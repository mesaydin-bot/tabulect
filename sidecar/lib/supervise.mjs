import { t } from "./i18n.mjs";
/**
 * Keep the HTTP process alive while schema-fill runs in a child.
 * A provider CLI crash, stdin EPIPE, or worker abort must not take port 8755 down.
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { closeJob, pushEvent } from "./ingest.mjs";
import {
  claimFill,
  fillPct,
  fillProgressMessage,
  isFillKillReason,
  isPartialFill,
  releaseFill,
  scheduleFillResume,
  touchFill,
  unfilledChunks,
} from "./fill.mjs";
import { loadDocument, saveJobRecord } from "./store.mjs";

const WORKER = fileURLToPath(new URL("./fill-worker.mjs", import.meta.url));

export function isolateFillEnabled() {
  if (String(process.env.TABULECT_FILL_INLINE || "") === "1") return false;
  if (String(process.env.TABULECT_FILL_WORKER || "") === "1") return false;
  return true;
}

export function installProcessKeepAlive() {
  if (globalThis.__tabularKeepAlive) return;
  globalThis.__tabularKeepAlive = true;
  const log = (kind, error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`tabulect ${kind}: ${message}`);
  };
  process.on("uncaughtException", (error) => log("uncaughtException", error));
  process.on("unhandledRejection", (error) => log("unhandledRejection", error));
  try {
    process.on("SIGPIPE", () => {});
  } catch {
    /* windows */
  }
}

function isSoftDoneEvent(event) {
  if (!event || event.phase !== "done") return false;
  if (event.error != null && event.error !== "") return true;
  return /devam|kesildi/i.test(String(event.message || ""));
}

function settleJob(job, { documentId, dataRoot, reason } = {}) {
  if (job.finished) {
    releaseFill(documentId, job.jobId);
    return;
  }
  const last = job.events.at(-1);
  if (last?.phase === "error") {
    closeJob(job);
    releaseFill(documentId, job.jobId);
    void saveJobRecord(job, dataRoot).catch(() => {});
    return;
  }
  if (last?.phase === "done" && last.error == null && !isSoftDoneEvent(last)) {
    closeJob(job);
    releaseFill(documentId, job.jobId);
    void saveJobRecord(job, dataRoot).catch(() => {});
    return;
  }
  void loadDocument(documentId, dataRoot)
    .then((doc) => {
      if (job.finished) return;
      if (!doc) {
        const text = reason && reason !== "devam" ? reason : "fill worker stopped";
        pushEvent(job, {
          phase: "error",
          pct: last?.pct ?? 0,
          message: t('operationFailed'),
          documentId,
          error: text,
        });
        closeJob(job);
        releaseFill(documentId, job.jobId);
        return saveJobRecord(job, dataRoot);
      }
      const rows = doc.rows?.length ?? 0;
      const total = doc.chunks?.length ?? 0;
      const leftover = unfilledChunks(doc).length;
      if (leftover > 0 || isPartialFill(doc)) {
        const text =
          reason && reason !== "devam"
            ? reason
            : `fill worker stopped with ${leftover} leftover chunks`;
        pushEvent(job, {
          phase: "error",
          pct: fillPct(rows, total) || 74,
          message: fillProgressMessage(rows, total, "kesildi"),
          documentId,
          error: text,
          filled: rows,
        });
        closeJob(job);
        releaseFill(documentId, job.jobId);
        if (isFillKillReason(reason) || isFillKillReason(text)) {
          scheduleFillResume(documentId, { dataRoot, reason: reason || text });
        }
      } else {
        pushEvent(job, {
          phase: "done",
          pct: 100,
          message: t('done'),
          documentId,
          error: null,
        });
        closeJob(job);
        releaseFill(documentId, job.jobId);
      }
      return saveJobRecord(job, dataRoot);
    })
    .catch(() => {
      if (job.finished) return;
      const text = reason && reason !== "devam" ? reason : "fill worker stopped";
      pushEvent(job, {
        phase: "error",
        pct: last?.pct ?? 0,
        message: t('operationFailed'),
        documentId,
        error: text,
      });
      closeJob(job);
      releaseFill(documentId, job.jobId);
    });
}

export function spawnFillWorker({ kind, job, dataRoot, payload = {} } = {}) {
  const documentId = job.documentId || payload.documentId || null;
  const child = fork(WORKER, [], {
    env: { ...process.env, TABULECT_FILL_WORKER: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let settled = false;
  const finish = (reason) => {
    if (settled) return;
    settled = true;
    settleJob(job, { documentId, dataRoot, reason });
  };

  claimFill(documentId, job.jobId, job, { pid: child.pid });
  child.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "heartbeat") {
      touchFill(documentId, {
        filled: Number.isFinite(msg.filled) ? msg.filled : undefined,
        clis: Number.isFinite(msg.clis) ? msg.clis : undefined,
      });
      return;
    }
    if (msg.type === "event" && msg.event) {
      pushEvent(job, msg.event);
      touchFill(documentId, {
        filled: Number.isFinite(msg.event.filled) ? msg.event.filled : undefined,
        clis: Number.isFinite(msg.event.clis) ? msg.event.clis : undefined,
      });
      const phase = msg.event.phase;
      if (phase === "error") {
        if (!job.finished) closeJob(job);
        releaseFill(documentId, job.jobId);
        settled = true;
        void saveJobRecord(job, dataRoot).catch(() => {});
      } else if (phase === "done" && !isSoftDoneEvent(msg.event)) {
        if (!job.finished) closeJob(job);
        releaseFill(documentId, job.jobId);
        settled = true;
        void saveJobRecord(job, dataRoot).catch(() => {});
      }
      return;
    }
    if (msg.type === "finished") {
      const snap = msg.snapshot;
      if (snap?.phase === "error" || snap?.error) {
        finish(String(snap.error || snap.message || "fill worker error"));
      } else {
        finish("interrupted");
      }
      return;
    }
    if (msg.type === "crash") {
      finish(String(msg.error || "worker crash"));
    }
  });
  child.on("exit", (code, signal) => {
    const reason = signal
      ? `fill worker killed (${signal})`
      : `fill worker exited ${code ?? 0}`;
    finish(reason);
  });
  child.on("error", (error) => finish(error instanceof Error ? error.message : "fill worker error"));
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  child.stdout?.on("error", () => {});
  child.stderr?.on("error", () => {});
  let sent = false;
  const sendOnce = () => {
    if (sent || !child.connected) return;
    sent = true;
    if (child.pid) claimFill(documentId, job.jobId, job, { pid: child.pid });
    child.send({
      kind,
      jobId: job.jobId,
      documentId,
      provider: job.provider,
      tableLocale: job.tableLocale,
      dataRoot: dataRoot || null,
      filename: job.filename,
      mime: job.mime,
      ...payload,
    });
  };
  child.on("spawn", sendOnce);
  sendOnce();
  return child;
}

export { pidAlive } from "./fill.mjs";
export {
  spawnBatchAgent,
  batchAgentsEnabled,
  getBatchAgentSpawnCount,
  resetBatchAgentSpawnCount,
} from "./batch-agent.mjs";
