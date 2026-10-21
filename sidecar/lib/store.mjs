import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { migrateDocument, validateDocument } from "./schema.mjs";
import { pathExists } from "./util.mjs";

/** Document ids are UUIDs (or test ids). Reject path fragments. */
export function safeDocumentId(id) {
  const value = String(id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
  return value;
}

export function dataRoot() {
  return (
    process.env.TABULECT_DATA ||
    join(homedir(), ".local", "share", "tabulect")
  );
}

export function pathsFor(root = dataRoot()) {
  return {
    root,
    documents: join(root, "documents"),
    uploads: join(root, "uploads"),
    jobs: join(root, "jobs"),
  };
}

export async function ensureStore(root = dataRoot()) {
  const paths = pathsFor(root);
  await mkdir(paths.documents, { recursive: true });
  await mkdir(paths.uploads, { recursive: true });
  await mkdir(paths.jobs, { recursive: true });
  return paths;
}

export async function saveUpload(id, filename, buffer, root = dataRoot()) {
  const paths = await ensureStore(root);
  const safe = String(filename || "upload").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const dest = join(paths.uploads, `${id}-${safe}`);
  await writeFile(dest, buffer);
  return dest;
}

export async function saveDocument(doc, root = dataRoot()) {
  const { doc: migrated } = migrateDocument(doc);
  validateDocument(migrated);
  const safe = safeDocumentId(migrated.id);
  if (!safe) throw new Error("document id is invalid");
  const paths = await ensureStore(root);
  const dest = join(paths.documents, `${safe}.json`);
  await writeFile(dest, JSON.stringify(migrated, null, 2), "utf8");
  try {
    const { indexDocument } = await import("./corpus.mjs");
    await indexDocument(migrated, root);
  } catch {
    /* corpus is best-effort */
  }
  return dest;
}

export async function loadDocument(id, root = dataRoot()) {
  const safe = safeDocumentId(id);
  if (!safe) return null;
  const paths = pathsFor(root);
  const dest = join(paths.documents, `${safe}.json`);
  if (!(await pathExists(dest))) return null;
  const raw = JSON.parse(await readFile(dest, "utf8"));
  const { doc, changed } = migrateDocument(raw);
  validateDocument(doc);
  if (changed) {
    await writeFile(dest, JSON.stringify(doc, null, 2), "utf8");
  }
  return doc;
}

function summarizeDocument(doc, updatedAt) {
  const rowCount = Array.isArray(doc.rows) ? doc.rows.length : 0;
  const chunkCount = Array.isArray(doc.chunks) ? doc.chunks.length : 0;
  const have = new Set((doc.rows || []).map((row) => row?.chunkId));
  const unfilled = (doc.chunks || []).filter((chunk) => chunk?.id && !have.has(chunk.id)).length;
  return {
    id: doc.id,
    title: doc.title,
    sourceType: doc.sourceType,
    tableLocale: doc.tableLocale,
    lastProvider: doc.lastProvider ?? null,
    rowCount,
    chunkCount,
    bookmarkCount: Array.isArray(doc.bookmarks) ? doc.bookmarks.length : 0,
    outputCount: Array.isArray(doc.outputs) ? doc.outputs.length : 0,
    folderId: null,
    partialFill: chunkCount > 0 && unfilled > 0,
    updatedAt,
  };
}

export async function listDocuments(root = dataRoot()) {
  const paths = await ensureStore(root);
  const names = (await readdir(paths.documents)).filter((n) => n.endsWith(".json"));
  const items = [];
  for (const name of names) {
    try {
      const dest = join(paths.documents, name);
      const [raw, st] = await Promise.all([readFile(dest, "utf8"), stat(dest)]);
      const doc = JSON.parse(raw);
      if (!doc?.id) continue;
      items.push(summarizeDocument(doc, st.mtime.toISOString()));
    } catch {
      /* skip corrupt */
    }
  }
  items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  try {
    const { attachFolderIds, loadLibraryMeta } = await import("./folders.mjs");
    return attachFolderIds(items, await loadLibraryMeta(root));
  } catch {
    return items;
  }
}

export async function renameDocument(id, title, root = dataRoot()) {
  const nextTitle = String(title ?? "").trim();
  if (!nextTitle) throw new Error("title is required");
  if (nextTitle.length > 240) throw new Error("title is too long");
  const doc = await loadDocument(id, root);
  if (!doc) return null;
  doc.title = nextTitle;
  await saveDocument(doc, root);
  return doc;
}

async function removeIfExists(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function findDocumentPath(safe, paths) {
  const dest = join(paths.documents, `${safe}.json`);
  if (await pathExists(dest)) return dest;
  const names = await readdir(paths.documents);
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const candidate = join(paths.documents, name);
    try {
      const raw = JSON.parse(await readFile(candidate, "utf8"));
      if (raw?.id === safe) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Delete the document JSON and any job/upload files that name this documentId. */
export async function deleteDocument(id, root = dataRoot()) {
  const safe = safeDocumentId(id);
  if (!safe) return false;
  const paths = await ensureStore(root);
  const dest = await findDocumentPath(safe, paths);
  if (!dest) return false;
  const removed = await removeIfExists(dest);
  if (!removed) return false;
  try {
    const { removeFromCorpus } = await import("./corpus.mjs");
    await removeFromCorpus(safe, root);
  } catch {
    /* corpus is best-effort */
  }
  try {
    const { dropDocumentMembership } = await import("./folders.mjs");
    await dropDocumentMembership(safe, root);
  } catch {
    /* membership cleanup is best-effort */
  }

  try {
    const jobNames = await readdir(paths.jobs);
    for (const name of jobNames) {
      if (!name.endsWith(".json")) continue;
      const jobPath = join(paths.jobs, name);
      let job;
      try {
        job = JSON.parse(await readFile(jobPath, "utf8"));
      } catch {
        continue;
      }
      if (job?.documentId !== safe) continue;
      await removeIfExists(jobPath);
      const jobId = typeof job.jobId === "string" ? job.jobId : name.slice(0, -5);
      if (!jobId || jobId.includes("/") || jobId.includes("..")) continue;
      try {
        const uploads = await readdir(paths.uploads);
        for (const upload of uploads) {
          if (upload.startsWith(`${jobId}-`)) {
            await removeIfExists(join(paths.uploads, upload));
          }
        }
      } catch {
        /* leftover uploads are non-fatal once the document JSON is gone */
      }
    }
  } catch {
    /* document JSON is already gone; ancillary cleanup must not fail delete */
  }
  return true;
}

export async function saveJobRecord(job, root = dataRoot()) {
  const paths = await ensureStore(root);
  const dest = join(paths.jobs, `${job.jobId}.json`);
  await writeFile(
    dest,
    JSON.stringify(
      {
        jobId: job.jobId,
        documentId: job.documentId ?? null,
        provider: job.provider ?? null,
        tableLocale: job.tableLocale ?? null,
        filename: job.filename ?? null,
        events: job.events,
        finished: job.finished,
        error: job.error ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );
}
