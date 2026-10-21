/** Locked Tabulect document schema. Keys stay English camelCase. */
import { currentLang } from "./i18n.mjs";

export const SOURCE_TYPES = ["pdf", "epub", "html", "md", "docx"];
export const TABLE_LOCALES = ["tr", "en"];
/** Used only outside any request (tests, scripts). */
export const DEFAULT_TABLE_LOCALE = "en";

/** A table with no explicit language follows the interface language of the request. */
export function defaultTableLocale() {
  return currentLang() === "tr" ? "tr" : DEFAULT_TABLE_LOCALE;
}

export const COLUMN_KEYS = [
  "claim",
  "warrant",
  "fact",
  "example",
  "definition",
  "exception",
  "openQuestion",
  "citation",
  "practicalSuggestion",
  "objection",
];

/** Default empty value for a locked column key. */
export function defaultCell(key) {
  return key === "objection" ? null : "";
}

export const INGEST_PHASES = [
  "queued",
  "extract",
  "ocr",
  "chunk",
  "schema",
  "done",
  "error",
];

export const PROVIDER_IDS = ["codex", "kimi", "antigravity", "cursor", "claude"];

export class SchemaError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "SchemaError";
    this.details = details;
  }
}

export function emptyCells() {
  const cells = {};
  for (const key of COLUMN_KEYS) {
    cells[key] = defaultCell(key);
  }
  return cells;
}

export function normalizeBookmark(raw, index = 0) {
  if (!raw || typeof raw !== "object") {
    throw new SchemaError(`bookmarks[${index}] must be an object`);
  }
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `b-${index + 1}`;
  const text = typeof raw.text === "string" ? raw.text : "";
  const chunkId = typeof raw.chunkId === "string" ? raw.chunkId : "";
  const start = Number.isInteger(raw.start) ? raw.start : 0;
  const end = Number.isInteger(raw.end) ? raw.end : start;
  if (start < 0 || end < start) {
    throw new SchemaError(`bookmarks[${index}] range is invalid`);
  }
  const spans = Array.isArray(raw.spans)
    ? raw.spans.map((span, i) => ({
        chunkId: typeof span?.chunkId === "string" ? span.chunkId : chunkId,
        start: Number.isInteger(span?.start) ? span.start : start,
        end: Number.isInteger(span?.end) ? span.end : end,
        page: span?.page == null ? null : assertFiniteInt(`bookmarks[${index}].spans[${i}].page`, span.page, {
          allowNull: true,
        }),
      }))
    : [{ chunkId, start, end, page: raw.page ?? null }];
  return {
    id,
    text,
    chunkId: chunkId || spans[0]?.chunkId || "",
    start,
    end,
    page: raw.page == null ? spans[0]?.page ?? null : raw.page,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    note: typeof raw.note === "string" ? raw.note : "",
    spans,
  };
}

export function normalizeOutput(raw, index = 0) {
  if (!raw || typeof raw !== "object") {
    throw new SchemaError(`outputs[${index}] must be an object`);
  }
  const format = raw.format === "html" || raw.format === "text" ? raw.format : "markdown";
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `out-${index + 1}`,
    title: typeof raw.title === "string" ? raw.title : "",
    format,
    content: typeof raw.content === "string" ? raw.content : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    source: raw.source === "bookmarks" || raw.source === "instruction" ? raw.source : "selection",
    templateId: typeof raw.templateId === "string" ? raw.templateId : "",
  };
}

/**
 * Fill missing locked column keys with empty defaults.
 * Adds bookmarks/outputs arrays. Does not invent cell content.
 */
export function migrateDocument(doc) {
  if (!doc || typeof doc !== "object") return { doc, changed: false };
  let changed = false;
  if (!Array.isArray(doc.rows)) {
    doc.rows = [];
    changed = true;
  }
  if (!Array.isArray(doc.bookmarks)) {
    doc.bookmarks = [];
    changed = true;
  }
  if (!Array.isArray(doc.outputs)) {
    doc.outputs = [];
    changed = true;
  }
  for (const row of doc.rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of COLUMN_KEYS) {
      if (!(key in row)) {
        row[key] = defaultCell(key);
        changed = true;
      }
    }
  }
  doc.bookmarks = doc.bookmarks.map((item, i) => {
    const next = normalizeBookmark(item, i);
    if (JSON.stringify(next) !== JSON.stringify(item)) changed = true;
    return next;
  });
  doc.outputs = doc.outputs.map((item, i) => normalizeOutput(item, i));
  return { doc, changed };
}

export function normalizeLocale(value) {
  if (value == null || value === "") return defaultTableLocale();
  if (TABLE_LOCALES.includes(value)) return value;
  throw new SchemaError(`tableLocale must be "tr" or "en", got ${JSON.stringify(value)}`);
}

export function normalizeSourceType(value) {
  if (!SOURCE_TYPES.includes(value)) {
    throw new SchemaError(`sourceType must be one of ${SOURCE_TYPES.join(", ")}`);
  }
  return value;
}

export function normalizeObjection(value) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new SchemaError("objection must be a string or null");
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeCell(key, value) {
  if (key === "objection") return normalizeObjection(value);
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new SchemaError(`${key} must be a string`);
  }
  return value;
}

export function assertFiniteInt(name, value, { allowNull = false } = {}) {
  if (value == null) {
    if (allowNull) return null;
    throw new SchemaError(`${name} is required`);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SchemaError(`${name} must be an integer`);
  }
  return value;
}

export function validateQuoteAnchor(anchor, chunk, rowId) {
  const prefix = rowId ? `row ${rowId}: ` : "";
  if (!anchor || typeof anchor !== "object") {
    throw new SchemaError(`${prefix}quoteAnchor is required`);
  }
  if (typeof anchor.chunkId !== "string" || !anchor.chunkId) {
    throw new SchemaError(`${prefix}quoteAnchor.chunkId is required`);
  }
  if (chunk && anchor.chunkId !== chunk.id) {
    throw new SchemaError(`${prefix}quoteAnchor.chunkId must match row.chunkId`);
  }
  const start = assertFiniteInt("quoteAnchor.start", anchor.start);
  const end = assertFiniteInt("quoteAnchor.end", anchor.end);
  if (start < 0 || end < start) {
    throw new SchemaError(`${prefix}quoteAnchor range is invalid`);
  }
  if (chunk && end > chunk.text.length) {
    throw new SchemaError(`${prefix}quoteAnchor.end exceeds chunk text`);
  }
  if (anchor.page != null) {
    assertFiniteInt("quoteAnchor.page", anchor.page, { allowNull: true });
  }
  if (anchor.bbox != null) {
    if (
      !Array.isArray(anchor.bbox) ||
      anchor.bbox.length !== 4 ||
      anchor.bbox.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      throw new SchemaError(`${prefix}quoteAnchor.bbox must be 4 numbers or null`);
    }
  }
}

export function validateChunk(chunk, index) {
  const prefix = `chunks[${index}]`;
  if (!chunk || typeof chunk !== "object") throw new SchemaError(`${prefix} must be an object`);
  if (typeof chunk.id !== "string" || !chunk.id) throw new SchemaError(`${prefix}.id is required`);
  if (typeof chunk.text !== "string") throw new SchemaError(`${prefix}.text must be a string`);
  assertFiniteInt(`${prefix}.start`, chunk.start);
  assertFiniteInt(`${prefix}.end`, chunk.end);
  if (chunk.start < 0 || chunk.end < chunk.start) {
    throw new SchemaError(`${prefix} offsets are invalid`);
  }
  if (chunk.page != null) assertFiniteInt(`${prefix}.page`, chunk.page);
}

export function validateRow(row, chunksById, index) {
  const prefix = `rows[${index}]`;
  if (!row || typeof row !== "object") throw new SchemaError(`${prefix} must be an object`);
  if (typeof row.id !== "string" || !row.id) throw new SchemaError(`${prefix}.id is required`);
  if (typeof row.chunkId !== "string" || !row.chunkId) {
    throw new SchemaError(`${prefix}.chunkId is required`);
  }
  const chunk = chunksById.get(row.chunkId);
  if (!chunk) throw new SchemaError(`${prefix}.chunkId ${row.chunkId} is not in chunks`);
  for (const key of COLUMN_KEYS) {
    if (!(key in row)) throw new SchemaError(`${prefix} missing ${key}`);
    normalizeCell(key, row[key]);
  }
  validateQuoteAnchor(row.quoteAnchor, chunk, row.id);
}

export function validateDocument(doc) {
  if (!doc || typeof doc !== "object") throw new SchemaError("document must be an object");
  const details = [];
  const need = ["id", "title", "sourceType", "tableLocale", "chunks", "rows"];
  for (const key of need) {
    if (!(key in doc)) details.push(`missing ${key}`);
  }
  if (details.length) throw new SchemaError("document is missing fields", details);
  if (typeof doc.id !== "string" || !doc.id) throw new SchemaError("id is required");
  if (typeof doc.title !== "string") throw new SchemaError("title must be a string");
  normalizeSourceType(doc.sourceType);
  normalizeLocale(doc.tableLocale);
  if (!Array.isArray(doc.chunks)) throw new SchemaError("chunks must be an array");
  if (!Array.isArray(doc.rows)) throw new SchemaError("rows must be an array");
  if (doc.bookmarks != null && !Array.isArray(doc.bookmarks)) {
    throw new SchemaError("bookmarks must be an array");
  }
  if (doc.outputs != null && !Array.isArray(doc.outputs)) {
    throw new SchemaError("outputs must be an array");
  }
  doc.chunks.forEach((chunk, i) => validateChunk(chunk, i));
  const chunksById = new Map(doc.chunks.map((c) => [c.id, c]));
  if (chunksById.size !== doc.chunks.length) throw new SchemaError("chunk ids must be unique");
  doc.rows.forEach((row, i) => validateRow(row, chunksById, i));
  const rowIds = new Set(doc.rows.map((r) => r.id));
  if (rowIds.size !== doc.rows.length) throw new SchemaError("row ids must be unique");
  const bookmarks = Array.isArray(doc.bookmarks) ? doc.bookmarks : [];
  bookmarks.forEach((item, i) => normalizeBookmark(item, i));
  const bookmarkIds = new Set(bookmarks.map((item) => item.id));
  if (bookmarkIds.size !== bookmarks.length) throw new SchemaError("bookmark ids must be unique");
  return doc;
}

export function validateProviderRows(payload) {
  if (!payload || typeof payload !== "object") {
    throw new SchemaError("provider output must be a JSON object");
  }
  if (!Array.isArray(payload.rows)) {
    throw new SchemaError("provider output must have a rows array");
  }
  if (payload.rows.length === 0) {
    throw new SchemaError("provider output rows is empty — refusing to invent data");
  }
  const details = [];
  payload.rows.forEach((row, i) => {
    if (!row || typeof row !== "object") {
      details.push(`rows[${i}] is not an object`);
      return;
    }
    if (typeof row.chunkId !== "string" || !row.chunkId) {
      details.push(`rows[${i}] missing chunkId`);
    }
    for (const key of COLUMN_KEYS) {
      if (!(key in row)) details.push(`rows[${i}] missing ${key}`);
      else {
        try {
          normalizeCell(key, row[key]);
        } catch (error) {
          details.push(`rows[${i}].${key}: ${error.message}`);
        }
      }
    }
  });
  if (details.length) {
    throw new SchemaError("provider JSON failed schema validation", details);
  }
  return payload;
}

export function validateIngestEvent(event) {
  if (!event || typeof event !== "object") throw new SchemaError("event must be an object");
  if (typeof event.jobId !== "string" || !event.jobId) throw new SchemaError("jobId required");
  if (!INGEST_PHASES.includes(event.phase)) throw new SchemaError(`bad phase ${event.phase}`);
  if (typeof event.pct !== "number" || event.pct < 0 || event.pct > 100) {
    throw new SchemaError("pct must be 0–100");
  }
  if (typeof event.message !== "string") throw new SchemaError("message must be a string");
  if (event.documentId != null && typeof event.documentId !== "string") {
    throw new SchemaError("documentId must be string or null");
  }
  if (event.error != null && typeof event.error !== "string") {
    throw new SchemaError("error must be string or null");
  }
  return event;
}
