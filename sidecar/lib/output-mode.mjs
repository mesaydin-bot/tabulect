export const OUTPUT_SEPARATOR = "\n\n---\n\n";

export function normalizeOutputMode(value) {
  return value === "append" ? "append" : "new";
}

/** Combine two markdown (or HTML) answers without gluing headings together. */
export function joinOutput(previous, next) {
  const prev = String(previous ?? "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+$/, "");
  const incoming = String(next ?? "")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
  if (!prev) return incoming;
  if (!incoming) return prev;
  return `${prev}${OUTPUT_SEPARATOR}${incoming}`;
}
