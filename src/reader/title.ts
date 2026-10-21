/** Top-bar display only. Library titles and rename keep the full string. */
export function shortDocTitle(title: string, maxWords = 5): string {
  const words = String(title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}
