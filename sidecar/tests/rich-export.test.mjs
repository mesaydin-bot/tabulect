import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { markdownToHtml, parseMarkdownTables, previewPlainText } from "../lib/markdown.mjs";
import { buildExport, contentToDocxXml, contentToPdf, renderPrintHtml, writeExportFile } from "../lib/rich-export.mjs";
import { extractPdfUnicode, resolveChrome } from "../lib/chrome-print.mjs";
import { unzipEntries } from "../lib/xlsx.mjs";

const md = `# Başlık

| Ana fikir | Gerekçe |
| --- | --- |
| Yavaş oku | Derinlik |

Bir cümle daha.
`;

test("markdown tables render as HTML tables", () => {
  const html = markdownToHtml(md);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Ana fikir<\/th>/);
  assert.match(html, /<td>Yavaş oku<\/td>/);
  assert.equal(parseMarkdownTables(md).length, 1);
});

test("pdf docx xlsx come from preview rendering, not raw markdown tokens", async () => {
  const sample = `# Başlık

Bu **kalın** bir cümle.

| Ana fikir | Gerekçe |
| --- | --- |
| Yavaş oku | Derinlik |
`;
  const plain = previewPlainText(sample);
  assert.match(plain, /Başlık/);
  assert.match(plain, /kalın/);
  assert.doesNotMatch(plain, /\*\*/);
  assert.doesNotMatch(plain, /^# /m);
  assert.doesNotMatch(plain, /\| Ana fikir/);

  const pdf = contentToPdf("Deneme", sample).toString("latin1");
  assert.match(pdf, /Baslik/);
  assert.match(pdf, /kalin/);
  assert.match(pdf, /Ana fikir/);
  assert.doesNotMatch(pdf, /\*\*/);
  assert.doesNotMatch(pdf, /# Baslik|# Başlık/);
  assert.doesNotMatch(pdf, /\| Ana fikir/);
  const tjs = [...pdf.matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\) Tj/g)].map((item) => item[1].replace(/\\([()\\])/g, "$1"));
  assert.ok(tjs.includes("Ana fikir"), tjs.join(" | "));
  assert.ok(tjs.includes("Yavas oku"), tjs.join(" | "));
  assert.ok(tjs.includes("Derinlik"), tjs.join(" | "));
  assert.equal(tjs.filter((line) => /Ana fikir/.test(line) && /Yavas oku/.test(line)).length, 0);
  const rects = pdf.match(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ re B/g) || [];
  assert.ok(rects.length >= 4, `expected table cell rects, got ${rects.length}`);

  const xml = contentToDocxXml("Deneme", sample);
  assert.match(xml, /Başlık/);
  assert.match(xml, /kalın/);
  assert.match(xml, /<w:tbl>/);
  assert.doesNotMatch(xml, /\*\*/);
  assert.doesNotMatch(xml, /# Başlık/);
  assert.doesNotMatch(xml, /\| Ana fikir \|/);

  const html = (await buildExport({ format: "html", title: "Deneme", content: sample })).buffer.toString("utf8");
  assert.match(html, /<h1>Başlık<\/h1>/);
  assert.match(html, /<strong>kalın<\/strong>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /\*\*kalın\*\*/);

  const xlsx = (await buildExport({ format: "xlsx", title: "Deneme", content: sample })).buffer;
  const sheet = unzipEntries(xlsx).get("xl/worksheets/sheet1.xml") || "";
  assert.match(sheet, /Ana fikir/);
  assert.match(sheet, /Yavaş oku/);
  assert.doesNotMatch(sheet, /\*\*/);
  assert.doesNotMatch(sheet, /\| ---/);
});

test("export builds md html pdf docx xlsx", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-ex-"));
  for (const format of ["md", "html", "pdf", "docx", "xlsx"]) {
    const built = await buildExport({ format, title: "Deneme", content: md });
    assert.ok(built.buffer.length > 10, format);
    const saved = await writeExportFile(built, root);
    const disk = await readFile(saved.path);
    assert.ok(disk.length > 10);
  }
});

const FLOW_CARD = `| Adler | Adler | Adler | Adler |
| --- | --- | --- | --- |
| Okumak | Radyo | Photo | Medya |

\`\`\`mermaid
flowchart LR
A["Yazılı söz information + understanding"] --> D["Artan anlayış"]
B["Konuşulan söz + gözlem"] --> D
C["Radyo / TV haber, etki, zaman tasarrufu"] --> E["İşlev: güçlü Anlayış: sorgulanır"]
B -.->|"never enough"| A
\`\`\`

<div style="margin-top:1.25rem;border:1px solid #c4b8a8;border-radius:12px;background:#f7f6e6;color:#2c2418;">
<div style="padding:10px 16px;background:#2c2418;color:#f7f6e6;">HOW TO READ A BOOK — seçili pasaj</div>
<div style="display:grid;grid-template-columns:1fr 1fr;">
<div style="padding:16px;"><div style="text-transform:uppercase;">ESKİ OKUR</div><p>Written word → large share of information <em>and</em> understanding</p></div>
<div style="padding:16px;"><div style="text-transform:uppercase;">YENİ MEDYA</div><p>Radio / TV → impact + time saved; understanding “may be seriously questioned”</p></div>
</div>
<div style="padding:12px 16px;"><strong>Kitabın adresi:</strong> readers of books whose main purpose is increased understanding.</div>
</div>
`;

test("pdf draws mermaid chips and HTML card instead of smashed text", () => {
  const pdf = contentToPdf("Deneme", FLOW_CARD).toString("latin1");
  const tjs = [...pdf.matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\) Tj/g)].map((item) => item[1].replace(/\\([()\\])/g, "$1"));
  const joined = tjs.join(" | ");
  assert.ok(tjs.some((line) => /Yazili soz/.test(line)), joined);
  assert.ok(tjs.some((line) => /Artan anlayis/.test(line)), joined);
  assert.equal(
    tjs.filter((line) => /Yazili soz/.test(line) && /Artan anlayis/.test(line)).length,
    0,
    "from/to must be separate chip strings",
  );
  assert.doesNotMatch(pdf, /\? Yazili soz[^\n]*Artan/);
  assert.doesNotMatch(joined, /Yazili soz information \+ understanding\?Artan/);
  assert.doesNotMatch(pdf, /\?Artan anlayis/);
  assert.match(pdf, /HOW TO READ A BOOK/);
  assert.match(pdf, /Eski okur|ESKI OKUR/);
  assert.match(pdf, /Yeni medya|YENI MEDYA/);
  assert.match(pdf, /Kitabin adresi|Kitabın adresi/);
  assert.match(pdf, /never enough/);
  const rects = pdf.match(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ re B/g) || [];
  const strokes = pdf.match(/(?:re B|\sB\n)/g) || [];
  assert.ok(rects.length >= 16, `table cells still drawn, got ${rects.length}`);
  assert.ok(strokes.length >= 20, `mermaid/card boxes expected extra strokes, got ${strokes.length}`);
  assert.ok(tjs.filter((line) => line === "->").length >= 3, "flow arrows between chips");

  const xml = contentToDocxXml("Deneme", FLOW_CARD);
  assert.match(xml, /Artan anlayış/);
  assert.match(xml, /HOW TO READ A BOOK/);
  assert.match(xml, /ESKİ OKUR/);
  assert.match(xml, /w:shd/);
  assert.doesNotMatch(xml, /flowchart LR/);
});

test("print HTML is the preview (table + mermaid chips + card grid), not a flattened list", () => {
  const html = renderPrintHtml("Deneme", FLOW_CARD);
  assert.match(html, /class="md-preview"/);
  assert.match(html, /print-color-adjust:\s*exact/);
  assert.match(html, /<table>/);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /class="mermaid-node"/);
  assert.match(html, /grid-template-columns:1fr 1fr/);
  assert.match(html, /ESKİ OKUR/);
  assert.match(html, /YENİ MEDYA/);
  assert.match(html, /Artan anlayış/);
  assert.doesNotMatch(html, /flowchart LR/);
});

test("Chrome print PDF keeps Unicode and tagged tables when Chrome is present", async () => {
  const chrome = await resolveChrome();
  if (!chrome) {
    const fallback = contentToPdf("Deneme", FLOW_CARD);
    assert.match(fallback.toString("latin1"), /Times-Roman/);
    return;
  }
  const built = await buildExport({ format: "pdf", title: "Deneme", content: FLOW_CARD });
  const pdf = built.buffer;
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.doesNotMatch(pdf.toString("latin1"), /Times-Roman/);
  assert.match(pdf.toString("latin1"), /ToUnicode/);
  assert.match(pdf.toString("latin1"), /\/Table/);
  const text = extractPdfUnicode(pdf);
  assert.match(text, /Adler/);
  assert.match(text, /Okumak/);
  assert.match(text, /Artan anlayış/);
  assert.match(text, /HOW TO READ A BOOK/);
  assert.match(text, /ESKİ OKUR/);
  assert.match(text, /YENİ MEDYA/);
  assert.match(text, /Kitabın adresi/);
  assert.doesNotMatch(text, /flowchart LR/);
});
