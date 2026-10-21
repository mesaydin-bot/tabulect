import { COLUMN_KEYS } from "../schema.mjs";

export function buildSchemaPrompt({ chunks, tableLocale, retryErrors = [] }) {
  const localeNote =
    tableLocale === "en"
      ? "Fill cell values in English."
      : "Write cell values in Turkish. Keep JSON keys in English.";

  const retryBlock =
    retryErrors.length > 0
      ? `\nPREVIOUS OUTPUT WAS REJECTED. Fix every issue and return JSON only:\n- ${retryErrors.join("\n- ")}\n`
      : "";

  const chunkBlock = chunks
    .map(
      (chunk) =>
        `--- CHUNK ${chunk.id} (page ${chunk.page ?? "null"}, chars ${chunk.text.length}) ---\n${chunk.text}`,
    )
    .join("\n\n");

  return `You extract a reading table from source chunks for Tabulect.
Return ONE JSON object and nothing else. No markdown fences, no commentary.

${localeNote}
JSON keys MUST be exactly these English camelCase names: ${COLUMN_KEYS.join(", ")}.

Schema:
{
  "rows": [
    {
      "chunkId": "c-001",
      "claim": "string",
      "warrant": "string",
      "fact": "string",
      "example": "string",
      "definition": "string",
      "exception": "string",
      "openQuestion": "string",
      "citation": "string",
      "practicalSuggestion": "string",
      "objection": null,
      "quoteStart": 0,
      "quoteEnd": 12
    }
  ]
}

Rules:
- Produce one row per listed chunk. chunkId must match exactly.
- Use "" for unused string fields. objection is null when empty.
- practicalSuggestion is a short, actionable tip grounded in that chunk (how a reader can use or apply what the passage says). Use "" if the passage has no practical tip.
- Do not invent claims, facts, quotes, citations, or tips that are not grounded in that chunk.
- quoteStart/quoteEnd are [start, end) offsets inside that chunk's text. If unsure, use 0 and the chunk length.
- Do not add extra top-level keys. Do not wrap the object in an array.
${retryBlock}
CHUNKS:
${chunkBlock}
`;
}

/**
 * Fill a single existing column from already-extracted rows + their chunks.
 * Used by /instruct (e.g. practicalSuggestion) so other cells stay untouched.
 */
export function buildColumnFillPrompt({
  items,
  columnKey,
  tableLocale,
  retryErrors = [],
}) {
  const localeNote =
    tableLocale === "en"
      ? "Write cell values in English."
      : "Write cell values in Turkish. Keep JSON keys in English.";

  const retryBlock =
    retryErrors.length > 0
      ? `\nPREVIOUS OUTPUT WAS REJECTED. Fix every issue and return JSON only:\n- ${retryErrors.join("\n- ")}\n`
      : "";

  const itemBlock = items
    .map(({ row, chunk }) => {
      const quote =
        row.quoteAnchor && chunk
          ? chunk.text.slice(row.quoteAnchor.start, row.quoteAnchor.end)
          : "";
      return `--- ROW ${row.id} CHUNK ${chunk.id} (page ${chunk.page ?? "null"}) ---
QUOTE: ${quote || "(full chunk)"}
CHUNK:
${chunk.text}`;
    })
    .join("\n\n");

  return `You fill ONE existing reading-table column from source chunks for Tabulect.
Return ONE JSON object and nothing else. No markdown fences, no commentary.

${localeNote}
Fill only "${columnKey}". Do not invent text that is not grounded in that row's chunk.
If the passage has no grounded value for this column, use "".

Schema:
{
  "rows": [
    { "rowId": "r-001", "chunkId": "c-001", "${columnKey}": "string" }
  ]
}

Rules:
- Produce one object per listed ROW. rowId and chunkId must match exactly.
- Ground every value in the chunk text. No outside knowledge, no generic advice.
- For practicalSuggestion: a short reader tip drawn from what the passage actually says (how to apply, notice, or use it). Not a summary of other columns.
- Do not add other columns. Do not wrap the object in an array.
${retryBlock}
ROWS:
${itemBlock}
`;
}

const INSTRUCT_CELL_CHARS = 180;
const INSTRUCT_CHUNK_CHARS = 1200;
const INSTRUCT_INDEX_CHARS = 72;
const INSTRUCT_INDEX_CAP = 80;

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function compactRowIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const take = list.length <= INSTRUCT_INDEX_CAP
    ? list
    : [...list.slice(0, 40), null, ...list.slice(-20)];
  return take
    .map((row) => {
      if (!row) return `… ${list.length - 60} more rows …`;
      const page = row.quoteAnchor?.page ?? row.page ?? "null";
      return `${row.id} p.${page} claim=${clip(row.claim, INSTRUCT_INDEX_CHARS)}`;
    })
    .join("\n");
}

function batchRowBlock(row, chunk) {
  const cells = COLUMN_KEYS.map((key) => `${key}=${clip(row[key], INSTRUCT_CELL_CHARS)}`).join(" | ");
  const page = chunk?.page ?? row.quoteAnchor?.page ?? "null";
  const chunkText = clip(chunk?.text || "", INSTRUCT_CHUNK_CHARS);
  return `--- ROW ${row.id} CHUNK ${row.chunkId} (page ${page}) ---
CELLS: ${cells}
CHUNK:
${chunkText}`;
}

/**
 * One-shot freeform instruction. The CLI must return a mutation JSON
 * the sidecar can apply to the existing document — not a chat reply.
 */
export function buildInstructPrompt({
  instruction,
  tableLocale,
  document,
  batchRows,
  chunksById,
  batchIndex = 0,
  batchCount = 1,
  retryErrors = [],
}) {
  const localeNote =
    tableLocale === "en"
      ? "Write cell values in English. JSON keys stay English camelCase."
      : "Write cell values in Turkish. Keep JSON keys in English.";

  const retryBlock =
    retryErrors.length > 0
      ? `\nPREVIOUS OUTPUT WAS REJECTED. Fix every issue and return JSON only:\n- ${retryErrors.join("\n- ")}\n`
      : "";

  const rows = Array.isArray(batchRows) ? batchRows : [];
  const itemBlock = rows
    .map((row) => batchRowBlock(row, chunksById?.get(row.chunkId)))
    .join("\n\n");

  const title = document?.title || "";
  const rowCount = document?.rows?.length ?? 0;
  const chunkCount = document?.chunks?.length ?? 0;

  return `TABULECT INSTRUCT
You apply a one-shot instruction to an existing reading table. This is not a chat.
Return ONE JSON object and nothing else. No markdown fences, no commentary.

INSTRUCTION_VERBATIM_BEGIN
${String(instruction || "")}
INSTRUCTION_VERBATIM_END

TABLE_LOCALE: ${tableLocale}
${localeNote}

DOCUMENT_TITLE: ${title}
COLUMN_KEYS: ${COLUMN_KEYS.join(", ")}
ROW_COUNT: ${rowCount}
CHUNK_COUNT: ${chunkCount}
BATCH: ${batchIndex + 1}/${batchCount}

ROW_INDEX:
${compactRowIndex(document?.rows || [])}

INSTRUCT_MUTATION_SCHEMA
{
  "applied": ["short description of each change"],
  "columnVisibility": { "claim": true },
  "updatedCells": [
    { "rowId": "r-001", "key": "claim", "value": "string" }
  ],
  "newRows": [
    {
      "chunkId": "c-001",
      "quoteStart": 0,
      "quoteEnd": 12,
      "claim": "string",
      "warrant": "string",
      "fact": "string",
      "example": "string",
      "definition": "string",
      "exception": "string",
      "openQuestion": "string",
      "citation": "string",
      "practicalSuggestion": "string",
      "objection": null
    }
  ]
}

Rules:
- Obey the user instruction verbatim against the provided rows/chunks.
- JSON keys MUST be the English camelCase names above. Do not invent new column keys.
- Use "" for unused strings. objection is null when empty.
- updatedCells.key must be one of: ${COLUMN_KEYS.join(", ")}.
- newRows must reference an existing chunkId from this document.
- Ground every cell in the provided row/chunk text. Do not invent a parallel table.
- columnVisibility keys may include rowNumber, page, and the column keys. Booleans only.
- If the instruction cannot change the table, return {"applied":[],"updatedCells":[],"error":"reason"}.
- Do not wrap the object in an array.
${retryBlock}
BATCH_ROWS:
${itemBlock}
`;
}

export function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("provider returned empty output");

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("provider output is not valid JSON");
  }
}
