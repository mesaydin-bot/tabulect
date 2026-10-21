import assert from "node:assert/strict";
import { chmod, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { resetPersistentSessions } from "../lib/providers/persistent.mjs";
afterEach(() => resetPersistentSessions());
import { joinOutput as joinMjs, normalizeOutputMode, OUTPUT_SEPARATOR } from "../lib/output-mode.mjs";
import { joinOutput as joinTs } from "../../src/reader/output-mode.ts";
import { createFillJob } from "../lib/ingest.mjs";
import { loadDocument, saveDocument } from "../lib/store.mjs";
import { runTableAiJob } from "../lib/table-ai.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

function sampleDoc(id, extra = {}) {
  return {
    id,
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
    ...extra,
  };
}

test("joinOutput matches on frontend and sidecar", () => {
  assert.equal(normalizeOutputMode("append"), "append");
  assert.equal(normalizeOutputMode("new"), "new");
  assert.equal(normalizeOutputMode("nope"), "new");
  assert.equal(joinMjs("", "# a"), "# a");
  assert.equal(joinMjs("# a\n", "# b"), `# a${OUTPUT_SEPARATOR}# b`);
  assert.equal(joinMjs("# a", ""), "# a");
  assert.equal(joinTs("# bir", "# iki"), joinMjs("# bir", "# iki"));
  assert.match(joinMjs("tablo 1", "tablo 2"), /\n\n---\n\n/);
});

test("append mode concatenates two Tabulect answers into outputs[0]", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const data = await mkdtemp(join(tmpdir(), "tr-append-"));
  const doc = sampleDoc("doc-append");
  await saveDocument(doc, data);
  const first = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(first, {
    dataRoot: data,
    request: { allBookmarks: true, tableLocale: "tr", templateId: "tpl-bookmarks-table" },
  });
  assert.equal(first.error, null);
  const afterFirst = await loadDocument(doc.id, data);
  const answer1 = afterFirst.outputs[0].content;
  assert.match(answer1, /Ana fikir/);
  assert.doesNotMatch(answer1, /\n\n---\n\n/);

  const second = createFillJob({
    documentId: doc.id,
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(second, {
    dataRoot: data,
    request: {
      allBookmarks: true,
      tableLocale: "tr",
      templateId: "tpl-bookmarks-table",
      append: true,
      baseContent: answer1,
    },
  });
  assert.equal(second.error, null);
  const combined = (await loadDocument(doc.id, data)).outputs[0].content;
  const parts = combined.split(OUTPUT_SEPARATOR);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], answer1.trim());
  assert.match(parts[1], /Ana fikir/);
  assert.ok(combined.startsWith(answer1.trim()));
  delete process.env.TABULECT_CLI_CODEX;
});

test("new mode replaces the stored output", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const data = await mkdtemp(join(tmpdir(), "tr-new-"));
  await saveDocument(
    sampleDoc("doc-new", {
      outputs: [
        {
          id: "out-old",
          title: "eski",
          format: "markdown",
          content: "SADECE_ESKI_CEVAP",
          createdAt: "2026-09-17T00:00:00.000Z",
          source: "selection",
          templateId: "",
        },
      ],
    }),
    data,
  );
  const job = createFillJob({
    documentId: "doc-new",
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(job, {
    dataRoot: data,
    request: { allBookmarks: true, tableLocale: "tr", templateId: "tpl-bookmarks-table", append: false },
  });
  const latest = (await loadDocument("doc-new", data)).outputs[0].content;
  assert.doesNotMatch(latest, /SADECE_ESKI_CEVAP/);
  assert.match(latest, /Ana fikir/);
  delete process.env.TABULECT_CLI_CODEX;
});

test("instruction append uses the previous draft as the prefix", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const data = await mkdtemp(join(tmpdir(), "tr-instr-append-"));
  await saveDocument(sampleDoc("doc-instr-append"), data);
  const job = createFillJob({
    documentId: "doc-instr-append",
    provider: "codex",
    tableLocale: "tr",
    kind: "table-ai",
    model: "",
  });
  await runTableAiJob(job, {
    dataRoot: data,
    request: {
      source: "instruction",
      instruction: "özetle",
      append: true,
      baseContent: "# önceki\n\nkalan metin",
      tableLocale: "tr",
    },
  });
  assert.equal(job.error, null);
  const content = (await loadDocument("doc-instr-append", data)).outputs[0].content;
  assert.match(content, /^# önceki\n\nkalan metin\n\n---\n\n/);
  assert.match(content, /özetle/);
  delete process.env.TABULECT_CLI_CODEX;
});

test("command bar exposes Ekle/Yeni without mixing it into Yeni sohbet", async () => {
  const bar = await readFile(join(root, "src/components/CommandBar.tsx"), "utf8");
  assert.match(bar, /chrome\.outputAppend/);
  assert.match(bar, /chrome\.outputNew/);
  assert.match(bar, /disabled=\{pending\}/);
  assert.match(bar, /onOutputMode\("append"\)/);
  assert.match(bar, /onOutputMode\("new"\)/);
  assert.match(bar, /chrome\.outputNewChat/);
  assert.match(bar, /output-mode/);
});

test("finishTableJob samples output mode at submit and skips draft reloads mid-job", async () => {
  const src = await readFile(join(root, "src/state/useDocument.ts"), "utf8");
  const finish = src.slice(src.indexOf("const finishTableJob"), src.indexOf("const runTableAi"));
  assert.match(finish, /outputModeRef\.current === "append"/);
  assert.match(finish, /baseContent: append \? baseContent : undefined/);
  assert.match(src, /if \(!aiPendingRef\.current \|\| switched\)/);
  assert.match(src, /if \(event\.documentId && !aiPendingRef\.current\)/);
  assert.match(src, /tabulect:outputMode|readOutputMode/);
  assert.match(src, /resetChat:/);
  const reset = src.slice(src.indexOf("resetChat:"));
  assert.match(reset, /resetCliSession/);
  assert.doesNotMatch(reset.slice(0, 400), /setOutputDraft\(""\)/);
});

test("append keeps the right pane visible while the next answer is pending", async () => {
  const pane = await readFile(join(root, "src/components/OutputPane.tsx"), "utf8");
  assert.match(pane, /keepDraft = outputMode === "append"/);
  assert.match(pane, /pending && !keepDraft/);
  assert.match(pane, /chrome\.outputAppending/);
});
