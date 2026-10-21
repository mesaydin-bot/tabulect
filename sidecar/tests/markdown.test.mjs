import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { markdownToHtml, previewPlainText, sanitizeHtml } from "../lib/markdown.mjs";
import { buildTableAiPrompt } from "../lib/table-ai.mjs";
import {
  DEFAULT_TABLE_TEMPLATE_ID,
  DEFAULT_TEMPLATES,
  isNoneTemplate,
  loadTemplates,
  resolveTableTemplate,
  templateById,
} from "../lib/templates.mjs";
import { contentToDocxXml, contentToPdf, renderPreviewHtml } from "../lib/rich-export.mjs";

const MIXED = `| Adler | Adler | Adler | Adler |
| --- | --- | --- | --- |
| Okumak | Radyo | Photo | Medya |

flowchart LR
A["Yazılı sözcük<br/>information + understanding"] --> D["Artan anlayış"]
B["Konuşulan sözcük + gözlem"] --> D
C["Radyo / TV<br/>haber, etki, zaman tasarrufu"] --> E["İşlev güçlü<br/>Anlayış sorgulanır"]
B -.->|"never enough"| A

<div style="margin-top:1.25rem;border:1px solid #c4b8a8;border-radius:12px;font-family:Georgia,serif;background:#f7f6e6;color:#2c2418;">
<div style="padding:10px 16px;background:#2c2418;color:#f7f6e6;">HOW TO READ A BOOK – seçili pasaj</div>
<p>Written word → large share of information <em>and</em> understanding.</p>
<p><strong>Kitabın adresi:</strong> readers of books.</p>
</div>
`;

test("preview renders table, mermaid, and HTML card instead of source dump", () => {
  const html = markdownToHtml(MIXED);
  assert.match(html, /<table>/);
  assert.match(html, /<td>Okumak<\/td>/);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /class="mermaid-node">Artan anlayış</);
  assert.match(html, /class="mermaid-edge-label">never enough</);
  assert.match(html, /HOW TO READ A BOOK/);
  assert.match(html, /<strong>Kitabın adresi:<\/strong>/);
  assert.doesNotMatch(html, /<p>flowchart/);
  assert.doesNotMatch(html, /&lt;div style=/);
  assert.doesNotMatch(html, /<p>&lt;div/);
  const plain = previewPlainText(MIXED);
  assert.match(plain, /Artan anlayış/);
  assert.match(plain, /HOW TO READ A BOOK/);
  assert.doesNotMatch(plain, /flowchart LR/);
  assert.doesNotMatch(plain, /<div style=/);
});

test("fenced mermaid and html render, scripts are stripped", () => {
  const html = markdownToHtml(`\`\`\`mermaid
flowchart LR
A["Bir"] --> B["İki"]
\`\`\`

\`\`\`html
<div class="card">Kart <script>alert(1)</script><img src="x" onerror="evil()"></div>
\`\`\`
`);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /class="mermaid-node">Bir</);
  assert.match(html, /class="card"/);
  assert.match(html, />Kart </);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a rel="noreferrer">x</a>');
});

test("default templates and prompts forbid trailing mermaid or HTML junk", () => {
  for (const tpl of DEFAULT_TEMPLATES) {
    assert.match(tpl.body, /return only the table/);
    assert.match(tpl.body, /mermaid/i);
    assert.match(tpl.bodyTr, /yalnızca tabloyu ver/);
  }
  const prompt = buildTableAiPrompt({
    template: DEFAULT_TEMPLATES[0].body,
    tableLocale: "tr",
    title: "Deneme",
    sourceLabel: "selection",
    sourceText: "Seçilen cümle.",
  });
  assert.match(prompt, /Do not append Mermaid/);
  assert.match(prompt, /return only the table/);
});

test("Özgür/none is not a stored template; Tabulect resolve falls back", () => {
  assert.equal(isNoneTemplate(""), true);
  assert.equal(isNoneTemplate("none"), true);
  assert.equal(isNoneTemplate("tpl-none"), true);
  assert.equal(isNoneTemplate("tpl-selection-table"), false);
  assert.equal(templateById(DEFAULT_TEMPLATES, ""), null);
  assert.equal(templateById(DEFAULT_TEMPLATES, "tpl-none"), null);
  assert.equal(resolveTableTemplate(DEFAULT_TEMPLATES, "").id, DEFAULT_TABLE_TEMPLATE_ID);
  assert.equal(resolveTableTemplate(DEFAULT_TEMPLATES, "tpl-none").id, DEFAULT_TABLE_TEMPLATE_ID);
});

test("saved builtin templates refresh stale bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-tpl-"));
  await writeFile(
    join(root, "templates.json"),
    JSON.stringify({
      templates: [
        {
          id: "tpl-selection-table",
          name: "Seçim → tablo",
          builtin: true,
          scope: "selection",
          body: "Seçili metni tabloya dönüştür.",
        },
      ],
    }),
    "utf8",
  );
  const list = await loadTemplates(root);
  const selection = list.find((item) => item.id === "tpl-selection-table");
  assert.match(selection.body, /return only the table/);
  assert.equal(selection.customized, false);
  assert.doesNotMatch(selection.body, /^Seçili metni tabloya dönüştür\.$/);
});

test("built-in prompts are English by default, Turkish on request, editable and resettable", async () => {
  const { localizeTemplates, resetTemplate, upsertTemplate, templateBody } = await import("../lib/templates.mjs");
  const root = await mkdtemp(join(tmpdir(), "tr-tpl-"));
  const base = await loadTemplates(root);
  const en = localizeTemplates(base, "en").find((t) => t.id === "tpl-selection-table");
  const tr = localizeTemplates(base, "tr").find((t) => t.id === "tpl-selection-table");
  assert.match(en.body, /^Turn the selected text/);
  assert.match(tr.body, /^Seçili metni/);
  // Saving the Turkish default unchanged does not mark it customized.
  let list = await upsertTemplate({ id: "tpl-selection-table", name: tr.name, body: tr.body }, root);
  assert.equal(list.find((t) => t.id === "tpl-selection-table").customized, false);
  list = await upsertTemplate({ id: "tpl-selection-table", name: "Mine", body: "My own prompt." }, root);
  const mine = list.find((t) => t.id === "tpl-selection-table");
  assert.equal(mine.customized, true);
  assert.equal(templateBody(mine, "tr"), "My own prompt.");
  list = await resetTemplate("tpl-selection-table", root);
  const reset = list.find((t) => t.id === "tpl-selection-table");
  assert.equal(reset.customized, false);
  assert.match(templateBody(reset, "en"), /^Turn the selected text/);
});

test("html pdf docx keep rendered mermaid and HTML card text", () => {
  const html = renderPreviewHtml("Deneme", MIXED);
  assert.match(html, /<table>/);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /HOW TO READ A BOOK/);
  assert.doesNotMatch(html, /&lt;div style=/);

  const pdf = contentToPdf("Deneme", MIXED).toString("latin1");
  assert.match(pdf, /Artan anlayis|Artan anlayış|Artan anlay/);
  assert.match(pdf, /HOW TO READ A BOOK/);
  assert.doesNotMatch(pdf, /flowchart LR/);
  assert.doesNotMatch(pdf, /\? Yazili soz[^\n]*Artan/);

  const xml = contentToDocxXml("Deneme", MIXED);
  assert.match(xml, /Artan anlayış/);
  assert.match(xml, /HOW TO READ A BOOK/);
  assert.match(xml, /<w:tbl>/);
  assert.doesNotMatch(xml, /flowchart LR/);
  assert.doesNotMatch(xml, /&lt;div style=/);
});
