/**
 * Local @mention parsing. `@library` and `@all` widen the AI scope
 * to the user's own local library (documents, bookmarks, notes). Nothing leaves this machine.
 */
const APP_ALIAS = {
  library: "library",
  all: "all",
};

function foldAlias(token) {
  return String(token || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9-]/g, "");
}

export function isAppMentionToken(token) {
  return Boolean(APP_ALIAS[foldAlias(token)]);
}

export function mentionTokens(instruction) {
  const text = String(instruction || "");
  const tokens = [];
  for (const match of text.matchAll(/@(?:"([^"]+)"|([^\s,;:]+))/g)) {
    const token = (match[1] || match[2] || "").trim();
    if (token) tokens.push(token.replace(/^@/, ""));
  }
  return tokens;
}

/** Parse explicit library @mentions. Default (no mention) is the open document only. */
export function parseAppMentions(instruction) {
  const found = new Set();
  for (const token of mentionTokens(instruction)) {
    const mapped = APP_ALIAS[foldAlias(token)];
    if (mapped) found.add(mapped);
  }
  const all = found.has("all");
  return { found: [...found], localLibrary: all || found.has("library"), all };
}
