import { t } from "./i18n.mjs";
/**
 * One schema-fill engine for ingest and resume.
 * Leftover chunks are sliced into batches and filled with bounded-concurrency
 * fillSchema calls (parallel CLI processes) inside the isolated worker.
 * Nested fill-worker forks are not used. Rows merge by chunkId.
 */
import {
  backoffMs,
  documentFillLimits,
  emptyFillError,
  FILL_HEARTBEAT_MS,
  fillProgressMessage,
  isHardProviderError,
  isUnrecoverableFillMiss,
  unfilledChunks,
} from "./fill.mjs";
import { fillSchema } from "./providers/index.mjs";
import { fillConcurrency, schemaBatchSize, skippedFillRows } from "./providers/run.mjs";
import { validateDocument } from "./schema.mjs";
import { loadDocument, saveDocument } from "./store.mjs";
import { cliPeak, delay, inFlightCliCount, liveCliCount, padId, resetCliPeak } from "./util.mjs";

/** IPC heartbeat so the HTTP lock sees live CLI pids, not just "çalışıyor" pings. */
export function workerCliCount() {
  return inFlightCliCount(process.pid, liveCliCount());
}

export function sendFillHeartbeat(filled = 0) {
  if (String(process.env.TABULECT_FILL_WORKER || "") !== "1") return;
  if (typeof process.send !== "function") return;
  try {
    process.send({ type: "heartbeat", filled, clis: workerCliCount() });
  } catch {
    /* parent gone */
  }
}

const mergeChains = new Map();

/** Empty CLI waves before this job yields; sidecar autofill retries. Batch size lives in run.mjs. */
function maxIdleWaves(raw = process.env.TABULECT_FILL_IDLE_WAVES) {
  if (raw == null || String(raw).trim() === "") return 3;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(12, n);
}

export function sliceBatches(items, size) {
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export async function mapPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const n = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let next = 0;
  let stopError = null;
  async function worker() {
    while (stopError == null) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      try {
        results[index] = await fn(list[index], index);
      } catch (error) {
        if (isHardProviderError(error)) {
          stopError = error;
          throw error;
        }
        results[index] = [];
      }
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: n }, () => worker()));
  if (stopError) throw stopError;
  const rejected = settled.find((item) => item.status === "rejected");
  if (rejected && isHardProviderError(rejected.reason)) throw rejected.reason;
  return results.map((row) => row ?? []);
}

/**
 * Keep existing rows; append incoming whose chunkId is new.
 * Reassigns colliding row ids. Does not invent cells.
 */
export function mergeRowsByChunkId(existing, incoming, chunks) {
  const order = new Map((chunks || []).map((chunk, index) => [chunk.id, index]));
  const kept = [];
  const have = new Set();
  const usedIds = new Set();
  for (const row of existing || []) {
    if (!row || typeof row.chunkId !== "string" || have.has(row.chunkId)) continue;
    have.add(row.chunkId);
    kept.push(row);
    if (row.id) usedIds.add(row.id);
  }
  for (const row of incoming || []) {
    if (!row || typeof row.chunkId !== "string" || have.has(row.chunkId)) continue;
    if (order.size && !order.has(row.chunkId)) continue;
    have.add(row.chunkId);
    let id = typeof row.id === "string" ? row.id : "";
    if (!id || usedIds.has(id)) {
      let n = kept.length;
      while (usedIds.has(padId("r", n))) n += 1;
      id = padId("r", n);
    }
    usedIds.add(id);
    kept.push({ ...row, id });
  }
  kept.sort((a, b) => (order.get(a.chunkId) ?? 1e9) - (order.get(b.chunkId) ?? 1e9));
  return kept;
}

function enqueueMerge(documentId, fn) {
  const prev = mergeChains.get(documentId) || Promise.resolve();
  const next = prev.then(fn, fn);
  mergeChains.set(
    documentId,
    next.catch(() => {}),
  );
  return next;
}

async function persistMerge(documentId, dataRoot, incoming, provider, onProgress, meta) {
  if (!incoming.length) return 0;
  return enqueueMerge(documentId, async () => {
    const doc = await loadDocument(documentId, dataRoot);
    if (!doc) return 0;
    const before = doc.rows.length;
    doc.rows = mergeRowsByChunkId(doc.rows, incoming, doc.chunks);
    if (provider) doc.lastProvider = provider;
    if (meta?.model != null) doc.lastModel = meta.model;
    validateDocument(doc);
    await saveDocument(doc, dataRoot);
    const added = doc.rows.length - before;
    if (added > 0 && typeof onProgress === "function") {
      await onProgress({
        filled: doc.rows.length,
        total: doc.chunks.length,
        extra: fillProgressExtra(meta, doc.rows.length, doc.chunks.length),
        agents: meta.agents,
        batchIndex: meta.batchIndex,
        batchCount: meta.batchCount,
      });
    }
    return added;
  });
}

function fillProgressExtra(meta, filled, total) {
  const agents = meta.agents > 1 ? `${meta.agents} ajan` : "1 ajan";
  return `${meta.batchIndex + 1}/${meta.batchCount} batch · ${agents}`;
}

export async function fillBatchChunks({
  provider,
  chunks,
  tableLocale,
  startIndex = 0,
  model,
} = {}) {
  if (!chunks?.length) return [];
  return fillSchema({
    providerId: provider,
    chunks,
    tableLocale,
    startIndex,
    model,
  });
}

/**
 * Fill leftover chunks until the table is complete or the provider fails.
 * Empty CLI waves with leftover chunks throw — they are not a successful pause.
 */
export async function fillDocument({
  documentId,
  provider,
  tableLocale,
  dataRoot,
  onProgress,
  model,
} = {}) {
  if (!documentId) throw new Error("documentId is required");
  if (!provider) throw new Error("provider is required to fill");
  let idleWaves = 0;
  let lastSoftError = null;
  while (true) {
    const doc = await loadDocument(documentId, dataRoot);
    if (!doc) throw new Error(`document ${documentId} not found`);
    const leftover = unfilledChunks(doc);
    const total = doc.chunks.length;
    if (leftover.length === 0) {
      return { complete: true, doc, filled: doc.rows.length, total };
    }
    const limits = documentFillLimits(documentId);
    const size = limits?.batch ?? schemaBatchSize();
    const batches = sliceBatches(leftover, size);
    const agents = Math.min(limits?.concurrency ?? fillConcurrency(), batches.length);
    if (typeof onProgress === "function") {
      await onProgress({
        filled: doc.rows.length,
        total,
        extra: `1/${batches.length} batch · ${agents} ajan`,
        agents,
        batchIndex: 0,
        batchCount: batches.length,
      });
    }
    let hard = null;
    resetCliPeak();
    const heartbeat = setInterval(() => {
      const clis = workerCliCount();
      sendFillHeartbeat(doc.rows.length);
      if (typeof onProgress === "function") {
        void onProgress({
          filled: doc.rows.length,
          total,
          extra: t('n0AgentsWorking', agents),
          agents,
          batchIndex: 0,
          batchCount: batches.length,
          heartbeat: true,
          clis,
        });
      }
    }, FILL_HEARTBEAT_MS);
    sendFillHeartbeat(doc.rows.length);
    try {
      await mapPool(batches, agents, async (batch, batchIndex) => {
        if (hard) return [];
        try {
          const rows = await fillBatchChunks({
            provider,
            chunks: batch,
            tableLocale: tableLocale || doc.tableLocale,
            startIndex: doc.rows.length + batchIndex * size,
            model,
          });
          const incoming = Array.isArray(rows) ? rows : [];
          await persistMerge(documentId, dataRoot, incoming, provider, onProgress, {
            batchIndex,
            batchCount: batches.length,
            agents,
            model,
          });
          return incoming;
        } catch (error) {
          if (isHardProviderError(error)) {
            hard = error;
            throw error;
          }
          lastSoftError = error;
          if (isUnrecoverableFillMiss(error)) {
            const skipped = skippedFillRows(batch, error, {
              startIndex: doc.rows.length + batchIndex * size,
              tableLocale: tableLocale || doc.tableLocale,
            });
            await persistMerge(documentId, dataRoot, skipped, provider, onProgress, {
              batchIndex,
              batchCount: batches.length,
              agents,
              model,
            });
            return skipped;
          }
          return [];
        }
      });
    } finally {
      clearInterval(heartbeat);
    }
    if (hard) throw hard;
    const latest = await loadDocument(documentId, dataRoot);
    const gained = latest.rows.length - doc.rows.length;
    const clisSeen = Math.max(cliPeak(), liveCliCount());
    if (gained <= 0) {
      idleWaves += 1;
      if (idleWaves >= maxIdleWaves()) {
        throw emptyFillError({
          filled: latest.rows.length,
          total,
          leftover: unfilledChunks(latest).length,
          clisSeen,
          cause: lastSoftError,
        });
      }
      const wait = backoffMs(idleWaves);
      if (wait) await delay(wait);
    } else {
      idleWaves = 0;
    }
  }
}

export { fillProgressMessage };
