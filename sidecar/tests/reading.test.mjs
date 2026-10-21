import assert from "node:assert/strict";
import test from "node:test";
import { readingParagraphs, firstSentenceEnd, readReadingPosition, writeReadingPosition } from "../../src/reader/reading.ts";
import { markedSegments } from "../../src/reader/search.ts";

const chunk = (id, text) => ({ id, text, page: 1, start: 0, end: text.length });

test("paragraph ranges preserve source offsets, hard wraps and stable document numbering", () => {
  const chunks = [chunk("a", "İlk satır\nikinci satır.\n \nİkinci paragraf."), chunk("b", "Üçüncü.\r\n\r\nDördüncü.")];
  const paragraphs = readingParagraphs(chunks);
  assert.deepEqual(paragraphs.map((p) => p.number), [1, 2, 3, 4]);
  assert.equal(paragraphs[0].text, "İlk satır\nikinci satır.");
  for (const p of paragraphs) assert.equal(chunks.find((c) => c.id === p.chunkId).text.slice(p.start, p.end), p.text);
  assert.deepEqual(readingParagraphs([chunk("blank", "\n\n  ")]), []);
});

test("first sentence respects Turkish abbreviations, initials, decimals and quotes", () => {
  for (const first of ["Dr. Yıldız geldi.", "Prof. Dr. A. Yılmaz anlattı.", "T.C. sınırları içinde.", "Örnekler vb. burada yer alır.", "Oran 3.14 oldu.", "“Tamam!”", "1. İlk madde.", "No punctuation"]) {
    assert.equal(firstSentenceEnd(`${first} Sonraki cümle.`), first === "No punctuation" ? `${first} Sonraki cümle.`.length : first.length, first);
  }
});

test("sentence emphasis partitions overlapping search and bookmarks without losing characters", () => {
  const text = "Dr. Yıldız geldi. Sonraki cümle.";
  const segments = markedSegments(text, [
    { start: 0, end: firstSentenceEnd(text), className: "first-sentence" },
    { start: 4, end: 10, className: "search-mark", searchId: 3 },
    { start: 7, end: 20, className: "bookmark-mark" },
  ]);
  assert.equal(segments.map((part) => part.text).join(""), text);
  assert.ok(segments.some((part) => part.className.includes("first-sentence") && part.className.includes("search-mark") && part.className.includes("bookmark-mark")));
});

test("reading positions are independent per document and tolerate invalid/unavailable storage", () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const position = { chunkId: "c10", offset: 350, progress: 0.4, selectionChunkId: "c11", selectionOffset: 420 };
    writeReadingPosition("book-a", position);
    assert.deepEqual(readReadingPosition("book-a"), position);
    assert.equal(readReadingPosition("book-b"), null);
    values.set("tabulect:reading-position:book-b", '{"chunkId":"c","offset":-5,"progress":0}');
    assert.equal(readReadingPosition("book-b"), null);
    values.set("tabulect:reading-position:book-b", "broken json");
    assert.equal(readReadingPosition("book-b"), null);
    globalThis.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    assert.equal(readReadingPosition("book-a"), null);
    assert.doesNotThrow(() => writeReadingPosition("book-a", position));
  } finally { globalThis.localStorage = previous; }
});
