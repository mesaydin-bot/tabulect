import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFillJob } from "../lib/ingest.mjs";
import {
  claimFill,
  liveFillJobId,
  pidAlive,
  releaseFill,
  setFillResumeHandler,
  resetFillResume,
  documentFillLimits,
  clearFillLimits,
} from "../lib/fill.mjs";
import { COLUMN_KEYS } from "../lib/schema.mjs";
import { saveDocument, loadDocument } from "../lib/store.mjs";
import {
  isolateFillEnabled,
  spawnFillWorker,
  spawnBatchAgent,
  batchAgentsEnabled,
  getBatchAgentSpawnCount,
  resetBatchAgentSpawnCount,
} from "../lib/supervise.mjs";
import { startContinueFill } from "../lib/continue.mjs";
import { delay, runCommand } from "../lib/util.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

test("pidAlive is false for a process that does not exist", () => {
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(999999991), false);
  assert.equal(pidAlive(process.pid), true);
});

test("a dead worker pid drops the in-memory fill lock", () => {
  const documentId = "doc-ghost-lock";
  claimFill(documentId, "job-ghost", { finished: false }, { pid: 999999992 });
  assert.equal(liveFillJobId(documentId), null);
  claimFill(documentId, "job-live", { finished: false }, { pid: process.pid });
  assert.equal(liveFillJobId(documentId), "job-live");
  releaseFill(documentId, "job-live");
  assert.equal(liveFillJobId(documentId), null);
});

test("isolateFillEnabled is on unless INLINE or already a worker", () => {
  const inline = process.env.TABULECT_FILL_INLINE;
  const worker = process.env.TABULECT_FILL_WORKER;
  delete process.env.TABULECT_FILL_INLINE;
  delete process.env.TABULECT_FILL_WORKER;
  assert.equal(isolateFillEnabled(), true);
  process.env.TABULECT_FILL_INLINE = "1";
  assert.equal(isolateFillEnabled(), false);
  delete process.env.TABULECT_FILL_INLINE;
  process.env.TABULECT_FILL_WORKER = "1";
  assert.equal(isolateFillEnabled(), false);
  if (inline == null) delete process.env.TABULECT_FILL_INLINE;
  else process.env.TABULECT_FILL_INLINE = inline;
  if (worker == null) delete process.env.TABULECT_FILL_WORKER;
  else process.env.TABULECT_FILL_WORKER = worker;
});

test("batchAgentsEnabled never nests fill-workers (inline CLI in the isolated worker)", () => {
  const worker = process.env.TABULECT_FILL_WORKER;
  delete process.env.TABULECT_FILL_INLINE;
  delete process.env.TABULECT_BATCH_INLINE;
  delete process.env.TABULECT_FILL_WORKER;
  assert.equal(batchAgentsEnabled(), false);
  process.env.TABULECT_FILL_WORKER = "1";
  assert.equal(batchAgentsEnabled(), false);
  if (worker == null) delete process.env.TABULECT_FILL_WORKER;
  else process.env.TABULECT_FILL_WORKER = worker;
});

test("CLI closing stdin does not crash the parent process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-stdin-epipe-"));
  const bin = join(dir, "close-stdin.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node
process.stdin.on("error", () => {});
process.stdin.destroy();
setTimeout(() => {
  process.stdout.write("ok-from-closed-stdin\\n");
  process.exit(0);
}, 30);
`,
  );
  await chmod(bin, 0o755);
  const result = await runCommand(process.execPath, [bin], {
    input: "x".repeat(256 * 1024),
    timeoutMs: 5000,
  });
  assert.match(result.stdout, /ok-from-closed-stdin/);
});

test("a crashed fill worker releases the lock and does not fake done/devam", async () => {
  process.env.TABULECT_WORKER_CRASH = "1";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-worker-crash-"));
  const job = createFillJob({
    documentId: "doc-worker-crash",
    provider: "codex",
    tableLocale: "tr",
  });
  spawnFillWorker({ kind: "continue", job, dataRoot });
  const start = Date.now();
  while (!job.finished && Date.now() - start < 8000) {
    await delay(20);
  }
  assert.equal(job.finished, true);
  const last = job.events.at(-1);
  assert.equal(last.phase, "error");
  assert.ok(last.error);
  assert.doesNotMatch(String(last.message || ""), /devam/);
  assert.equal(liveFillJobId("doc-worker-crash"), null);
  delete process.env.TABULECT_WORKER_CRASH;
});

test("killing a fill-worker with leftover chunks is an error, not done/devam", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-worker-leftover-"));
  const row = {
    id: "r-001",
    chunkId: "c-001",
    quoteAnchor: { chunkId: "c-001", start: 0, end: 8, page: 1, bbox: null },
    claim: "keep",
  };
  for (const key of COLUMN_KEYS) {
    if (!(key in row)) row[key] = key === "objection" ? null : "";
  }
  const doc = {
    id: "doc-worker-leftover",
    title: "Leftover interrupt",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [
      { id: "c-001", text: "Birinci parça yavaş okumak bir yapı işidir.", page: 1, start: 0, end: 40 },
      { id: "c-002", text: "İkinci parça satır uydurulmaz.", page: 1, start: 40, end: 70 },
    ],
    rows: [row],
  };
  await saveDocument(doc, dataRoot);
  process.env.TABULECT_WORKER_CRASH = "1";
  const job = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
  });
  spawnFillWorker({ kind: "continue", job, dataRoot });
  const start = Date.now();
  while (!job.finished && Date.now() - start < 8000) {
    await delay(20);
  }
  assert.equal(job.finished, true);
  const last = job.events.at(-1);
  assert.equal(last.phase, "error");
  assert.ok(last.error);
  assert.doesNotMatch(String(last.message || ""), /^\d+\/\d+ chunks · continuing$/);
  assert.notEqual(last.error, null);
  const kept = await loadDocument(doc.id, dataRoot);
  assert.equal(kept.rows.length, 1);
  assert.equal(liveFillJobId(doc.id), null);
  delete process.env.TABULECT_WORKER_CRASH;
});

test("nested batch fork from inside a fill-worker is forbidden", async () => {
  const prev = process.env.TABULECT_FILL_WORKER;
  process.env.TABULECT_FILL_WORKER = "1";
  resetBatchAgentSpawnCount();
  try {
    await assert.rejects(
      () =>
        spawnBatchAgent({
          provider: "codex",
          tableLocale: "tr",
          chunks: [{ id: "c-001", text: "x", page: 1, start: 0, end: 1 }],
        }),
      /nested batch fill-worker is forbidden/,
    );
    assert.equal(getBatchAgentSpawnCount(), 0);
  } finally {
    if (prev == null) delete process.env.TABULECT_FILL_WORKER;
    else process.env.TABULECT_FILL_WORKER = prev;
  }
});

test("spawnBatchAgent fills a chunk slice in an isolated child", async () => {
  await chmod(FAKE, 0o755);
  const prevInline = process.env.TABULECT_FILL_INLINE;
  const prevBatch = process.env.TABULECT_BATCH_INLINE;
  delete process.env.TABULECT_FILL_INLINE;
  delete process.env.TABULECT_BATCH_INLINE;
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const rows = await spawnBatchAgent({
    provider: "codex",
    tableLocale: "tr",
    chunks: [
      {
        id: "c-101",
        text: "Yavaş okumak bir yapı işidir ve satır uydurulmaz.",
        page: 1,
        start: 0,
        end: 48,
      },
      {
        id: "c-102",
        text: "İkinci parça da aynı şemayı doldurur.",
        page: 1,
        start: 50,
        end: 87,
      },
    ],
    timeoutMs: 15000,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chunkId, "c-101");
  assert.ok(rows[0].claim);
  assert.ok(rows[1].claim);
  delete process.env.TABULECT_CLI_CODEX;
  if (prevInline == null) delete process.env.TABULECT_FILL_INLINE;
  else process.env.TABULECT_FILL_INLINE = prevInline;
  if (prevBatch == null) delete process.env.TABULECT_BATCH_INLINE;
  else process.env.TABULECT_BATCH_INLINE = prevBatch;
});

test("SIGKILL with leftover chunks relaunches continue at tighter limits", async () => {
  await chmod(FAKE, 0o755);
  const prevCli = process.env.TABULECT_CLI_CODEX;
  const prevRetry = process.env.TABULECT_RETRY_BASE_MS;
  const prevSleep = process.env.FAKE_CODEX_SLEEP_MS;
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.FAKE_CODEX_SLEEP_MS = "1500";
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-worker-sigkill-"));
  const row = {
    id: "r-001",
    chunkId: "c-001",
    quoteAnchor: { chunkId: "c-001", start: 0, end: 8, page: 1, bbox: null },
    claim: "keep",
  };
  for (const key of COLUMN_KEYS) {
    if (!(key in row)) row[key] = key === "objection" ? null : "";
  }
  const doc = {
    id: "doc-worker-sigkill",
    title: "SIGKILL resume",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [
      { id: "c-001", text: "Birinci parça yavaş okumak bir yapı işidir.", page: 1, start: 0, end: 40 },
      { id: "c-002", text: "İkinci parça satır uydurulmaz.", page: 1, start: 40, end: 70 },
    ],
    rows: [row],
  };
  await saveDocument(doc, dataRoot);
  const jobs = new Map();
  clearFillLimits(doc.id);
  resetFillResume(doc.id);
  setFillResumeHandler(({ documentId, dataRoot: root } = {}) => {
    void startContinueFill({
      documentId,
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot: root,
      force: true,
    });
  });
  const job = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
  });
  jobs.set(job.jobId, job);
  const child = spawnFillWorker({ kind: "continue", job, dataRoot });
  try {
    const start = Date.now();
    while (!child.pid && Date.now() - start < 2000) {
      await delay(10);
    }
    await delay(200);
    child.kill("SIGKILL");
    const died = Date.now();
    while (!job.finished && Date.now() - died < 8000) {
      await delay(20);
    }
    assert.equal(job.finished, true);
    const last = job.events.at(-1);
    assert.equal(last.phase, "error");
    assert.match(String(last.error || ""), /SIGKILL/);
    assert.deepEqual(documentFillLimits(doc.id), { batch: 1, concurrency: 1 });
    let resumed = null;
    const wait = Date.now();
    while (Date.now() - wait < 12000) {
      resumed = [...jobs.values()].find((item) => item.jobId !== job.jobId);
      if (resumed?.finished) break;
      await delay(40);
    }
    assert.ok(resumed, "SIGKILL must relaunch the same continue engine");
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 2);
    assert.equal(filled.rows[0].claim, "keep");
  } finally {
    setFillResumeHandler(null);
    resetFillResume(doc.id);
    clearFillLimits(doc.id);
    if (prevCli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prevCli;
    if (prevRetry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prevRetry;
    if (prevSleep == null) delete process.env.FAKE_CODEX_SLEEP_MS;
    else process.env.FAKE_CODEX_SLEEP_MS = prevSleep;
  }
});
