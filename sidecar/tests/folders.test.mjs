import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFolder,
  deleteFolder,
  loadLibraryMeta,
  moveDocumentToFolder,
  renameFolder,
} from "../lib/folders.mjs";
import { listDocuments, saveDocument } from "../lib/store.mjs";

function sampleDoc(id, title) {
  return {
    id,
    title,
    sourceType: "md",
    tableLocale: "tr",
    chunks: [{ id: "c-001", text: "merhaba", page: 1, start: 0, end: 7 }],
    rows: [],
    bookmarks: [],
    outputs: [],
  };
}

test("folder CRUD and document move persist on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-fld-"));
  await saveDocument(sampleDoc("doc-a", "Kitap A"), root);
  const folder = await createFolder("Okuma", root);
  assert.equal(folder.name, "Okuma");
  await moveDocumentToFolder("doc-a", folder.id, root);
  const listed = await listDocuments(root);
  assert.equal(listed[0].folderId, folder.id);
  const renamed = await renameFolder(folder.id, "Arşiv", root);
  assert.equal(renamed.name, "Arşiv");
  await deleteFolder(folder.id, root);
  const after = await listDocuments(root);
  assert.equal(after[0].folderId, null);
  const meta = await loadLibraryMeta(root);
  assert.equal(meta.folders.length, 0);
});
