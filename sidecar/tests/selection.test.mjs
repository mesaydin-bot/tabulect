import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLineIndex,
  looksLikeHardWrap,
  moveHighlight,
  searchUnits,
  spansFromUnits,
  textFromSpans,
  unitsForStep,
  visualLineRanges,
  windowAt,
} from "../lib/selection.mjs";

const chunks = [
  { id: "c-001", text: "Bir.\nİki.\nÜç.\nDört.\nBeş.", page: 1 },
  { id: "c-002", text: "Paragraf A.\n\nParagraf B.", page: 2 },
];

test("line index keeps chunk-local offsets", () => {
  const lines = buildLineIndex(chunks);
  assert.equal(lines.length, 8);
  assert.equal(lines[0].text, "Bir.");
  assert.equal(lines[2].chunkId, "c-001");
  assert.equal(chunks[0].text.slice(lines[2].start, lines[2].end), "Üç.");
});

test("arrow without shift replaces the transient window", () => {
  const first = windowAt(0, "2", 5);
  assert.deepEqual(first, { start: 0, end: 1, empty: false });
  const next = moveHighlight(first, { direction: 1, shift: false, step: "2", length: 5 });
  assert.deepEqual(next, { start: 2, end: 3, empty: false });
  const prev = moveHighlight(next, { direction: -1, shift: false, step: "2", length: 5 });
  assert.deepEqual(prev, { start: 0, end: 1, empty: false });
});

test("shift+arrow accumulates the same yellow range", () => {
  const first = windowAt(0, "1", 5);
  const grown = moveHighlight(first, { direction: 1, shift: true, step: "1", length: 5 });
  assert.deepEqual(grown, { start: 0, end: 1, empty: false });
  const more = moveHighlight(grown, { direction: 1, shift: true, step: "1", length: 5 });
  assert.deepEqual(more, { start: 0, end: 2, empty: false });
});

test("paragraph step walks paragraphs", () => {
  const units = unitsForStep(chunks, "paragraph");
  assert.ok(units.length >= 2);
  assert.match(units[0].text, /Bir/);
  const first = windowAt(0, "paragraph", units.length);
  const next = moveHighlight(first, { direction: 1, shift: false, step: "paragraph", length: units.length });
  assert.equal(next.start, 1);
});

test("spans collapse adjacent lines in one chunk", () => {
  const units = buildLineIndex(chunks);
  const spans = spansFromUnits(units, 0, 2);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].chunkId, "c-001");
  assert.match(textFromSpans(spans), /Bir/);
});

test("search finds matching units", () => {
  const units = buildLineIndex(chunks);
  const hits = searchUnits(units, "paragraf");
  assert.ok(hits.length >= 1);
});

test("mid-sentence EPUB wraps merge; TOC and sentence breaks stay", () => {
  assert.equal(looksLikeHardWrap("The table of contents is", "printed here with many"), true);
  assert.equal(looksLikeHardWrap("1. Introduction", "2. The slip-box"), false);
  assert.equal(looksLikeHardWrap("This sentence ends.", "The next one starts."), false);
});

test("step=1 walks visual lines, not leftover hard wraps", () => {
  const epub = {
    id: "c-epub",
    text: "The table of contents is\nprinted here with many\nentries for later chapters.\n\nChapter one begins after the break and continues in a long flowing paragraph without extra hard wraps.",
    page: 1,
  };
  const units = unitsForStep([epub], "1", { charsPerLine: 40 });
  assert.ok(units.length >= 3);
  assert.doesNotMatch(units[0].text, /^printed here/);
  assert.match(units[0].text.replace(/\s+/g, " "), /table of contents/);
  const first = windowAt(0, "1", units.length);
  const next = moveHighlight(first, { direction: 1, shift: false, step: "1", length: units.length });
  assert.equal(next.start, 1);
  assert.equal(next.end, 1);
  const a = units[0].text.replace(/\s+/g, " ").trim();
  const b = units[1].text.replace(/\s+/g, " ").trim();
  assert.ok(a.length <= 48, a);
  assert.ok(b.length <= 48, b);
  assert.notEqual(a, b);
});

test("visual lines keep original offsets into the chunk", () => {
  const text = "Hello there wrapped\nfriend who continues.";
  const lines = visualLineRanges(text, 80);
  assert.equal(lines.length, 1);
  assert.equal(text.slice(lines[0].start, lines[0].end), text);
});
