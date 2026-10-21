import { t } from "./i18n.mjs";
/**
 * First-class notes: folders + markdown bodies on disk.
 * Indexed into the local corpus (title + body) for @library / @all.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot, ensureStore, safeDocumentId } from "./store.mjs";
import { pathExists } from "./util.mjs";

export function safeNoteId(id) {
  return safeDocumentId(id);
}

export function safeNoteFolderId(id) {
  const value = String(id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
  return value;
}

function notesDir(root) {
  return join(root, "notes");
}

function metaPath(root) {
  return join(root, "notes-meta.json");
}

export function parseNoteOutline(markdown) {
  const items = [];
  const lines = String(markdown || "").split(/\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      items.push({
        id: `h-${i}-${match[1].length}`,
        level: match[1].length,
        text: match[2].trim(),
        offset,
        line: i,
      });
    }
    offset += line.length + 1;
  }
  return items;
}

export function emptyNotesMeta() {
  return { folders: [], membership: {} };
}

export function normalizeNotesMeta(raw) {
  const folders = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.folders) ? raw.folders : []) {
    const id = safeNoteFolderId(item?.id);
    const name = String(item?.name || "").trim().slice(0, 80);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    folders.push({
      id,
      name,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
  }
  const membership = {};
  const folderIds = new Set(folders.map((item) => item.id));
  const rawMap = raw?.membership && typeof raw.membership === "object" ? raw.membership : {};
  for (const [noteId, folderId] of Object.entries(rawMap)) {
    const safeNote = safeNoteId(noteId);
    const safeFld = safeNoteFolderId(folderId);
    if (!safeNote || !safeFld || !folderIds.has(safeFld)) continue;
    membership[safeNote] = safeFld;
  }
  return { folders, membership };
}

async function ensureNotes(root = dataRoot()) {
  const paths = await ensureStore(root);
  await mkdir(notesDir(paths.root), { recursive: true });
  return paths.root;
}

export async function loadNotesMeta(root = dataRoot()) {
  const destRoot = await ensureNotes(root);
  const dest = metaPath(destRoot);
  if (!(await pathExists(dest))) return emptyNotesMeta();
  try {
    return normalizeNotesMeta(JSON.parse(await readFile(dest, "utf8")));
  } catch {
    return emptyNotesMeta();
  }
}

export async function saveNotesMeta(meta, root = dataRoot()) {
  const destRoot = await ensureNotes(root);
  const next = normalizeNotesMeta(meta);
  await writeFile(metaPath(destRoot), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function clipTitle(value, fallback = t('untitledNote')) {
  const title = String(value || "").trim().slice(0, 240);
  return title || fallback;
}

export function normalizeNote(raw, membership = {}, folderIds = null) {
  const id = safeNoteId(raw?.id);
  if (!id) return null;
  const createdAt =
    typeof raw?.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString();
  const updatedAt =
    typeof raw?.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;
  const mapped = membership[id] || null;
  const fromFile = safeNoteFolderId(raw?.folderId);
  const valid = (value) => value && (!folderIds || folderIds.has(value));
  const folderId = valid(mapped) ? mapped : valid(fromFile) ? fromFile : null;
  return {
    id,
    title: clipTitle(raw?.title),
    body: typeof raw?.body === "string" ? raw.body : "",
    folderId,
    createdAt,
    updatedAt,
  };
}

function notePath(root, id) {
  return join(notesDir(root), `${id}.json`);
}

async function indexNoteBestEffort(note, root) {
  try {
    const { indexNote } = await import("./corpus.mjs");
    await indexNote(note, root);
  } catch {
    /* corpus is best-effort */
  }
}

async function dropNoteBestEffort(id, root) {
  try {
    const { removeFromCorpus } = await import("./corpus.mjs");
    await removeFromCorpus(id, root);
  } catch {
    /* corpus is best-effort */
  }
}

export async function saveNote(note, root = dataRoot()) {
  const destRoot = await ensureNotes(root);
  const meta = await loadNotesMeta(destRoot);
  const folderIds = new Set(meta.folders.map((item) => item.id));
  const requested = note.folderId == null || note.folderId === "" || note.folderId === "unfiled" ? null : safeNoteFolderId(note.folderId);
  if (note.folderId && note.folderId !== "" && note.folderId !== "unfiled" && !requested) {
    throw Object.assign(new Error("folder not found"), { status: 404 });
  }
  if (requested && !folderIds.has(requested)) {
    throw Object.assign(new Error("folder not found"), { status: 404 });
  }
  const normalized = normalizeNote({ ...note, folderId: requested }, {}, folderIds);
  if (!normalized) throw Object.assign(new Error("note id is invalid"), { status: 400 });
  const now = new Date().toISOString();
  if (!normalized.createdAt) normalized.createdAt = now;
  normalized.updatedAt = now;
  const folderId = normalized.folderId;
  if (folderId) {
    if (!meta.folders.some((item) => item.id === folderId)) {
      throw Object.assign(new Error("folder not found"), { status: 404 });
    }
    meta.membership[normalized.id] = folderId;
  } else {
    delete meta.membership[normalized.id];
    normalized.folderId = null;
  }
  await writeFile(notePath(destRoot, normalized.id), JSON.stringify(normalized, null, 2), "utf8");
  await saveNotesMeta(meta, destRoot);
  await indexNoteBestEffort(normalized, destRoot);
  return normalized;
}

export async function loadNote(id, root = dataRoot()) {
  const safe = safeNoteId(id);
  if (!safe) return null;
  const destRoot = await ensureNotes(root);
  const dest = notePath(destRoot, safe);
  if (!(await pathExists(dest))) return null;
  try {
    const meta = await loadNotesMeta(destRoot);
    const folderIds = new Set(meta.folders.map((item) => item.id));
    const note = normalizeNote(JSON.parse(await readFile(dest, "utf8")), meta.membership, folderIds);
    return note;
  } catch {
    return null;
  }
}

export async function listNotes(root = dataRoot()) {
  const destRoot = await ensureNotes(root);
  const meta = await loadNotesMeta(destRoot);
  const folderIds = new Set(meta.folders.map((item) => item.id));
  const names = (await readdir(notesDir(destRoot))).filter((name) => name.endsWith(".json"));
  const items = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(await readFile(join(notesDir(destRoot), name), "utf8"));
      const note = normalizeNote(raw, meta.membership, folderIds);
      if (note) items.push(note);
    } catch {
      /* skip corrupt */
    }
  }
  items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return items;
}

export async function listNoteFolders(root = dataRoot()) {
  const meta = await loadNotesMeta(root);
  return meta.folders.slice().sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function createNoteFolder(name, root = dataRoot()) {
  const title = String(name || "").trim();
  if (!title) throw Object.assign(new Error("folder name is required"), { status: 400 });
  if (title.length > 80) throw Object.assign(new Error("folder name is too long"), { status: 400 });
  const meta = await loadNotesMeta(root);
  const exists = meta.folders.some((item) => item.name.toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"));
  if (exists) throw Object.assign(new Error("folder already exists"), { status: 400 });
  const folder = { id: `nfld-${randomUUID().slice(0, 8)}`, name: title, createdAt: new Date().toISOString() };
  meta.folders.push(folder);
  await saveNotesMeta(meta, root);
  return folder;
}

export async function renameNoteFolder(id, name, root = dataRoot()) {
  const safe = safeNoteFolderId(id);
  const title = String(name || "").trim();
  if (!safe) return null;
  if (!title) throw Object.assign(new Error("folder name is required"), { status: 400 });
  const meta = await loadNotesMeta(root);
  const folder = meta.folders.find((item) => item.id === safe);
  if (!folder) return null;
  folder.name = title.slice(0, 80);
  await saveNotesMeta(meta, root);
  return folder;
}

export async function deleteNoteFolder(id, root = dataRoot()) {
  const safe = safeNoteFolderId(id);
  if (!safe) return false;
  const meta = await loadNotesMeta(root);
  const before = meta.folders.length;
  meta.folders = meta.folders.filter((item) => item.id !== safe);
  if (meta.folders.length === before) return false;
  for (const [noteId, folderId] of Object.entries(meta.membership)) {
    if (folderId === safe) delete meta.membership[noteId];
  }
  await saveNotesMeta(meta, root);
  return true;
}

export async function createNote({ title, body, folderId } = {}, root = dataRoot()) {
  const note = {
    id: `nte-${randomUUID().slice(0, 8)}`,
    title: clipTitle(title),
    body: typeof body === "string" ? body : "",
    folderId: folderId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveNote(note, root);
}

export async function patchNote(id, patch = {}, root = dataRoot()) {
  const existing = await loadNote(id, root);
  if (!existing) return null;
  const next = { ...existing };
  if (patch.title != null) next.title = clipTitle(patch.title, existing.title);
  if (patch.body != null) next.body = String(patch.body);
  if (Object.prototype.hasOwnProperty.call(patch, "folderId")) {
    next.folderId = patch.folderId || null;
  }
  return saveNote(next, root);
}

export async function moveNoteToFolder(noteId, folderId, root = dataRoot()) {
  const existing = await loadNote(noteId, root);
  if (!existing) return null;
  const nextFolder =
    folderId == null || folderId === "" || folderId === "unfiled" ? null : folderId;
  return saveNote({ ...existing, folderId: nextFolder }, root);
}

export async function deleteNote(id, root = dataRoot()) {
  const safe = safeNoteId(id);
  if (!safe) return false;
  const destRoot = await ensureNotes(root);
  const dest = notePath(destRoot, safe);
  if (!(await pathExists(dest))) return false;
  await unlink(dest);
  const meta = await loadNotesMeta(destRoot);
  if (safe in meta.membership) {
    delete meta.membership[safe];
    await saveNotesMeta(meta, destRoot);
  }
  await dropNoteBestEffort(safe, destRoot);
  return true;
}

export async function snapshotNotes(root = dataRoot()) {
  const [notes, folders] = await Promise.all([listNotes(root), listNoteFolders(root)]);
  return { notes, folders };
}

export function summarizeNote(note) {
  const body = String(note?.body || "").replace(/\s+/g, " ").trim();
  return {
    id: note.id,
    title: note.title,
    folderId: note.folderId || null,
    snippet: body.length > 280 ? `${body.slice(0, 277).trim()}…` : body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    outline: parseNoteOutline(note.body),
  };
}
