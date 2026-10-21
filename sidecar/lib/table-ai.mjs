/**
 * Tabulect: send a selection or document bookmarks to a CLI with a prompt template.
 * No span-extraction schema. The CLI may return markdown, HTML, or prose.
 */
import { randomUUID } from "node:crypto";
import { closeJob, createFillJob, pushEvent } from "./ingest.mjs";
import { assertProviderReady, completeFreeform } from "./providers/index.mjs";
import { PROVIDER_IDS } from "./schema.mjs";
import { listDocuments, loadDocument, saveDocument, saveJobRecord } from "./store.mjs";
import { loadTemplates, resolveTableTemplate, templateBody, templateById } from "./templates.mjs";
import { resolveModel } from "./providers/models.mjs";
import { formatAdditionalSources, searchCorpus } from "./corpus.mjs";
import { listFolders } from "./folders.mjs";
import { listNoteFolders, listNotes } from "./notes.mjs";
import { resolveCorpusScope, retrievalQuery } from "./scope.mjs";
import { joinOutput } from "./output-mode.mjs";

export function formatLibraryIndex(documents = [], folders = [], notes = [], noteFolders = []) {
  const folderName = new Map((folders || []).map((item) => [item.id, item.name]));
  const noteFolderName = new Map((noteFolders || []).map((item) => [item.id, item.name]));
  const folderLines = (folders || []).map((item) => `- ${item.id}: ${item.name}`);
  const docLines = (documents || []).map((item) => {
    const folder = item.folderId ? folderName.get(item.folderId) || item.folderId : "(none)";
    return `- ${item.id} | ${item.title || "(untitled)"} | folder: ${folder}`;
  });
  const noteFolderLines = (noteFolders || []).map((item) => `- ${item.id}: ${item.name}`);
  const noteLines = (notes || []).map((item) => {
    const folder = item.folderId ? noteFolderName.get(item.folderId) || item.folderId : "(none)";
    return `- ${item.id} | ${item.title || "(untitled)"} | folder: ${folder}`;
  });
  return [
    "FOLDERS:",
    ...(folderLines.length ? folderLines : ["- (none)"]),
    "DOCUMENTS:",
    ...(docLines.length ? docLines : ["- (empty library)"]),
    "NOTE_FOLDERS:",
    ...(noteFolderLines.length ? noteFolderLines : ["- (none)"]),
    "NOTES:",
    ...(noteLines.length ? noteLines : ["- (no notes)"]),
  ].join("\n");
}

function evidencePromptBlock(evidenceBlock) {
  const block = String(evidenceBlock || "").trim();
  if (!block) return "";
  return `
CROSS_APP_EVIDENCE (read-only evidence supplied with the request; cite each used source by name; do not invent missing passages):
${block}
`;
}

export function buildTableAiPrompt({
  template,
  instruction,
  tableLocale,
  title,
  sourceLabel,
  sourceText,
  additionalSources,
  evidenceBlock = "",
  scopeMode = "open",
  mode = "selection",
  libraryIndex = "",
  documentId = "",
}) {
  const localeNote =
    tableLocale === "en"
      ? "Write the answer in English unless the source requires otherwise."
      : "Write the answer in Turkish unless the source requires otherwise.";
  const extra = String(instruction || "").trim();
  const scopeLine =
    scopeMode === "open"
      ? "OPEN_DOCUMENT_ONLY"
      : scopeMode === "corpus"
        ? "OPEN_DOCUMENT_PLUS_CORPUS"
        : "OPEN_DOCUMENT_PLUS_NAMED_SOURCES";
  const extraEvidence = evidencePromptBlock(evidenceBlock);
  if (mode === "instruction") {
    const hint = String(template || "").trim();
    const passage = String(sourceText || "").trim();
    return `TABLE_AI
You follow a freeform reader instruction from the / command bar.
The INSTRUCTION below is the primary task. Answer that question.
This is not a bookmark dump, not a schema-fill job, and not a request to tabulate the open book unless the instruction says so.
Ignore earlier main-idea / table-template instructions from this chat unless the INSTRUCTION itself asks for a table.
Do not invent library books that are not in LIBRARY_INDEX.
${localeNote}
Return markdown. Use a table only if the instruction asks for one. HTML or Mermaid only if asked.
No JSON schema. No camelCase keys. No chat preamble.

INSTRUCTION:
${extra}

CURRENT_DOCUMENT: ${title || ""} (${documentId || ""})
SOURCE_KIND: instruction
SCOPE: ${scopeLine}
Do not attach or dump bookmarks. Do not quote the open document unless SOURCE_BEGIN has a passage.
If CROSS_APP_EVIDENCE is present, cite those sources when you use them. Never invent remote corpus text.

LIBRARY_INDEX_BEGIN
${libraryIndex || "(empty library)"}
LIBRARY_INDEX_END
${hint ? `\nFORMAT_HINT (optional shape only; the instruction still wins):\n${hint}\n` : ""}
${passage ? `\nSOURCE_BEGIN\n${passage}\nSOURCE_END\n` : "\nNo source passage attached. Do not invent one from the open document.\n"}
${additionalSources ? `\nADDITIONAL_SOURCES (reader asked for these; cite title/id; do not invent):\n${additionalSources}\n` : ""}${extraEvidence}`;
  }
  return `TABLE_AI
You help a reader turn selected source text into a useful note.
Do not invent facts that are not in the source.
${localeNote}
Return markdown. Tables are welcome when they fit. HTML is allowed if asked.
Unless the instruction explicitly asks for a diagram or an HTML card, return only the table or the requested prose. Do not append Mermaid, flowchart, graph, or decorative HTML after a table.
No JSON schema. No camelCase keys. No chat preamble.

DOCUMENT_TITLE: ${title || ""}
SOURCE_KIND: ${sourceLabel}

TEMPLATE:
${template || "Summarize the source as a compact markdown table: Main idea | Reasoning | Example | Practical tip."}

${extra ? `EXTRA_INSTRUCTION:\n${extra}\n` : ""}
SCOPE: ${scopeLine}
Do not use other library books unless ADDITIONAL_SOURCES is present.
If CROSS_APP_EVIDENCE is present, cite those sources when you use them. Never invent remote corpus text.

SOURCE_BEGIN
${sourceText}
SOURCE_END
${additionalSources ? `\nADDITIONAL_SOURCES (reader asked for these; cite title/id; do not invent):\n${additionalSources}\n` : ""}${extraEvidence}`;
}

function extraTitle(instruction) {
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!text) return "Instruction";
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

export function detectOutputFormat(text) {
  const raw = String(text || "").trim();
  if (/^<!doctype html/i.test(raw) || /^<html[\s>]/i.test(raw)) return "html";
  if (/^<(?:div|section|article|table)\b/i.test(raw) && /<\/[a-z]+>/i.test(raw)) return "html";
  return "markdown";
}

export function sourceFromRequest(doc, body) {
  const instructionOnly = body?.source === "instruction" || body?.mode === "instruction";
  const selectionText = typeof body.selection?.text === "string" ? body.selection.text.trim() : "";
  if (instructionOnly) {
    if (selectionText) {
      return {
        label: "instruction",
        text: `ACTIVE_SELECTION:\n${selectionText}`,
        source: "instruction",
      };
    }
    return { label: "instruction", text: "", source: "instruction" };
  }
  if (selectionText) {
    return { label: "selection", text: selectionText, source: "selection" };
  }
  const bookmarks = Array.isArray(doc.bookmarks) ? doc.bookmarks : [];
  let chosen = bookmarks;
  if (Array.isArray(body.bookmarkIds) && body.bookmarkIds.length) {
    const want = new Set(body.bookmarkIds);
    chosen = bookmarks.filter((item) => want.has(item.id));
  }
  if (!chosen.length) {
    throw Object.assign(new Error("no selection or bookmarks to send"), { status: 400 });
  }
  const text = chosen
    .map((item, i) => `--- BOOKMARK ${i + 1} (${item.id}) ---\n${item.text}`)
    .join("\n\n");
  return { label: "bookmarks", text, source: "bookmarks" };
}

export async function runTableAiJob(job, { dataRoot, request } = {}) {
  try {
    pushEvent(job, { phase: "queued", pct: 8, message: "Tabulect queued" });
    const doc = await loadDocument(job.documentId, dataRoot);
    if (!doc) throw Object.assign(new Error(`document ${job.documentId} not found`), { status: 404 });
    const templates = await loadTemplates(dataRoot);
    const packed = sourceFromRequest(doc, request);
    const documents = await listDocuments(dataRoot);
    const folders = await listFolders(dataRoot);
    const notes = await listNotes(dataRoot);
    const noteFolders = await listNoteFolders(dataRoot);
    const scope = resolveCorpusScope({
      instruction: request.instruction,
      mentionIds: request.mentionIds,
      documents,
      folders,
      notes,
      noteFolders,
      openDocumentId: doc.id,
    });
    const locale = request.tableLocale || doc.tableLocale;
    const query = retrievalQuery(request.instruction, packed.text);
    let additionalSources = "";
    if (scope.searchCorpus) {
      const hits = searchCorpus(query, {
        includeIds: scope.mode === "explicit" ? scope.extraIds : undefined,
        excludeIds: [doc.id],
        limit: 6,
        root: dataRoot,
      });
      additionalSources = formatAdditionalSources(hits);
    }
    const instructionOnly = packed.source === "instruction";
    const template = instructionOnly
      ? templateById(templates, request.templateId)
      : resolveTableTemplate(templates, request.templateId);
    const prompt = buildTableAiPrompt({
      template: instructionOnly
        ? templateBody(template, request.promptLang || locale)
        : templateBody(template, request.promptLang || locale) || request.prompt || "",
      instruction: request.instruction,
      tableLocale: locale,
      title: doc.title,
      documentId: doc.id,
      sourceLabel: packed.label,
      sourceText: packed.text,
      additionalSources,
      scopeMode: scope.mode,
      mode: instructionOnly ? "instruction" : packed.source,
      libraryIndex: instructionOnly ? formatLibraryIndex(documents, folders, notes, noteFolders) : "",
    });
    job.prompt = prompt;
    pushEvent(job, {
      phase: "extract",
      pct: 35,
      message: instructionOnly
        ? "Sending instruction"
        : packed.label === "bookmarks"
          ? "Sending bookmarks"
          : "Sending selection",
      documentId: doc.id,
    });
    const output = await completeFreeform({
      providerId: job.provider,
      prompt,
      model: job.model,
      documentId: job.documentId,
    });
    const raw = String(output ?? "");
    const append = request.append === true;
    const stored = String(doc.outputs?.[0]?.content || "");
    const previous = typeof request.baseContent === "string" ? request.baseContent : stored;
    const content = append ? joinOutput(previous, raw) : raw;
    const format = detectOutputFormat(content);
    const artifact = {
      id: `out-${randomUUID().slice(0, 8)}`,
      title: instructionOnly ? extraTitle(request.instruction) : template?.name || "Tabulect",
      format,
      content,
      createdAt: new Date().toISOString(),
      source: packed.source,
      templateId: template?.id || "",
    };
    doc.outputs = [artifact, ...(Array.isArray(doc.outputs) ? doc.outputs : [])].slice(0, 20);
    doc.lastProvider = job.provider;
    doc.lastModel = job.model || "";
    await saveDocument(doc, dataRoot);
    job.output = artifact;
    pushEvent(job, {
      phase: "done",
      pct: 100,
      message: "Tabulect done",
      documentId: doc.id,
      error: null,
    });
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    pushEvent(job, {
      phase: "error",
      pct: job.events.at(-1)?.pct ?? 0,
      message: "Tabulect failed",
      documentId: job.documentId,
      error: job.error,
    });
  } finally {
    closeJob(job);
    await saveJobRecord(job, dataRoot).catch(() => {});
  }
}

export async function startTableAi({
  documentId,
  provider,
  model,
  tableLocale,
  templateId,
  instruction,
  prompt,
  selection,
  bookmarkIds,
  allBookmarks,
  mentionIds,
  source,
  append,
  baseContent,
  promptLang,
  registerJob,
  dataRoot,
} = {}) {
  const doc = await loadDocument(documentId, dataRoot);
  if (!doc) return { status: 404, body: { error: `document ${documentId} not found` } };
  if (!PROVIDER_IDS.includes(provider)) {
    return { status: 400, body: { error: `provider must be one of ${PROVIDER_IDS.join(", ")}` } };
  }
  try {
    await assertProviderReady(provider);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  const job = createFillJob({
    documentId,
    provider,
    tableLocale: tableLocale || doc.tableLocale,
    kind: "table-ai",
    model: resolveModel(provider, model, doc.lastModel),
  });
  registerJob?.(job);
  const request = {
    templateId,
    instruction,
    prompt,
    selection,
    bookmarkIds,
    allBookmarks,
    mentionIds: Array.isArray(mentionIds) ? mentionIds : [],
    source: source === "instruction" ? "instruction" : undefined,
    tableLocale: tableLocale || doc.tableLocale,
    promptLang: promptLang === "tr" || promptLang === "en" ? promptLang : undefined,
    append: append === true,
    baseContent: typeof baseContent === "string" ? baseContent : undefined,
  };
  queueMicrotask(() => {
    runTableAiJob(job, { dataRoot, request }).catch((error) => {
      if (!job.finished) {
        job.error = error instanceof Error ? error.message : String(error);
        pushEvent(job, {
          phase: "error",
          pct: 0,
          message: "Tabulect failed",
          documentId,
          error: job.error,
        });
        closeJob(job);
      }
    });
  });
  return { status: 202, body: { jobId: job.jobId, documentId } };
}
