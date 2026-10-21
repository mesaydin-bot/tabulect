import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSourceType, extractFile, extractHtml, extractMarkdown } from "../lib/extract.mjs";
import { chunkExtracted } from "../lib/chunk.mjs";
import { writeTextPdf } from "./helpers/pdf.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("detects locked source types", () => {
  assert.equal(detectSourceType({ filename: "a.pdf" }), "pdf");
  assert.equal(detectSourceType({ filename: "a.epub" }), "epub");
  assert.equal(detectSourceType({ filename: "a.html" }), "html");
  assert.equal(detectSourceType({ filename: "a.md" }), "md");
  assert.equal(detectSourceType({ filename: "a.docx" }), "docx");
  assert.throws(() => detectSourceType({ filename: "a.rtf" }));
});

test("markdown and html extract titles and text", () => {
  const md = extractMarkdown(Buffer.from("# Başlık\n\nParagraf."), "x.md");
  assert.equal(md.title, "Başlık");
  assert.match(md.text, /Paragraf/);
  const html = extractHtml(
    Buffer.from("<html><title>T</title><h1>H</h1><p>Merhaba</p></html>"),
    "x.html",
  );
  assert.equal(html.title, "T");
  assert.match(html.text, /Merhaba/);
});

test("chunks keep global offsets and page numbers", () => {
  const long = (n) => `Sayfa ${n}. ${"okumak ".repeat(160)}`;
  const { chunks } = chunkExtracted({
    title: "t",
    pages: [
      { page: 1, text: `${long(1)}\n\n${long(1)}` },
      { page: 2, text: long(2) },
    ],
  });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].id, "c-001");
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks.at(-1).page === 2);
  assert.ok(chunks[0].end > chunks[0].start);
});

test("extracts committed sample.md", async () => {
  const extracted = await extractFile({
    filePath: join(HERE, "fixtures/sample.md"),
    filename: "sample.md",
  });
  assert.equal(extracted.sourceType, "md");
  assert.match(extracted.text, /yavaş/i);
});

test("extracts a minimal text-layer PDF via pdftotext", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-pdf-"));
  const pdf = await writeTextPdf(join(dir, "hello.pdf"), "Hello Tabulect text layer");
  const extracted = await extractFile({ filePath: pdf, filename: "hello.pdf" });
  assert.equal(extracted.sourceType, "pdf");
  assert.match(extracted.text, /Hello Tabulect/);
});

test("builds a tiny docx and extracts w:t text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-docx-"));
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Docx iddia metni</w:t></w:r></w:p></w:body>
</w:document>`;
  const docxDir = join(dir, "unz");
  execFileSync("bash", [
    "-lc",
    `mkdir -p ${JSON.stringify(docxDir + "/word")} && printf %s ${JSON.stringify(xml)} > ${JSON.stringify(docxDir + "/word/document.xml")} && (cd ${JSON.stringify(docxDir)} && zip -q ${JSON.stringify(join(dir, "a.docx"))} word/document.xml)`,
  ]);
  const extracted = await extractFile({
    filePath: join(dir, "a.docx"),
    filename: "a.docx",
  });
  assert.match(extracted.text, /Docx iddia metni/);
});
