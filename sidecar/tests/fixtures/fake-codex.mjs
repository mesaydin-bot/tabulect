#!/usr/bin/env node
/**
 * Test double for a subscription CLI. Not shipped as a product provider.
 * Reads the prompt from stdin or a trailing file path and emits schema JSON.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("app-server")) {
  const { serve } = await import("./fake-persistent.mjs");
  await serve(import.meta.url);
  process.exit(0);
}
if (args.includes("login") || args.includes("status")) {
  process.stdout.write("logged in\n");
  process.exit(0);
}
if (args.includes("--version")) {
  process.stdout.write("fake-codex 0.0.1\n");
  process.exit(0);
}

let prompt = "";
try {
  prompt = readFileSync(0, "utf8");
} catch {
  prompt = "";
}
if (!prompt.trim()) {
  const file = args.find((a) => a.endsWith(".txt")) || args.at(-1);
  if (file && !file.startsWith("-")) {
    try {
      prompt = readFileSync(file, "utf8");
    } catch {
      prompt = "";
    }
  }
}

if (process.env.FAKE_CODEX_LIVE) {
  const livePath = process.env.FAKE_CODEX_LIVE;
  appendFileSync(livePath, `start ${Date.now()} ${process.pid}\n`);
}

const sleep = Number.parseInt(process.env.FAKE_CODEX_SLEEP_MS || "0", 10);
if (Number.isFinite(sleep) && sleep > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep);
}

if (process.env.FAKE_CODEX_LIVE) {
  appendFileSync(process.env.FAKE_CODEX_LIVE, `end ${Date.now()} ${process.pid}\n`);
}

if (process.env.FAKE_CODEX_EMPTY === "1") {
  process.exit(0);
}

if (process.env.FAKE_CODEX_RATE_LIMIT === "1") {
  process.stderr.write("rate limit\n");
  process.exit(1);
}

if (process.env.FAKE_CODEX_REQUIRE_TRUST === "1") {
  if (!args.includes("--trust")) {
    process.stderr.write("Workspace Trust: Do you trust this folder? pass --trust\n");
    process.exit(1);
  }
}

if (process.env.FAKE_CODEX_REQUIRE_TTY === "1") {
  const term = String(process.env.TERM || "");
  if (!term || term === "dumb") {
    process.stderr.write("Error: TERM=dumb / not a TTY. Refusing to run.\n");
    process.exit(1);
  }
}

if (process.env.FAKE_CODEX_COUNTER) {
  let n = 0;
  try {
    n = Number(readFileSync(process.env.FAKE_CODEX_COUNTER, "utf8")) || 0;
  } catch {
    n = 0;
  }
  n += 1;
  writeFileSync(process.env.FAKE_CODEX_COUNTER, String(n));
  const failAfter = Number(process.env.FAKE_CODEX_FAIL_AFTER || 0);
  if (failAfter > 0 && n > failAfter) {
    process.stderr.write("fake-codex: forced fail after first batch\n");
    process.exit(1);
  }
}

if (process.env.FAKE_CODEX_INVALID === "1") {
  process.stdout.write("not json at all\n");
  process.exit(0);
}

if (args.includes("resume") && process.env.FAKE_CODEX_BAD_RESUME === "1") {
  process.stderr.write("unknown session: cannot resume\n");
  process.exit(1);
}

if (process.env.FAKE_CODEX_PROMPT_OUT) {
  try {
    writeFileSync(process.env.FAKE_CODEX_PROMPT_OUT, prompt);
  } catch {
    /* ignore */
  }
}

if (/TABLE_AI/.test(prompt)) {
  const source = (prompt.match(/SOURCE_BEGIN\s*([\s\S]*?)\s*SOURCE_END/) || [])[1] || "";
  const excerpt = source.replace(/\s+/g, " ").trim().slice(0, 80) || "kaynak";
  process.stderr.write(`${JSON.stringify({ session_id: "sess-table-1" })}\n`);
  if (/SOURCE_KIND: instruction/.test(prompt)) {
    const lib = (prompt.match(/LIBRARY_INDEX_BEGIN\s*([\s\S]*?)\s*LIBRARY_INDEX_END/) || [])[1] || "";
    const instr =
      (prompt.match(/INSTRUCTION:\n([\s\S]*?)\n\n(?:CURRENT_DOCUMENT:|LIBRARY_INDEX)/) || [])[1] || "";
    process.stdout.write(`# ${instr.trim() || "yönerge"}\n\n${lib.trim()}\n`);
    process.exit(0);
  }
  process.stdout.write(
    `| Ana fikir | Gerekçe | Örnek | Pratik öneri |\n| --- | --- | --- | --- |\n| ${excerpt} | Metindeki gerekçe | Kaynaktan örnek | Okurken uygula |\n`,
  );
  process.exit(0);
}

if (/INSTRUCT_MUTATION_SCHEMA/.test(prompt)) {
  const instruction =
    (prompt.match(/INSTRUCTION_VERBATIM_BEGIN\s*([\s\S]*?)\s*INSTRUCTION_VERBATIM_END/) || [])[1]?.trim() ||
    "applied";
  const rowIds = [...prompt.matchAll(/ROW (r-\d+)/g)].map((m) => m[1]);
  const first = rowIds[0] || "r-001";
  process.stdout.write(
    JSON.stringify({
      applied: [`CLI: ${instruction.slice(0, 80)}`],
      updatedCells: [
        {
          rowId: first,
          key: "claim",
          value: `Yönerge uygulandı: ${instruction.slice(0, 160)}`,
        },
      ],
    }),
  );
  process.exit(0);
}
if (process.env.FAKE_CODEX_LOGGED_OUT === "1") {
  process.stderr.write("Error: not logged in\n");
  process.exit(1);
}

const paired = [...prompt.matchAll(/ROW (r-\d+)\s+CHUNK (c-\d+)/g)].map((m) => ({
  rowId: m[1],
  chunkId: m[2],
}));
const chunkIds = [...new Set([...prompt.matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
const targets = paired.length
  ? paired
  : chunkIds.map((chunkId) => ({ rowId: null, chunkId }));
if (targets.length === 0) {
  process.stderr.write("fake-codex: no chunks in prompt\n");
  process.exit(1);
}

if (process.env.FAKE_CODEX_SKIP_IDS) {
  const skip = new Set(
    String(process.env.FAKE_CODEX_SKIP_IDS)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (targets.some((item) => skip.has(item.chunkId))) {
    process.stderr.write("empty output\n");
    process.exit(0);
  }
}

const rows = targets.map(({ rowId, chunkId }) => {
  const marker = rowId ? `ROW ${rowId} CHUNK ${chunkId}` : `CHUNK ${chunkId}`;
  const block = prompt.split(marker)[1] || prompt.split(`CHUNK ${chunkId}`)[1] || "";
  const body = block.split("---")[1] || block;
  const sentence = body.replace(/\s+/g, " ").trim().slice(0, 160);
  const tip = sentence ? `Metindeki pratik: ${sentence.slice(0, 100)}` : "";
  const row = {
    chunkId,
    claim: sentence || `claim from ${chunkId}`,
    warrant: "Metindeki gerekçe",
    fact: sentence.slice(0, 80),
    example: "",
    definition: "",
    exception: "",
    openQuestion: "",
    citation: "",
    practicalSuggestion: tip,
    objection: null,
    quoteStart: 0,
    quoteEnd: Math.min(40, sentence.length),
  };
  if (rowId) row.rowId = rowId;
  return row;
});

process.stdout.write(JSON.stringify({ rows }));
