import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteDocument,
  ensureStore,
  listDocuments,
  loadDocument,
  renameDocument,
  saveDocument,
  saveJobRecord,
  saveUpload,
} from "../lib/store.mjs";

const chunk = { id: "c-001", text: "hello world", page: 1, start: 0, end: 11 };
const row = {
  id: "r-001",
  chunkId: "c-001",
  quoteAnchor: { chunkId: "c-001", start: 0, end: 5, page: 1, bbox: null },
  claim: "c",
  warrant: "w",
  fact: "f",
  example: "",
  definition: "",
  exception: "",
  openQuestion: "",
  citation: "",
  practicalSuggestion: "",
  objection: null,
};

function sampleDoc(id, title) {
  return {
    id,
    title,
    sourceType: "md",
    tableLocale: "tr",
    chunks: [chunk],
    rows: [row],
  };
}

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "tr-store-"));
}

test("listDocuments returns title, locale, counts, and updatedAt; newest first", async () => {
  const root = await tempRoot();
  await saveDocument(sampleDoc("doc-older", "Eski kitap"), root);
  await new Promise((r) => setTimeout(r, 20));
  await saveDocument(sampleDoc("doc-newer", "Yeni kitap"), root);

  const items = await listDocuments(root);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "doc-newer");
  assert.equal(items[0].title, "Yeni kitap");
  assert.equal(items[0].sourceType, "md");
  assert.equal(items[0].tableLocale, "tr");
  assert.equal(items[0].rowCount, 1);
  assert.equal(items[0].chunkCount, 1);
  assert.equal(items[0].partialFill, false);
  assert.ok(items[0].updatedAt);
  assert.ok(Date.parse(items[0].updatedAt) >= Date.parse(items[1].updatedAt));
});

test("renameDocument updates title on disk without touching rows", async () => {
  const root = await tempRoot();
  await saveDocument(sampleDoc("doc-rename", "Eski ad"), root);
  const renamed = await renameDocument("doc-rename", "  How to Read a Book  ", root);
  assert.equal(renamed.title, "How to Read a Book");
  const loaded = await loadDocument("doc-rename", root);
  assert.equal(loaded.title, "How to Read a Book");
  assert.equal(loaded.rows.length, 1);
});

test("deleteDocument removes JSON and related job/upload files only", async () => {
  const root = await tempRoot();
  const paths = await ensureStore(root);
  await saveDocument(sampleDoc("keep-me", "Kalacak"), root);
  await saveDocument(sampleDoc("drop-me", "Silinecek"), root);
  await saveJobRecord(
    {
      jobId: "job-drop",
      documentId: "drop-me",
      provider: "codex",
      tableLocale: "tr",
      filename: "book.pdf",
      events: [],
      finished: true,
      error: null,
    },
    root,
  );
  await saveJobRecord(
    {
      jobId: "job-keep",
      documentId: "keep-me",
      provider: "codex",
      tableLocale: "tr",
      filename: "other.md",
      events: [],
      finished: true,
      error: null,
    },
    root,
  );
  const dropUpload = await saveUpload("job-drop", "book.pdf", Buffer.from("pdf"), root);
  const keepUpload = await saveUpload("job-keep", "other.md", Buffer.from("# x"), root);

  const removed = await deleteDocument("drop-me", root);
  assert.equal(removed, true);
  assert.equal(await loadDocument("drop-me", root), null);
  assert.ok(await loadDocument("keep-me", root));

  const listed = await listDocuments(root);
  assert.deepEqual(listed.map((item) => item.id), ["keep-me"]);

  await assert.rejects(() => readFile(join(paths.jobs, "job-drop.json")));
  await assert.rejects(() => readFile(dropUpload));
  assert.ok(await readFile(join(paths.jobs, "job-keep.json"), "utf8"));
  assert.ok(await readFile(keepUpload));
});

test("deleteDocument returns false for missing or unsafe ids", async () => {
  const root = await tempRoot();
  assert.equal(await deleteDocument("missing-id", root), false);
  assert.equal(await deleteDocument("../etc/passwd", root), false);
  assert.equal(await deleteDocument("a/b", root), false);
});

test("deleteDocument finds a file whose embedded id differs from the filename", async () => {
  const root = await tempRoot();
  const paths = await ensureStore(root);
  const doc = sampleDoc("real-id", "Gizli ad");
  await saveDocument(doc, root);
  const { rename } = await import("node:fs/promises");
  await rename(join(paths.documents, "real-id.json"), join(paths.documents, "alias-name.json"));
  const removed = await deleteDocument("real-id", root);
  assert.equal(removed, true);
  assert.equal(await loadDocument("real-id", root), null);
});

test("loadDocument migrates missing practicalSuggestion and persists it", async () => {
  const root = await tempRoot();
  const paths = await ensureStore(root);
  const legacy = sampleDoc("legacy-doc", "Eski şema");
  delete legacy.rows[0].practicalSuggestion;
  await writeFile(join(paths.documents, "legacy-doc.json"), JSON.stringify(legacy), "utf8");
  const loaded = await loadDocument("legacy-doc", root);
  assert.equal(loaded.rows[0].practicalSuggestion, "");
  const disk = JSON.parse(await readFile(join(paths.documents, "legacy-doc.json"), "utf8"));
  assert.equal(disk.rows[0].practicalSuggestion, "");
});

test("corrupt JSON in the store is skipped, not fatal", async () => {
  const root = await tempRoot();
  const paths = await ensureStore(root);
  await writeFile(join(paths.documents, "broken.json"), "{not json", "utf8");
  await saveDocument(sampleDoc("ok-doc", "Sağlam"), root);
  const items = await listDocuments(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "ok-doc");
});
