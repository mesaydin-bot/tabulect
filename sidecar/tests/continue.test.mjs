import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { startContinueFill } from "../lib/continue.mjs";
import { claimFill, isPartialFill, liveFillJobId } from "../lib/fill.mjs";
import { isSkippedFillRow } from "../lib/providers/run.mjs";
import { loadDocument, saveDocument } from "../lib/store.mjs";
import { delay } from "../lib/util.mjs";
import { COLUMN_KEYS } from "../lib/schema.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

function cells(overrides = {}) {
  const row = {
    id: "r-001",
    chunkId: "c-001",
    quoteAnchor: { chunkId: "c-001", start: 0, end: 8, page: 1, bbox: null },
    ...overrides,
  };
  for (const key of COLUMN_KEYS) {
    if (!(key in row)) row[key] = key === "objection" ? null : key === "claim" ? "keep" : "";
  }
  return row;
}

function chunk(id, text, index) {
  return {
    id,
    text,
    page: 1,
    start: index * 40,
    end: index * 40 + text.length,
  };
}

function partialDoc(id) {
  const chunks = [
    chunk("c-001", "Birinci parça yavaş okumak.", 0),
    chunk("c-002", "İkinci parça yapı işidir.", 1),
    chunk("c-003", "Üçüncü parça satır uydurulmaz.", 2),
  ];
  return {
    id,
    title: "How to Read a Book",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks,
    rows: [cells({ id: "r-001", chunkId: "c-001", quoteAnchor: { chunkId: "c-001", start: 0, end: 8, page: 1, bbox: null } })],
  };
}

async function waitJob(jobs, jobId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = jobs.get(jobId);
    if (job?.finished) return job;
    await delay(20);
  }
  throw new Error(`continue job ${jobId} did not finish`);
}

describe("continue fill", { concurrency: false }, () => {

test("POST continue fills leftover chunks and is a no-op when complete", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-"));
  const doc = partialDoc("doc-continue-1");
  await saveDocument(doc, dataRoot);
  assert.equal(isPartialFill(doc), true);

  const jobs = new Map();
  const first = await startContinueFill({
    documentId: doc.id,
    registerJob: (job) => jobs.set(job.jobId, job),
    dataRoot,
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.continued, true);
  assert.ok(first.body.jobId);

  const busy = await startContinueFill({
    documentId: doc.id,
    registerJob: (job) => jobs.set(job.jobId, job),
    dataRoot,
  });
  assert.equal(busy.status, 202);
  assert.equal(busy.body.busy, true);
  assert.equal(busy.body.jobId, first.body.jobId);

  const job = await waitJob(jobs, first.body.jobId);
  assert.equal(job.events.at(-1).phase, "done");
  assert.ok(job.events.some((event) => /chunks/.test(event.message)));

  const filled = await loadDocument(doc.id, dataRoot);
  assert.equal(filled.rows.length, 3);
  assert.equal(isPartialFill(filled), false);
  assert.equal(filled.rows[0].claim, "keep");
  assert.ok(filled.rows[1].claim);
  assert.ok(filled.rows[2].claim);

  const done = await startContinueFill({
    documentId: doc.id,
    registerJob: (job) => jobs.set(job.jobId, job),
    dataRoot,
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.complete, true);
  assert.equal(done.body.jobId, null);

  delete process.env.TABULECT_CLI_CODEX;
});

test("empty leftover chunks skip in place instead of fake done/devam", async () => {
  await chmod(FAKE, 0o755);
  const prev = {
    cli: process.env.TABULECT_CLI_CODEX,
    retry: process.env.TABULECT_RETRY_BASE_MS,
    idle: process.env.TABULECT_FILL_IDLE_WAVES,
    empty: process.env.FAKE_CODEX_EMPTY,
    inline: process.env.TABULECT_FILL_INLINE,
  };
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_FILL_IDLE_WAVES = "1";
  process.env.FAKE_CODEX_EMPTY = "1";
  process.env.TABULECT_FILL_INLINE = "1";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-empty-"));
  const doc = partialDoc("doc-continue-empty");
  await saveDocument(doc, dataRoot);
  const jobs = new Map();
  try {
    const started = await startContinueFill({
      documentId: doc.id,
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot,
      force: true,
    });
    assert.equal(started.status, 202);
    const job = await waitJob(jobs, started.body.jobId);
    const last = job.events.at(-1);
    assert.equal(last.phase, "done");
    assert.equal(last.error, null);
    const kept = await loadDocument(doc.id, dataRoot);
    assert.equal(kept.rows.length, 3);
    assert.equal(isPartialFill(kept), false);
    assert.equal(kept.rows[0].claim, "keep");
    assert.equal(kept.rows[1].claim, "");
    assert.equal(isSkippedFillRow(kept.rows[1]), true);
    assert.equal(isSkippedFillRow(kept.rows[2]), true);
  } finally {
    if (prev.cli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prev.cli;
    if (prev.retry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prev.retry;
    if (prev.idle == null) delete process.env.TABULECT_FILL_IDLE_WAVES;
    else process.env.TABULECT_FILL_IDLE_WAVES = prev.idle;
    if (prev.empty == null) delete process.env.FAKE_CODEX_EMPTY;
    else process.env.FAKE_CODEX_EMPTY = prev.empty;
    if (prev.inline == null) delete process.env.TABULECT_FILL_INLINE;
    else process.env.TABULECT_FILL_INLINE = prev.inline;
  }
});

test("empty output on one leftover chunk skips the hole and fills the rest", async () => {
  await chmod(FAKE, 0o755);
  const prev = {
    cli: process.env.TABULECT_CLI_CODEX,
    retry: process.env.TABULECT_RETRY_BASE_MS,
    idle: process.env.TABULECT_FILL_IDLE_WAVES,
    skip: process.env.FAKE_CODEX_SKIP_IDS,
    empty: process.env.FAKE_CODEX_EMPTY,
    inline: process.env.TABULECT_FILL_INLINE,
  };
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_FILL_IDLE_WAVES = "1";
  process.env.FAKE_CODEX_SKIP_IDS = "c-002";
  delete process.env.FAKE_CODEX_EMPTY;
  process.env.TABULECT_FILL_INLINE = "1";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-skip-"));
  const doc = partialDoc("doc-continue-skip");
  await saveDocument(doc, dataRoot);
  const jobs = new Map();
  try {
    const started = await startContinueFill({
      documentId: doc.id,
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot,
      force: true,
    });
    const job = await waitJob(jobs, started.body.jobId);
    const last = job.events.at(-1);
    assert.equal(last.phase, "done");
    assert.equal(last.error, null);
    const kept = await loadDocument(doc.id, dataRoot);
    assert.equal(kept.rows.length, 3);
    assert.equal(kept.rows[0].chunkId, "c-001");
    assert.equal(kept.rows[1].chunkId, "c-002");
    assert.equal(kept.rows[2].chunkId, "c-003");
    assert.equal(kept.rows[1].claim, "");
    assert.equal(isSkippedFillRow(kept.rows[1]), true);
    assert.ok(kept.rows[2].claim);
    assert.equal(isPartialFill(kept), false);
  } finally {
    if (prev.cli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prev.cli;
    if (prev.retry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prev.retry;
    if (prev.idle == null) delete process.env.TABULECT_FILL_IDLE_WAVES;
    else process.env.TABULECT_FILL_IDLE_WAVES = prev.idle;
    if (prev.skip == null) delete process.env.FAKE_CODEX_SKIP_IDS;
    else process.env.FAKE_CODEX_SKIP_IDS = prev.skip;
    if (prev.empty == null) delete process.env.FAKE_CODEX_EMPTY;
    else process.env.FAKE_CODEX_EMPTY = prev.empty;
    if (prev.inline == null) delete process.env.TABULECT_FILL_INLINE;
    else process.env.TABULECT_FILL_INLINE = prev.inline;
  }
});

test("continue 404s for unknown documents", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-miss-"));
  const result = await startContinueFill({
    documentId: "no-such-doc",
    dataRoot,
    registerJob: () => {},
  });
  assert.equal(result.status, 404);
});

test("a stalled busy lock with zero progress does not block a new continue", async () => {
  await chmod(FAKE, 0o755);
  const prevStall = process.env.TABULECT_FILL_STALL_MS;
  const prevCli = process.env.TABULECT_CLI_CODEX;
  const prevRetry = process.env.TABULECT_RETRY_BASE_MS;
  process.env.TABULECT_FILL_STALL_MS = "25";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const { spawn } = await import("node:child_process");
  const hung = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-stall-"));
  const doc = partialDoc("doc-continue-stall");
  await saveDocument(doc, dataRoot);
  const jobs = new Map();
  try {
    claimFill(
      doc.id,
      "ghost-busy-328",
      { finished: false },
      {
        pid: hung.pid,
        lastProgressAt: Date.now() - 5_000,
        lastGrowthAt: Date.now() - 5_000,
        filled: 328,
        clis: 0,
      },
    );
    const started = await startContinueFill({
      documentId: doc.id,
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot,
      force: true,
    });
    assert.equal(started.status, 202);
    assert.equal(started.body.continued, true);
    assert.notEqual(started.body.jobId, "ghost-busy-328");
    assert.equal(liveFillJobId(doc.id), started.body.jobId);
    const job = await waitJob(jobs, started.body.jobId);
    assert.equal(job.events.at(-1).phase, "done");
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 3);
  } finally {
    try {
      hung.kill("SIGKILL");
    } catch {
      /* gone */
    }
    if (prevStall == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prevStall;
    if (prevCli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prevCli;
    if (prevRetry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prevRetry;
  }
});

test("isolated continue is not stall-killed while the provider CLI is in flight", async () => {
  await chmod(FAKE, 0o755);
  const prev = {
    stall: process.env.TABULECT_FILL_STALL_MS,
    sleep: process.env.FAKE_CODEX_SLEEP_MS,
    live: process.env.FAKE_CODEX_LIVE,
    cli: process.env.TABULECT_CLI_CODEX,
    retry: process.env.TABULECT_RETRY_BASE_MS,
    inline: process.env.TABULECT_FILL_INLINE,
    worker: process.env.TABULECT_FILL_WORKER,
    batch: process.env.TABULECT_BATCH_SIZE,
  };
  delete process.env.TABULECT_FILL_INLINE;
  delete process.env.TABULECT_FILL_WORKER;
  process.env.TABULECT_FILL_STALL_MS = "2000";
  process.env.FAKE_CODEX_SLEEP_MS = "6000";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_BATCH_SIZE = "1";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-continue-inflight-"));
  const livePath = join(dataRoot, "live.log");
  process.env.FAKE_CODEX_LIVE = livePath;
  const doc = partialDoc("doc-continue-inflight");
  await saveDocument(doc, dataRoot);
  const jobs = new Map();
  try {
    const started = await startContinueFill({
      documentId: doc.id,
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot,
      force: true,
    });
    assert.equal(started.body.continued, true);
    await delay(2500);
    assert.equal(
      liveFillJobId(doc.id),
      started.body.jobId,
      "stall must not kill a fill-worker whose provider CLI is still running",
    );
    const job = await waitJob(jobs, started.body.jobId, 30000);
    assert.equal(job.events.at(-1).phase, "done");
    assert.equal(job.events.at(-1).error, null);
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 3);
  } finally {
    if (prev.stall == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev.stall;
    if (prev.sleep == null) delete process.env.FAKE_CODEX_SLEEP_MS;
    else process.env.FAKE_CODEX_SLEEP_MS = prev.sleep;
    if (prev.live == null) delete process.env.FAKE_CODEX_LIVE;
    else process.env.FAKE_CODEX_LIVE = prev.live;
    if (prev.cli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prev.cli;
    if (prev.retry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prev.retry;
    if (prev.inline == null) delete process.env.TABULECT_FILL_INLINE;
    else process.env.TABULECT_FILL_INLINE = prev.inline;
    if (prev.worker == null) delete process.env.TABULECT_FILL_WORKER;
    else process.env.TABULECT_FILL_WORKER = prev.worker;
    if (prev.batch == null) delete process.env.TABULECT_BATCH_SIZE;
    else process.env.TABULECT_BATCH_SIZE = prev.batch;
  }
});

});
