import type { ProviderId } from "../api/client";

export const MODEL_STORAGE_KEY = "tabulect:models";

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  cursor: "auto",
  kimi: "",
  codex: "",
  antigravity: "",
  claude: "",
};

export const CURATED_MODELS: Record<ProviderId, string[]> = {
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
  claude: ["sonnet", "opus", "haiku"],
};

export function defaultModel(provider: ProviderId): string {
  return DEFAULT_MODELS[provider] || "";
}

export function curatedModels(provider: ProviderId): string[] {
  return CURATED_MODELS[provider] || [];
}

export function normalizeModelId(raw: string | null | undefined): string {
  if (raw == null) return "";
  let value = String(raw).trim();
  if (!value) return "";
  value = value.replace(/\[[^\]]*]/g, "").trim();
  value = value.replace(/\s+/g, "");
  if (!value || value.length > 80) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/.test(value)) return "";
  return value;
}

export type ModelMap = Record<ProviderId, string>;

export function emptyModelMap(): ModelMap {
  return {
    cursor: DEFAULT_MODELS.cursor,
    kimi: DEFAULT_MODELS.kimi,
    codex: DEFAULT_MODELS.codex,
    antigravity: DEFAULT_MODELS.antigravity,
    claude: DEFAULT_MODELS.claude,
  };
}

export function readStoredModels(): ModelMap {
  const next = emptyModelMap();
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const id of Object.keys(next) as ProviderId[]) {
      if (typeof parsed[id] === "string") {
        next[id] = id === "cursor" ? normalizeModelId(parsed[id]) || "auto" : normalizeModelId(parsed[id]);
      }
    }
  } catch {
    /* ignore */
  }
  return next;
}

export function writeStoredModels(map: ModelMap) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function modelForProvider(map: ModelMap, provider: ProviderId): string {
  if (provider === "cursor") return normalizeModelId(map.cursor) || "auto";
  return normalizeModelId(map[provider]);
}
