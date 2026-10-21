import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createIngestJob, maxChunkLimit, runIngestJob, snapshotJob } from "../lib/ingest.mjs";
import { BATCH_SIZE } from "../lib/providers/run.mjs";
import { chunkExtracted } from "../lib/chunk.mjs";
import { pagesFromPlainText } from "../lib/extract.mjs";
import { loadDocument } from "../lib/store.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

test("maxChunkLimit: unset/empty/0 is unlimited; a positive integer caps", () => {
  assert.equal(maxChunkLimit(undefined), Number.POSITIVE_INFINITY);
  assert.equal(maxChunkLimit(""), Number.POSITIVE_INFINITY);
  assert.equal(maxChunkLimit("  "), Number.POSITIVE_INFINITY);
  assert.equal(maxChunkLimit("0"), Number.POSITIVE_INFINITY);
  assert.equal(maxChunkLimit("-3"), Number.POSITIVE_INFINITY);
  assert.equal(maxChunkLimit("32"), 32);
  assert.equal(maxChunkLimit("10000"), 10000);
});

function fatBook(paragraphs) {
  const body = Array.from({ length: paragraphs }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `Paragraf ${n}. Yavaş okumak bir yapı işidir. ${"okumak ".repeat(180)}`;
  }).join("\n\n");
  return `# Çok parçalı kitap\n\n${body}\n`;
}

function attachSnapshots(job, dataRoot) {
  const snapshots = [];
  job.listeners.add({
    write(chunk) {
      const line = String(chunk).replace(/^data:\s*/, "").trim();
      if (!line) return;
      const event = JSON.parse(line);
      if (!event.documentId) return;
      const dest = join(dataRoot, "documents", `${event.documentId}.json`);
      const doc = JSON.parse(readFileSync(dest, "utf8"));
      snapshots.push({
        phase: event.phase,
        message: event.message,
        pct: event.pct,
        rows: Array.isArray(doc.rows) ? doc.rows.length : 0,
        documentId: event.documentId,
      });
    },
    end() {},
  });
  return snapshots;
}

test("ingest extracts and chunks without schema fill", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-ingest-"));
  const text = fatBook(BATCH_SIZE + 2);
  const packed = chunkExtracted(pagesFromPlainText(text, "Çok parçalı kitap"));
  assert.ok(packed.chunks.length >= BATCH_SIZE + 1, `need multiple chunks, got ${packed.chunks.length}`);

  const job = createIngestJob({
    filename: "book.md",
    mime: "text/markdown",
    buffer: Buffer.from(text, "utf8"),
    provider: "codex",
    tableLocale: "tr",
  });
  attachSnapshots(job, dataRoot);
  await runIngestJob(job, { dataRoot });

  assert.equal(job.error, null);
  const phases = job.events.map((event) => event.phase);
  assert.ok(phases.includes("extract"));
  assert.ok(phases.includes("chunk"));
  assert.ok(phases.includes("done"));
  assert.ok(!phases.includes("schema"), "book-wide schema fill is not the ingest path");

  const doc = await loadDocument(job.documentId, dataRoot);
  assert.ok(doc);
  assert.ok(doc.chunks.length >= 1);
  assert.equal(doc.rows.length, 0);
  assert.deepEqual(doc.bookmarks, []);
  assert.deepEqual(doc.outputs, []);

  const snap = snapshotJob(job);
  assert.equal(snap.finished, true);
  assert.equal(snap.phase, "done");
  assert.equal(snap.documentId, job.documentId);

  delete process.env.TABULECT_CLI_CODEX;
});
