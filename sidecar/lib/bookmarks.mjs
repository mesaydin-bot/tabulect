import { randomUUID } from "node:crypto";
import { normalizeBookmark } from "./schema.mjs";
import { loadDocument, saveDocument } from "./store.mjs";

export function bookmarkFromSpans(spans, { text, note } = {}) {
  const list = Array.isArray(spans) ? spans.filter((span) => span && span.chunkId) : [];
  const first = list[0] || { chunkId: "", start: 0, end: 0, page: null };
  const body =
    typeof text === "string" && text.trim()
      ? text
      : list
          .map((span) => String(span.text || ""))
          .join("\n")
          .trim();
  return normalizeBookmark({
    id: `b-${randomUUID().slice(0, 8)}`,
    text: body,
    chunkId: first.chunkId,
    start: first.start ?? 0,
    end: first.end ?? 0,
    page: first.page ?? null,
    createdAt: new Date().toISOString(),
    note: note || "",
    spans: list.map((span) => ({
      chunkId: span.chunkId,
      start: span.start ?? 0,
      end: span.end ?? 0,
      page: span.page ?? null,
    })),
  });
}

export async function addBookmark(documentId, payload, root) {
  const doc = await loadDocument(documentId, root);
  if (!doc) return null;
  const bookmark = bookmarkFromSpans(payload.spans || [
    {
      chunkId: payload.chunkId,
      start: payload.start,
      end: payload.end,
      page: payload.page,
      text: payload.text,
    },
  ], payload);
  doc.bookmarks = Array.isArray(doc.bookmarks) ? doc.bookmarks : [];
  doc.bookmarks.push(bookmark);
  await saveDocument(doc, root);
  return { doc, bookmark };
}

export async function removeBookmark(documentId, bookmarkId, root) {
  const doc = await loadDocument(documentId, root);
  if (!doc) return null;
  const before = (doc.bookmarks || []).length;
  doc.bookmarks = (doc.bookmarks || []).filter((item) => item.id !== bookmarkId);
  if (doc.bookmarks.length === before) return { doc, removed: false };
  await saveDocument(doc, root);
  return { doc, removed: true };
}

export async function updateBookmark(documentId, bookmarkId, patch, root) {
  const doc = await loadDocument(documentId, root);
  if (!doc) return null;
  const index = (doc.bookmarks || []).findIndex((item) => item.id === bookmarkId);
  if (index < 0) return { doc, bookmark: null };
  const prev = doc.bookmarks[index];
  const next = normalizeBookmark({
    ...prev,
    note: patch.note != null ? String(patch.note) : prev.note,
    text: patch.text != null ? String(patch.text) : prev.text,
  });
  doc.bookmarks[index] = next;
  await saveDocument(doc, root);
  return { doc, bookmark: next };
}

export async function reorderBookmarks(documentId, ids, root) {
  const doc = await loadDocument(documentId, root);
  if (!doc) return null;
  const wanted = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  const map = new Map((doc.bookmarks || []).map((item) => [item.id, item]));
  const next = [];
  for (const id of wanted) {
    const item = map.get(id);
    if (item) {
      next.push(item);
      map.delete(id);
    }
  }
  for (const rest of map.values()) next.push(rest);
  doc.bookmarks = next;
  await saveDocument(doc, root);
  return { doc };
}

export function filterBookmarks(bookmarks, query) {
  const q = String(query || "").trim().toLocaleLowerCase("tr");
  const list = Array.isArray(bookmarks) ? bookmarks : [];
  if (!q) return list;
  return list.filter((item) => {
    const hay = `${item.text || ""} ${item.note || ""}`.toLocaleLowerCase("tr");
    return hay.includes(q);
  });
}
