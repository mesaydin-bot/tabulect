export const OUTPUT_MODE_KEY = "tabulect:outputMode";
export const OUTPUT_SEPARATOR = "\n\n---\n\n";

export type OutputMode = "new" | "append";

export function normalizeOutputMode(value: unknown): OutputMode {
  return value === "append" ? "append" : "new";
}

export function readOutputMode(): OutputMode {
  try {
    return normalizeOutputMode(localStorage.getItem(OUTPUT_MODE_KEY));
  } catch {
    return "new";
  }
}

export function writeOutputMode(mode: OutputMode) {
  try {
    localStorage.setItem(OUTPUT_MODE_KEY, normalizeOutputMode(mode));
  } catch {
    /* ignore */
  }
}

/** Combine two markdown (or HTML) answers without gluing headings together. */
export function joinOutput(previous: string, next: string): string {
  const prev = String(previous ?? "").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  const incoming = String(next ?? "").replace(/^\s+/, "").replace(/\s+$/, "");
  if (!prev) return incoming;
  if (!incoming) return prev;
  return `${prev}${OUTPUT_SEPARATOR}${incoming}`;
}
