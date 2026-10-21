#!/usr/bin/env node
/**
 * Test double for Kimi CLI argv. A bare positional is a COMMAND, not a prompt.
 * Prompt text must come from --prompt/--command/-p/-c TEXT, a prompt file, or stdin.
 */
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("login") || args.includes("status") || args.includes("info") || args.includes("--version")) {
  process.stdout.write("logged in\n");
  process.exit(0);
}

const VALUE_FLAGS = new Set(["--prompt", "--command", "-p", "-c", "--output-format", "--input-format"]);
const PROMPT_FLAGS = ["--prompt", "--command", "-p", "-c"];

function flagValue(names) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith("-")) return args[i + 1];
  }
  return null;
}

function barePositionals() {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (String(args[i]).startsWith("-")) {
      if (VALUE_FLAGS.has(args[i])) i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

const bare = barePositionals();
if (bare.length) {
  process.stderr.write(`No such command '${bare[0]}'.\n`);
  process.exit(2);
}

let prompt = flagValue(PROMPT_FLAGS);
if (prompt && existsSync(prompt)) {
  try {
    prompt = readFileSync(prompt, "utf8");
  } catch {
    /* keep path text */
  }
}
if (!prompt) {
  try {
    prompt = readFileSync(0, "utf8");
  } catch {
    prompt = "";
  }
}
if (!String(prompt).trim()) {
  process.stderr.write("fake-kimi: empty prompt\n");
  process.exit(1);
}

const paired = [...String(prompt).matchAll(/ROW (r-\d+)\s+CHUNK (c-\d+)/g)].map((m) => ({
  rowId: m[1],
  chunkId: m[2],
}));
const chunkIds = [...new Set([...String(prompt).matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
const targets = paired.length
  ? paired
  : chunkIds.map((chunkId) => ({ rowId: null, chunkId }));
if (targets.length === 0) {
  process.stderr.write("fake-kimi: no chunks in prompt\n");
  process.exit(1);
}

const rows = targets.map(({ rowId, chunkId }) => {
  const marker = rowId ? `ROW ${rowId} CHUNK ${chunkId}` : `CHUNK ${chunkId}`;
  const block = String(prompt).split(marker)[1] || String(prompt).split(`CHUNK ${chunkId}`)[1] || "";
  const body = block.split("---")[1] || block;
  const sentence = body.replace(/\s+/g, " ").trim().slice(0, 160);
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
    practicalSuggestion: sentence ? `Metindeki pratik: ${sentence.slice(0, 100)}` : "",
    objection: null,
    quoteStart: 0,
    quoteEnd: Math.min(40, sentence.length),
  };
  if (rowId) row.rowId = rowId;
  return row;
});

process.stdout.write(JSON.stringify({ rows }));
