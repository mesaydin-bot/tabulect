import assert from "node:assert/strict";
import test from "node:test";
import {
  COLUMN_KEYS,
  SchemaError,
  migrateDocument,
  validateDocument,
  validateProviderRows,
  validateIngestEvent,
} from "../lib/schema.mjs";

const chunk = { id: "c-001", text: "hello world", page: 1, start: 0, end: 11 };
const row = {
  id: "r-001",
  chunkId: "c-001",
  quoteAnchor: { chunkId: "c-001", start: 0, end: 5, page: 1, bbox: null },
  claim: "c",
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

test("locked column keys stay camelCase", () => {
  assert.deepEqual(COLUMN_KEYS, [
    "claim",
    "warrant",
    "fact",
    "example",
    "definition",
    "exception",
    "openQuestion",
    "citation",
    "practicalSuggestion",
    "objection",
  ]);
});

test("validateDocument accepts a complete document", () => {
  validateDocument({
    id: "d1",
    title: "t",
    sourceType: "md",
    tableLocale: "tr",
    chunks: [chunk],
    rows: [row],
  });
});

test("validateDocument accepts empty rows plus bookmarks", () => {
  const { doc } = migrateDocument({
    id: "d2",
    title: "t",
    sourceType: "md",
    tableLocale: "tr",
    chunks: [chunk],
    rows: [],
  });
  validateDocument(doc);
  assert.deepEqual(doc.bookmarks, []);
  assert.ok(Array.isArray(doc.outputs));
});

test("validateDocument rejects unknown sourceType and locale", () => {
  assert.throws(
    () =>
      validateDocument({
        id: "d1",
        title: "t",
        sourceType: "rtf",
        tableLocale: "tr",
        chunks: [chunk],
        rows: [row],
      }),
    SchemaError,
  );
  assert.throws(
    () =>
      validateDocument({
        id: "d1",
        title: "t",
        sourceType: "md",
        tableLocale: "de",
        chunks: [chunk],
        rows: [row],
      }),
    SchemaError,
  );
});

test("provider rows must include every schema key", () => {
  assert.throws(
    () => validateProviderRows({ rows: [{ chunkId: "c-001", claim: "x" }] }),
    SchemaError,
  );
  validateProviderRows({
    rows: [
      {
        chunkId: "c-001",
        claim: "c",
        warrant: "",
        fact: "",
        example: "",
        definition: "",
        exception: "",
        openQuestion: "",
        citation: "",
        practicalSuggestion: "",
        objection: null,
      },
    ],
  });
});

test("validateDocument still rejects missing keys (migrate first)", () => {
  const incomplete = structuredClone(row);
  delete incomplete.practicalSuggestion;
  assert.throws(
    () =>
      validateDocument({
        id: "d1",
        title: "t",
        sourceType: "md",
        tableLocale: "tr",
        chunks: [chunk],
        rows: [incomplete],
      }),
    SchemaError,
  );
});

test("migrateDocument fills missing practicalSuggestion with empty string", () => {
  const incomplete = structuredClone(row);
  delete incomplete.practicalSuggestion;
  const { doc, changed } = migrateDocument({
    id: "d1",
    title: "t",
    sourceType: "md",
    tableLocale: "tr",
    chunks: [chunk],
    rows: [incomplete],
  });
  assert.equal(changed, true);
  assert.equal(doc.rows[0].practicalSuggestion, "");
  validateDocument(doc);
});

test("empty provider rows are rejected (no fake data)", () => {
  assert.throws(() => validateProviderRows({ rows: [] }), /invent/);
});

test("schema phase may repeat with the same documentId", () => {
  const first = validateIngestEvent({
    jobId: "j",
    phase: "schema",
    pct: 74,
    message: "1/2 batch",
    documentId: "d1",
    error: null,
  });
  const second = validateIngestEvent({
    jobId: "j",
    phase: "schema",
    pct: 99,
    message: "2/2 batch",
    documentId: "d1",
    error: null,
  });
  assert.equal(first.phase, "schema");
  assert.equal(second.documentId, first.documentId);
  assert.ok(second.pct > first.pct);
});

test("ingest event shape", () => {
  validateIngestEvent({
    jobId: "j",
    phase: "extract",
    pct: 20,
    message: "ok",
    documentId: null,
    error: null,
  });
  assert.throws(
    () =>
      validateIngestEvent({
        jobId: "j",
        phase: "nope",
        pct: 20,
        message: "ok",
        documentId: null,
        error: null,
      }),
    SchemaError,
  );
});
