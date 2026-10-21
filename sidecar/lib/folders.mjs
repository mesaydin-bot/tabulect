import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot, ensureStore, safeDocumentId } from "./store.mjs";
import { pathExists } from "./util.mjs";

function metaPath(root) {
  return join(root, "library.json");
}

export function safeFolderId(id) {
  const value = String(id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
  return value;
}

export function emptyLibraryMeta() {
  return { folders: [], membership: {} };
}

export function normalizeLibraryMeta(raw) {
  const folders = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.folders) ? raw.folders : []) {
    const id = safeFolderId(item?.id);
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
  for (const [docId, folderId] of Object.entries(rawMap)) {
    const safeDoc = safeDocumentId(docId);
    const safeFld = safeFolderId(folderId);
    if (!safeDoc || !safeFld || !folderIds.has(safeFld)) continue;
    membership[safeDoc] = safeFld;
  }
  return { folders, membership };
}

export async function loadLibraryMeta(root = dataRoot()) {
  const paths = await ensureStore(root);
  const dest = metaPath(paths.root);
  if (!(await pathExists(dest))) return emptyLibraryMeta();
  try {
    return normalizeLibraryMeta(JSON.parse(await readFile(dest, "utf8")));
  } catch {
    return emptyLibraryMeta();
  }
}

export async function saveLibraryMeta(meta, root = dataRoot()) {
  const paths = await ensureStore(root);
  const next = normalizeLibraryMeta(meta);
  await writeFile(metaPath(paths.root), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function listFolders(root = dataRoot()) {
  const meta = await loadLibraryMeta(root);
  return meta.folders.slice().sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function createFolder(name, root = dataRoot()) {
  const title = String(name || "").trim();
  if (!title) throw Object.assign(new Error("folder name is required"), { status: 400 });
  if (title.length > 80) throw Object.assign(new Error("folder name is too long"), { status: 400 });
  const meta = await loadLibraryMeta(root);
  const exists = meta.folders.some((item) => item.name.toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"));
  if (exists) throw Object.assign(new Error("folder already exists"), { status: 400 });
  const folder = { id: `fld-${randomUUID().slice(0, 8)}`, name: title, createdAt: new Date().toISOString() };
  meta.folders.push(folder);
  await saveLibraryMeta(meta, root);
  return folder;
}

export async function renameFolder(id, name, root = dataRoot()) {
  const safe = safeFolderId(id);
  const title = String(name || "").trim();
  if (!safe) return null;
  if (!title) throw Object.assign(new Error("folder name is required"), { status: 400 });
  const meta = await loadLibraryMeta(root);
  const folder = meta.folders.find((item) => item.id === safe);
  if (!folder) return null;
  folder.name = title.slice(0, 80);
  await saveLibraryMeta(meta, root);
  return folder;
}

export async function deleteFolder(id, root = dataRoot()) {
  const safe = safeFolderId(id);
  if (!safe) return false;
  const meta = await loadLibraryMeta(root);
  const before = meta.folders.length;
  meta.folders = meta.folders.filter((item) => item.id !== safe);
  if (meta.folders.length === before) return false;
  for (const [docId, folderId] of Object.entries(meta.membership)) {
    if (folderId === safe) delete meta.membership[docId];
  }
  await saveLibraryMeta(meta, root);
  return true;
}

export async function moveDocumentToFolder(documentId, folderId, root = dataRoot()) {
  const safeDoc = safeDocumentId(documentId);
  if (!safeDoc) return null;
  const meta = await loadLibraryMeta(root);
  if (folderId == null || folderId === "" || folderId === "unfiled") {
    delete meta.membership[safeDoc];
    await saveLibraryMeta(meta, root);
    return { documentId: safeDoc, folderId: null };
  }
  const safeFld = safeFolderId(folderId);
  if (!safeFld || !meta.folders.some((item) => item.id === safeFld)) {
    throw Object.assign(new Error("folder not found"), { status: 404 });
  }
  meta.membership[safeDoc] = safeFld;
  await saveLibraryMeta(meta, root);
  return { documentId: safeDoc, folderId: safeFld };
}

export async function dropDocumentMembership(documentId, root = dataRoot()) {
  const safeDoc = safeDocumentId(documentId);
  if (!safeDoc) return;
  const meta = await loadLibraryMeta(root);
  if (!(safeDoc in meta.membership)) return;
  delete meta.membership[safeDoc];
  await saveLibraryMeta(meta, root);
}

export function attachFolderIds(documents, meta) {
  const membership = meta?.membership || {};
  return (Array.isArray(documents) ? documents : []).map((item) => ({
    ...item,
    folderId: membership[item.id] || null,
  }));
}
