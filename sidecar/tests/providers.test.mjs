import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractJson } from "../lib/providers/prompt.mjs";
import { fillSchema, listProviders, resolveProvider } from "../lib/providers/index.mjs";
import { BATCH_SIZE, DEFAULT_BATCH_SIZE, DEFAULT_FILL_CONCURRENCY, fillColumnWithAdapter, fillRowsWithAdapter, isSkippedFillRow } from "../lib/providers/run.mjs";
import { COLUMN_KEYS } from "../lib/schema.mjs";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

test("schema batch default is one chunk and one CLI on 8GB machines", () => {
  assert.equal(DEFAULT_BATCH_SIZE, 1);
  assert.equal(DEFAULT_FILL_CONCURRENCY, 1);
  assert.equal(BATCH_SIZE, DEFAULT_BATCH_SIZE);
});

test("extractJson accepts raw object or fenced JSON", () => {
  assert.deepEqual(extractJson('{"rows":[]}'), { rows: [] });
  assert.deepEqual(extractJson('here\n```json\n{"rows":[1]}\n```'), { rows: [1] });
});

test("provider probes distinguish installed subscriptions from unavailable CLIs", async () => {
  const prev = { ...process.env };
  delete process.env.TABULECT_CLI_CODEX;
  delete process.env.TABULECT_CLI_KIMI;
  delete process.env.TABULECT_CLI_ANTIGRAVITY;
  delete process.env.TABULECT_CLI_CURSOR;
  delete process.env.TABULECT_CLI_CLAUDE;
  const providers = await listProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["codex", "kimi", "antigravity", "cursor", "claude"]);
  for (const provider of providers) {
    if (provider.available && provider.loggedIn) {
      assert.ok(provider.bin);
      assert.equal(provider.error, null);
    } else {
      assert.match(provider.error, /will not invent|API keys|not found|not logged/i);
    }
  }
  const unavailable = providers.find((provider) => !provider.available || !provider.loggedIn);
  // Never send a real paid model request just because the test host has CLIs installed.
  if (unavailable) await assert.rejects(
    () =>
      fillSchema({
        providerId: unavailable.id,
        tableLocale: "tr",
        chunks: [{ id: "c-001", text: "x", page: 1, start: 0, end: 1 }],
      }),
    /not found|not logged|API keys/i,
  );
  Object.assign(process.env, prev);
});

test("unknown provider is rejected", async () => {
  await assert.rejects(() => resolveProvider("openai"), /Unknown provider/);
});

test("codex adapter validates JSON and retries, then fills rows", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  const chunks = [
    {
      id: "c-001",
      text: "Okumak bir hız yarışı değildir. Metin bir yapıdır.",
      page: 1,
      start: 0,
      end: 50,
    },
    {
      id: "c-002",
      text: "Yavaş okumak her kelimeyi hecelemek değildir.",
      page: 1,
      start: 52,
      end: 98,
    },
  ];
  const rows = await fillSchema({
    providerId: "codex",
    tableLocale: "tr",
    chunks,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chunkId, "c-001");
  assert.ok(rows[0].claim);
  assert.equal(rows[0].quoteAnchor.chunkId, "c-001");
  delete process.env.TABULECT_CLI_CODEX;
});

function makeChunks(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${String(i + 1).padStart(3, "0")}`,
    text: `Parça ${i + 1}: yavaş okumak bir yapı işidir ve satır uydurulmaz.`,
    page: 1,
    start: i * 60,
    end: i * 60 + 55,
  }));
}

function cellsFor(chunkId) {
  const row = {
    chunkId,
    quoteStart: 0,
    quoteEnd: 12,
  };
  for (const key of COLUMN_KEYS) {
    row[key] = key === "objection" ? null : key === "claim" ? `claim ${chunkId}` : "";
  }
  return row;
}

function mockAdapter(label = "mock") {
  return {
    label,
    async complete(prompt) {
      const ids = [...new Set([...prompt.matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
      return JSON.stringify({ rows: ids.map((id) => cellsFor(id)) });
    },
  };
}

test("fillRowsWithAdapter reports each batch with growing row counts", async () => {
  const prev = process.env.TABULECT_BATCH_SIZE;
  process.env.TABULECT_BATCH_SIZE = "2";
  try {
    const size = 2;
    const chunks = makeChunks(size + 2);
    const batches = [];
    const rows = await fillRowsWithAdapter(mockAdapter(), {
      chunks,
      tableLocale: "tr",
      onBatch: ({ rowsSoFar, batchIndex, batchCount }) => {
        batches.push({
          rows: rowsSoFar.length,
          batchIndex,
          batchCount,
          ids: rowsSoFar.map((row) => row.chunkId),
        });
      },
    });
    assert.equal(batches.length, 2);
    assert.equal(batches[0].batchCount, 2);
    assert.equal(batches[0].batchIndex, 0);
    assert.equal(batches[0].rows, size);
    assert.equal(batches[1].batchIndex, 1);
    assert.equal(batches[1].rows, size + 2);
    assert.equal(rows.length, size + 2);
    assert.deepEqual(
      rows.map((row) => row.chunkId),
      chunks.map((chunk) => chunk.id),
    );
  } finally {
    if (prev == null) delete process.env.TABULECT_BATCH_SIZE;
    else process.env.TABULECT_BATCH_SIZE = prev;
  }
});

test("fillColumnWithAdapter updates only the named column", async () => {
  const chunks = makeChunks(2);
  const existing = chunks.map((chunk, index) => ({
    id: `r-${String(index + 1).padStart(3, "0")}`,
    chunkId: chunk.id,
    quoteAnchor: { chunkId: chunk.id, start: 0, end: 12, page: 1, bbox: null },
    claim: `keep ${chunk.id}`,
    warrant: "keep",
    fact: "",
    example: "",
    definition: "",
    exception: "",
    openQuestion: "",
    citation: "",
    practicalSuggestion: "",
    objection: null,
  }));
  const adapter = {
    label: "column-fill",
    async complete(prompt) {
      const pairs = [...prompt.matchAll(/ROW (r-\d+)\s+CHUNK (c-\d+)/g)];
      return JSON.stringify({
        rows: pairs.map((match) => ({
          rowId: match[1],
          chunkId: match[2],
          practicalSuggestion: `tip for ${match[2]}`,
        })),
      });
    },
  };
  const updates = await fillColumnWithAdapter(adapter, {
    rows: existing,
    chunks,
    columnKey: "practicalSuggestion",
    tableLocale: "tr",
  });
  assert.equal(updates.get("r-001"), "tip for c-001");
  assert.equal(existing[0].claim, "keep c-001");
});

test("empty output on one chunk skips that hole and still fills the others", async () => {
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const adapter = {
    label: "Kimi",
    async complete(prompt) {
      const ids = [...new Set([...prompt.matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
      if (ids.includes("c-002")) {
        throw new Error("Kimi failed. empty output No table data was fabricated.");
      }
      return JSON.stringify({ rows: ids.map((id) => cellsFor(id)) });
    },
  };
  const rows = await fillRowsWithAdapter(adapter, {
    chunks: makeChunks(3),
    tableLocale: "tr",
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.chunkId),
    ["c-001", "c-002", "c-003"],
  );
  assert.equal(rows[0].claim, "claim c-001");
  assert.equal(rows[1].claim, "");
  assert.equal(isSkippedFillRow(rows[1]), true);
  assert.match(rows[1].openQuestion, /Atlandı:/);
  assert.ok(rows[2].claim);
});

test("a later batch failure keeps already-filled rows and skip-placeholders the miss", async () => {
  let calls = 0;
  const adapter = {
    label: "partial-fail",
    async complete(prompt) {
      calls += 1;
      if (calls > 1) throw new Error("second batch timed out");
      const ids = [...new Set([...prompt.matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
      return JSON.stringify({ rows: ids.map((id) => cellsFor(id)) });
    },
  };
  const batches = [];
  process.env.TABULECT_RETRY_BASE_MS = "0";
  process.env.TABULECT_BATCH_SIZE = "2";
  try {
    const rows = await fillRowsWithAdapter(adapter, {
      chunks: makeChunks(3),
      tableLocale: "tr",
      onBatch: ({ rowsSoFar }) => {
        batches.push(rowsSoFar.length);
      },
    });
    assert.equal(rows.length, 3);
    assert.equal(batches[0], 2);
    assert.equal(rows[2].claim, "");
    assert.equal(isSkippedFillRow(rows[2]), true);
    assert.ok(calls > 1, "failed batch must be retried");
  } finally {
    delete process.env.TABULECT_BATCH_SIZE;
  }
});

test("invalid JSON after retries becomes a skip row, not a frozen leftover", async () => {
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const adapter = {
    label: "Kimi",
    async complete() {
      return "not json at all";
    },
  };
  const rows = await fillRowsWithAdapter(adapter, {
    chunks: makeChunks(1),
    tableLocale: "tr",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chunkId, "c-001");
  assert.equal(rows[0].claim, "");
  assert.equal(isSkippedFillRow(rows[0]), true);
  assert.match(rows[0].openQuestion, /uydurulmadı/);
});

test("a rate-limit wave still refuses to invent or skip-claim the book", async () => {
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const adapter = {
    label: "Kimi",
    async complete() {
      throw new Error("rate limit");
    },
  };
  await assert.rejects(
    () =>
      fillRowsWithAdapter(adapter, {
        chunks: makeChunks(1),
        tableLocale: "tr",
      }),
    /no valid rows|refusing to invent data/,
  );
});

test("a transient batch failure is retried then filled", async () => {
  let calls = 0;
  const adapter = {
    label: "retry-ok",
    async complete(prompt) {
      calls += 1;
      if (calls === 1) throw new Error("rate limit");
      const ids = [...new Set([...prompt.matchAll(/CHUNK (c-\d+)/g)].map((m) => m[1]))];
      return JSON.stringify({ rows: ids.map((id) => cellsFor(id)) });
    },
  };
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const rows = await fillRowsWithAdapter(adapter, {
    chunks: makeChunks(2),
    tableLocale: "tr",
  });
  assert.equal(rows.length, 2);
  assert.ok(calls >= 2);
});

test("Cursor --trust and Codex TTY-like TERM satisfy headless CLIs", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_RETRY_BASE_MS = "0";
  const chunk = {
    id: "c-001",
    text: "Okumak bir hız yarışı değildir. Metin bir yapıdır.",
    page: 1,
    start: 0,
    end: 50,
  };
  process.env.TABULECT_CLI_CURSOR = FAKE;
  process.env.FAKE_CODEX_REQUIRE_TRUST = "1";
  const cursorRows = await fillSchema({
    providerId: "cursor",
    tableLocale: "tr",
    chunks: [chunk],
  });
  assert.equal(cursorRows.length, 1);
  delete process.env.FAKE_CODEX_REQUIRE_TRUST;
  delete process.env.TABULECT_CLI_CURSOR;

  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_REQUIRE_TTY = "1";
  const codexRows = await fillSchema({
    providerId: "codex",
    tableLocale: "tr",
    chunks: [chunk],
  });
  assert.equal(codexRows.length, 1);
  delete process.env.FAKE_CODEX_REQUIRE_TTY;
  delete process.env.TABULECT_CLI_CODEX;
});

test("logged-out CLI is an explicit error", async () => {
  await chmod(FAKE, 0o755);
  process.env.TABULECT_CLI_CODEX = FAKE;
  process.env.FAKE_CODEX_LOGGED_OUT = "1";
  await assert.rejects(
    () =>
      fillSchema({
        providerId: "codex",
        tableLocale: "tr",
        chunks: [{ id: "c-001", text: "abc def ghi jkl mno", page: 1, start: 0, end: 19 }],
      }),
    /not logged|failed|invent/i,
  );
  delete process.env.FAKE_CODEX_LOGGED_OUT;
  delete process.env.TABULECT_CLI_CODEX;
});
