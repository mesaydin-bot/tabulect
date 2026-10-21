#!/usr/bin/env node
/**
 * Tabulect local backend. Loopback only: 127.0.0.1:8755, token-protected (see lib/http-guard.mjs).
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, isAbsolute, resolve as resolvePath } from "node:path";
import { PROVIDER_IDS, validateIngestEvent } from "./lib/schema.mjs";
import { createIngestJob, pushEvent, runIngestJob, snapshotJob } from "./lib/ingest.mjs";
import { fieldsFromParts, parseMultipart } from "./lib/multipart.mjs";
import { probeOcrTools } from "./lib/ocr.mjs";
import { listProviders, listSessions } from "./lib/providers/index.mjs";
import { SUBSCRIPTIONS, loginCommandText, openLogin } from "./lib/providers/login.mjs";
import { createPhraseService } from "./lib/phrases.mjs";
import { configureSessionStore } from "./lib/providers/sessions.mjs";
import { closePersistentSessions, connectionStatus, resetPersistentSessions } from "./lib/providers/persistent.mjs";
import { modelCatalog } from "./lib/providers/models.mjs";
import { asciiFilename, documentToXlsx, filenameForDocument, parseExportColumns } from "./lib/export.mjs";
import { applyInstruct } from "./lib/instruct.mjs";
import { migrateDocument, validateDocument } from "./lib/schema.mjs";
import { startAutofillWorker, startContinueFill } from "./lib/continue.mjs";
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  renameDocument,
  safeDocumentId,
  saveDocument,
  saveUpload,
} from "./lib/store.mjs";
import { addBookmark, removeBookmark, reorderBookmarks, updateBookmark } from "./lib/bookmarks.mjs";
import { createFolder, deleteFolder, listFolders, moveDocumentToFolder, renameFolder } from "./lib/folders.mjs";
import { deleteTemplate, loadTemplates, localizeTemplates, resetTemplate, upsertTemplate } from "./lib/templates.mjs";
import { startTableAi } from "./lib/table-ai.mjs";
import { buildExport, writeExportFile } from "./lib/rich-export.mjs";
import { loadSettings, saveSettings } from "./lib/settings.mjs";
import { isolateFillEnabled, installProcessKeepAlive, spawnFillWorker } from "./lib/supervise.mjs";
import { fillConcurrency, schemaBatchSize } from "./lib/providers/run.mjs";
import { resolveModel } from "./lib/providers/models.mjs";
import { allowedOrigin, checkRequest, createSessionToken } from "./lib/http-guard.mjs";
import { t, withLang } from "./lib/i18n.mjs";
import {
  createNote,
  createNoteFolder,
  deleteNote,
  deleteNoteFolder,
  listNoteFolders,
  listNotes,
  loadNote,
  moveNoteToFolder,
  patchNote,
  renameNoteFolder,
  safeNoteId,
  snapshotNotes,
} from "./lib/notes.mjs";

const HOST = process.env.TABULECT_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.TABULECT_PORT || "8755", 10);
const SERVICE = "tabulect";
const MAX_UPLOAD = 80 * 1024 * 1024;

installProcessKeepAlive();
configureSessionStore();
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  closePersistentSessions();
  server.close();
  setTimeout(() => process.exit(0), 1600).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, shutdown);
}
// Native macOS termination can bypass ExitRequested and leave the shell sidecar
// orphaned. Watch the owning app as well, including forced quits and crashes.
const ownerPid = Number.parseInt(process.env.TABULECT_PARENT_PID || "0", 10);
if (ownerPid > 1) {
  const ownerWatch = setInterval(() => {
    try { process.kill(ownerPid, 0); }
    catch (error) { if (error.code === "ESRCH") { clearInterval(ownerWatch); shutdown(); } }
  }, 1000);
  ownerWatch.unref();
}

const jobs = new Map();
const phraseService = createPhraseService();

const SESSION_TOKEN = createSessionToken();

function applyCors(req, res) {
  const allowed = allowedOrigin(req.headers.origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Tabulect-Token, X-Tabulect-Lang");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function pathnameOf(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  return new URL(req.url, `http://${host}`).pathname;
}

let ocrProbeCache = { at: 0, value: null };

async function handleHealth(_req, res) {
  // Keep /health cheap so the .app can finish launching and so fill workers
  // cannot stall liveness. Provider CLI probes live on /providers.
  const now = Date.now();
  if (!ocrProbeCache.value || now - ocrProbeCache.at > 15_000) {
    ocrProbeCache = { at: now, value: await probeOcrTools() };
  }
  sendJson(res, 200, {
    ok: true,
    service: SERVICE,
    ocr: ocrProbeCache.value,
    features: {
      instruct: "cli",
      exportXlsx: true,
      documentDelete: true,
      continueFill: false,
      isolatedFill: true,
      parallelFill: true,
      schemaFill: false,
      bookmarks: true,
      tableAi: true,
      richExport: true,
      templates: true,
      sessionReuse: true,
      folders: true,
      notes: true,
      corpus: true,
      schemaBatchSize: schemaBatchSize(),
      fillConcurrency: fillConcurrency(),
    },
    pid: process.pid,
  });
}

function sendXlsx(res, buffer, filename) {
  const encoded = encodeURIComponent(filename);
  const ascii = asciiFilename(filename);
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "no-store",
    "Content-Length": buffer.length,
  });
  res.end(buffer);
}

function columnsFromRequest(req, body) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = new URL(req.url, `http://${host}`);
  return parseExportColumns(url.searchParams.get("columns") || body?.columns);
}

async function handleProviders(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const providers = await listProviders({ refresh: url.searchParams.has("refresh") });
  const enriched = providers.map((provider) => {
    const def = SUBSCRIPTIONS[provider.id];
    return {
      ...provider,
      status: provider.status || (provider.available ? (provider.loggedIn ? "connected" : "login_required") : "missing"),
      install: def?.install || null,
      docs: def?.docs || null,
      loginCommand: def ? loginCommandText(provider.id, provider.bin) : null,
      bin: undefined,
    };
  });
  sendJson(res, 200, { providers: enriched, models: modelCatalog() });
}

async function handleProviderLogin(res, id) {
  try {
    sendJson(res, 200, await openLogin(id));
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message });
  }
}

async function parseIngestRequest(req) {
  const type = String(req.headers["content-type"] || "");
  const body = await readBody(req);
  if (type.includes("multipart/form-data")) {
    const { fields, file } = fieldsFromParts(parseMultipart(body, type));
    if (!file) throw new Error("file field is required");
    return {
      filename: file.filename || fields.filename || "upload",
      mime: file.mime || fields.mime || "",
      buffer: file.buffer,
      provider: fields.provider,
      tableLocale: fields.tableLocale || fields.locale,
      model: fields.model,
    };
  }
  const json = JSON.parse(body.toString("utf8") || "{}");
  if (json.filePath) {
    const filePath = String(json.filePath);
    if (!isAbsolute(filePath)) throw new Error("filePath must be an absolute local path");
    const buffer = await readFile(filePath);
    return {
      filename: json.filename || json.fileName || basename(filePath),
      mime: json.mime || "",
      buffer,
      provider: json.provider,
      tableLocale: json.tableLocale || json.locale,
      model: json.model,
    };
  }
  if (!json.contentBase64 && !json.text) {
    throw new Error("JSON ingest needs filePath, contentBase64, or text");
  }
  const buffer = json.text
    ? Buffer.from(String(json.text), "utf8")
    : Buffer.from(String(json.contentBase64), "base64");
  return {
    filename: json.filename || json.fileName || "upload.md",
    mime: json.mime || "",
    buffer,
    provider: json.provider,
    tableLocale: json.tableLocale || json.locale,
    model: json.model,
  };
}

async function handleInstruct(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!documentId || !instruction) {
    sendJson(res, 400, { error: "documentId and instruction are required" });
    return;
  }
  if (body.tableLocale !== "tr" && body.tableLocale !== "en") {
    sendJson(res, 400, { error: 'tableLocale must be "tr" or "en"' });
    return;
  }
  const provider =
    typeof body.provider === "string" && PROVIDER_IDS.includes(body.provider)
      ? body.provider
      : undefined;
  const result = await applyInstruct({
    documentId,
    instruction,
    tableLocale: body.tableLocale,
    provider,
    model: typeof body.model === "string" ? body.model : undefined,
    registerJob: (job) => jobs.set(job.jobId, job),
  });
  const status = result.ok ? 200 : result.status || 400;
  sendJson(res, status, result);
}

async function handleIngest(req, res) {
  const parsed = await parseIngestRequest(req);
  if (!PROVIDER_IDS.includes(parsed.provider)) {
    sendJson(res, 400, {
      error: `provider must be one of ${PROVIDER_IDS.join(", ")}`,
    });
    return;
  }
  if (!parsed.buffer?.length) {
    sendJson(res, 400, { error: "empty upload" });
    return;
  }
  parsed.model = resolveModel(parsed.provider, parsed.model);
  const job = createIngestJob(parsed);
  jobs.set(job.jobId, job);
  if (isolateFillEnabled()) {
    const uploadPath = await saveUpload(job.jobId, job.filename, job.buffer);
    job.buffer = Buffer.alloc(0);
    spawnFillWorker({
      kind: "ingest",
      job,
      payload: {
        uploadPath,
        filename: parsed.filename,
        mime: parsed.mime,
        provider: parsed.provider,
        tableLocale: parsed.tableLocale,
        model: parsed.model,
      },
    });
  } else {
    queueMicrotask(() => {
      runIngestJob(job).catch((error) => {
        if (!job.finished) {
          pushEvent(job, {
            phase: "error",
            pct: 0,
            message: t('operationFailed'),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    });
  }
  sendJson(res, 202, { jobId: job.jobId });
}

function handleSse(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: `unknown job ${jobId}` });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  for (const event of job.events) {
    validateIngestEvent(event);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (job.finished) {
    res.end();
    return;
  }
  job.listeners.add(res);
  res.on("error", () => {
    job.listeners.delete(res);
  });
  req.on("close", () => {
    job.listeners.delete(res);
  });
}

async function handleContinue(req, res, id) {
  const safe = safeDocumentId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid document id" });
    return;
  }
  let body = {};
  try {
    const raw = (await readBody(req, 16 * 1024)).toString("utf8").trim();
    if (raw) body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const result = await startContinueFill({
    documentId: safe,
    provider: body.provider,
    tableLocale: body.tableLocale,
    model: typeof body.model === "string" ? body.model : undefined,
    force: body.force === true,
    registerJob: (job) => jobs.set(job.jobId, job),
  });
  sendJson(res, result.status, result.body);
}

async function handleDocument(res, id) {
  const safe = safeDocumentId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid document id" });
    return;
  }
  const doc = await loadDocument(safe);
  if (!doc) {
    sendJson(res, 404, { error: `document ${safe} not found` });
    return;
  }
  sendJson(res, 200, doc);
}

async function handleDeleteDocument(res, id) {
  const safe = safeDocumentId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid document id" });
    return;
  }
  try {
    const removed = await deleteDocument(safe);
    if (!removed) {
      sendJson(res, 404, { error: `document ${safe} not found` });
      return;
    }
    sendJson(res, 200, { ok: true, id: safe });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleExportDocument(req, res, id) {
  const safe = safeDocumentId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid document id" });
    return;
  }
  const doc = await loadDocument(safe);
  if (!doc) {
    sendJson(res, 404, { error: `document ${safe} not found` });
    return;
  }
  const buffer = documentToXlsx(doc, { columns: columnsFromRequest(req) });
  sendXlsx(res, buffer, filenameForDocument(doc));
}

async function handleExportBody(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  let doc = null;
  if (typeof body.documentId === "string" && body.documentId.trim()) {
    const safe = safeDocumentId(body.documentId.trim());
    if (!safe) {
      sendJson(res, 400, { error: "invalid document id" });
      return;
    }
    doc = await loadDocument(safe);
    if (!doc) {
      sendJson(res, 404, { error: `document ${safe} not found` });
      return;
    }
  } else if (body.document) {
    const { doc: migrated } = migrateDocument(body.document);
    validateDocument(migrated);
    doc = migrated;
  }
  if (!doc) {
    sendJson(res, 400, { error: "documentId or document is required" });
    return;
  }
  const buffer = documentToXlsx(doc, { columns: parseExportColumns(body.columns) });
  sendXlsx(res, buffer, filenameForDocument(doc));
}

function sendBinary(res, status, { buffer, mime, filename }) {
  const encoded = encodeURIComponent(filename);
  res.writeHead(status, {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "no-store",
    "Content-Length": buffer.length,
  });
  res.end(buffer);
}

function templateLang(req) {
  const lang = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("lang");
  return lang === "tr" ? "tr" : "en";
}

async function handleTemplates(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { templates: localizeTemplates(await loadTemplates(), templateLang(req)) });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const templates = await upsertTemplate(body);
  sendJson(res, 200, { templates: localizeTemplates(templates, templateLang(req)) });
}

async function handleTemplateReset(req, res, id) {
  const templates = await resetTemplate(id);
  if (!templates) {
    sendJson(res, 404, { error: "only built-in templates can be reset" });
    return;
  }
  sendJson(res, 200, { templates: localizeTemplates(templates, templateLang(req)) });
}

async function handleTemplateItem(req, res, id) {
  if (req.method === "DELETE") {
    const templates = await deleteTemplate(id);
    if (!templates) {
      sendJson(res, 404, { error: "template not found" });
      return;
    }
    sendJson(res, 200, { templates: localizeTemplates(templates, templateLang(req)) });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const templates = await upsertTemplate({ ...body, id });
  sendJson(res, 200, { templates: localizeTemplates(templates, templateLang(req)) });
}

async function handleSettings(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, await loadSettings());
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  sendJson(res, 200, await saveSettings(body));
}

async function handleCreateDocument(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const source = body.document || body;
  try {
    const { doc } = migrateDocument(source);
    validateDocument(doc);
    await saveDocument(doc);
    sendJson(res, 200, doc);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleAddBookmark(req, res, id) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const result = await addBookmark(id, body);
    if (!result) {
      sendJson(res, 404, { error: `document ${id} not found` });
      return;
    }
    sendJson(res, 200, { ok: true, bookmark: result.bookmark, document: result.doc });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleReorderBookmarks(req, res, id) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const result = await reorderBookmarks(id, body.ids);
  if (!result) {
    sendJson(res, 404, { error: `document ${id} not found` });
    return;
  }
  sendJson(res, 200, { ok: true, document: result.doc });
}

async function handleBookmarkItem(req, res, id, bookmarkId) {
  if (req.method === "DELETE") {
    const result = await removeBookmark(id, bookmarkId);
    if (!result) {
      sendJson(res, 404, { error: `document ${id} not found` });
      return;
    }
    if (!result.removed) {
      sendJson(res, 404, { error: "bookmark not found" });
      return;
    }
    sendJson(res, 200, { ok: true, document: result.doc });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const result = await updateBookmark(id, bookmarkId, body);
  if (!result) {
    sendJson(res, 404, { error: `document ${id} not found` });
    return;
  }
  if (!result.bookmark) {
    sendJson(res, 404, { error: "bookmark not found" });
    return;
  }
  sendJson(res, 200, { ok: true, bookmark: result.bookmark, document: result.doc });
}

async function handleCreateFolder(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const folder = await createFolder(body.name);
    sendJson(res, 200, { folder, folders: await listFolders() });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleFolderItem(req, res, folderId) {
  if (req.method === "DELETE") {
    const ok = await deleteFolder(folderId);
    if (!ok) {
      sendJson(res, 404, { error: "folder not found" });
      return;
    }
    sendJson(res, 200, { ok: true, folders: await listFolders(), documents: await listDocuments() });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const folder = await renameFolder(folderId, body.name);
    if (!folder) {
      sendJson(res, 404, { error: "folder not found" });
      return;
    }
    sendJson(res, 200, { folder, folders: await listFolders() });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleMoveDocumentFolder(req, res, documentId) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const moved = await moveDocumentToFolder(documentId, body.folderId ?? null);
    sendJson(res, 200, { ok: true, ...moved, documents: await listDocuments(), folders: await listFolders() });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleTableAi(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) {
    sendJson(res, 400, { error: "documentId is required" });
    return;
  }
  const result = await startTableAi({
    documentId,
    provider: body.provider,
    model: body.model,
    tableLocale: body.tableLocale,
    templateId: body.templateId,
    instruction: body.instruction,
    prompt: body.prompt,
    selection: body.selection,
    bookmarkIds: body.bookmarkIds,
    allBookmarks: body.allBookmarks === true,
    mentionIds: Array.isArray(body.mentionIds) ? body.mentionIds : [],
    promptLang: body.promptLang,
    source: body.source === "instruction" ? "instruction" : undefined,
    append: body.append === true,
    baseContent: typeof body.baseContent === "string" ? body.baseContent : undefined,
    registerJob: (job) => jobs.set(job.jobId, job),
  });
  sendJson(res, result.status, result.body);
}

async function handleSessionReset(req, res) {
  let body = {};
  try {
    const raw = (await readBody(req, 16 * 1024)).toString("utf8").trim();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    resetPersistentSessions({
      providerId: typeof body.provider === "string" ? body.provider : undefined,
      documentId: typeof body.documentId === "string" ? body.documentId : undefined,
    });
  } catch (error) { sendJson(res, error.status || 500, { error: error.message }); return; }
  sendJson(res, 200, { ok: true, sessions: listSessions() });
}

async function handleOutputExport(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const built = await buildExport({
      format: body.format,
      title: body.title,
      content: body.content,
    });
    sendBinary(res, 200, built);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleOutputSave(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const settings = await loadSettings();
    const built = await buildExport({
      format: body.format,
      title: body.title,
      content: body.content,
    });
    // Only the export folder the user chose in settings is writable; a request
    // cannot name an arbitrary directory.
    if (body.directory && resolvePath(String(body.directory)) !== resolvePath(settings.exportDir)) {
      sendJson(res, 400, { error: "Saving is limited to the export folder chosen in settings." });
      return;
    }
    const saved = await writeExportFile(built, settings.exportDir);
    sendJson(res, 200, { ok: true, ...saved });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePatchDocument(req, res, id) {
  const safe = safeDocumentId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid document id" });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  if (body.title == null) {
    sendJson(res, 400, { error: "title is required" });
    return;
  }
  try {
    const doc = await renameDocument(safe, body.title);
    if (!doc) {
      sendJson(res, 404, { error: `document ${safe} not found` });
      return;
    }
    sendJson(res, 200, doc);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleNotesList(res) {
  sendJson(res, 200, await snapshotNotes());
}

async function handleCreateNote(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const note = await createNote({
      title: body.title,
      body: body.body,
      folderId: body.folderId ?? null,
    });
    sendJson(res, 200, { note, ...(await snapshotNotes()) });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleNoteItem(req, res, id) {
  const safe = safeNoteId(id);
  if (!safe) {
    sendJson(res, 400, { error: "invalid note id" });
    return;
  }
  if (req.method === "GET") {
    const note = await loadNote(safe);
    if (!note) {
      sendJson(res, 404, { error: `note ${safe} not found` });
      return;
    }
    sendJson(res, 200, { note });
    return;
  }
  if (req.method === "DELETE") {
    const ok = await deleteNote(safe);
    if (!ok) {
      sendJson(res, 404, { error: `note ${safe} not found` });
      return;
    }
    sendJson(res, 200, { ok: true, id: safe, ...(await snapshotNotes()) });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const note = await patchNote(safe, body);
    if (!note) {
      sendJson(res, 404, { error: `note ${safe} not found` });
      return;
    }
    sendJson(res, 200, { note, ...(await snapshotNotes()) });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleMoveNoteFolder(req, res, id) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const note = await moveNoteToFolder(id, body.folderId ?? null);
    if (!note) {
      sendJson(res, 404, { error: `note ${id} not found` });
      return;
    }
    sendJson(res, 200, { ok: true, note, ...(await snapshotNotes()) });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCreateNoteFolder(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const folder = await createNoteFolder(body.name);
    sendJson(res, 200, { folder, ...(await snapshotNotes()) });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleNoteFolderItem(req, res, folderId) {
  if (req.method === "DELETE") {
    const ok = await deleteNoteFolder(folderId);
    if (!ok) {
      sendJson(res, 404, { error: "folder not found" });
      return;
    }
    sendJson(res, 200, { ok: true, ...(await snapshotNotes()) });
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const folder = await renameNoteFolder(folderId, body.name);
    if (!folder) {
      sendJson(res, 404, { error: "folder not found" });
      return;
    }
    sendJson(res, 200, { folder, ...(await snapshotNotes()) });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleNoteExport(req, res, id) {
  const note = await loadNote(id);
  if (!note) {
    sendJson(res, 404, { error: `note ${id} not found` });
    return;
  }
  let body = {};
  try {
    const raw = (await readBody(req, 16 * 1024)).toString("utf8").trim();
    if (raw) body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }
  try {
    const built = await buildExport({
      format: body.format || "md",
      title: note.title,
      content: note.body,
    });
    sendBinary(res, 200, built);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

const server = createServer((req, res) => withLang(requestLang(req), () => route(req, res)));

function requestLang(req) {
  const header = req.headers["x-tabulect-lang"];
  if (header) return String(header);
  try {
    return new URL(req.url || "/", "http://127.0.0.1").searchParams.get("lang") || "en";
  } catch {
    return "en";
  }
}

async function route(req, res) {
  applyCors(req, res);
  let guardUrl;
  try {
    guardUrl = new URL(req.url, "http://127.0.0.1");
  } catch {
    sendJson(res, 400, { error: "bad request" });
    return;
  }
  const refused = checkRequest(req, { port: PORT, token: SESSION_TOKEN, pathname: guardUrl.pathname, query: guardUrl.searchParams });
  if (refused) {
    sendJson(res, refused.status, { error: refused.error });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = pathnameOf(req);
  try {
    if (req.method === "GET" && path === "/session") {
      sendJson(res, 200, { token: SESSION_TOKEN });
      return;
    }
    if (req.method === "GET" && path === "/health") {
      await handleHealth(req, res);
      return;
    }
    if (req.method === "GET" && path === "/providers") {
      await handleProviders(req, res);
      return;
    }
    const providerLogin = path.match(/^\/providers\/([a-z]+)\/login$/);
    if (req.method === "POST" && providerLogin) {
      await handleProviderLogin(res, providerLogin[1]);
      return;
    }
    if (req.method === "POST" && path === "/reading/phrases") {
      try {
        const result = await phraseService.request(JSON.parse((await readBody(req, 100000)).toString("utf8")));
        sendJson(res, result.status === "pending" ? 202 : 200, result);
      } catch (error) { sendJson(res, error.status || 400, { error: error.message }); }
      return;
    }
    if (req.method === "GET" && /^\/reading\/phrases\/[a-f0-9]{64}$/.test(path)) {
      const result = phraseService.get(path.split("/").pop());
      sendJson(res, result ? 200 : 404, result || { error: t('thePhrasePreparationRecordWasNot') });
      return;
    }
    if (req.method === "GET" && path === "/documents") {
      sendJson(res, 200, { documents: await listDocuments(), folders: await listFolders() });
      return;
    }
    if (req.method === "GET" && path === "/folders") {
      sendJson(res, 200, { folders: await listFolders() });
      return;
    }
    if (req.method === "GET" && path === "/notes") {
      await handleNotesList(res);
      return;
    }
    if (req.method === "POST" && path === "/notes") {
      await handleCreateNote(req, res);
      return;
    }
    if (req.method === "GET" && path === "/note-folders") {
      sendJson(res, 200, { folders: await listNoteFolders(), notes: await listNotes() });
      return;
    }
    if (req.method === "POST" && path === "/note-folders") {
      await handleCreateNoteFolder(req, res);
      return;
    }
    if (req.method === "POST" && path === "/folders") {
      await handleCreateFolder(req, res);
      return;
    }
    if (req.method === "POST" && path === "/documents") {
      await handleCreateDocument(req, res);
      return;
    }
    if (req.method === "GET" && path === "/templates") {
      await handleTemplates(req, res);
      return;
    }
    if (req.method === "POST" && path === "/templates") {
      await handleTemplates(req, res);
      return;
    }
    if (req.method === "GET" && path === "/settings") {
      await handleSettings(req, res);
      return;
    }
    if (req.method === "PATCH" && path === "/settings") {
      await handleSettings(req, res);
      return;
    }
    if (req.method === "POST" && path === "/table-ai") {
      await handleTableAi(req, res);
      return;
    }
    if (req.method === "POST" && path === "/sessions/reset") {
      await handleSessionReset(req, res);
      return;
    }
    if (req.method === "GET" && path === "/sessions") {
      sendJson(res, 200, { sessions: listSessions(), connections: connectionStatus() });
      return;
    }
    if (req.method === "POST" && path === "/output/export") {
      await handleOutputExport(req, res);
      return;
    }
    if (req.method === "POST" && path === "/output/save") {
      await handleOutputSave(req, res);
      return;
    }
    const templateReset = path.match(/^\/templates\/([^/]+)\/reset$/);
    if (templateReset && req.method === "POST") {
      await handleTemplateReset(req, res, decodeURIComponent(templateReset[1]));
      return;
    }
    const templateItem = path.match(/^\/templates\/([^/]+)$/);
    if (templateItem && (req.method === "PATCH" || req.method === "DELETE")) {
      await handleTemplateItem(req, res, decodeURIComponent(templateItem[1]));
      return;
    }
    if (req.method === "POST" && path === "/ingest") {
      await handleIngest(req, res);
      return;
    }
    if (req.method === "POST" && path === "/instruct") {
      await handleInstruct(req, res);
      return;
    }
    if (req.method === "POST" && (path === "/export.xlsx" || path === "/documents/export.xlsx")) {
      await handleExportBody(req, res);
      return;
    }
    const events = path.match(/^\/ingest\/([^/]+)\/events$/);
    if (req.method === "GET" && events) {
      handleSse(req, res, decodeURIComponent(events[1]));
      return;
    }
    const ingestStatus = path.match(/^\/ingest\/([^/]+)$/);
    if (req.method === "GET" && ingestStatus) {
      const job = jobs.get(decodeURIComponent(ingestStatus[1]));
      if (!job) {
        sendJson(res, 404, { error: `unknown job ${ingestStatus[1]}` });
        return;
      }
      sendJson(res, 200, snapshotJob(job));
      return;
    }
    const folderItem = path.match(/^\/folders\/([^/]+)$/);
    if (folderItem && (req.method === "PATCH" || req.method === "DELETE")) {
      await handleFolderItem(req, res, decodeURIComponent(folderItem[1]));
      return;
    }
    const noteFolderItem = path.match(/^\/note-folders\/([^/]+)$/);
    if (noteFolderItem && (req.method === "PATCH" || req.method === "DELETE")) {
      await handleNoteFolderItem(req, res, decodeURIComponent(noteFolderItem[1]));
      return;
    }
    const noteExport = path.match(/^\/notes\/([^/]+)\/export$/);
    if (req.method === "POST" && noteExport) {
      await handleNoteExport(req, res, decodeURIComponent(noteExport[1]));
      return;
    }
    const noteMove = path.match(/^\/notes\/([^/]+)\/folder$/);
    if (req.method === "POST" && noteMove) {
      await handleMoveNoteFolder(req, res, decodeURIComponent(noteMove[1]));
      return;
    }
    const noteItem = path.match(/^\/notes\/([^/]+)$/);
    if (noteItem && (req.method === "GET" || req.method === "PATCH" || req.method === "DELETE")) {
      await handleNoteItem(req, res, decodeURIComponent(noteItem[1]));
      return;
    }
    const moveFolder = path.match(/^\/documents\/([^/]+)\/folder$/);
    if (req.method === "POST" && moveFolder) {
      await handleMoveDocumentFolder(req, res, decodeURIComponent(moveFolder[1]));
      return;
    }
    const addBookmarkRoute = path.match(/^\/documents\/([^/]+)\/bookmarks$/);
    if (req.method === "POST" && addBookmarkRoute) {
      await handleAddBookmark(req, res, decodeURIComponent(addBookmarkRoute[1]));
      return;
    }
    const reorderRoute = path.match(/^\/documents\/([^/]+)\/bookmarks\/reorder$/);
    if (req.method === "POST" && reorderRoute) {
      await handleReorderBookmarks(req, res, decodeURIComponent(reorderRoute[1]));
      return;
    }
    const bookmarkItem = path.match(/^\/documents\/([^/]+)\/bookmarks\/([^/]+)$/);
    if (bookmarkItem && (req.method === "DELETE" || req.method === "PATCH")) {
      await handleBookmarkItem(
        req,
        res,
        decodeURIComponent(bookmarkItem[1]),
        decodeURIComponent(bookmarkItem[2]),
      );
      return;
    }
    const continueDoc = path.match(/^\/documents\/([^/]+)\/continue$/);
    if (req.method === "POST" && continueDoc) {
      await handleContinue(req, res, decodeURIComponent(continueDoc[1]));
      return;
    }
    const exportDoc = path.match(/^\/documents\/([^/]+)\/export\.xlsx$/);
    if (req.method === "GET" && exportDoc) {
      await handleExportDocument(req, res, decodeURIComponent(exportDoc[1]));
      return;
    }
    const doc = path.match(/^\/documents\/([^/]+)$/);
    if (doc) {
      const documentId = decodeURIComponent(doc[1]);
      if (req.method === "GET") {
        await handleDocument(res, documentId);
        return;
      }
      if (req.method === "DELETE") {
        await handleDeleteDocument(res, documentId);
        return;
      }
      if (req.method === "PATCH") {
        await handlePatchDocument(req, res, documentId);
        return;
      }
    }
    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /too large/.test(message) ? 413 : 400;
    sendJson(res, status, { error: message });
  }
}

server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 65_000;

server.on("error", (error) => {
  console.error(`tabulect backend failed: ${error.message}`);
  if (!server.listening) process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`tabulect listening on http://${HOST}:${PORT}`);
  startAutofillWorker({
    registerJob: (job) => jobs.set(job.jobId, job),
  });
});
