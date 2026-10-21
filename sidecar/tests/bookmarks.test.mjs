import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addBookmark, filterBookmarks, removeBookmark, reorderBookmarks } from "../lib/bookmarks.mjs";
import { saveDocument } from "../lib/store.mjs";

const doc = {
  id: "doc-bookmark-1",
  title: "Deneme",
  sourceType: "md",
  tableLocale: "tr",
  chunks: [{ id: "c-001", text: "Merhaba dünya ve yavaş okumak.", page: 1, start: 0, end: 30 }],
  rows: [],
  bookmarks: [],
};

test("bookmarks persist on the document", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-bm-"));
  await saveDocument(doc, root);
  const added = await addBookmark(
    doc.id,
    { chunkId: "c-001", start: 0, end: 7, page: 1, text: "Merhaba" },
    root,
  );
  assert.ok(added.bookmark.id);
  assert.equal(added.doc.bookmarks.length, 1);
  assert.equal(added.doc.bookmarks[0].text, "Merhaba");
  const removed = await removeBookmark(doc.id, added.bookmark.id, root);
  assert.equal(removed.removed, true);
  assert.equal(removed.doc.bookmarks.length, 0);
});

test("bookmarks can be reordered on the document", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-bm-ord-"));
  await saveDocument(doc, root);
  const first = await addBookmark(doc.id, { chunkId: "c-001", start: 0, end: 7, text: "Merhaba" }, root);
  const second = await addBookmark(doc.id, { chunkId: "c-001", start: 8, end: 13, text: "dünya" }, root);
  assert.equal(second.doc.bookmarks[0].text, "Merhaba");
  const moved = await reorderBookmarks(doc.id, [second.bookmark.id, first.bookmark.id], root);
  assert.equal(moved.doc.bookmarks[0].text, "dünya");
  assert.equal(moved.doc.bookmarks[1].text, "Merhaba");
});

test("bookmark search is case-insensitive Turkish", () => {
  const list = [
    { id: "1", text: "Yavaş okumak", note: "" },
    { id: "2", text: "Hızlı özet", note: "gerekçe" },
  ];
  assert.equal(filterBookmarks(list, "yavaş").length, 1);
  assert.equal(filterBookmarks(list, "GEREKÇE").length, 1);
});
