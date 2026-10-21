import assert from "node:assert/strict";
import test from "node:test";
import { COLUMN_LABELS, columnHeaderLabel } from "../../src/locale/ui.ts";

test("Turkish column header labels name every visible schema column", () => {
  assert.equal(columnHeaderLabel("tr", "claim"), "Ana iddia");
  assert.equal(columnHeaderLabel("tr", "example"), "Örnek");
  assert.equal(columnHeaderLabel("tr", "fact"), "Olgu");
  assert.equal(columnHeaderLabel("tr", "definition"), "Tanım");
  assert.equal(columnHeaderLabel("tr", "warrant"), "Gerekçe");
  assert.equal(columnHeaderLabel("tr", "page"), "Sayfa");
  assert.equal(columnHeaderLabel("tr", "expand"), "");
  assert.equal(columnHeaderLabel(undefined, "claim"), "Ana iddia");
  for (const key of Object.keys(COLUMN_LABELS.tr)) {
    assert.ok(columnHeaderLabel("tr", key).length > 0, key);
  }
});

test("chrome exposes a model picker label in Turkish and English", async () => {
  const { CHROME } = await import("../../src/locale/ui.ts");
  assert.equal(CHROME.tr.modelLabel, "Model");
  assert.equal(CHROME.en.modelLabel, "Model");
  assert.ok(CHROME.tr.modelDefault.includes("varsayılan"));
  assert.ok(CHROME.en.modelDefault.toLowerCase().includes("default"));
});
