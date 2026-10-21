import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyInstruct, isPracticalAddOnly, isPureVisibilityToggle, parseInstruction } from "../lib/instruct.mjs";
import { ensureStore, loadDocument, saveDocument } from "../lib/store.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");
const FAKE_INVALID = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex-invalid.mjs");

const chunk = { id: "c-001", text: "Okumak bir hız yarışı değildir. Tempo düşünce bağlanır.", page: 1, start: 0, end: 56 };
const row = {
  id: "r-001",
  chunkId: "c-001",
  quoteAnchor: { chunkId: "c-001", start: 0, end: 28, page: 1, bbox: null },
  claim: "Okumak hız yarışı değildir",
  warrant: "w",
  fact: "f",
  example: "",
  definition: "",
  exception: "",
  openQuestion: "",
  citation: "",
  practicalSuggestion: "",
  objection: null,
};

function sampleDoc(id, extra = {}) {
  return {
    id,
    title: "Deneme",
    sourceType: "md",
    tableLocale: "tr",
    lastProvider: "codex",
    chunks: [chunk],
    rows: [{ ...row, ...extra.row }],
    ...extra.doc,
  };
}

test("parse hide/show for known columns in Turkish and English", () => {
  assert.deepEqual(parseInstruction("hide objection").actions, [
    { type: "hide", column: "objection" },
  ]);
  assert.deepEqual(parseInstruction("objection gizle").actions, [
    { type: "hide", column: "objection" },
  ]);
  assert.deepEqual(parseInstruction("itirazı kapat").actions, [
    { type: "hide", column: "objection" },
  ]);
  assert.deepEqual(parseInstruction("show citation").actions, [
    { type: "show", column: "citation" },
  ]);
  assert.deepEqual(parseInstruction("alıntı göster").actions, [
    { type: "show", column: "citation" },
  ]);
  assert.deepEqual(parseInstruction("sayfa sütununu gizle").actions, [
    { type: "hide", column: "page" },
  ]);
  assert.deepEqual(parseInstruction("hide page").actions, [
    { type: "hide", column: "page" },
  ]);
  assert.deepEqual(parseInstruction("hide row number").actions, [
    { type: "hide", column: "rowNumber" },
  ]);
  assert.deepEqual(parseInstruction("# gizle").actions, [
    { type: "hide", column: "rowNumber" },
  ]);
});

test("parse add practical tips phrases", () => {
  for (const phrase of [
    "pratik öneriler sütunu ekle",
    "pratik öneriler",
    "add practical tips column",
    "add practical suggestions",
  ]) {
    const parsed = parseInstruction(phrase);
    assert.deepEqual(parsed.actions, [{ type: "add", column: "practicalSuggestion" }], phrase);
  }
});

test("parse combined hide and add", () => {
  const parsed = parseInstruction("hide objection and add practical tips");
  const byType = Object.fromEntries(parsed.actions.map((a) => [a.column, a.type]));
  assert.equal(byType.objection, "hide");
  assert.equal(byType.practicalSuggestion, "add");
});

test("unrecognized instruction has no local actions and is not a chrome toggle", () => {
  const parsed = parseInstruction("make it nicer");
  assert.equal(parsed.actions.length, 0);
  assert.equal(parsed.error, "unrecognized");
  assert.equal(isPureVisibilityToggle("make it nicer", parsed.actions), false);
});

test("pure show/hide is local; leftover freeform is not", () => {
  assert.equal(isPureVisibilityToggle("hide objection", parseInstruction("hide objection").actions), true);
  assert.equal(isPureVisibilityToggle("sayfa sütununu gizle", parseInstruction("sayfa sütununu gizle").actions), true);
  assert.equal(
    isPureVisibilityToggle(
      "hide objection and rewrite every claim",
      parseInstruction("hide objection and rewrite every claim").actions,
    ),
    false,
  );
  assert.equal(
    isPracticalAddOnly("pratik öneriler sütunu ekle", parseInstruction("pratik öneriler sütunu ekle").actions),
    true,
  );
});

test("applyInstruct hide objection returns UI hint and does not stub", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-instruct-hide-"));
  await saveDocument(sampleDoc("doc-hide"), root);
  const result = await applyInstruct({
    documentId: "doc-hide",
    instruction: "hide objection",
    tableLocale: "en",
    dataRoot: root,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ui.columnVisibility.objection, false);
  assert.ok(result.applied.some((line) => /hide|objection/i.test(line)));
  assert.ok(!result.applied.includes("instruction-accepted"));
  assert.equal(result.jobId, undefined);
});

test("applyInstruct hide page returns UI hint for the chrome column", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-instruct-page-"));
  await saveDocument(sampleDoc("doc-page"), root);
  const result = await applyInstruct({
    documentId: "doc-page",
    instruction: "sayfa sütununu gizle",
    tableLocale: "tr",
    dataRoot: root,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ui.columnVisibility.page, false);
  assert.ok(result.applied.some((line) => /sayfa|page/i.test(line)));
});

test("applyInstruct add practical tips creates the field and starts a fill job", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const root = await mkdtemp(join(tmpdir(), "tr-instruct-add-"));
  const paths = await ensureStore(root);
  const legacy = sampleDoc("doc-add");
  delete legacy.rows[0].practicalSuggestion;
  await writeFile(join(paths.documents, "doc-add.json"), JSON.stringify(legacy, null, 2), "utf8");

  const jobs = new Map();
  const result = await applyInstruct({
    documentId: "doc-add",
    instruction: "pratik öneriler sütunu ekle",
    tableLocale: "tr",
    provider: "codex",
    registerJob: (job) => jobs.set(job.jobId, job),
    dataRoot: root,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ui.columnVisibility.practicalSuggestion, true);
  assert.ok("practicalSuggestion" in result.document.rows[0]);
  assert.equal(typeof result.document.rows[0].practicalSuggestion, "string");
  assert.ok(result.applied.some((line) => /pratik|practical/i.test(line)));
  assert.ok(result.jobId);
  const job = jobs.get(result.jobId);
  assert.ok(job);
  const started = Date.now();
  while (!job.finished && Date.now() - started < 15_000) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.finished, true);
  assert.equal(job.events.at(-1).phase, "done");
  const filled = await loadDocument("doc-add", root);
  assert.ok(filled.rows[0].practicalSuggestion);
  assert.match(filled.rows[0].practicalSuggestion, /pratik|Okumak|hız/i);
  delete process.env.TABULECT_CLI_CODEX;
});

test("applyInstruct sends freeform text to the CLI and mutates the table", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const root = await mkdtemp(join(tmpdir(), "tr-instruct-free-"));
  await saveDocument(sampleDoc("doc-free"), root);
  const jobs = new Map();
  const result = await applyInstruct({
    documentId: "doc-free",
    instruction: "please rewrite the first claim so it mentions the instruction",
    tableLocale: "en",
    provider: "codex",
    registerJob: (job) => jobs.set(job.jobId, job),
    dataRoot: root,
  });
  assert.equal(result.ok, true);
  assert.ok(result.jobId);
  assert.ok(!result.applied.includes("instruction-accepted"));
  const job = jobs.get(result.jobId);
  assert.ok(job);
  const started = Date.now();
  while (!job.finished && Date.now() - started < 15_000) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.finished, true);
  assert.equal(job.events.at(-1).phase, "done");
  const filled = await loadDocument("doc-free", root);
  assert.match(filled.rows[0].claim, /Yönerge uygulandı|rewrite the first claim/i);
  delete process.env.TABULECT_CLI_CODEX;
});

test("applyInstruct CLI invalid JSON errors instead of silent success", async () => {
  await chmod(FAKE_INVALID, 0o755);
  const prev = process.env.TABULECT_CLI_CODEX;
  process.env.TABULECT_CLI_CODEX = FAKE_INVALID;
  try {
    const root = await mkdtemp(join(tmpdir(), "tr-instruct-invalid-"));
    await saveDocument(sampleDoc("doc-invalid"), root);
    const jobs = new Map();
    const result = await applyInstruct({
      documentId: "doc-invalid",
      instruction: "turn every warrant into a haiku",
      tableLocale: "en",
      provider: "codex",
      registerJob: (job) => jobs.set(job.jobId, job),
      dataRoot: root,
    });
    assert.equal(result.ok, true);
    assert.ok(result.jobId);
    const job = jobs.get(result.jobId);
    const started = Date.now();
    while (!job.finished && Date.now() - started < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(job.finished, true);
    assert.equal(job.events.at(-1).phase, "error");
    assert.match(job.error || job.events.at(-1).error, /CLI|JSON|usable|geçerli/i);
    const unchanged = await loadDocument("doc-invalid", root);
    assert.equal(unchanged.rows[0].claim, "Okumak hız yarışı değildir");
  } finally {
    if (prev == null) delete process.env.TABULECT_CLI_CODEX;
    else process.env.TABULECT_CLI_CODEX = prev;
  }
});

test("applyInstruct missing document is a clear 404, not a stub", async () => {
  const result = await applyInstruct({
    documentId: "missing-doc",
    instruction: "hide objection",
    tableLocale: "en",
    dataRoot: await mkdtemp(join(tmpdir(), "tr-instruct-miss-")),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(result.error, /not found|bulunamadı/i);
});
