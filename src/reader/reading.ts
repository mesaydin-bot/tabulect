import type { Chunk } from "../types/document";

export type ReadingParagraph = { chunkId: string; start: number; end: number; text: string; number: number };
export type ReadingPosition = { chunkId: string; offset: number; progress: number; selectionChunkId?: string; selectionOffset?: number };

/** Display ranges always refer to the untouched source text. */
export function readingParagraphs(chunks: Chunk[]): ReadingParagraph[] {
  const result: ReadingParagraph[] = [];
  for (const chunk of chunks) {
    const separator = /\r?\n[\t \r]*\n(?:[\t \r]*\n)*/g;
    let start = 0;
    const append = (end: number) => {
      const text = chunk.text.slice(start, end);
      if (text.trim()) result.push({ chunkId: chunk.id, start, end, text, number: result.length + 1 });
    };
    for (const match of chunk.text.matchAll(separator)) {
      append(match.index);
      start = match.index + match[0].length;
    }
    append(chunk.text.length);
  }
  return result;
}

const ABBREVIATIONS = new Set(["dr", "prof", "doç", "doc", "av", "sn", "say", "mr", "mrs", "ms", "jr", "sr", "st", "vs", "vb", "bkz", "örn", "ör", "no", "fig", "e.g", "i.e"]);

export function firstSentenceEnd(text: string): number {
  for (const match of text.matchAll(/[.!?…]+[”’"'»)]*(?=\s|$)/gu)) {
    const punctuation = match[0];
    const before = text.slice(0, match.index);
    if (punctuation.startsWith(".")) {
      const word = before.match(/([\p{L}.]+)$/u)?.[1] || "";
      if (ABBREVIATIONS.has(word.toLocaleLowerCase("tr")) || /^[\p{Lu}]$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) continue;
      if (/^\s*\d+$/.test(before)) continue; // numbered list, not a sentence
    }
    return match.index + punctuation.length;
  }
  return text.length;
}

const positionKey = (documentId: string) => `tabulect:reading-position:${documentId}`;

export function readReadingPosition(documentId: string): ReadingPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(positionKey(documentId)) || "null");
    if (!value || typeof value.chunkId !== "string" || !Number.isInteger(value.offset) || value.offset < 0 ||
        !Number.isFinite(value.progress) || value.progress < -2 || value.progress > 1) return null;
    return { chunkId: value.chunkId, offset: value.offset, progress: value.progress,
      selectionChunkId: typeof value.selectionChunkId === "string" ? value.selectionChunkId : undefined,
      selectionOffset: Number.isInteger(value.selectionOffset) && value.selectionOffset >= 0 ? value.selectionOffset : undefined };
  } catch { return null; }
}

export function writeReadingPosition(documentId: string, position: ReadingPosition) {
  try { localStorage.setItem(positionKey(documentId), JSON.stringify(position)); } catch { /* storage can be unavailable */ }
}
