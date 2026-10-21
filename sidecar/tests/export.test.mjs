import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  asciiFilename,
  defaultExportColumns,
  documentToXlsx,
  filenameForDocument,
  parseExportColumns,
} from "../lib/export.mjs";
import { unzipEntries } from "../lib/xlsx.mjs";
import { saveDocument } from "../lib/store.mjs";

const chunk = { id: "c-001", text: "Okumak bir hız yarışı değildir.", page: 2, start: 0, end: 31 };
const row = {
  id: "r-001",
  chunkId: "c-001",
  quoteAnchor: { chunkId: "c-001", start: 0, end: 28, page: 2, bbox: null },
  claim: "Okumak hız yarışı değildir",
  warrant: "Tempo düşünceye bağlanır",
  fact: "Metin bir yapıdır",
  example: "",
  definition: "",
  exception: "",
  openQuestion: "",
  citation: "",
  practicalSuggestion: "Yavaşla",
  objection: null,
};

function sampleDoc(id, extra = {}) {
  return {
    id,
    title: extra.title || "Nasıl Okumalı",
    sourceType: "md",
    tableLocale: extra.tableLocale || "tr",
    chunks: [chunk],
    rows: [{ ...row, ...extra.row }],
    ...extra.doc,
  };
}

test("parseExportColumns keeps known keys in order and drops junk", () => {
  assert.deepEqual(parseExportColumns("rowNumber,claim,nope,claim"), ["rowNumber", "claim"]);
  assert.equal(parseExportColumns(""), null);
  assert.equal(parseExportColumns("zzz"), null);
});

test("default export includes page when rows have a page", () => {
  const withPage = defaultExportColumns(sampleDoc("d1"));
  assert.ok(withPage.includes("page"));
  assert.ok(withPage.includes("rowNumber"));
  assert.ok(withPage.includes("claim"));
  const noPage = defaultExportColumns({
    ...sampleDoc("d2"),
    rows: [{ ...row, quoteAnchor: { ...row.quoteAnchor, page: null } }],
  });
  assert.ok(!noPage.includes("page"));
});

test("documentToXlsx writes Turkish headers and cell text", () => {
  const buf = documentToXlsx(sampleDoc("doc-xlsx"));
  assert.ok(buf.slice(0, 2).equals(Buffer.from("PK")));
  const entries = unzipEntries(buf);
  const sheet = entries.get("xl/worksheets/sheet1.xml");
  assert.ok(sheet);
  assert.match(sheet, /Ana iddia/);
  assert.match(sheet, /Gerekçe/);
  assert.match(sheet, /Sayfa/);
  assert.match(sheet, /Okumak hız yarışı değildir/);
  assert.match(sheet, />2</);
  assert.equal(filenameForDocument(sampleDoc("doc-xlsx")), "Nasıl Okumalı.xlsx");
  assert.equal(asciiFilename("Nasıl Okumalı.xlsx"), "Nas_l Okumal_.xlsx");
});

test("documentToXlsx uses English headers when tableLocale=en", () => {
  const buf = documentToXlsx(sampleDoc("doc-en", { tableLocale: "en" }));
  const sheet = unzipEntries(buf).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, />Claim</);
  assert.match(sheet, />Warrant</);
  assert.ok(!/Ana iddia/.test(sheet));
});

test("visible-column export omits hidden schema keys", () => {
  const buf = documentToXlsx(sampleDoc("doc-cols"), { columns: ["rowNumber", "claim"] });
  const sheet = unzipEntries(buf).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /Ana iddia/);
  assert.ok(!/Gerekçe/.test(sheet));
});

test("saved library document round-trips into xlsx", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-export-"));
  const doc = sampleDoc("lib-xlsx");
  await saveDocument(doc, root);
  const buf = documentToXlsx(doc);
  const sheet = unzipEntries(buf).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /Tempo düşünceye bağlanır/);
});
