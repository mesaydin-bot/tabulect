/**
 * Per-provider CLI model ids. Cursor defaults to `auto`.
 * Kimi / Codex / Antigravity omit the flag when unset (CLI default).
 * Effort suffixes like `composer-1[effort=medium]` are stripped — they are not model ids.
 */

export const MODEL_FLAGS = {
  cursor: "--model",
  kimi: "--model",
  codex: "-m",
  antigravity: "--model",
  claude: "--model",
};

export const DEFAULT_MODELS = {
  cursor: "auto",
  kimi: "",
  codex: "",
  antigravity: "",
  claude: "",
};

/** Short curated lists. Free-text override is always allowed. */
export const CURATED_MODELS = {
  cursor: [
    "auto",
    "composer-2.5",
    "gpt-5.4",
    "gpt-5.3",
    "claude-4.6-sonnet",
    "claude-4.5-sonnet",
    "grok-4",
    "grok-4.5",
  ],
  kimi: ["kimi-k2.5", "kimi-for-coding"],
  codex: ["gpt-5.4", "gpt-5.3-codex", "gpt-5.2"],
  antigravity: ["gemini-2.5-pro", "gemini-2.5-flash"],
  // Claude Code aliases; the CLI maps each to the account's current model.
  claude: ["sonnet", "opus", "haiku"],
};

export function defaultModel(providerId) {
  return DEFAULT_MODELS[providerId] || "";
}

export function curatedModels(providerId) {
  return (CURATED_MODELS[providerId] || []).slice();
}

export function modelCatalog() {
  return Object.fromEntries(
    Object.keys(DEFAULT_MODELS).map((id) => [
      id,
      {
        default: defaultModel(id),
        flag: MODEL_FLAGS[id] || "--model",
        choices: curatedModels(id),
      },
    ]),
  );
}

/**
 * Strip effort brackets and whitespace. Reject junk so we never pass
 * `composer-1[effort=medium]` into Cursor.
 */
export function normalizeModelId(raw) {
  if (raw == null) return "";
  let value = String(raw).trim();
  if (!value) return "";
  value = value.replace(/\[[^\]]*]/g, "").trim();
  value = value.replace(/\s+/g, "");
  if (!value || value.length > 80) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/.test(value)) return "";
  return value;
}

export function resolveModel(providerId, requested, fallback) {
  if (requested != null) {
    const trimmed = String(requested).trim();
    if (trimmed === "") return defaultModel(providerId);
    return normalizeModelId(trimmed) || defaultModel(providerId);
  }
  if (fallback != null && String(fallback).trim() !== "") {
    return normalizeModelId(fallback) || defaultModel(providerId);
  }
  return defaultModel(providerId);
}

export function modelFlagArgs(providerId, model) {
  const id = normalizeModelId(model) || defaultModel(providerId);
  const flag = MODEL_FLAGS[providerId];
  if (!id || !flag) return [];
  return [flag, id];
}

/**
 * Insert `--model id` / `-m id` before the prompt/stdin token.
 * No-ops when the resolved model is empty (Kimi/Codex CLI default).
 */
export function withModelFlag(patterns, providerId, model) {
  const pair = modelFlagArgs(providerId, model);
  const list = Array.isArray(patterns) ? patterns : [];
  if (!pair.length) return list.map((pattern) => (Array.isArray(pattern) ? pattern.slice() : pattern));
  const [flag, id] = pair;
  return list.map((pattern) => insertArgvPair(Array.isArray(pattern) ? pattern : [], flag, id));
}

const PROMPT_VALUE_FLAGS = new Set(["--prompt", "--command", "-p", "-c"]);

export function insertArgvPair(args, flag, value) {
  const next = Array.isArray(args) ? args.slice() : [];
  if (!flag || value == null || value === "") return next;
  const existing = next.findIndex(
    (part, i) => part === flag && next[i + 1] != null && next[i + 1] !== "{prompt}" && next[i + 1] !== "{file}",
  );
  if (existing >= 0) {
    next[existing + 1] = value;
    return next;
  }
  const markers = new Set(["{prompt}", "{file}", "-"]);
  let at = next.findIndex((part) => markers.has(part));
  if (at >= 1 && PROMPT_VALUE_FLAGS.has(next[at - 1])) at -= 1;
  if (at < 0) at = next.length;
  next.splice(at, 0, flag, value);
  return next;
}
