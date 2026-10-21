import { t } from "../i18n.mjs";
import { PROVIDER_IDS } from "../schema.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAntigravityAdapter, resolveAntigravity } from "./antigravity.mjs";
import { createClaudeAdapter, resolveClaude } from "./claude.mjs";
import { createCodexAdapter, resolveCodex } from "./codex.mjs";
import { createCursorAdapter, resolveCursor } from "./cursor.mjs";
import { createKimiAdapter, resolveKimi } from "./kimi.mjs";
import { fillColumnWithAdapter, fillRowsWithAdapter, instructDocumentWithAdapter } from "./run.mjs";
import { completePersistent } from "./persistent.mjs";
import {
  PERSISTENT_PROVIDERS,
  getSession,
  looksLikeResumeFailure,
  sessionWorkspace,
  setSession,
} from "./sessions.mjs";

const RESOLVERS = {
  codex: resolveCodex,
  kimi: resolveKimi,
  antigravity: resolveAntigravity,
  cursor: resolveCursor,
  claude: resolveClaude,
};

const FACTORIES = {
  codex: createCodexAdapter,
  kimi: createKimiAdapter,
  antigravity: createAntigravityAdapter,
  cursor: createCursorAdapter,
  claude: createClaudeAdapter,
};

let providerCache = null;

/** Installed/sign-in status for every subscription CLI. Cached for 30 s; `refresh` re-probes. */
export async function listProviders({ refresh = false } = {}) {
  if (!refresh && providerCache && Date.now() - providerCache.at < 30_000) return providerCache.value;
  const value = await Promise.all(PROVIDER_IDS.map((id) => RESOLVERS[id]()));
  providerCache = { at: Date.now(), value };
  return value;
}

export async function resolveProvider(id) {
  if (!PROVIDER_IDS.includes(id)) {
    throw new Error(
      `Unknown provider "${id}". Use one of: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return RESOLVERS[id]();
}

export async function fillSchema({ providerId, chunks, tableLocale, onBatch, startIndex = 0, model } = {}) {
  const resolved = await resolveProvider(providerId);
  if (!resolved.available || !resolved.loggedIn || !resolved.bin) {
    throw new Error(resolved.error || `${resolved.label} is unavailable`);
  }
  const adapter = FACTORIES[providerId](resolved, { model });
  return fillRowsWithAdapter(adapter, { chunks, tableLocale, onBatch, startIndex });
}

export async function fillColumn({
  providerId,
  rows,
  chunks,
  columnKey,
  tableLocale,
  onBatch,
  model,
} = {}) {
  const resolved = await resolveProvider(providerId);
  if (!resolved.available || !resolved.loggedIn || !resolved.bin) {
    throw new Error(resolved.error || `${resolved.label} is unavailable`);
  }
  const adapter = FACTORIES[providerId](resolved, { model });
  return fillColumnWithAdapter(adapter, {
    rows,
    chunks,
    columnKey,
    tableLocale,
    onBatch,
  });
}

async function adapterFor(providerId, model) {
  const resolved = await resolveProvider(providerId);
  if (!resolved.available || !resolved.loggedIn || !resolved.bin) {
    throw new Error(resolved.error || `${resolved.label} is unavailable`);
  }
  return FACTORIES[providerId](resolved, { model });
}

/** Background reading analysis must never enter or alter the reader's chat. */
export async function completeIsolated({ providerId, prompt, model }) {
  const adapter = await adapterFor(providerId, model);
  const cwd = await mkdtemp(join(tmpdir(), "table-reading-"));
  try {
    const result = readCompleteResult(await adapter.complete(prompt, { cwd }));
    if (!result.text.trim()) throw new Error("empty output");
    return result.text;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

export async function assertProviderReady(providerId) {
  await adapterFor(providerId);
  return providerId;
}

/** Freeform /instruct — same CLI complete() adapters as schema fill. */
export async function instructDocument({
  providerId,
  instruction,
  tableLocale,
  document,
  onBatch,
  model,
} = {}) {
  const adapter = await adapterFor(providerId, model);
  return instructDocumentWithAdapter(adapter, {
    instruction,
    tableLocale,
    document,
    onBatch,
  });
}

function readCompleteResult(result) {
  if (result && typeof result === "object") {
    return { text: String(result.text || ""), sessionId: String(result.sessionId || "") };
  }
  return { text: String(result || ""), sessionId: "" };
}

/** Raw CLI complete — no JSON schema. Used by Tabulect and `/` instruct. */
export async function completeFreeform({ providerId, prompt, model, documentId } = {}) {
  if (PERSISTENT_PROVIDERS.has(providerId)) {
    const resolved = await resolveProvider(providerId);
    if (!resolved.available || !resolved.loggedIn || !resolved.bin) throw new Error(resolved.error || `${resolved.label} is unavailable`);
    return completePersistent({ providerId, bin: resolved.bin, prompt, model });
  }
  const adapter = await adapterFor(providerId, model);
  const cwd = await sessionWorkspace(providerId, documentId);
  const run = async (session) =>
    readCompleteResult(await adapter.complete(prompt, { session, meta: true, cwd }));

  const existing = getSession(providerId, documentId);
  try {
    const result = await run(existing);
    if (!result.text.trim()) throw new Error("empty output");
    setSession(providerId, documentId, {
      id: result.sessionId || existing?.id || "",
      continued: true,
    });
    return result.text;
  } catch (error) {
    if (existing && looksLikeResumeFailure(error)) {
      throw new Error(t('theConversationCouldNotBeContinued', error.message));
    }
    throw error;
  }
}

export { clearSessions, getSession, listSessions, sessionKey } from "./sessions.mjs";
