/**
 * Decide whether Tabulect may leave the open document.
 * Default is open-document only. Other books enter only via @mention,
 * picker ids, or an explicit corpus/folder/book ask.
 * Scope tokens (@library, @all) are not library titles.
 */
import { isAppMentionToken, mentionTokens, parseAppMentions } from "./mentions.mjs";

export { mentionTokens, parseAppMentions };

const CORPUS_HINTS =
  /\b(?:corpus|kitapl[iı]k(?:tan)?|diğer kitap|diger kitap|şu kitaba|su kitaba|öbür kitap|obur kitap|başka kitap|baska kitap|tüm belgeler|tum belgeler|other (?:book|doc)|all (?:books|documents)|kitaplara da|şuna da bak|suna da bak)\b/i;

function norm(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

function matchByTitle(token, items, minTitle = 4) {
  const needle = norm(token);
  if (needle.length < 2) return [];
  const ids = [];
  for (const item of items || []) {
    const title = norm(item.title);
    const id = norm(item.id);
    if (id === needle || title === needle || (title.length >= minTitle && (title.includes(needle) || needle.includes(title)))) {
      ids.push(item.id);
    }
  }
  return ids;
}

function matchLibrary(token, documents, folders) {
  const needle = norm(token);
  if (needle.length < 2) return { docIds: [], folderIds: [] };
  const docIds = matchByTitle(token, documents);
  const folderIds = [];
  for (const folder of folders || []) {
    const name = norm(folder.name);
    if (name === needle || (name.length >= 3 && (name.includes(needle) || needle.includes(name)))) {
      folderIds.push(folder.id);
    }
  }
  return { docIds, folderIds };
}

export function resolveCorpusScope({
  instruction = "",
  mentionIds = [],
  documents = [],
  folders = [],
  notes = [],
  noteFolders = [],
  openDocumentId,
} = {}) {
  const extra = new Set((mentionIds || []).filter((id) => id && id !== openDocumentId));
  const text = String(instruction || "");
  const apps = parseAppMentions(text);
  for (const token of mentionTokens(text)) {
    if (isAppMentionToken(token)) continue;
    const found = matchLibrary(token, documents, folders);
    found.docIds.forEach((id) => extra.add(id));
    for (const folderId of found.folderIds) {
      for (const doc of documents) {
        if (doc.folderId === folderId) extra.add(doc.id);
      }
    }
    matchByTitle(token, notes).forEach((id) => extra.add(id));
    const needle = norm(token);
    for (const folder of noteFolders || []) {
      const name = norm(folder.name);
      if (name === needle || (name.length >= 3 && (name.includes(needle) || needle.includes(name)))) {
        for (const note of notes) {
          if (note.folderId === folder.id) extra.add(note.id);
        }
      }
    }
  }
  const lowered = norm(text);
  if (lowered) {
    for (const folder of folders || []) {
      const name = norm(folder.name);
      if (name.length >= 3 && lowered.includes(name)) {
        for (const doc of documents) {
          if (doc.folderId === folder.id) extra.add(doc.id);
        }
      }
    }
    for (const doc of documents || []) {
      if (doc.id === openDocumentId) continue;
      const title = norm(doc.title);
      if (title.length >= 4 && lowered.includes(title)) extra.add(doc.id);
    }
    for (const folder of noteFolders || []) {
      const name = norm(folder.name);
      if (name.length >= 3 && lowered.includes(name)) {
        for (const note of notes) {
          if (note.folderId === folder.id) extra.add(note.id);
        }
      }
    }
    for (const note of notes || []) {
      const title = norm(note.title);
      if (title.length >= 4 && lowered.includes(title)) extra.add(note.id);
    }
  }
  extra.delete(openDocumentId);
  const wantCorpus = CORPUS_HINTS.test(text) || apps.localLibrary;
  if (!extra.size && !wantCorpus) {
    return { mode: "open", extraIds: [], searchCorpus: false };
  }
  if (apps.localLibrary || (wantCorpus && !extra.size)) {
    return {
      mode: "corpus",
      extraIds: [
        ...(documents || []).map((item) => item.id),
        ...(notes || []).map((item) => item.id),
      ].filter((id) => id !== openDocumentId),
      searchCorpus: true,
    };
  }
  return { mode: "explicit", extraIds: [...extra], searchCorpus: true };
}

export function retrievalQuery(instruction, fallback) {
  const text = String(instruction || "").replace(/@(?:"[^"]+"|[^\s,;:]+)/g, " ").trim();
  return text || String(fallback || "").trim();
}
