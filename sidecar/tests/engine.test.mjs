import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fillDocument, mapPool, mergeRowsByChunkId, sliceBatches } from "../lib/engine.mjs";
import { isEmptyFillError } from "../lib/fill.mjs";
import { isSkippedFillRow } from "../lib/providers/run.mjs";
import { COLUMN_KEYS } from "../lib/schema.mjs";
import { saveDocument, loadDocument } from "../lib/store.mjs";
import { delay } from "../lib/util.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

function cells(chunkId, index, claim) {
  const row = {
    id: `r-${String(index + 1).padStart(3, "0")}`,
    chunkId,
    quoteAnchor: { chunkId, start: 0, end: 8, page: 1, bbox: null },
    claim,
  };
  for (const key of COLUMN_KEYS) {
    if (!(key in row)) row[key] = key === "objection" ? null : "";
  }
  return row;
}

function chunk(id, text, index) {
  return { id, text, page: 1, start: index * 40, end: index * 40 + text.length };
}

test("sliceBatches and mapPool run bounded work", async () => {
  assert.deepEqual(
    sliceBatches([1, 2, 3, 4, 5], 2),
    [[1, 2], [3, 4], [5]],
  );
  const seen = [];
  const live = { n: 0, max: 0 };
  const out = await mapPool([10, 20, 30, 40], 2, async (item) => {
    live.n += 1;
    live.max = Math.max(live.max, live.n);
    seen.push(item);
    await delay(40);
    live.n -= 1;
    return item * 2;
  });
  assert.deepEqual(out, [20, 40, 60, 80]);
  assert.ok(live.max >= 2, `expected overlap, max=${live.max}`);
  assert.ok(live.max <= 2);
  assert.equal(seen.length, 4);
});

test("mergeRowsByChunkId keeps existing rows and assigns colliding ids", () => {
  const chunks = [chunk("c-001", "a", 0), chunk("c-002", "b", 1), chunk("c-003", "c", 2)];
  const existing = [cells("c-001", 0, "keep")];
  const incoming = [cells("c-002", 0, "new-2"), cells("c-001", 1, "ignore-dup")];
  const merged = mergeRowsByChunkId(existing, incoming, chunks);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].claim, "keep");
  assert.equal(merged[0].id, "r-001");
  assert.equal(merged[1].chunkId, "c-002");
  assert.equal(merged[1].claim, "new-2");
  assert.notEqual(merged[1].id, "r-001");
});

test("fillDocument fans leftover chunks to parallel CLI agents", async () => {
  await chmod(FAKE, 0o755);
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-engine-"));
  const livePath = join(dataRoot, "live.log");
  await writeFile(livePath, "");
  process.env.TABULECT_FILL_INLINE = "1";
  process.env.TABULECT_FILL_CONCURRENCY = "4";
  process.env.TABULECT_BATCH_SIZE = "2";
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_LIVE = livePath;
  process.env.FAKE_CODEX_SLEEP_MS = "80";

  const chunks = Array.from({ length: 8 }, (_, i) =>
    chunk(`c-${String(i + 1).padStart(3, "0")}`, `Parça ${i + 1} yavaş okumak bir yapı işidir.`, i),
  );
  const doc = {
    id: "doc-engine-parallel",
    title: "Parallel fill",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks,
    rows: [cells("c-001", 0, "keep")],
  };
  await saveDocument(doc, dataRoot);

  try {
    const result = await fillDocument({
      documentId: doc.id,
      provider: "codex",
      tableLocale: "tr",
      dataRoot,
    });
    assert.equal(result.complete, true);
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 8);
    assert.equal(filled.rows[0].claim, "keep");
    assert.ok(filled.rows.every((row) => typeof row.claim === "string" && row.claim.length > 0));
    assert.ok(COLUMN_KEYS.every((key) => key in filled.rows[1]));

    const log = await readFile(livePath, "utf8");
    let live = 0;
    let max = 0;
    for (const line of log.split("\n")) {
      if (line.startsWith("start ")) {
        live += 1;
        max = Math.max(max, live);
      } else if (line.startsWith("end ")) {
        live = Math.max(0, live - 1);
      }
    }
    assert.ok(max >= 2, `parallel CLI agents expected, max=${max}\n${log}`);
  } finally {
    delete process.env.TABULECT_FILL_INLINE;
    delete process.env.TABULECT_FILL_CONCURRENCY;
    delete process.env.TABULECT_BATCH_SIZE;
    delete process.env.TABULECT_CLI_CODEX;
    delete process.env.FAKE_CODEX_LIVE;
    delete process.env.FAKE_CODEX_SLEEP_MS;
  }
});

test("FILL_WORKER fillDocument invokes the provider and never nests fill-workers", async () => {
  await chmod(FAKE, 0o755);
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-engine-worker-"));
  const livePath = join(dataRoot, "live.log");
  await writeFile(livePath, "");
  const prev = {
    worker: process.env.TABULECT_FILL_WORKER,
    inline: process.env.TABULECT_FILL_INLINE,
    concurrency: process.env.TABULECT_FILL_CONCURRENCY,
    batch: process.env.TABULECT_BATCH_SIZE,
    retry: process.env.TABULECT_RETRY_BASE_MS,
    cli: process.env.TABULECT_CLI_CODEX,
    live: process.env.FAKE_CODEX_LIVE,
    sleep: process.env.FAKE_CODEX_SLEEP_MS,
  };
  process.env.TABULECT_FILL_WORKER = "1";
  delete process.env.TABULECT_FILL_INLINE;
  process.env.TABULECT_FILL_CONCURRENCY = "2";
  process.env.TABULECT_BATCH_SIZE = "2";
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_LIVE = livePath;
  process.env.FAKE_CODEX_SLEEP_MS = "20";

  const { resetBatchAgentSpawnCount, getBatchAgentSpawnCount } = await import("../lib/batch-agent.mjs");
  resetBatchAgentSpawnCount();

  const chunks = Array.from({ length: 4 }, (_, i) =>
    chunk(`c-${String(i + 1).padStart(3, "0")}`, `Parça ${i + 1} yavaş okumak bir yapı işidir.`, i),
  );
  const doc = {
    id: "doc-engine-fill-worker",
    title: "Worker inline fill",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks,
    rows: [cells("c-001", 0, "keep")],
  };
  await saveDocument(doc, dataRoot);

  try {
    const result = await fillDocument({
      documentId: doc.id,
      provider: "codex",
      tableLocale: "tr",
      dataRoot,
    });
    assert.equal(result.complete, true);
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 4);
    assert.equal(filled.rows[0].claim, "keep");
    assert.ok(filled.rows.every((row) => typeof row.claim === "string" && row.claim.length > 0));
    const log = await readFile(livePath, "utf8");
    assert.match(log, /start /, "provider CLI must be invoked from inside FILL_WORKER");
    assert.equal(getBatchAgentSpawnCount(), 0, "nested fill-worker forks must not run");
  } finally {
    if (prev.worker == null) delete process.env.TABULECT_FILL_WORKER;
    else process.env.TABULECT_FILL_WORKER = prev.worker;
    if (prev.inline == null) delete process.env.TABULECT_FILL_INLINE;
    else process.env.TABULECT_FILL_INLINE = prev.inline;
    if (prev.concurrency == null) delete process.env.TABULECT_FILL_CONCURRENCY;
    else process.env.TABULECT_FILL_CONCURRENCY = prev.concurrency;
    if (prev.batch == null) delete process.env.TABULECT_BATCH_SIZE;
    else process.env.TABULECT_BATCH_SIZE = prev.batch;
    if (prev.retry == null) delete process.env.TABULECT_RETRY_BASE_MS;
    else process.env.TABULECT_RETRY_BASE_MS = prev.retry;
    if (prev.cli == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prev.cli;
    if (prev.live == null) delete process.env.FAKE_CODEX_LIVE;
    else process.env.FAKE_CODEX_LIVE = prev.live;
    if (prev.sleep == null) delete process.env.FAKE_CODEX_SLEEP_MS;
    else process.env.FAKE_CODEX_SLEEP_MS = prev.sleep;
  }
});

test("a leftover hole with invalid CLI JSON is skipped so later chunks still fill", async () => {
  await chmod(FAKE, 0o755);
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-engine-hole-"));
  process.env.TABULECT_FILL_INLINE = "1";
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_SKIP_IDS = "c-401";
  const doc = {
    id: "doc-engine-hole",
    title: "How to Read a Book",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [
      chunk("c-400", "Dolu parça yavaş okumak bir yapı işidir.", 0),
      chunk("c-401", "Delik parça: sağlayıcı geçerli JSON vermez.", 1),
      chunk("c-841", "Sonraki parça satır uydurulmaz.", 2),
    ],
    rows: [cells("c-400", 0, "keep")],
  };
  await saveDocument(doc, dataRoot);
  try {
    const result = await fillDocument({
      documentId: doc.id,
      provider: "codex",
      tableLocale: "tr",
      dataRoot,
    });
    assert.equal(result.complete, true);
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 3);
    assert.equal(filled.rows[0].claim, "keep");
    assert.equal(filled.rows[1].chunkId, "c-401");
    assert.equal(filled.rows[1].claim, "");
    assert.equal(isSkippedFillRow(filled.rows[1]), true);
    assert.equal(filled.rows[2].chunkId, "c-841");
    assert.ok(filled.rows[2].claim);
  } finally {
    delete process.env.TABULECT_FILL_INLINE;
    delete process.env.TABULECT_RETRY_BASE_MS;
    delete process.env.TABULECT_CLI_CODEX;
    delete process.env.FAKE_CODEX_SKIP_IDS;
  }
});

test("rate-limit waves throw instead of succeeding with leftover chunks", async () => {
  await chmod(FAKE, 0o755);
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-engine-rate-"));
  process.env.TABULECT_FILL_INLINE = "1";
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_FILL_IDLE_WAVES = "1";
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_RATE_LIMIT = "1";
  const doc = {
    id: "doc-engine-rate",
    title: "Rate limit CLI",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [
      chunk("c-001", "Birinci parça yavaş okumak bir yapı işidir.", 0),
      chunk("c-002", "İkinci parça satır uydurulmaz.", 1),
    ],
    rows: [cells("c-001", 0, "keep")],
  };
  await saveDocument(doc, dataRoot);
  try {
    await assert.rejects(
      () =>
        fillDocument({
          documentId: doc.id,
          provider: "codex",
          tableLocale: "tr",
          dataRoot,
        }),
      (error) => {
        assert.equal(isEmptyFillError(error), true);
        assert.match(String(error.message), /leftover chunks remain/);
        return true;
      },
    );
    const kept = await loadDocument(doc.id, dataRoot);
    assert.equal(kept.rows.length, 1);
  } finally {
    delete process.env.TABULECT_FILL_INLINE;
    delete process.env.TABULECT_RETRY_BASE_MS;
    delete process.env.TABULECT_FILL_IDLE_WAVES;
    delete process.env.TABULECT_CLI_CODEX;
    delete process.env.FAKE_CODEX_RATE_LIMIT;
  }
});

test("kimi --prompt argv fills leftover chunks", async () => {
  const FAKE_KIMI = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-kimi.mjs");
  await chmod(FAKE_KIMI, 0o755);
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-engine-kimi-"));
  process.env.TABULECT_FILL_INLINE = "1";
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_CLI_KIMI = FAKE_KIMI;
  const doc = {
    id: "doc-engine-kimi",
    title: "Kimi prompt flag",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "kimi",
    chunks: [
      chunk("c-001", "Birinci parça yavaş okumak bir yapı işidir.", 0),
      chunk("c-002", "İkinci parça satır uydurulmaz.", 1),
    ],
    rows: [cells("c-001", 0, "keep")],
  };
  await saveDocument(doc, dataRoot);
  try {
    const result = await fillDocument({
      documentId: doc.id,
      provider: "kimi",
      tableLocale: "tr",
      dataRoot,
    });
    assert.equal(result.complete, true);
    const filled = await loadDocument(doc.id, dataRoot);
    assert.equal(filled.rows.length, 2);
    assert.equal(filled.rows[0].claim, "keep");
    assert.ok(filled.rows[1].claim);
  } finally {
    delete process.env.TABULECT_FILL_INLINE;
    delete process.env.TABULECT_RETRY_BASE_MS;
    delete process.env.TABULECT_CLI_KIMI;
  }
});
