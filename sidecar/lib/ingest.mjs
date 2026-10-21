import { t } from "./i18n.mjs";
import { randomUUID } from "node:crypto";
import { chunkExtracted } from "./chunk.mjs";
import { detectSourceType, extractFile } from "./extract.mjs";
import { evaluateTextLayer, resolvePdfText } from "./ocr.mjs";
import { releaseFill, touchFill } from "./fill.mjs";
import { defaultTableLocale, normalizeLocale, validateDocument } from "./schema.mjs";
import { saveDocument, saveJobRecord, saveUpload } from "./store.mjs";

/**
 * Optional ingest cap. Unset, empty, or ≤0 means the whole book.
 * A positive integer (tests / local experiments) slices after chunking.
 */
export function maxChunkLimit(raw = process.env.TABULECT_MAX_CHUNKS) {
  if (raw == null) return Number.POSITIVE_INFINITY;
  const trimmed = String(raw).trim();
  if (trimmed === "") return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

export function createIngestJob({ filename, mime, buffer, provider, tableLocale, model }) {
  const jobId = randomUUID();
  return {
    jobId,
    filename: filename || "upload",
    mime: mime || "",
    buffer,
    provider,
    model: model || "",
    tableLocale: tableLocale || defaultTableLocale(),
    events: [],
    listeners: new Set(),
    finished: false,
    documentId: null,
    error: null,
    kind: "ingest",
  };
}

export function createFillJob({ documentId, provider, tableLocale, kind = "continue", model }) {
  const jobId = randomUUID();
  return {
    jobId,
    filename: kind,
    mime: "",
    buffer: Buffer.alloc(0),
    provider,
    model: model || "",
    tableLocale: tableLocale || defaultTableLocale(),
    events: [],
    listeners: new Set(),
    finished: false,
    documentId,
    error: null,
    kind,
  };
}

export function pushEvent(job, partial) {
  const event = {
    jobId: job.jobId,
    phase: partial.phase,
    pct: partial.pct,
    message: partial.message,
    documentId: partial.documentId ?? job.documentId ?? null,
    error: partial.error ?? null,
  };
  if (Number.isFinite(partial.filled)) event.filled = partial.filled;
  if (Number.isFinite(partial.clis)) event.clis = partial.clis;
  job.events.push(event);
  if (event.documentId) {
    touchFill(event.documentId, {
      filled: Number.isFinite(partial.filled) ? partial.filled : undefined,
      clis: Number.isFinite(partial.clis) ? partial.clis : undefined,
    });
  }
  for (const listener of [...job.listeners]) {
    try {
      if (typeof listener.write === "function") {
        listener.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      job.listeners.delete(listener);
    }
  }
  return event;
}

export function closeJob(job) {
  job.finished = true;
  for (const listener of [...job.listeners]) {
    try {
      if (typeof listener.end === "function") listener.end();
    } catch {
      /* client already gone */
    }
  }
  job.listeners.clear();
}

export function snapshotJob(job) {
  const last = job.events.at(-1);
  return {
    jobId: job.jobId,
    phase: last?.phase ?? "queued",
    pct: last?.pct ?? 0,
    message: last?.message ?? "",
    documentId: job.documentId ?? last?.documentId ?? null,
    error: job.error ?? last?.error ?? null,
    finished: job.finished,
    events: job.events,
    output: job.output ?? last?.output ?? null,
  };
}

export async function runIngestJob(job, { dataRoot } = {}) {
  try {
    pushEvent(job, { phase: "queued", pct: 2, message: t('queued') });
    const locale = normalizeLocale(job.tableLocale);
    const sourceType = detectSourceType({ filename: job.filename, mime: job.mime });
    const uploadPath = await saveUpload(job.jobId, job.filename, job.buffer, dataRoot);

    pushEvent(job, {
      phase: "extract",
      pct: 18,
      message: t('extracting0Text', sourceType.toUpperCase()),
    });
    let extracted = await extractFile({
      filePath: uploadPath,
      buffer: job.buffer,
      filename: job.filename,
      mime: job.mime,
      sourceType,
    });

    if (sourceType === "pdf") {
      const verdict = evaluateTextLayer(extracted.pages);
      pushEvent(job, {
        phase: "ocr",
        pct: 36,
        message: verdict.usable
          ? t('textLayerIsSufficientOcrSkipped')
          : "Yerel OCR (ocrmypdf/tesseract, tur+eng, deskew)",
      });
      extracted = await resolvePdfText(uploadPath, job.filename, extracted);
    } else {
      pushEvent(job, {
        phase: "ocr",
        pct: 36,
        message: "OCR gerekmedi",
      });
    }

    if (!extracted.text?.trim()) {
      throw new Error("Extract produced no text");
    }

    pushEvent(job, { phase: "chunk", pct: 58, message: t('splittingIntoChunks') });
    const chunked = chunkExtracted(extracted);
    let { chunks, title } = chunked;
    if (chunks.length === 0) throw new Error("Chunking produced no chunks");
    const limit = maxChunkLimit();
    if (Number.isFinite(limit) && chunks.length > limit) {
      pushEvent(job, {
        phase: "chunk",
        pct: 62,
        message: t('first01ChunksTabulectMax', limit, chunks.length),
      });
      chunks = chunks.slice(0, limit);
    } else {
      pushEvent(job, {
        phase: "chunk",
        pct: 62,
        message: t('n0Chunks', chunks.length),
      });
    }

    const document = validateDocument({
      id: randomUUID(),
      title: extracted.title || title || job.filename,
      sourceType,
      tableLocale: locale,
      lastProvider: job.provider,
      lastModel: job.model || "",
      chunks,
      rows: [],
      bookmarks: [],
      outputs: [],
    });
    job.documentId = document.id;
    await saveDocument(document, dataRoot);

    pushEvent(job, {
      phase: "done",
      pct: 100,
      message: t('n0ChunksReadyToRead', chunks.length),
      documentId: document.id,
      error: null,
    });
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    pushEvent(job, {
      phase: "error",
      pct: job.events.at(-1)?.pct ?? 0,
      message: t('operationFailed'),
      documentId: job.documentId,
      error: job.error,
    });
  } finally {
    if (job.documentId) releaseFill(job.documentId, job.jobId);
    closeJob(job);
    await saveJobRecord(job, dataRoot).catch(() => {});
  }
}
