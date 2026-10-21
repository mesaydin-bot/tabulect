import { t } from "./i18n.mjs";
/**
 * Partial schema-fill helpers: leftover chunks, error classification, in-process lock.
 * One row per chunk. Unfilled chunks are retried by continue / the autofill worker.
 */

import { inFlightCliCount } from "./util.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_FILL_STALL_MS = 300_000;
/** Worker/HTTP lock pings. Must stay well below DEFAULT_FILL_STALL_MS. */
export const FILL_HEARTBEAT_MS = 1_000;
const fillLocks = new Map(); // documentId -> { jobId, job, pid, lastProgressAt, lastGrowthAt, filled, clis }
const hardUntil = new Map(); // documentId -> timestamp ms

/** True when the pid exists. Used to drop ghost fill locks after a worker dies. */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export function unfilledChunks(doc) {
  const have = new Set((doc?.rows || []).map((row) => row.chunkId));
  return (doc?.chunks || []).filter((chunk) => chunk && typeof chunk.id === "string" && !have.has(chunk.id));
}

export function isPartialFill(doc) {
  if (!doc || !Array.isArray(doc.chunks) || doc.chunks.length === 0) return false;
  return unfilledChunks(doc).length > 0;
}

export function fillPct(filled, total) {
  if (!total || total <= 0) return 74;
  const t = Math.max(0, Math.min(1, filled / total));
  return Math.min(99, 74 + Math.round(t * 25));
}

export function fillProgressMessage(filled, total, extra = "") {
  const base = t('n01Chunks', filled, total);
  return extra ? `${base} · ${extra}` : base;
}

/** Sidecar autofill no-ops when this file exists in the data root. Do not delete it. */
export function isAutofillPaused(root) {
  if (String(process.env.TABULECT_AUTOFILL ?? "1") === "0") return true;
  const dest =
    root ||
    process.env.TABULECT_DATA ||
    join(homedir(), ".local", "share", "tabulect");
  try {
    return existsSync(join(dest, "autofill.pause"));
  } catch {
    return false;
  }
}

export function retryBaseMs(raw = process.env.TABULECT_RETRY_BASE_MS) {
  if (raw == null || String(raw).trim() === "") return 800;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 800;
  return n;
}

export function backoffMs(attempt, base = retryBaseMs()) {
  if (base <= 0) return 0;
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(30_000, base * 2 ** (n - 1));
}

const TRANSIENT_RE =
  /empty output|empty response|timed out|timeout|rate limit|quota|usage limit|workspace trust|do you trust|--trust|non-tty|not a tty|is not a tty|TERM=dumb|dumb terminal|headless|ECONNRESET|EPIPE|ETIMEDOUT|fabricated|did not return valid|no valid schema JSON|no valid rows|refusing to invent data/i;

export function isHardProviderError(error) {
  if (isEmptyFillError(error)) return false;
  const msg = String(error?.message || error || "");
  if (TRANSIENT_RE.test(msg)) return false;
  return /not logged|is unavailable|was not found \(|CLI and sign in|Unknown provider|unauthoriz|unauthenticated|sign in to the subscription|does not accept API keys/i.test(
    msg,
  );
}

export function isEmptyFillError(error) {
  if (error && error.code === "EMPTY_FILL") return true;
  return /provider CLI was never spawned|provider returned no new rows|leftover chunks remain/i.test(
    String(error?.message || error || ""),
  );
}

export function emptyFillError({ filled = 0, total = 0, leftover = 0, clisSeen = 0, cause } = {}) {
  const why =
    clisSeen <= 0
      ? "provider CLI was never spawned"
      : "provider returned no new rows";
  const err = new Error(
    `${why} (${filled}/${total} chunks, ${leftover} leftover chunks remain). Kimi needs --prompt TEXT (not a bare positional). Cursor needs -p --trust -f. Empty waves are not a completed fill.`,
  );
  err.code = "EMPTY_FILL";
  if (cause) err.cause = cause;
  return err;
}

export function isTransientProviderError(error) {
  if (isHardProviderError(error)) return false;
  if (isEmptyFillError(error)) return false;
  return true;
}

/**
 * CLI ran (or timed out) and still produced nothing usable for this chunk.
 * After per-chunk retries, persist an empty-claim skip row instead of
 * leaving the leftover hole at the front of every later wave.
 * Do not skip hard auth / missing CLI, or a live rate-limit window.
 */
export function isUnrecoverableFillMiss(error) {
  if (!error || isHardProviderError(error) || isEmptyFillError(error)) return false;
  const msg = String(error.message || error);
  if (
    /rate limit|quota|usage limit|workspace trust|do you trust|--trust|not a tty|TERM=dumb|not logged|unauthoriz|CLI and sign in|Unknown provider|was not found \(/i.test(
      msg,
    )
  ) {
    return false;
  }
  // Match the inner CLI/parse failure, not the fillRowsWithAdapter wrapper
  // ("no valid rows — refusing to invent data") which also covers rate limits.
  return /empty output|empty response|provider output rows is empty|provider output is not valid JSON|rows must use the provided chunkId|timed out|timeout|Return a single JSON object|not valid JSON|JSON failed schema/i.test(
    msg,
  );
}

export function stallMs(raw = process.env.TABULECT_FILL_STALL_MS) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_FILL_STALL_MS;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FILL_STALL_MS;
  return n;
}

function killFillPid(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0 || n === process.pid) return;
  try {
    process.kill(n, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function isStalled(entry, now, stall) {
  if (stall <= 0) return false;
  const clis = inFlightCliCount(entry.pid, entry.clis);
  // A live kimi/codex child means the first persist has not landed yet, not a dead lock.
  if (clis > 0) return false;
  const lastBeat = entry.lastProgressAt || 0;
  // Heartbeats ("çalışıyor") mean the isolated worker is alive. Do not SIGKILL it
  // just because rows have not grown yet — a slow subscription CLI batch can take
  // minutes, and killing mid-wave strands the book at the last persist.
  return now - lastBeat > stall;
}

export function isFillKillReason(reason) {
  return /\bSIGKILL\b|\bSIGTERM\b|killed \(SIG/i.test(String(reason || ""));
}

const fillLimits = new Map(); // documentId -> { batch, concurrency }

export function documentFillLimits(documentId) {
  if (!documentId) return null;
  return fillLimits.get(documentId) || null;
}

/** After OS OOM/SIGKILL, the next wave uses one CLI and one chunk. */
export function tightenFillLimits(documentId) {
  if (!documentId) return { batch: 1, concurrency: 1 };
  const next = { batch: 1, concurrency: 1 };
  fillLimits.set(documentId, next);
  return next;
}

export function clearFillLimits(documentId) {
  if (documentId) fillLimits.delete(documentId);
}

let resumeHandler = null;
const resumeTimers = new Map();
const resumeAttempts = new Map();

export function setFillResumeHandler(fn) {
  resumeHandler = typeof fn === "function" ? fn : null;
}

/** Same-engine relaunch after OS SIGKILL. Not an external watchdog. */
export function scheduleFillResume(documentId, { dataRoot, reason } = {}) {
  if (!documentId || !isFillKillReason(reason)) return false;
  if (String(process.env.TABULECT_AUTOFILL ?? "1") === "0") return false;
  if (isAutofillPaused(dataRoot)) return false;
  tightenFillLimits(documentId);
  if (resumeTimers.has(documentId)) return true;
  const attempt = (resumeAttempts.get(documentId) || 0) + 1;
  resumeAttempts.set(documentId, Math.min(attempt, 8));
  const delay = Math.min(12_000, 1000 * 2 ** Math.min(attempt - 1, 3));
  const timer = setTimeout(() => {
    resumeTimers.delete(documentId);
    if (liveFillJobId(documentId)) return;
    try {
      resumeHandler?.({ documentId, dataRoot });
    } catch {
      /* next autofill tick */
    }
  }, delay);
  resumeTimers.set(documentId, timer);
  return true;
}

export function resetFillResume(documentId) {
  if (!documentId) return;
  const timer = resumeTimers.get(documentId);
  if (timer) clearTimeout(timer);
  resumeTimers.delete(documentId);
  resumeAttempts.delete(documentId);
}

export function liveFillJobId(documentId) {
  const entry = fillLocks.get(documentId);
  if (!entry) return null;
  if (entry.job?.finished) {
    fillLocks.delete(documentId);
    return null;
  }
  if (entry.pid && !pidAlive(entry.pid)) {
    fillLocks.delete(documentId);
    return null;
  }
  const stall = stallMs();
  if (isStalled(entry, Date.now(), stall)) {
    killFillPid(entry.pid);
    fillLocks.delete(documentId);
    return null;
  }
  return entry.jobId;
}

export function claimFill(documentId, jobId, job = null, extra = {}) {
  if (!documentId) return null;
  const live = liveFillJobId(documentId);
  if (live && live !== jobId) return live;
  const now = Date.now();
  fillLocks.set(documentId, {
    jobId,
    job,
    pid: extra.pid ?? extra.workerPid ?? null,
    lastProgressAt: extra.lastProgressAt ?? now,
    lastGrowthAt: extra.lastGrowthAt ?? extra.lastProgressAt ?? now,
    filled: Number.isFinite(extra.filled) ? extra.filled : 0,
    clis: Number.isFinite(extra.clis) ? extra.clis : 0,
  });
  return jobId;
}

export function touchFill(documentId, extra = {}) {
  const entry = fillLocks.get(documentId);
  if (!entry) return;
  entry.lastProgressAt = Date.now();
  if (Number.isFinite(extra.clis)) {
    entry.clis = Math.max(0, extra.clis, inFlightCliCount(entry.pid, extra.clis));
  }
  if (Number.isFinite(extra.filled) && extra.filled > (entry.filled ?? -1)) {
    entry.filled = extra.filled;
    entry.lastGrowthAt = Date.now();
  }
}

export function releaseFill(documentId, jobId) {
  const entry = fillLocks.get(documentId);
  if (!entry) return;
  if (!jobId || entry.jobId === jobId) fillLocks.delete(documentId);
}

export function markHardFillError(documentId, ms = 60_000) {
  if (!documentId) return;
  hardUntil.set(documentId, Date.now() + ms);
}

export function clearHardFillError(documentId) {
  if (documentId) hardUntil.delete(documentId);
}

export function hardFillBlocked(documentId) {
  const until = hardUntil.get(documentId);
  if (!until) return false;
  if (Date.now() >= until) {
    hardUntil.delete(documentId);
    return false;
  }
  return true;
}
