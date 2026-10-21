import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchIndex, searchDocument, markedSegments } from "../../src/reader/search.ts";

const chunks = (...texts) => texts.map((text, i) => ({ id: `c${i}`, text, page: i + 1, start: 0, end: text.length }));

test("every occurrence gets its own exact anchor, including repeated hits in one paragraph", () => {
  const index = buildSearchIndex(chunks("kitap ve kitap", "bir kitap daha"));
  const hits = searchDocument(index, "kitap");
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map(h => h.spans[0].start), [0, 9, 4]);
  assert.deepEqual(hits.map(h => h.spans[0].page), [1, 1, 2]);
  assert.equal(hits[1].match, "kitap");
});

test("phrases cross line breaks, repeated whitespace and page/chunk boundaries", () => {
  const source = chunks("Bir karar\n  verme süreci. Karar", "verme devam ediyor.");
  const hits = searchDocument(buildSearchIndex(source), "karar verme");
  assert.equal(hits.length, 2);
  assert.equal(source[0].text.slice(hits[0].spans[0].start, hits[0].spans[0].end), "karar\n  verme");
  assert.equal(hits[1].spans.length, 2);
  assert.equal(hits[1].spans[0].page, 1);
  assert.equal(hits[1].spans[1].page, 2);
});

test("PDF line-end and soft hyphens retain original offsets", () => {
  const source = chunks("Bir öğren-\nme süreci ve öğ\u00adrenme deneyimi.");
  const hits = searchDocument(buildSearchIndex(source), "öğrenme");
  assert.equal(hits.length, 2);
  assert.equal(source[0].text.slice(hits[0].spans[0].start, hits[0].spans[0].end), "öğren-\nme");
  assert.equal(source[0].text.slice(hits[1].spans[0].start, hits[1].spans[0].end), "öğ\u00adrenme");
});

test("Turkish case, decomposed accents, ligatures and emoji do not shift offsets", () => {
  const source = chunks("📖 İNSAN insan IŞIK ışık o\u0308ğrenme ﬁkir");
  const index = buildSearchIndex(source);
  assert.equal(searchDocument(index, "insan").length, 2);
  assert.equal(searchDocument(index, "ışık").length, 2);
  for (const query of ["öğrenme", "fikir"]) {
    const hit = searchDocument(index, query)[0];
    assert.equal(source[0].text.slice(hit.spans[0].start, hit.spans[0].end).normalize("NFKC"), query);
  }
  assert.equal(searchDocument(buildSearchIndex(source, true), "insan").length, 1);
});

test("whole-word option uses Unicode boundaries and literal punctuation", () => {
  const index = buildSearchIndex(chunks("iş kişi işçi (iş). C++ C++17 [a+b]"));
  assert.equal(searchDocument(index, "iş", true).length, 2);
  assert.equal(searchDocument(index, "C++", true).length, 1);
  assert.equal(searchDocument(index, "[a+b]").length, 1);
  assert.equal(searchDocument(index, "   ").length, 0);
  assert.equal(searchDocument(index, "yok").length, 0);
});

test("overlapping selection, bookmark and search marks never duplicate or lose source text", () => {
  const text = "Bir kitap ve bir kitap.";
  const parts = markedSegments(text, [
    { start: 0, end: 16, className: "quote-mark" },
    { start: 2, end: 10, className: "bookmark-mark" },
    { start: 4, end: 9, className: "search-mark", searchId: 0 },
    { start: 17, end: 22, className: "search-mark search-mark-active", searchId: 1 },
  ]);
  assert.equal(parts.map(p => p.text).join(""), text);
  assert.equal(parts.filter(p => p.searchId === 0).map(p => p.text).join(""), "kitap");
  assert.ok(parts.some(p => p.className.includes("quote-mark") && p.className.includes("search-mark")));
});

test("book-sized corpus includes final-page hits without a result cap", () => {
  const source = chunks(...Array.from({ length: 2000 }, (_, i) => `Sayfa ${i}. ${"Uzun kitap metni. ".repeat(30)} hedef hedef.`));
  const index = buildSearchIndex(source);
  const hits = searchDocument(index, "hedef");
  assert.equal(hits.length, 4000);
  assert.equal(hits.at(-1).spans[0].page, 2000);
  assert.equal(hits.at(-1).match, "hedef");
});
