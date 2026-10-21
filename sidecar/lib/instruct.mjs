import { t } from "./i18n.mjs";
/**
 * Apply a one-shot table instruction. No conversation store.
 * Trivial show/hide of known columns is local. Everything else goes to the
 * selected CLI provider (same complete() adapters as schema fill).
 */
import { randomUUID } from "node:crypto";
import { closeJob, pushEvent } from "./ingest.mjs";
import { assertProviderReady, fillColumn, instructDocument, listProviders } from "./providers/index.mjs";
import { schemaBatchCount } from "./providers/run.mjs";
import {
  COLUMN_KEYS,
  PROVIDER_IDS,
  migrateDocument,
  normalizeLocale,
} from "./schema.mjs";
import { loadDocument, saveDocument, saveJobRecord } from "./store.mjs";
import { resolveModel } from "./providers/models.mjs";

const UI_COLUMN_KEYS = ["rowNumber", "page", ...COLUMN_KEYS];

const COLUMN_ALIASES = {
  rowNumber: [
    "row number",
    "rownumber",
    "row no",
    "satir no",
    "satır no",
    "satir numarasi",
    "satır numarası",
  ],
  page: ["page", "sayfa"],
  claim: ["claim", "ana iddia", "iddia"],
  warrant: ["warrant", "gerekce", "gerekçe"],
  fact: ["fact", "olgu"],
  example: ["example", "ornek", "örnek"],
  definition: ["definition", "tanim", "tanım"],
  exception: ["exception", "istisna", "cekince", "çekince"],
  openQuestion: ["open question", "openquestion", "acik soru", "açık soru"],
  citation: ["citation", "alinti", "alıntı", "kaynak"],
  practicalSuggestion: [
    "practicalsuggestion",
    "practical suggestion",
    "practical suggestions",
    "practical tips",
    "practical tip",
    "pratik oneriler",
    "pratik öneriler",
    "pratik oneri",
    "pratik öneri",
    "pratik onerisi",
    "pratik önerisi",
  ],
  objection: ["objection", "itiraz", "itirazi"],
};

const COLUMN_LABELS = {
  tr: {
    rowNumber: "#",
    page: "Sayfa",
    claim: "Ana iddia",
    warrant: "Gerekçe",
    fact: "Olgu",
    example: "Örnek",
    definition: "Tanım",
    exception: "İstisna / çekince",
    openQuestion: "Açık soru",
    citation: "Alıntı / kaynak",
    practicalSuggestion: "Pratik öneriler",
    objection: "İtiraz",
  },
  en: {
    rowNumber: "#",
    page: "Page",
    claim: "Claim",
    warrant: "Warrant",
    fact: "Fact",
    example: "Example",
    definition: "Definition",
    exception: "Exception / caveat",
    openQuestion: "Open question",
    citation: "Citation",
    practicalSuggestion: "Practical tips",
    objection: "Objection",
  },
};

function foldText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/#/g, " rownumber ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasList() {
  const items = [];
  for (const key of UI_COLUMN_KEYS) {
    for (const alias of COLUMN_ALIASES[key] || []) {
      items.push({ key, alias: foldText(alias) });
    }
  }
  items.sort((a, b) => b.alias.length - a.alias.length);
  return items;
}

const ALIASES = aliasList();

function findColumns(folded) {
  const used = new Array(folded.length).fill(false);
  const found = [];
  for (const { key, alias } of ALIASES) {
    if (!alias) continue;
    let from = 0;
    while (from <= folded.length) {
      const idx = folded.indexOf(alias, from);
      if (idx < 0) break;
      const before = idx === 0 || folded[idx - 1] === " ";
      const after = idx + alias.length === folded.length || folded[idx + alias.length] === " ";
      const overlap = used.slice(idx, idx + alias.length).some(Boolean);
      if (before && after && !overlap) {
        for (let i = idx; i < idx + alias.length; i += 1) used[i] = true;
        found.push({ key, index: idx });
      }
      from = idx + alias.length;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function findVerbs(folded) {
  const verbs = [];
  const patterns = [
    [/\b(hide|gizle|sakla|kapat|kapa)\b/g, "hide"],
    [/\b(show|goster|ac)\b/g, "show"],
    [/\b(add|ekle|ekleyin|ekleyelim|ekleyerek)\b/g, "add"],
  ];
  for (const [re, type] of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(folded))) {
      verbs.push({ type, index: match.index });
    }
  }
  return verbs.sort((a, b) => a.index - b.index);
}

function nearestVerb(verbs, index) {
  if (!verbs.length) return null;
  let best = verbs[0];
  let bestDist = Math.abs(verbs[0].index - index);
  for (const verb of verbs) {
    const dist = Math.abs(verb.index - index);
    if (dist < bestDist) {
      best = verb;
      bestDist = dist;
    }
  }
  return best.type;
}

export function parseInstruction(instruction) {
  const raw = String(instruction || "").trim();
  const folded = foldText(raw);
  if (!folded) return { actions: [], error: "empty" };

  const columns = findColumns(folded);
  const verbs = findVerbs(folded);
  const byColumn = new Map();

  const setAction = (column, type) => {
    byColumn.set(column, { type, column });
  };

  for (const col of columns) {
    const verb = nearestVerb(verbs, col.index);
    if (col.key === "practicalSuggestion") {
      if (verb === "hide") setAction(col.key, "hide");
      else if (verb === "show") setAction(col.key, "show");
      else setAction(col.key, "add");
    } else if (verb === "hide") {
      setAction(col.key, "hide");
    } else if (verb === "show" || verb === "add") {
      setAction(col.key, "show");
    }
  }

  const actions = [...byColumn.values()];
  if (!actions.length) {
    return { actions: [], error: "unrecognized" };
  }
  return { actions, error: null };
}

const FILLER_TOKENS = new Set([
  "sutun",
  "sutunu",
  "sutununu",
  "sutunlar",
  "sutunlari",
  "column",
  "columns",
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "please",
  "just",
  "ve",
  "ile",
  "icin",
  "lutfen",
  "gizle",
  "sakla",
  "kapat",
  "kapa",
  "hide",
  "show",
  "goster",
  "ac",
  "add",
  "ekle",
  "ekleyin",
  "ekleyelim",
  "ekleyerek",
]);

function leftoverTokens(instruction) {
  let rest = ` ${foldText(instruction)} `;
  for (const { alias } of ALIASES) {
    if (!alias) continue;
    rest = rest.split(` ${alias} `).join(" ");
  }
  return rest
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !FILLER_TOKENS.has(token));
}

/** Chrome-only show/hide of known columns — no leftover freeform text. */
export function isPureVisibilityToggle(instruction, actions) {
  if (!actions?.length) return false;
  if (actions.some((action) => action.type !== "hide" && action.type !== "show")) {
    return false;
  }
  return leftoverTokens(instruction).length === 0;
}

export function isPracticalAddOnly(instruction, actions) {
  if (!actions || actions.length !== 1) return false;
  const action = actions[0];
  if (action.type !== "add" || action.column !== "practicalSuggestion") return false;
  return leftoverTokens(instruction).length === 0;
}

function columnName(locale, key) {
  return COLUMN_LABELS[locale]?.[key] || key;
}

function describeAction(locale, action) {
  const name = columnName(locale, action.column);
  if (locale === "en") {
    if (action.type === "hide") return `Hide column: ${name}`;
    if (action.type === "show") return `Show column: ${name}`;
    if (action.type === "add") return `Add column: ${name}`;
    if (action.type === "fill") return `Fill ${name} from source chunks`;
  }
  if (action.type === "hide") return t('column0Hidden', name);
  if (action.type === "show") return t('column0Shown', name);
  if (action.type === "add") return t('column0Added', name);
  if (action.type === "fill") return t('filling0FromSourceChunks', name);
  return name;
}

function ensureColumn(doc, key) {
  const { doc: migrated, changed } = migrateDocument(doc);
  let extra = changed;
  for (const row of migrated.rows || []) {
    if (!(key in row)) {
      row[key] = key === "objection" ? null : "";
      extra = true;
    }
  }
  return { doc: migrated, changed: extra };
}

async function resolveInstructProvider(requested, doc) {
  if (requested && PROVIDER_IDS.includes(requested)) return requested;
  if (doc.lastProvider && PROVIDER_IDS.includes(doc.lastProvider)) {
    return doc.lastProvider;
  }
  try {
    const listed = await listProviders();
    const ready = listed.find((item) => item.available && item.loggedIn);
    if (ready) return ready.id;
  } catch {
    /* fall through */
  }
  return "codex";
}

function schemaPct(batchIndex, batchCount) {
  if (batchCount <= 0) return 74;
  const t = (batchIndex + 1) / batchCount;
  return Math.min(99, 74 + Math.round(t * 25));
}

export function createInstructJob({
  documentId,
  provider,
  tableLocale,
  columnKey = null,
  instruction = "",
  mode = "fill",
  model = "",
}) {
  return {
    jobId: randomUUID(),
    kind: mode === "cli" ? "instruct-cli" : "instruct",
    mode,
    documentId,
    provider,
    model: model || "",
    tableLocale,
    columnKey,
    instruction,
    filename: null,
    events: [],
    listeners: new Set(),
    finished: false,
    error: null,
  };
}

function cliFailedMessage(locale, detail) {
  const excerpt = String(detail || "").trim();
  if (locale === "en") {
    return excerpt
      ? `The CLI did not return a usable table update. ${excerpt}`
      : "The CLI did not return a usable table update.";
  }
  return excerpt
    ? t('theCliDidNotReturnA2', excerpt)
    : t('theCliDidNotReturnA');
}

export async function runInstructFillJob(job, { dataRoot } = {}) {
  try {
    pushEvent(job, { phase: "queued", pct: 8, message: t('instructionQueued') });
    const locale = normalizeLocale(job.tableLocale);
    let doc = await loadDocument(job.documentId, dataRoot);
    if (!doc) throw new Error(`document ${job.documentId} not found`);
    const ensured = ensureColumn(doc, job.columnKey);
    doc = ensured.doc;
    doc.lastProvider = job.provider;
    if (job.model != null) doc.lastModel = job.model;
    await saveDocument(doc, dataRoot);

    const batchCount = schemaBatchCount(doc.rows.length);
    pushEvent(job, {
      phase: "schema",
      pct: 74,
      message: `1/${batchCount} batch`,
      documentId: doc.id,
    });

    await fillColumn({
      providerId: job.provider,
      rows: doc.rows,
      chunks: doc.chunks,
      columnKey: job.columnKey,
      tableLocale: locale,
      model: job.model,
      onBatch: async ({ updatesSoFar, batchIndex, batchCount: count }) => {
        const latest = await loadDocument(job.documentId, dataRoot);
        if (!latest) throw new Error(`document ${job.documentId} not found`);
        for (const row of latest.rows) {
          if (updatesSoFar.has(row.id)) {
            row[job.columnKey] = updatesSoFar.get(row.id);
          }
        }
        latest.lastProvider = job.provider;
        if (job.model != null) latest.lastModel = job.model;
        await saveDocument(latest, dataRoot);
        pushEvent(job, {
          phase: "schema",
          pct: schemaPct(batchIndex, count),
          message: `${batchIndex + 1}/${count} batch`,
          documentId: latest.id,
        });
      },
    });

    pushEvent(job, {
      phase: "done",
      pct: 100,
      message: t('instructionCompleted'),
      documentId: job.documentId,
      error: null,
    });
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    pushEvent(job, {
      phase: "error",
      pct: job.events.at(-1)?.pct ?? 0,
      message: t('instructionFailed'),
      documentId: job.documentId,
      error: job.error,
    });
  } finally {
    closeJob(job);
    await saveJobRecord(job, dataRoot).catch(() => {});
  }
}

function failJobStart(job, error) {
  if (job.finished) return;
  pushEvent(job, {
    phase: "error",
    pct: 0,
    message: t('instructionFailed'),
    error: error instanceof Error ? error.message : String(error),
  });
  closeJob(job);
}

export async function runInstructCliJob(job, { dataRoot } = {}) {
  try {
    pushEvent(job, {
      phase: "queued",
      pct: 8,
      message: t('instructionQueuedForTheCli'),
    });
    const locale = normalizeLocale(job.tableLocale);
    let doc = await loadDocument(job.documentId, dataRoot);
    if (!doc) throw new Error(`document ${job.documentId} not found`);
    doc.lastProvider = job.provider;
    if (job.model != null) doc.lastModel = job.model;
    await saveDocument(doc, dataRoot);

    pushEvent(job, {
      phase: "schema",
      pct: 74,
      message: "1/? batch",
      documentId: doc.id,
    });

    const result = await instructDocument({
      providerId: job.provider,
      instruction: job.instruction,
      tableLocale: locale,
      document: doc,
      model: job.model,
      onBatch: async ({ document, batchIndex, batchCount }) => {
        document.lastProvider = job.provider;
        if (job.model != null) document.lastModel = job.model;
        await saveDocument(document, dataRoot);
        pushEvent(job, {
          phase: "schema",
          pct: schemaPct(batchIndex, batchCount),
          message: `${batchIndex + 1}/${batchCount} batch`,
          documentId: document.id,
        });
      },
    });

    if (!result.changed && !Object.keys(result.visibility).length) {
      throw new Error(
        locale === "en"
          ? "CLI returned no table changes."
          : t('theCliReturnedNoTableChange'),
      );
    }

    const latest = await loadDocument(job.documentId, dataRoot);
    if (latest) {
      latest.lastProvider = job.provider;
      if (job.model != null) latest.lastModel = job.model;
      await saveDocument(latest, dataRoot);
    }

    pushEvent(job, {
      phase: "done",
      pct: 100,
      message: t('instructionCompleted'),
      documentId: job.documentId,
      error: null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    job.error = cliFailedMessage(normalizeLocale(job.tableLocale), detail);
    pushEvent(job, {
      phase: "error",
      pct: job.events.at(-1)?.pct ?? 0,
      message: t('instructionFailed'),
      documentId: job.documentId,
      error: job.error,
    });
  } finally {
    closeJob(job);
    await saveJobRecord(job, dataRoot).catch(() => {});
  }
}

async function startCliInstructJob({
  documentId,
  instruction,
  locale,
  provider,
  model,
  registerJob,
  dataRoot,
  applied,
  visibility,
  doc,
}) {
  let resolvedProvider;
  try {
    resolvedProvider = await resolveInstructProvider(provider, doc);
    await assertProviderReady(resolvedProvider);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : String(error),
      applied: [],
    };
  }

  const job = createInstructJob({
    documentId: doc.id,
    provider: resolvedProvider,
    tableLocale: locale,
    instruction,
    mode: "cli",
    model: resolveModel(resolvedProvider, model, doc.lastModel),
  });
  registerJob?.(job);
  applied.push(
    locale === "en"
      ? `Instruction sent to ${resolvedProvider}`
      : t('instructionSentToThe0Cli', resolvedProvider),
  );
  queueMicrotask(() => {
    runInstructCliJob(job, { dataRoot }).catch((error) => failJobStart(job, error));
  });
  return {
    ok: true,
    document: doc,
    applied,
    ui: Object.keys(visibility).length ? { columnVisibility: visibility } : undefined,
    jobId: job.jobId,
  };
}

export async function applyInstruct({
  documentId,
  instruction,
  tableLocale,
  provider,
  model,
  registerJob,
  dataRoot,
}) {
  const locale = normalizeLocale(tableLocale);
  const raw = String(instruction || "").trim();
  if (!raw) {
    return {
      ok: false,
      status: 400,
      error: locale === "en" ? "Instruction is empty." : t('theInstructionIsEmpty'),
      applied: [],
    };
  }

  const loaded = await loadDocument(documentId, dataRoot);
  if (!loaded) {
    return {
      ok: false,
      status: 404,
      error:
        locale === "en"
          ? `Document ${documentId} was not found in the library.`
          : t('document0WasNotFoundIn', documentId),
      applied: [],
    };
  }

  const parsed = parseInstruction(raw);
  const visibility = {};
  const applied = [];
  let doc = loaded;
  let persist = false;
  let fillColumnKey = null;

  if (isPureVisibilityToggle(raw, parsed.actions)) {
    for (const action of parsed.actions) {
      visibility[action.column] = action.type !== "hide";
      applied.push(describeAction(locale, action));
    }
    return {
      ok: true,
      document: doc,
      applied,
      ui: { columnVisibility: visibility },
    };
  }

  if (isPracticalAddOnly(raw, parsed.actions)) {
    const ensured = ensureColumn(doc, "practicalSuggestion");
    doc = ensured.doc;
    persist = persist || ensured.changed;
    visibility.practicalSuggestion = true;
    applied.push(describeAction(locale, { type: "add", column: "practicalSuggestion" }));
    if (doc.rows.length > 0) fillColumnKey = "practicalSuggestion";
    if (persist) {
      await saveDocument(doc, dataRoot);
      doc = (await loadDocument(documentId, dataRoot)) || doc;
    }
    if (!fillColumnKey) {
      return {
        ok: true,
        document: doc,
        applied,
        ui: { columnVisibility: visibility },
      };
    }
    const resolvedProvider = await resolveInstructProvider(provider, doc);
    const job = createInstructJob({
      documentId: doc.id,
      provider: resolvedProvider,
      tableLocale: locale,
      columnKey: fillColumnKey,
      mode: "fill",
      model: resolveModel(resolvedProvider, model, doc.lastModel),
    });
    registerJob?.(job);
    applied.push(describeAction(locale, { type: "fill", column: fillColumnKey }));
    queueMicrotask(() => {
      runInstructFillJob(job, { dataRoot }).catch((error) => failJobStart(job, error));
    });
    return {
      ok: true,
      document: doc,
      applied,
      ui: { columnVisibility: visibility },
      jobId: job.jobId,
    };
  }

  if (parsed.actions.length) {
    for (const action of parsed.actions) {
      if (action.type === "hide") {
        visibility[action.column] = false;
        applied.push(describeAction(locale, action));
      } else if (action.type === "show") {
        visibility[action.column] = true;
        applied.push(describeAction(locale, action));
      } else if (action.type === "add") {
        const ensured = ensureColumn(doc, action.column);
        doc = ensured.doc;
        persist = persist || ensured.changed;
        visibility[action.column] = true;
        applied.push(describeAction(locale, action));
      }
    }
    if (persist) {
      await saveDocument(doc, dataRoot);
      doc = (await loadDocument(documentId, dataRoot)) || doc;
    }
  }

  return startCliInstructJob({
    documentId,
    instruction: raw,
    locale,
    provider,
    model,
    registerJob,
    dataRoot,
    applied,
    visibility,
    doc,
  });
}
