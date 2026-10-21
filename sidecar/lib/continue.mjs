import { t } from "./i18n.mjs";
/**
 * Resume schema fill for a saved document (leftover chunks only).
 * Ingest, opening a partial book, and the sidecar worker all share this path.
 */
import { closeJob, createFillJob, pushEvent } from "./ingest.mjs";
import {
  claimFill,
  clearFillLimits,
  clearHardFillError,
  emptyFillError,
  fillPct,
  fillProgressMessage,
  hardFillBlocked,
  isEmptyFillError,
  isHardProviderError,
  isPartialFill,
  isTransientProviderError,
  liveFillJobId,
  markHardFillError,
  releaseFill,
  resetFillResume,
  setFillResumeHandler,
  unfilledChunks,
  isAutofillPaused,
} from "./fill.mjs";
import { fillDocument } from "./engine.mjs";
import { isolateFillEnabled, spawnFillWorker } from "./supervise.mjs";
import { schemaBatchCount } from "./providers/run.mjs";
import { PROVIDER_IDS } from "./schema.mjs";
import { listDocuments, loadDocument, saveJobRecord } from "./store.mjs";
import { resolveModel } from "./providers/models.mjs";

function providerFor(doc, requested) {
  if (requested && PROVIDER_IDS.includes(requested)) return requested;
  if (doc.lastProvider && PROVIDER_IDS.includes(doc.lastProvider)) return doc.lastProvider;
  return null;
}

function modelFor(doc, provider, requested) {
  return resolveModel(provider, requested, doc?.lastModel);
}

export async function startContinueFill({
  documentId,
  provider,
  tableLocale,
  registerJob,
  dataRoot,
  force = false,
  model,
} = {}) {
  const doc = await loadDocument(documentId, dataRoot);
  if (!doc) {
    return { status: 404, body: { error: `document ${documentId} not found` } };
  }
  const live = liveFillJobId(documentId);
  if (live) {
    return {
      status: 202,
      body: { jobId: live, documentId, continued: false, busy: true, complete: false },
    };
  }
  if (!isPartialFill(doc)) {
    return {
      status: 200,
      body: { jobId: null, documentId, continued: false, complete: true },
    };
  }
  const resolved = providerFor(doc, provider);
  if (!resolved) {
    return {
      status: 400,
      body: { error: "provider is required to continue fill" },
    };
  }
  if (!force && hardFillBlocked(documentId)) {
    return {
      status: 202,
      body: {
        jobId: null,
        documentId,
        continued: false,
        complete: false,
        deferred: true,
        error: "fill paused after an unrecoverable provider error; retry shortly",
      },
    };
  }
  if (force) clearHardFillError(documentId);

  const selectedModel = modelFor(doc, resolved, model);
  const job = createFillJob({
    documentId,
    provider: resolved,
    tableLocale: tableLocale || doc.tableLocale,
    model: selectedModel,
  });
  registerJob?.(job);
  claimFill(documentId, job.jobId, job);
  if (isolateFillEnabled()) {
    spawnFillWorker({
      kind: "continue",
      job,
      dataRoot,
      payload: { provider: resolved, tableLocale: tableLocale || doc.tableLocale, model: selectedModel },
    });
  } else {
    queueMicrotask(() => {
      runContinueJob(job, { dataRoot }).catch((error) => {
        if (!job.finished) {
          pushEvent(job, {
            phase: "error",
            pct: 0,
            message: t('operationFailed'),
            documentId,
            error: error instanceof Error ? error.message : String(error),
          });
          closeJob(job);
        }
      });
    });
  }
  return {
    status: 202,
    body: { jobId: job.jobId, documentId, continued: true, complete: false },
  };
}

export async function runContinueJob(job, { dataRoot } = {}) {
  const documentId = job.documentId;
  try {
    claimFill(documentId, job.jobId, job);
    const doc = await loadDocument(documentId, dataRoot);
    if (!doc) throw new Error(`document ${documentId} not found`);
    const remaining = unfilledChunks(doc);
    const total = doc.chunks.length;
    if (remaining.length === 0) {
      clearFillLimits(documentId);
      resetFillResume(documentId);
      pushEvent(job, {
        phase: "done",
        pct: 100,
        message: t('done'),
        documentId,
        error: null,
      });
      return;
    }
    const provider = providerFor(doc, job.provider);
    if (!provider) throw new Error("provider is required to continue fill");
    job.provider = provider;
    job.model = modelFor(doc, provider, job.model);
    const batchCount = schemaBatchCount(remaining.length);
    pushEvent(job, {
      phase: "schema",
      pct: fillPct(doc.rows.length, total),
      message: fillProgressMessage(doc.rows.length, total, `1/${batchCount} batch`),
      documentId,
    });
    try {
      const result = await fillDocument({
        documentId,
        provider,
        tableLocale: doc.tableLocale || job.tableLocale,
        dataRoot,
        model: job.model,
        onProgress: async ({ filled, total: count, extra, clis }) => {
          pushEvent(job, {
            phase: "schema",
            pct: fillPct(filled, count),
            message: fillProgressMessage(filled, count, extra),
            documentId,
            filled,
            clis,
          });
        },
      });
      const filled = result.filled ?? result.doc?.rows?.length ?? 0;
      if (!result.complete) {
        throw emptyFillError({
          filled,
          total,
          leftover: Math.max(0, total - filled),
        });
      }
      clearFillLimits(documentId);
      resetFillResume(documentId);
      pushEvent(job, {
        phase: "done",
        pct: 100,
        message: t('done'),
        documentId,
        error: null,
      });
    } catch (error) {
      if (isHardProviderError(error) || isEmptyFillError(error)) throw error;
      const latest = await loadDocument(documentId, dataRoot);
      const filled = latest?.rows?.length ?? 0;
      const leftover = latest ? unfilledChunks(latest).length : 0;
      if (leftover > 0) {
        throw emptyFillError({
          filled,
          total,
          leftover,
          cause: error,
        });
      }
      pushEvent(job, {
        phase: "done",
        pct: fillPct(filled, total) || 74,
        message: fillProgressMessage(filled, total, t('partialTableKeptContinuing')),
        documentId,
        error: null,
      });
    }
  } catch (error) {
    if (isEmptyFillError(error)) {
      const latest = await loadDocument(documentId, dataRoot).catch(() => null);
      const filled = latest?.rows?.length ?? 0;
      const count = latest?.chunks?.length ?? 0;
      job.error = error instanceof Error ? error.message : String(error);
      pushEvent(job, {
        phase: "error",
        pct: fillPct(filled, count) || 74,
        message: fillProgressMessage(filled, count, t('cliReturnedNothing')),
        documentId,
        error: job.error,
      });
      return;
    }
    if (isTransientProviderError(error) && documentId) {
      const latest = await loadDocument(documentId, dataRoot).catch(() => null);
      const filled = latest?.rows?.length ?? 0;
      const total = latest?.chunks?.length ?? 0;
      const leftover = latest ? unfilledChunks(latest).length : 0;
      if (leftover > 0) {
        job.error = error instanceof Error ? error.message : String(error);
        pushEvent(job, {
          phase: "error",
          pct: fillPct(filled, total) || 74,
          message: fillProgressMessage(filled, total, "kesildi"),
          documentId,
          error: job.error,
        });
        return;
      }
      pushEvent(job, {
        phase: "done",
        pct: fillPct(filled, total) || 74,
        message: fillProgressMessage(filled, total, t('partialTableKeptContinuing')),
        documentId,
        error: null,
      });
      return;
    }
    job.error = error instanceof Error ? error.message : String(error);
    if (isHardProviderError(error)) markHardFillError(documentId);
    pushEvent(job, {
      phase: "error",
      pct: job.events.at(-1)?.pct ?? 0,
      message: t('operationFailed'),
      documentId,
      error: job.error,
    });
  } finally {
    releaseFill(documentId, job.jobId);
    closeJob(job);
    await saveJobRecord(job, dataRoot).catch(() => {});
  }
}

export function startAutofillWorker({ registerJob, dataRoot, intervalMs } = {}) {
  if (String(process.env.TABULECT_AUTOFILL ?? "0") === "0") {
    setFillResumeHandler(null);
    return () => {};
  }
  setFillResumeHandler(({ documentId, dataRoot: root } = {}) => {
    const dest = root ?? dataRoot;
    if (isAutofillPaused(dest)) return;
    void startContinueFill({
      documentId,
      registerJob,
      dataRoot: dest,
      force: true,
    });
  });
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    if (isAutofillPaused(dataRoot)) return;
    try {
      const items = await listDocuments(dataRoot);
      for (const item of items) {
        if (stopped) return;
        if (!item.partialFill) continue;
        if (liveFillJobId(item.id)) continue;
        if (hardFillBlocked(item.id)) continue;
        await startContinueFill({
          documentId: item.id,
          registerJob,
          dataRoot,
        });
      }
    } catch {
      /* worker must survive a bad document */
    }
  };
  const raw = intervalMs ?? Number.parseInt(process.env.TABULECT_AUTOFILL_MS || "2500", 10);
  const ms = Number.isFinite(raw) && raw >= 250 ? raw : 2500;
  const timer = setInterval(tick, ms);
  setTimeout(tick, 200);
  return () => {
    stopped = true;
    clearInterval(timer);
    setFillResumeHandler(null);
  };
}
