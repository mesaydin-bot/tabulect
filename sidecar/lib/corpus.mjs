/**
 * Local document corpus. SQLite FTS5 under the data root.
 * Retrieval is opt-in — default Tabulect never searches other books.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { dataRoot, ensureStore } from "./store.mjs";

const dbs = new Map();

function corpusPath(root) {
  return join(root, "corpus.sqlite");
}

export function ftsQuery(raw) {
  const tokens = String(raw || "")
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  if (!tokens.length) return "";
  return tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" OR ");
}

export function openCorpus(root = dataRoot()) {
  const dest = corpusPath(root);
  const cached = dbs.get(dest);
  if (cached) return cached;
  const db = new DatabaseSync(dest);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS passages (
      passage_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT,
      title TEXT,
      page TEXT,
      body TEXT
    );
    CREATE INDEX IF NOT EXISTS passages_doc ON passages(document_id);
  `);
  dbs.set(dest, db);
  return db;
}

function clip(text, max = 900) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}…`;
}

function bodyKey(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer one hit when a bookmark span is already in a corpus passage. */
function isDuplicateBody(hits, documentId, body) {
  const needle = bodyKey(body);
  if (needle.length < 24) return false;
  return hits.some((hit) => {
    if (hit.documentId !== documentId) return false;
    const hay = bodyKey(hit.text);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

function upsertCorpusDoc(db, id, title) {
  db.prepare(
    "INSERT INTO documents(id, title, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at",
  ).run(id, title, new Date().toISOString());
}

export async function indexDocument(doc, root = dataRoot()) {
  if (!doc?.id) return;
  await ensureStore(root);
  const db = openCorpus(root);
  const title = String(doc.title || doc.id);
  upsertCorpusDoc(db, doc.id, title);
  db.prepare("DELETE FROM passages WHERE document_id = ?").run(doc.id);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO passages(passage_id, document_id, kind, title, page, body) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const chunk of Array.isArray(doc.chunks) ? doc.chunks : []) {
    const body = clip(chunk?.text, 1200);
    if (!body) continue;
    insert.run(String(chunk.id || `${doc.id}-chunk`), doc.id, "chunk", title, String(chunk.page ?? ""), body);
  }
  for (const bookmark of Array.isArray(doc.bookmarks) ? doc.bookmarks : []) {
    const body = clip(bookmark?.text, 800);
    if (!body) continue;
    insert.run(String(bookmark.id || `${doc.id}-bm`), doc.id, "bookmark", title, String(bookmark.page ?? ""), body);
  }
}

/** Index a note's title + body (and heading slices) for FTS / @library. */
export async function indexNote(note, root = dataRoot()) {
  if (!note?.id) return;
  await ensureStore(root);
  const db = openCorpus(root);
  const title = String(note.title || note.id);
  upsertCorpusDoc(db, note.id, title);
  db.prepare("DELETE FROM passages WHERE document_id = ?").run(note.id);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO passages(passage_id, document_id, kind, title, page, body) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const body = String(note.body || "");
  const combined = clip(`${title}\n${body}`, 4000);
  if (combined) {
    insert.run(`${note.id}-note`, note.id, "note", title, "", combined);
  }
  const headings = [];
  let offset = 0;
  for (const line of body.split(/\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) headings.push({ text: match[2].trim(), offset });
    offset += line.length + 1;
  }
  headings.slice(0, 24).forEach((heading, index) => {
    const start = heading.offset;
    const end = headings[index + 1] ? headings[index + 1].offset : body.length;
    const slice = clip(body.slice(start, end), 1200);
    if (!slice || slice === combined) return;
    insert.run(`${note.id}-h-${index}`, note.id, "note", `${title} · ${heading.text}`, "", slice);
  });
}

export async function removeFromCorpus(documentId, root = dataRoot()) {
  const id = String(documentId || "").trim();
  if (!id) return;
  await ensureStore(root);
  const db = openCorpus(root);
  db.prepare("DELETE FROM passages WHERE document_id = ?").run(id);
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

export function searchCorpus(query, { includeIds, excludeIds, limit = 6, root = dataRoot() } = {}) {
  const tokens = String(query || "")
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  const db = openCorpus(root);
  const include = new Set((includeIds || []).filter(Boolean));
  const exclude = new Set((excludeIds || []).filter(Boolean));
  let rows = db.prepare("SELECT passage_id, document_id, kind, title, page, body FROM passages").all();
  if (tokens.length) {
    rows = rows
      .map((row) => {
        const hay = `${row.title} ${row.body}`.toLocaleLowerCase("tr");
        const score = tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0);
        return { row, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.row);
  }
  const hits = [];
  for (const row of rows) {
    if (exclude.has(row.document_id)) continue;
    if (include.size && !include.has(row.document_id)) continue;
    if (isDuplicateBody(hits, row.document_id, row.body)) continue;
    hits.push({
      id: row.passage_id,
      documentId: row.document_id,
      kind: row.kind,
      title: row.title,
      page: row.page || null,
      text: clip(row.body, 700),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function formatAdditionalSources(hits) {
  if (!hits?.length) return "";
  return hits
    .map((hit, i) => {
      const page = hit.page ? ` p.${hit.page}` : "";
      const kind = hit.kind ? ` ${hit.kind}` : "";
      return `[${i + 1}] ${hit.title}${page}${kind} (${hit.documentId})\n${hit.text}`;
    })
    .join("\n\n");
}

function passageToHit(row, source = "library") {
  return {
    source,
    id: row.passage_id || row.id,
    title: row.title || "",
    snippet: clip(row.body || row.text || "", 700),
    url: row.kind === "note" ? `tabulect://note/${row.document_id}` : `tabulect://doc/${row.document_id}`,
    meta: {
      kind: row.kind || "chunk",
      documentId: row.document_id,
      page: row.page || null,
    },
  };
}

/** Snapshot the library sees: documents, bookmarks, and notes. */
export async function librarySnapshot({ query = "", limit = 24, root = dataRoot() } = {}) {
  const { listDocuments, loadDocument } = await import("./store.mjs");
  const { listNotes, listNoteFolders, summarizeNote } = await import("./notes.mjs");
  const documents = await listDocuments(root);
  const notes = await listNotes(root);
  const noteFolders = await listNoteFolders(root);
  const bookmarks = [];
  for (const item of documents) {
    const doc = await loadDocument(item.id, root);
    for (const bookmark of Array.isArray(doc?.bookmarks) ? doc.bookmarks : []) {
      bookmarks.push({
        id: bookmark.id,
        documentId: doc.id,
        documentTitle: doc.title,
        text: clip(bookmark.text, 800),
        page: bookmark.page ?? null,
        createdAt: bookmark.createdAt || null,
      });
    }
  }
  const hits = query
    ? searchCorpus(query, { limit, root }).map((hit) =>
        passageToHit({
          passage_id: hit.id,
          document_id: hit.documentId,
          kind: hit.kind,
          title: hit.title,
          page: hit.page,
          body: hit.text,
        }),
      )
    : [];
  return {
    source: "library",
    documents: documents.map((item) => ({
      id: item.id,
      title: item.title,
      folderId: item.folderId || null,
      bookmarkCount: item.bookmarkCount || 0,
      updatedAt: item.updatedAt,
    })),
    bookmarks,
    notes: notes.map((note) => ({
      ...summarizeNote(note),
      body: note.body,
    })),
    noteFolders,
    hits,
  };
}

export function searchLibraryCorpus(query, { limit = 12, kinds, root = dataRoot() } = {}) {
  const allow = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const hits = searchCorpus(query, { limit: allow ? limit * 4 : limit, root });
  const filtered = allow ? hits.filter((hit) => allow.has(hit.kind)) : hits;
  return filtered.slice(0, limit).map((hit) =>
    passageToHit({
      passage_id: hit.id,
      document_id: hit.documentId,
      kind: hit.kind,
      title: hit.title,
      page: hit.page,
      body: hit.text,
    }),
  );
}
