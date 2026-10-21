import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backoffMs, isHardProviderError, isUnrecoverableFillMiss } from "../fill.mjs";
import { COLUMN_KEYS, SchemaError, emptyCells, normalizeCell, validateProviderRows } from "../schema.mjs";
import { delay, padId } from "../util.mjs";
import { extractJson, buildSchemaPrompt, buildColumnFillPrompt, buildInstructPrompt } from "./prompt.mjs";

export const UI_COLUMN_KEYS = ["rowNumber", "page", ...COLUMN_KEYS];

const MAX_ATTEMPTS = 3;
export const DEFAULT_BATCH_SIZE = 1;
export const DEFAULT_FILL_CONCURRENCY = 1;
/** Default schema batch size. Prefer schemaBatchSize() so tests can override. */
export const BATCH_SIZE = DEFAULT_BATCH_SIZE;

function envPositive(raw, fallback, { min = 1, max = 32 } = {}) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, n);
}

export function schemaBatchSize(raw = process.env.TABULECT_BATCH_SIZE) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_BATCH_SIZE;
  return envPositive(raw, DEFAULT_BATCH_SIZE, { min: 1, max: 32 });
}

export function fillConcurrency(raw = process.env.TABULECT_FILL_CONCURRENCY) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_FILL_CONCURRENCY;
  return envPositive(raw, DEFAULT_FILL_CONCURRENCY, { min: 1, max: 8 });
}

export function schemaBatchCount(chunkCount, size = schemaBatchSize()) {
  return Math.max(1, Math.ceil(chunkCount / size));
}

export function skipOpenQuestion(error, tableLocale = "tr") {
  const excerpt = String(error?.message || error || "no valid rows")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  if (tableLocale === "en") {
    return `Skipped: provider returned no valid row — ${excerpt} (no data invented).`;
  }
  return `Atlandı: sağlayıcı geçerli satır döndürmedi — ${excerpt} (uydurulmadı).`;
}

export function isSkippedFillRow(row) {
  const question = String(row?.openQuestion || "");
  return (!row?.claim || row.claim === "") && (/^Atlandı:/.test(question) || /^Skipped:/.test(question));
}

export function skippedFillItem(chunk, error, tableLocale = "tr") {
  const item = {
    chunkId: chunk.id,
    quoteStart: 0,
    quoteEnd: Number.isInteger(chunk.text?.length) ? chunk.text.length : 0,
  };
  for (const key of COLUMN_KEYS) {
    item[key] = key === "objection" ? null : "";
  }
  item.openQuestion = skipOpenQuestion(error, tableLocale);
  return item;
}

export function skippedFillRows(chunks, error, { startIndex = 0, tableLocale = "tr" } = {}) {
  return (chunks || []).map((chunk, i) =>
    rowFromProvider(skippedFillItem(chunk, error, tableLocale), chunk, startIndex + i),
  );
}

function rowFromProvider(item, chunk, index) {
  const cells = emptyCells();
  for (const key of COLUMN_KEYS) {
    cells[key] = normalizeCell(key, item[key]);
  }
  let start = 0;
  let end = chunk.text.length;
  if (Number.isInteger(item.quoteStart) && Number.isInteger(item.quoteEnd)) {
    start = Math.max(0, item.quoteStart);
    end = Math.min(chunk.text.length, item.quoteEnd);
    if (end < start) {
      start = 0;
      end = chunk.text.length;
    }
  }
  return {
    id: padId("r", index),
    chunkId: chunk.id,
    quoteAnchor: {
      chunkId: chunk.id,
      start,
      end,
      page: chunk.page,
      bbox: null,
    },
    ...cells,
  };
}

export async function fillRowsWithAdapter(adapter, { chunks, tableLocale, onBatch, startIndex = 0 }) {
  if (!chunks.length) {
    throw new SchemaError("no chunks to fill — refusing to invent rows");
  }
  const rows = [];
  const size = schemaBatchSize();
  const batchCount = schemaBatchCount(chunks.length, size);
  for (let offset = 0, batchIndex = 0; offset < chunks.length; offset += size, batchIndex += 1) {
    const batch = chunks.slice(offset, offset + size);
    let filled = [];
    try {
      filled = await fillBatch(adapter, batch, tableLocale);
    } catch (error) {
      if (isHardProviderError(error)) throw error;
      // A 1-chunk wave already spent MAX_ATTEMPTS on this leftover. Do not
      // spend another three CLI trips on the same toxic hole (c-401).
      if (batch.length === 1 && isUnrecoverableFillMiss(error)) {
        filled = [skippedFillItem(batch[0], error, tableLocale)];
      } else {
        filled = [];
      }
    }
    const have = new Set(filled.map((item) => item.chunkId));
    for (const chunk of batch) {
      if (have.has(chunk.id)) continue;
      try {
        const one = await fillBatch(adapter, [chunk], tableLocale);
        for (const item of one) {
          if (have.has(item.chunkId)) continue;
          have.add(item.chunkId);
          filled.push(item);
        }
      } catch (inner) {
        if (isHardProviderError(inner)) throw inner;
        if (isUnrecoverableFillMiss(inner)) {
          have.add(chunk.id);
          filled.push(skippedFillItem(chunk, inner, tableLocale));
        }
      }
    }
    for (const item of filled) {
      const chunk = batch.find((c) => c.id === item.chunkId);
      if (!chunk) continue;
      if (rows.some((row) => row.chunkId === chunk.id)) continue;
      rows.push(rowFromProvider(item, chunk, startIndex + rows.length));
    }
    if (typeof onBatch === "function") {
      await onBatch({
        rowsSoFar: rows.slice(),
        batchIndex,
        batchCount,
        skipped: batch.length - filled.filter((item) => batch.some((c) => c.id === item.chunkId)).length,
      });
    }
  }
  if (rows.length === 0) {
    throw new SchemaError("provider produced no valid rows — refusing to invent data");
  }
  return rows;
}

async function fillBatch(adapter, chunks, tableLocale) {
  let errors = [];
  let lastRaw = "";
  let lastGot = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildSchemaPrompt({ chunks, tableLocale, retryErrors: errors });
    let raw;
    try {
      raw = await adapter.complete(prompt);
    } catch (error) {
      if (isHardProviderError(error)) throw error;
      errors = [error instanceof Error ? error.message : String(error)];
      lastRaw = errors[0];
      const wait = backoffMs(attempt);
      if (wait) await delay(wait);
      continue;
    }
    lastRaw = raw;
    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (error) {
      errors = [error.message, "Return a single JSON object only."];
      const wait = backoffMs(attempt);
      if (wait) await delay(wait);
      continue;
    }
    try {
      validateProviderRows(parsed);
    } catch (error) {
      const details = error.details?.length ? error.details : [error.message];
      errors = details;
      const wait = backoffMs(attempt);
      if (wait) await delay(wait);
      continue;
    }
    const wanted = new Set(chunks.map((c) => c.id));
    const got = parsed.rows.filter((row) => wanted.has(row.chunkId));
    if (got.length === 0) {
      errors = ["rows must use the provided chunkId values"];
      const wait = backoffMs(attempt);
      if (wait) await delay(wait);
      continue;
    }
    lastGot = got;
    const missing = chunks.filter((c) => !got.some((row) => row.chunkId === c.id));
    if (missing.length && attempt < MAX_ATTEMPTS) {
      errors = [`missing rows for ${missing.map((c) => c.id).join(", ")}`];
      const wait = backoffMs(attempt);
      if (wait) await delay(wait);
      continue;
    }
    return got;
  }
  if (lastGot.length) return lastGot;
  throw new SchemaError(
    `${adapter.label} did not return valid schema JSON after ${MAX_ATTEMPTS} attempts. Last error: ${errors.join("; ")}. Output excerpt: ${String(lastRaw).slice(0, 240)}`,
    errors,
  );
}

export function validateColumnFillRows(payload, columnKey) {
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
    if (typeof row.rowId !== "string" && typeof row.chunkId !== "string") {
      details.push(`rows[${i}] missing rowId or chunkId`);
    }
    if (!(columnKey in row)) {
      details.push(`rows[${i}] missing ${columnKey}`);
    } else {
      try {
        normalizeCell(columnKey, row[columnKey]);
      } catch (error) {
        details.push(`rows[${i}].${columnKey}: ${error.message}`);
      }
    }
  });
  if (details.length) {
    throw new SchemaError("provider JSON failed column-fill validation", details);
  }
  return payload;
}

function assignColumnFill(existingRows, filled, columnKey) {
  const unused = new Set(existingRows.map((row) => row.id));
  const byId = new Map(existingRows.map((row) => [row.id, row]));
  const updates = new Map();
  for (const item of filled) {
    let target = null;
    if (typeof item.rowId === "string" && unused.has(item.rowId)) {
      target = byId.get(item.rowId) ?? null;
    }
    if (!target && typeof item.chunkId === "string") {
      target = existingRows.find((row) => row.chunkId === item.chunkId && unused.has(row.id)) ?? null;
    }
    if (!target) continue;
    unused.delete(target.id);
    updates.set(target.id, normalizeCell(columnKey, item[columnKey]));
  }
  return updates;
}

async function fillColumnBatch(adapter, items, columnKey, tableLocale) {
  let errors = [];
  let lastRaw = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildColumnFillPrompt({
      items,
      columnKey,
      tableLocale,
      retryErrors: errors,
    });
    const raw = await adapter.complete(prompt);
    lastRaw = raw;
    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (error) {
      errors = [error.message, "Return a single JSON object only."];
      continue;
    }
    try {
      validateColumnFillRows(parsed, columnKey);
    } catch (error) {
      const details = error.details?.length ? error.details : [error.message];
      errors = details;
      continue;
    }
    const wantedRows = new Set(items.map((item) => item.row.id));
    const wantedChunks = new Set(items.map((item) => item.chunk.id));
    const got = parsed.rows.filter(
      (row) =>
        (typeof row.rowId === "string" && wantedRows.has(row.rowId)) ||
        (typeof row.chunkId === "string" && wantedChunks.has(row.chunkId)),
    );
    if (got.length === 0) {
      errors = ["rows must use the provided rowId or chunkId values"];
      continue;
    }
    const missing = items.filter(
      (item) =>
        !got.some(
          (row) =>
            row.rowId === item.row.id ||
            (!row.rowId && row.chunkId === item.chunk.id),
        ),
    );
    if (missing.length) {
      errors = [`missing rows for ${missing.map((item) => item.row.id).join(", ")}`];
      continue;
    }
    return got;
  }
  throw new SchemaError(
    `${adapter.label} did not return valid ${columnKey} JSON after ${MAX_ATTEMPTS} attempts. Last error: ${errors.join("; ")}. Output excerpt: ${String(lastRaw).slice(0, 240)}`,
    errors,
  );
}

/**
 * Fill one locked column on existing rows. Other cells are left untouched.
 */
export async function fillColumnWithAdapter(
  adapter,
  { rows, chunks, columnKey, tableLocale, onBatch },
) {
  if (!COLUMN_KEYS.includes(columnKey)) {
    throw new SchemaError(`unknown column ${columnKey}`);
  }
  if (!rows.length) {
    throw new SchemaError("no rows to fill — refusing to invent data");
  }
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const items = [];
  for (const row of rows) {
    const chunk = chunksById.get(row.chunkId);
    if (!chunk) {
      throw new SchemaError(`row ${row.id} chunk ${row.chunkId} is not in chunks`);
    }
    items.push({ row, chunk });
  }
  const updates = new Map();
  const size = schemaBatchSize();
  const batchCount = schemaBatchCount(items.length, size);
  for (let offset = 0, batchIndex = 0; offset < items.length; offset += size, batchIndex += 1) {
    const batch = items.slice(offset, offset + size);
    const filled = await fillColumnBatch(adapter, batch, columnKey, tableLocale);
    for (const [rowId, value] of assignColumnFill(
      batch.map((item) => item.row),
      filled,
      columnKey,
    )) {
      updates.set(rowId, value);
    }
    if (typeof onBatch === "function") {
      await onBatch({
        updatesSoFar: new Map(updates),
        batchIndex,
        batchCount,
      });
    }
  }
  if (updates.size === 0) {
    throw new SchemaError("provider produced no valid column values — refusing to invent data");
  }
  return updates;
}

export function validateInstructMutation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SchemaError("instruct output must be a JSON object");
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    const hasWork =
      (Array.isArray(payload.updatedCells) && payload.updatedCells.length > 0) ||
      (Array.isArray(payload.newRows) && payload.newRows.length > 0) ||
      (payload.columnVisibility &&
        typeof payload.columnVisibility === "object" &&
        Object.keys(payload.columnVisibility).length > 0);
    if (!hasWork) {
      throw new SchemaError(payload.error.trim());
    }
  }
  const details = [];
  if (payload.applied != null) {
    if (!Array.isArray(payload.applied) || payload.applied.some((line) => typeof line !== "string")) {
      details.push("applied must be an array of strings");
    }
  }
  if (payload.columnVisibility != null) {
    if (!payload.columnVisibility || typeof payload.columnVisibility !== "object") {
      details.push("columnVisibility must be an object");
    } else {
      for (const [key, value] of Object.entries(payload.columnVisibility)) {
        if (!UI_COLUMN_KEYS.includes(key)) details.push(`unknown visibility key ${key}`);
        else if (typeof value !== "boolean") details.push(`columnVisibility.${key} must be boolean`);
      }
    }
  }
  if (payload.updatedCells != null) {
    if (!Array.isArray(payload.updatedCells)) {
      details.push("updatedCells must be an array");
    } else {
      payload.updatedCells.forEach((cell, i) => {
        if (!cell || typeof cell !== "object") {
          details.push(`updatedCells[${i}] is not an object`);
          return;
        }
        if (typeof cell.rowId !== "string" || !cell.rowId) {
          details.push(`updatedCells[${i}] missing rowId`);
        }
        if (!COLUMN_KEYS.includes(cell.key)) {
          details.push(`updatedCells[${i}] key must be a known column`);
        } else {
          try {
            normalizeCell(cell.key, cell.value);
          } catch (error) {
            details.push(`updatedCells[${i}].value: ${error.message}`);
          }
        }
      });
    }
  }
  if (payload.newRows != null) {
    if (!Array.isArray(payload.newRows)) {
      details.push("newRows must be an array");
    } else {
      payload.newRows.forEach((row, i) => {
        if (!row || typeof row !== "object") {
          details.push(`newRows[${i}] is not an object`);
          return;
        }
        if (typeof row.chunkId !== "string" || !row.chunkId) {
          details.push(`newRows[${i}] missing chunkId`);
        }
        for (const key of COLUMN_KEYS) {
          if (!(key in row)) continue;
          try {
            normalizeCell(key, row[key]);
          } catch (error) {
            details.push(`newRows[${i}].${key}: ${error.message}`);
          }
        }
      });
    }
  }
  if (details.length) {
    throw new SchemaError("instruct JSON failed validation", details);
  }
  return payload;
}

export function mutationHasWork(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload.updatedCells) && payload.updatedCells.length > 0) return true;
  if (Array.isArray(payload.newRows) && payload.newRows.length > 0) return true;
  if (
    payload.columnVisibility &&
    typeof payload.columnVisibility === "object" &&
    Object.keys(payload.columnVisibility).length > 0
  ) {
    return true;
  }
  return false;
}

function nextRowId(rows) {
  let maxN = 0;
  for (const row of rows) {
    const match = String(row.id || "").match(/(\d+)$/);
    if (match) maxN = Math.max(maxN, Number(match[1]));
  }
  return padId("r", maxN);
}

/**
 * Apply a validated mutation onto a document in place. Returns visibility hints
 * and human-readable applied lines.
 */
export function applyInstructMutation(doc, payload) {
  const applied = [];
  const visibility = {};
  if (!payload || typeof payload !== "object") {
    return { doc, applied, visibility, changed: false };
  }

  if (payload.columnVisibility && typeof payload.columnVisibility === "object") {
    for (const key of UI_COLUMN_KEYS) {
      if (typeof payload.columnVisibility[key] === "boolean") {
        visibility[key] = payload.columnVisibility[key];
      }
    }
  }

  let changed = Object.keys(visibility).length > 0;
  const byId = new Map((doc.rows || []).map((row) => [row.id, row]));

  for (const cell of payload.updatedCells || []) {
    if (!cell || !COLUMN_KEYS.includes(cell.key)) continue;
    const row = byId.get(cell.rowId);
    if (!row) continue;
    const next = normalizeCell(cell.key, cell.value);
    if (row[cell.key] !== next) {
      row[cell.key] = next;
      changed = true;
    }
  }

  const chunksById = new Map((doc.chunks || []).map((chunk) => [chunk.id, chunk]));
  for (const item of payload.newRows || []) {
    if (!item || typeof item.chunkId !== "string") continue;
    const chunk = chunksById.get(item.chunkId);
    if (!chunk) continue;
    const row = rowFromProvider(item, chunk, doc.rows.length);
    row.id = nextRowId(doc.rows);
    doc.rows.push(row);
    byId.set(row.id, row);
    changed = true;
  }

  if (Array.isArray(payload.applied)) {
    for (const line of payload.applied) {
      if (typeof line === "string" && line.trim()) applied.push(line.trim());
    }
  }
  return { doc, applied, visibility, changed };
}

async function completeInstructBatch(adapter, {
  instruction,
  tableLocale,
  document,
  batchRows,
  chunksById,
  batchIndex,
  batchCount,
}) {
  let errors = [];
  let lastRaw = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildInstructPrompt({
      instruction,
      tableLocale,
      document,
      batchRows,
      chunksById,
      batchIndex,
      batchCount,
      retryErrors: errors,
    });
    const raw = await adapter.complete(prompt);
    lastRaw = raw;
    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (error) {
      errors = [error.message, "Return a single JSON object only."];
      continue;
    }
    try {
      validateInstructMutation(parsed);
    } catch (error) {
      const details = error.details?.length ? error.details : [error.message];
      errors = details;
      continue;
    }
    if (!mutationHasWork(parsed)) {
      errors = [
        "updatedCells, newRows, or columnVisibility is required — this is not a chat. Apply a table change or return an error field.",
      ];
      continue;
    }
    const rowIds = new Set(batchRows.map((row) => row.id));
    const chunkIds = new Set(document.chunks.map((chunk) => chunk.id));
    if (Array.isArray(parsed.updatedCells)) {
      parsed.updatedCells = parsed.updatedCells.filter((cell) => rowIds.has(cell.rowId));
    }
    if (Array.isArray(parsed.newRows)) {
      parsed.newRows = parsed.newRows.filter((row) => chunkIds.has(row.chunkId));
    }
    if (!mutationHasWork(parsed)) {
      errors = ["rowId / chunkId values must match the provided batch"];
      continue;
    }
    return parsed;
  }
  throw new SchemaError(
    `${adapter.label} did not return a valid instruction mutation after ${MAX_ATTEMPTS} attempts. Last error: ${errors.join("; ")}. Output excerpt: ${String(lastRaw).slice(0, 240)}`,
    errors,
  );
}

/**
 * Apply a freeform instruction via the selected CLI, batching large tables.
 */
export async function instructDocumentWithAdapter(
  adapter,
  { instruction, tableLocale, document, onBatch },
) {
  const rows = document.rows || [];
  if (!rows.length && !(document.chunks || []).length) {
    throw new SchemaError("document has no rows or chunks to instruct");
  }
  const chunksById = new Map((document.chunks || []).map((chunk) => [chunk.id, chunk]));
  const items = rows.slice();
  const size = schemaBatchSize();
  const batchCount = items.length ? schemaBatchCount(items.length, size) : 1;
  const applied = [];
  const visibility = {};
  let changed = false;

  if (!items.length) {
    const parsed = await completeInstructBatch(adapter, {
      instruction,
      tableLocale,
      document,
      batchRows: [],
      chunksById,
      batchIndex: 0,
      batchCount: 1,
    });
    const next = applyInstructMutation(document, parsed);
    Object.assign(visibility, next.visibility);
    applied.push(...next.applied);
    changed = next.changed;
    if (typeof onBatch === "function") {
      await onBatch({
        document,
        mutation: parsed,
        batchIndex: 0,
        batchCount: 1,
      });
    }
    return { document, applied, visibility, changed };
  }

  for (let offset = 0, batchIndex = 0; offset < items.length; offset += size, batchIndex += 1) {
    const batchRows = items.slice(offset, offset + size);
    const parsed = await completeInstructBatch(adapter, {
      instruction,
      tableLocale,
      document,
      batchRows,
      chunksById,
      batchIndex,
      batchCount,
    });
    const next = applyInstructMutation(document, parsed);
    Object.assign(visibility, next.visibility);
    applied.push(...next.applied);
    changed = changed || next.changed;
    if (typeof onBatch === "function") {
      await onBatch({
        document,
        mutation: parsed,
        batchIndex,
        batchCount,
      });
    }
  }
  return { document, applied, visibility, changed };
}

export async function writePromptFile(prompt) {
  const dir = await mkdtemp(join(tmpdir(), "tabulect-prompt-"));
  const path = join(dir, "prompt.txt");
  await writeFile(path, prompt, "utf8");
  return { dir, path };
}

export async function removePromptDir(dir) {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
}
