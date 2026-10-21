import type { BookmarkSpan, Chunk } from "../types/document";

export type SearchOptions = { caseSensitive: boolean; wholeWord: boolean };
export type SearchHit = {
  id: number;
  spans: BookmarkSpan[];
  chunkNumber: number;
  before: string;
  match: string;
  after: string;
};

// Keep original UTF-16 offsets: normalization must never move the jump target.
function normalize(text: string, caseSensitive: boolean) {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const tokens = /[\p{L}\p{N}]\p{M}*|[^]/gu;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(text))) {
    const start = token.index;
    let value = token[0];
    if (value === "\u00ad") continue;
    // PDF line-end hyphenation, including a word continued on the next page.
    if ((value === "-" || value === "‐") && /\p{L}$/u.test(text.slice(Math.max(0, start - 2), start))) {
      const wrap = text.slice(start + 1).match(/^[\t ]*\r?\n\s*(?=\p{L})/u);
      if (wrap) {
        tokens.lastIndex = start + 1 + wrap[0].length;
        continue;
      }
    }
    value = value.normalize("NFKC");
    if (!caseSensitive) value = value.toLocaleLowerCase("tr");
    if (/^\s+$/u.test(value)) value = " ";
    if (value === " " && parts[parts.length - 1] === " ") {
      ends[ends.length - 1] = start + token[0].length;
      continue;
    }
    parts.push(value);
    for (let i = 0; i < value.length; i++) {
      starts.push(start);
      ends.push(start + token[0].length);
    }
  }
  return { text: parts.join(""), starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}

export function buildSearchIndex(chunks: Chunk[], caseSensitive = false) {
  let offset = 0;
  const locations = chunks.map((chunk, index) => {
    const entry = { chunk, index, start: offset, end: offset + chunk.text.length };
    offset = entry.end + 2;
    return entry;
  });
  const raw = chunks.map((chunk) => chunk.text).join("\n\n");
  return { raw, locations, ...normalize(raw, caseSensitive), caseSensitive };
}

const isWord = (char: string) => /[\p{L}\p{N}\p{M}_]/u.test(char);
const compact = (text: string) => text.replace(/\s+/gu, " ");

export function searchDocument(index: ReturnType<typeof buildSearchIndex>, query: string, wholeWord = false): SearchHit[] {
  const needle = normalize(query.trim(), index.caseSensitive).text;
  if (!needle) return [];
  const hits: SearchHit[] = [];
  let from = 0;
  let location = 0;
  while (from <= index.text.length - needle.length) {
    const found = index.text.indexOf(needle, from);
    if (found < 0) break;
    from = found + needle.length;
    if (wholeWord) {
      const prev = Array.from(index.text.slice(Math.max(0, found - 2), found)).at(-1) || "";
      const next = Array.from(index.text.slice(from, from + 2))[0] || "";
      if (isWord(prev) || isWord(next)) continue;
    }
    const start = index.starts[found];
    const end = index.ends[from - 1];
    while (location < index.locations.length && index.locations[location].end <= start) location++;
    const spans: BookmarkSpan[] = [];
    for (let c = location; c < index.locations.length && index.locations[c].start < end; c++) {
      const entry = index.locations[c];
      if (entry.end <= start) continue;
      spans.push({ chunkId: entry.chunk.id, page: entry.chunk.page,
        start: Math.max(0, start - entry.start), end: Math.min(entry.chunk.text.length, end - entry.start) });
    }
    if (!spans.length) continue;
    hits.push({ id: hits.length, spans, chunkNumber: location + 1,
      before: (start > 32 ? "…" : "") + compact(index.raw.slice(Math.max(0, start - 32), start)),
      match: compact(index.raw.slice(start, end)),
      after: compact(index.raw.slice(end, end + 85)) + (end + 85 < index.raw.length ? "…" : ""),
    });
  }
  return hits;
}

export type TextMark = { start: number; end: number; className: string; searchId?: number };

// Partition overlapping bookmarks, selection and search hits without duplicating text.
export function markedSegments(text: string, ranges: TextMark[]) {
  const events = new Map<number, { add: TextMark[]; remove: TextMark[] }>();
  const at = (offset: number) => {
    if (!events.has(offset)) events.set(offset, { add: [], remove: [] });
    return events.get(offset)!;
  };
  at(0); at(text.length);
  for (const range of ranges) {
    const start = Math.max(0, Math.min(text.length, range.start));
    const end = Math.max(start, Math.min(text.length, range.end));
    if (end <= start) continue;
    at(start).add.push(range); at(end).remove.push(range);
  }
  const positions = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<TextMark>();
  return positions.slice(0, -1).map((start, i) => {
    const event = events.get(start)!;
    event.remove.forEach((range) => active.delete(range));
    event.add.forEach((range) => active.add(range));
    const marks = [...active];
    return { start, text: text.slice(start, positions[i + 1]),
      className: [...new Set(marks.map((range) => range.className))].join(" "),
      searchId: marks.find((range) => range.searchId != null)?.searchId };
  });
}
