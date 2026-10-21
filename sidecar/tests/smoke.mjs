#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SERVER = join(ROOT, "server.mjs");
const FAKE = join(HERE, "fixtures/fake-codex.mjs");
const SAMPLE = join(HERE, "fixtures/sample.md");
const PORT = Number.parseInt(process.env.TABULECT_SMOKE_PORT || "18755", 10);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const TOKEN = "smoke".padEnd(48, "x");
const rawFetch = globalThis.fetch.bind(globalThis);
// Every non-/health route needs the per-launch session token (lib/http-guard.mjs).
globalThis.fetch = (url, init = {}) => {
  if (String(url).startsWith(BASE)) {
    const headers = new Headers(init.headers || {});
    if (!headers.has("x-tabulect-token")) headers.set("x-tabulect-token", TOKEN);
    return rawFetch(url, { ...init, headers });
  }
  return rawFetch(url, init);
};

function fail(message) {
  throw new Error(message);
}

async function waitForHealth(child, timeoutMs = 8000) {
  const start = Date.now();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null) {
      fail(`server exited ${child.exitCode} before listen. stderr=${stderr}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.ok === true && body.service === "tabulect") return body;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`health timed out. stderr=${stderr}`);
}

async function readSseUntil(url, predicate) {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) fail(`sse ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      const line = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (predicate(event, events)) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return events;
      }
    }
  }
  return events;
}

const dataDir = await mkdtemp(join(tmpdir(), "tr-smoke-"));
await chmod(FAKE, 0o755);

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    TABULECT_HOST: HOST,
    TABULECT_PORT: String(PORT),
    TABULECT_DATA: dataDir,
    TABULECT_CLI_CODEX: FAKE,
    TABULECT_RETRY_BASE_MS: "0",
    TABULECT_TOKEN: TOKEN,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const shutdown = () => {
  if (child.exitCode == null) child.kill("SIGKILL");
};
process.on("exit", shutdown);

try {
  const health = await waitForHealth(child);
  assert.equal(health.ok, true);
  assert.equal(health.service, "tabulect");
  assert.ok(health.ocr);
  assert.equal(health.ocr.languages, "tur+eng");
  assert.equal(health.features?.instruct, "cli");
  assert.equal(health.features?.exportXlsx, true);
  assert.equal(health.features?.documentDelete, true);
  assert.equal(health.features?.continueFill, false);
  assert.equal(health.features?.schemaFill, false);
  assert.equal(health.features?.bookmarks, true);
  assert.equal(health.features?.tableAi, true);
  assert.equal(health.features?.richExport, true);
  assert.equal(health.features?.sessionReuse, true);
  assert.equal(health.features?.folders, true);
  assert.equal(health.features?.notes, true);
  assert.equal(health.features?.corpus, true);
  assert.equal(health.features?.corpusBridge, undefined);

  // Local API hardening: token, Origin, content-type, and save-path checks.
  const noToken = await rawFetch(`${BASE}/documents`);
  assert.equal(noToken.status, 401);
  const evilOrigin = await rawFetch(`${BASE}/session`, { headers: { Origin: "https://evil.example" } });
  assert.equal(evilOrigin.status, 403);
  const crossSite = await rawFetch(`${BASE}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
    body: JSON.stringify({ exportDir: "/tmp" }),
  });
  assert.equal(crossSite.status, 403);
  const session = await rawFetch(`${BASE}/session`).then((r) => r.json());
  assert.equal(session.token, TOKEN);
  const textPlain = await fetch(`${BASE}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ exportDir: "/tmp" }),
  });
  assert.equal(textPlain.status, 415);
  const rebinding = await new Promise((resolve, reject) => {
    import("node:http").then(({ request }) => {
      const req = request({ host: HOST, port: PORT, path: "/session", headers: { Host: `attacker.example:${PORT}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
  });
  assert.equal(rebinding, 403);
  const arbitrarySave = await fetch(`${BASE}/output/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "md", title: "x", content: "# x", directory: join(dataDir, "elsewhere") }),
  });
  assert.equal(arbitrarySave.status, 400);
  assert.equal(health.features?.isolatedFill, true);
  assert.ok(health.features?.schemaBatchSize >= 1);
  assert.ok(health.features?.fillConcurrency >= 1);

  const missing = await fetch(`${BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "x.md",
      text: "hello",
      provider: "kimi",
      tableLocale: "tr",
    }),
  });
  assert.equal(missing.status, 202);
  const missingJob = await missing.json();
  const missingEvents = await readSseUntil(
    `${BASE}/ingest/${missingJob.jobId}/events`,
    (e) => e.phase === "error" || e.phase === "done",
  );
  const extracted = missingEvents.at(-1);
  assert.equal(extracted.phase, "done", "ingest no longer requires a CLI");
  assert.ok(extracted.documentId);

  const text = await readFile(SAMPLE, "utf8");
  const started = await fetch(`${BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "sample.md",
      text,
      provider: "codex",
      tableLocale: "tr",
    }),
  });
  assert.equal(started.status, 202);
  const { jobId } = await started.json();
  const events = await readSseUntil(
    `${BASE}/ingest/${jobId}/events`,
    (e) => e.phase === "done" || e.phase === "error",
  );
  const phases = events.map((e) => e.phase);
  for (const need of ["queued", "extract", "ocr", "chunk", "done"]) {
    assert.ok(phases.includes(need), `missing phase ${need}: ${phases.join(",")}`);
  }
  assert.ok(!phases.includes("schema"), "ingest must not run book-wide schema fill");
  const done = events.at(-1);
  assert.equal(done.phase, "done");
  assert.ok(done.documentId);
  const statusRes = await fetch(`${BASE}/ingest/${jobId}`);
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.jobId, jobId);
  assert.equal(status.finished, true);
  assert.equal(status.documentId, done.documentId);
  assert.equal(status.phase, "done");
  assert.ok(Array.isArray(status.events));

  const docRes = await fetch(`${BASE}/documents/${done.documentId}`);
  assert.equal(docRes.status, 200);
  const doc = await docRes.json();
  assert.equal(doc.tableLocale, "tr");
  assert.equal(doc.sourceType, "md");
  assert.ok(doc.chunks.length >= 1);
  assert.equal(doc.rows.length, 0);
  assert.ok(Array.isArray(doc.bookmarks));
  assert.equal(doc.bookmarks.length, 0);

  const list = await fetch(`${BASE}/documents`).then((r) => r.json());
  assert.ok(list.documents.some((d) => d.id === doc.id));
  const listed = list.documents.find((d) => d.id === doc.id);
  assert.equal(listed.title, doc.title);
  assert.equal(listed.rowCount, 0);
  assert.equal(listed.chunkCount, doc.chunks.length);
  assert.equal(listed.bookmarkCount, 0);
  assert.ok(listed.updatedAt);

  const addedBm = await fetch(`${BASE}/documents/${doc.id}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunkId: doc.chunks[0].id,
      start: 0,
      end: Math.min(40, doc.chunks[0].text.length),
      page: doc.chunks[0].page,
      text: doc.chunks[0].text.slice(0, 40),
    }),
  });
  assert.equal(addedBm.status, 200);
  const bmBody = await addedBm.json();
  assert.ok(bmBody.bookmark?.id);
  assert.equal(bmBody.document.bookmarks.length, 1);

  const templates = await fetch(`${BASE}/templates`).then((r) => r.json());
  assert.ok(templates.templates.some((item) => item.id === "tpl-selection-table"));

  const tablo = await fetch(`${BASE}/table-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: doc.id,
      provider: "codex",
      tableLocale: "tr",
      templateId: "tpl-selection-table",
      selection: { text: doc.chunks[0].text },
    }),
  });
  assert.equal(tablo.status, 202);
  const tableJob = await tablo.json();
  const tableEvents = await readSseUntil(
    `${BASE}/ingest/${tableJob.jobId}/events`,
    (e) => e.phase === "done" || e.phase === "error",
  );
  assert.equal(tableEvents.at(-1).phase, "done");
  const afterAi = await fetch(`${BASE}/documents/${doc.id}`).then((r) => r.json());
  assert.ok(afterAi.outputs?.[0]?.content);

  const missingAi = await fetch(`${BASE}/table-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: doc.id,
      provider: "kimi",
      tableLocale: "tr",
      selection: { text: "kısa seçim" },
    }),
  });
  assert.equal(missingAi.status, 400);
  const missingAiBody = await missingAi.json();
  assert.match(String(missingAiBody.error || ""), /Kimi|not found|not logged|unavailable/i);

  const exportedMd = await fetch(`${BASE}/output/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: "html",
      title: "Cikti",
      content: afterAi.outputs[0].content,
    }),
  });
  assert.equal(exportedMd.status, 200);
  assert.match(exportedMd.headers.get("content-type") || "", /html/);

  const form = new FormData();
  form.set(
    "file",
    new Blob(["# Multipart\n\nBu dosya form-data ile geldi."], { type: "text/markdown" }),
    "multipart.md",
  );
  form.set("provider", "codex");
  form.set("tableLocale", "en");
  const multi = await fetch(`${BASE}/ingest`, { method: "POST", body: form });
  assert.equal(multi.status, 202);
  const multiJob = await multi.json();
  const multiEvents = await readSseUntil(
    `${BASE}/ingest/${multiJob.jobId}/events`,
    (e) => e.phase === "done" || e.phase === "error",
  );
  assert.equal(multiEvents.at(-1).phase, "done");
  const multiDoc = await fetch(`${BASE}/documents/${multiEvents.at(-1).documentId}`).then((r) => r.json());
  assert.equal(multiDoc.tableLocale, "en");
  assert.equal(multiDoc.sourceType, "md");

  const viaPath = await fetch(`${BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: SAMPLE,
      filename: "sample.md",
      provider: "codex",
      tableLocale: "tr",
    }),
  });
  assert.equal(viaPath.status, 202);
  const pathJob = await viaPath.json();
  const pathEvents = await readSseUntil(
    `${BASE}/ingest/${pathJob.jobId}/events`,
    (e) => e.phase === "done" || e.phase === "error",
  );
  assert.equal(pathEvents.at(-1).phase, "done");

  const badInstruct = await fetch(`${BASE}/instruct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: "", instruction: "", tableLocale: "tr" }),
  });
  assert.equal(badInstruct.status, 400);
  const badLocale = await fetch(`${BASE}/instruct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: doc.id,
      instruction: "hide objection",
      tableLocale: "de",
    }),
  });
  assert.equal(badLocale.status, 400);
  const missingInstruct = await fetch(`${BASE}/instruct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: "00000000-0000-0000-0000-000000000000",
      instruction: "hide objection",
      tableLocale: "tr",
    }),
  });
  assert.equal(missingInstruct.status, 404);
  const okInstruct = await fetch(`${BASE}/instruct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: doc.id,
      instruction: "hide objection",
      tableLocale: "en",
    }),
  });
  assert.equal(okInstruct.status, 200);
  const instructed = await okInstruct.json();
  assert.equal(instructed.ok, true);
  assert.ok(Array.isArray(instructed.applied));
  assert.ok(!instructed.applied.includes("instruction-accepted"));
  assert.ok(instructed.applied.some((line) => /hide|objection|gizle|itiraz/i.test(line)));
  assert.equal(instructed.ui?.columnVisibility?.objection, false);
  assert.equal(instructed.document?.id, doc.id);

  const exported = await fetch(`${BASE}/documents/${doc.id}/export.xlsx`);
  if (exported.status !== 200) {
    const detail = await exported.text();
    fail(`export.xlsx ${exported.status}: ${detail}`);
  }
  assert.match(exported.headers.get("content-type") || "", /spreadsheetml|xlsx/);
  const xlsxBuf = Buffer.from(await exported.arrayBuffer());
  assert.ok(xlsxBuf.slice(0, 2).equals(Buffer.from("PK")));
  assert.ok(xlsxBuf.length > 200);

  const missingExport = await fetch(`${BASE}/documents/00000000-0000-0000-0000-000000000000/export.xlsx`);
  assert.equal(missingExport.status, 404);
  const missingExportBody = await missingExport.json();
  assert.match(missingExportBody.error, /not found/i);

  const renamed = await fetch(`${BASE}/documents/${doc.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Yeniden adlandırıldı" }),
  });
  assert.equal(renamed.status, 200);
  const renamedDoc = await renamed.json();
  assert.equal(renamedDoc.title, "Yeniden adlandırıldı");
  const reloaded = await fetch(`${BASE}/documents/${doc.id}`).then((r) => r.json());
  assert.equal(reloaded.title, "Yeniden adlandırıldı");

  const deleted = await fetch(`${BASE}/documents/${multiDoc.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const deletedBody = await deleted.json();
  assert.equal(deletedBody.ok, true);
  assert.equal(deletedBody.id, multiDoc.id);
  const gone = await fetch(`${BASE}/documents/${multiDoc.id}`);
  assert.equal(gone.status, 404);
  const afterDelete = await fetch(`${BASE}/documents`).then((r) => r.json());
  assert.ok(afterDelete.documents.every((d) => d.id !== multiDoc.id));
  assert.ok(afterDelete.documents.some((d) => d.id === doc.id));

  const folder = await fetch(`${BASE}/note-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Okuma" }),
  });
  assert.equal(folder.status, 200);
  const folderBody = await folder.json();
  assert.ok(folderBody.folder?.id);
  const createdNote = await fetch(`${BASE}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Adler defteri",
      body: "# Adler\n\nYavaş okumak bir yapı işidir.",
      folderId: folderBody.folder.id,
    }),
  });
  assert.equal(createdNote.status, 200);
  const noteJson = await createdNote.json();
  assert.equal(noteJson.note.title, "Adler defteri");
  assert.equal(noteJson.note.folderId, folderBody.folder.id);
  const patchedNote = await fetch(`${BASE}/notes/${noteJson.note.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "# Adler\n\nBu cümle yalnızca notta geçer." }),
  });
  assert.equal(patchedNote.status, 200);
  const noteExport = await fetch(`${BASE}/notes/${noteJson.note.id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "html" }),
  });
  assert.equal(noteExport.status, 200);
  assert.match(noteExport.headers.get("content-type") || "", /html/);
  const corpusGone = await fetch(`${BASE}/corpus/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "yalnızca notta" }),
  });
  assert.equal(corpusGone.status, 404);

  const missingDelete = await fetch(`${BASE}/documents/${multiDoc.id}`, { method: "DELETE" });
  assert.equal(missingDelete.status, 404);
  const badDelete = await fetch(`${BASE}/documents/../secret`, { method: "DELETE" });
  assert.ok(badDelete.status === 400 || badDelete.status === 404);

  console.log("smoke ok");
  console.log(`document ${doc.id} bookmarks=${afterAi.bookmarks.length} chunks=${doc.chunks.length}`);
} finally {
  shutdown();
}
