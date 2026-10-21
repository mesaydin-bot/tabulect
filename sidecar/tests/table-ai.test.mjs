import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { resetPersistentSessions } from "../lib/providers/persistent.mjs";
afterEach(() => resetPersistentSessions());
import {
  buildTableAiPrompt,
  detectOutputFormat,
  formatLibraryIndex,
  runTableAiJob,
  sourceFromRequest,
} from "../lib/table-ai.mjs";
import { createFolder, moveDocumentToFolder } from "../lib/folders.mjs";
import { createFillJob } from "../lib/ingest.mjs";
import { saveDocument } from "../lib/store.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

test("table-ai prompt has no camelCase schema keys", () => {
  const prompt = buildTableAiPrompt({
    template: "tablo yap",
    tableLocale: "tr",
    title: "Deneme",
    sourceLabel: "selection",
    sourceText: "Seçilen cümle.",
  });
  assert.match(prompt, /TABLE_AI/);
  assert.match(prompt, /SOURCE_BEGIN/);
  assert.match(prompt, /OPEN_DOCUMENT_ONLY/);
  assert.doesNotMatch(prompt, /ADDITIONAL_SOURCES \(reader/);
  assert.doesNotMatch(prompt, /practicalSuggestion/);
});

test("detects html vs markdown", () => {
  assert.equal(detectOutputFormat("| a | b |\n| --- | --- |\n| 1 | 2 |"), "markdown");
  assert.equal(detectOutputFormat("<table><tr><td>x</td></tr></table>"), "html");
});

test("table-ai writes a freeform output on the document", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const root = await mkdtemp(join(tmpdir(), "tr-ai-"));
  const doc = {
    id: "doc-ai-1",
    title: "Deneme",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [{ id: "c-001", text: "Okumak bir hız yarışı değildir.", page: 1, start: 0, end: 31 }],
    rows: [],
    bookmarks: [
      {
        id: "b-1",
        text: "Okumak bir hız yarışı değildir.",
        chunkId: "c-001",
        start: 0,
        end: 31,
        page: 1,
        createdAt: "2026-09-17T00:00:00.000Z",
        note: "",
        spans: [{ chunkId: "c-001", start: 0, end: 31, page: 1 }],
      },
    ],
    outputs: [],
  };
  await saveDocument(doc, root);
  const job = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(job, {
    dataRoot: root,
    request: { allBookmarks: true, tableLocale: "tr", templateId: "tpl-bookmarks-table" },
  });
  assert.equal(job.error, null);
  assert.ok(job.output?.content.includes("Ana fikir"));
  delete process.env.TABULECT_CLI_CODEX;
});

test("instruction mode never dumps bookmarks and includes a library index", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const promptOut = join(await mkdtemp(join(tmpdir(), "tr-ai-prompt-")), "prompt.txt");
  process.env.FAKE_CODEX_PROMPT_OUT = promptOut;
  const root = await mkdtemp(join(tmpdir(), "tr-ai-instr-"));
  const secret = "YER_IMI_GIZLI_METIN_ASLA_GONDERILMESIN";
  const open = {
    id: "doc-open",
    title: "Açık kitap",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [{ id: "c-001", text: "Okumak bir hız yarışı değildir.", page: 1, start: 0, end: 31 }],
    rows: [],
    bookmarks: [
      {
        id: "b-1",
        text: secret,
        chunkId: "c-001",
        start: 0,
        end: 10,
        page: 1,
        createdAt: "2026-09-17T00:00:00.000Z",
        note: "",
        spans: [{ chunkId: "c-001", start: 0, end: 10, page: 1 }],
      },
    ],
    outputs: [],
  };
  const other = {
    id: "doc-other",
    title: "İkinci kitap",
    sourceType: "md",
    tableLocale: "tr",
    chunks: [{ id: "c-001", text: "başka", page: 1, start: 0, end: 5 }],
    rows: [],
    bookmarks: [],
    outputs: [],
  };
  await saveDocument(open, root);
  await saveDocument(other, root);
  const folder = await createFolder("Klasikler", root);
  await moveDocumentToFolder(other.id, folder.id, root);

  const packed = sourceFromRequest(open, { source: "instruction", instruction: "kitapları listele" });
  assert.equal(packed.source, "instruction");
  assert.doesNotMatch(packed.text, new RegExp(secret));
  assert.doesNotMatch(packed.text, /BOOKMARK/);

  const job = createFillJob({
    documentId: open.id,
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(job, {
    dataRoot: root,
    request: { source: "instruction", instruction: "kitapları listele", allBookmarks: false, tableLocale: "tr" },
  });
  assert.equal(job.error, null);
  assert.equal(job.output?.source, "instruction");
  assert.match(job.output?.content || "", /kitapları listele/);
  assert.match(job.output?.content || "", /İkinci kitap/);
  assert.match(job.output?.content || "", /Klasikler/);
  assert.doesNotMatch(job.output?.content || "", new RegExp(secret));

  const { readFile } = await import("node:fs/promises");
  const prompt = await readFile(promptOut, "utf8");
  assert.match(prompt, /SOURCE_KIND: instruction/);
  assert.match(prompt, /LIBRARY_INDEX_BEGIN/);
  assert.match(prompt, /doc-other \| İkinci kitap/);
  assert.match(prompt, /Klasikler/);
  assert.doesNotMatch(prompt, new RegExp(secret));
  assert.doesNotMatch(prompt, /BOOKMARK/);
  assert.doesNotMatch(prompt, /Do not invent facts that are not in the source/);
  assert.doesNotMatch(prompt, /Tables are welcome/);
  assert.doesNotMatch(prompt, /OPEN_DOCUMENT_EXCERPT/);
  assert.match(prompt, /No source passage attached/);
  assert.doesNotMatch(prompt, /FORMAT_HINT/);

  delete process.env.TABULECT_CLI_CODEX;
  delete process.env.FAKE_CODEX_PROMPT_OUT;
});

test("instruction prompt lists folders and document ids", () => {
  const index = formatLibraryIndex(
    [
      { id: "doc-a", title: "Bir", folderId: "fld-1" },
      { id: "doc-b", title: "İki", folderId: null },
    ],
    [{ id: "fld-1", name: "Okuma" }],
  );
  assert.match(index, /fld-1: Okuma/);
  assert.match(index, /doc-a \| Bir \| folder: Okuma/);
  assert.match(index, /doc-b \| İki \| folder: \(none\)/);
  assert.match(index, /NOTES:/);
  assert.match(index, /\(no notes\)/);
  const prompt = buildTableAiPrompt({
    mode: "instruction",
    instruction: "kitapları listele",
    tableLocale: "tr",
    title: "Açık",
    documentId: "doc-a",
    sourceLabel: "instruction",
    sourceText: "excerpt",
    libraryIndex: index,
  });
  assert.match(prompt, /INSTRUCTION:\nkitapları listele/);
  assert.match(prompt, /LIBRARY_INDEX_BEGIN/);
  assert.match(prompt, /Do not attach or dump bookmarks/);
});

test("instruction-only prompt answers the user question without dumping the open book", () => {
  const prompt = buildTableAiPrompt({
    mode: "instruction",
    instruction:
      "yapay zekanın en iyi anlayacağı, en verimli/zengin içerik ve formatta not tutmak nasıl olmalı",
    tableLocale: "tr",
    title: "How to Read a Book",
    documentId: "doc-open",
    sourceLabel: "instruction",
    sourceText: "",
    libraryIndex: "- doc-open | How to Read a Book",
  });
  assert.match(prompt, /primary task/);
  assert.match(prompt, /INSTRUCTION:\nyapay zekanın en iyi anlayacağı/);
  assert.match(prompt, /Use a table only if the instruction asks for one/);
  assert.match(prompt, /No source passage attached/);
  assert.doesNotMatch(prompt, /Tables are welcome/);
  assert.doesNotMatch(prompt, /OPEN_DOCUMENT_EXCERPT/);
  assert.doesNotMatch(prompt, /\nSOURCE_BEGIN\n/);
  assert.doesNotMatch(prompt, /\nSOURCE_END\n/);
  assert.doesNotMatch(prompt, /FORMAT_HINT/);
  assert.doesNotMatch(prompt, /\nTEMPLATE:/);
  assert.doesNotMatch(prompt, /EXTRA_INSTRUCTION/);
});

test("instruction with an optional template keeps the user question primary", () => {
  const prompt = buildTableAiPrompt({
    mode: "instruction",
    template: "Seçili metni bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe.",
    instruction: "not tutmak nasıl olmalı",
    tableLocale: "tr",
    title: "How to Read a Book",
    sourceLabel: "instruction",
    sourceText: "",
    libraryIndex: "",
  });
  assert.match(prompt, /INSTRUCTION:\nnot tutmak nasıl olmalı/);
  assert.match(prompt, /FORMAT_HINT \(optional shape only; the instruction still wins\)/);
  assert.match(prompt, /Ana fikir/);
  assert.doesNotMatch(prompt, /EXTRA_INSTRUCTION/);
  assert.doesNotMatch(prompt, /Tables are welcome/);
});

test("instruction attaches a yellow selection only, never the open-document dump", () => {
  const dumped = "BU_KITAP_DUMP_OLMAMALI How to Read a Book ana fikir";
  const packed = sourceFromRequest(
    { chunks: [{ text: dumped }], bookmarks: [] },
    { source: "instruction", selection: { text: "sarı seçim" } },
  );
  assert.equal(packed.source, "instruction");
  assert.match(packed.text, /ACTIVE_SELECTION:\nsarı seçim/);
  assert.doesNotMatch(packed.text, /BU_KITAP_DUMP/);
  const empty = sourceFromRequest(
    { chunks: [{ text: dumped }], bookmarks: [{ id: "b-1", text: "yer imi" }] },
    { source: "instruction" },
  );
  assert.equal(empty.text, "");
  assert.doesNotMatch(empty.text, /BU_KITAP_DUMP/);
  assert.doesNotMatch(empty.text, /yer imi/);
});

test("Tabulect with Özgür/empty templateId still uses the default table template", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const promptOut = join(await mkdtemp(join(tmpdir(), "tr-ai-table-none-")), "prompt.txt");
  process.env.FAKE_CODEX_PROMPT_OUT = promptOut;
  const root = await mkdtemp(join(tmpdir(), "tr-ai-table-fallback-"));
  const doc = {
    id: "doc-ai-fallback",
    title: "Deneme",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [{ id: "c-001", text: "Okumak bir hız yarışı değildir.", page: 1, start: 0, end: 31 }],
    rows: [],
    bookmarks: [
      {
        id: "b-1",
        text: "Okumak bir hız yarışı değildir.",
        chunkId: "c-001",
        start: 0,
        end: 31,
        page: 1,
        createdAt: "2026-09-17T00:00:00.000Z",
        note: "",
        spans: [{ chunkId: "c-001", start: 0, end: 31, page: 1 }],
      },
    ],
    outputs: [],
  };
  await saveDocument(doc, root);
  const job = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(job, {
    dataRoot: root,
    request: { allBookmarks: true, tableLocale: "tr", templateId: "" },
  });
  assert.equal(job.error, null);
  assert.ok(job.output?.content.includes("Ana fikir"));
  const { readFile } = await import("node:fs/promises");
  const prompt = await readFile(promptOut, "utf8");
  assert.match(prompt, /TEMPLATE:/);
  assert.match(prompt, /Ana fikir/);
  assert.match(prompt, /SOURCE_BEGIN/);
  assert.doesNotMatch(prompt, /SOURCE_KIND: instruction/);
  assert.doesNotMatch(prompt, /No source passage attached/);
  delete process.env.TABULECT_CLI_CODEX;
  delete process.env.FAKE_CODEX_PROMPT_OUT;
});
