import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withLang } from "../lib/i18n.mjs";
import { normalizeLocale, validateDocument } from "../lib/schema.mjs";

const load = async (name) => JSON.parse(await readFile(new URL(`../../src/fixtures/${name}`, import.meta.url), "utf8"));

test("English first-run sample is Bacon's public-domain 'Of Studies' with English tables", async () => {
  const en = await load("essay-en.json");
  assert.doesNotThrow(() => validateDocument(en));
  assert.equal(en.tableLocale, "en");
  assert.match(en.title, /Of Studies/);
  assert.match(en.chunks.map((c) => c.text).join(" "), /Some books are to be tasted, others to be swallowed/);
  for (const chunk of en.chunks) assert.equal(chunk.end - chunk.start, chunk.text.length);
  assert.doesNotMatch(JSON.stringify(en), /[çğışöüÇĞİŞÖÜ]/);
  const tr = await load("essay.json");
  assert.equal(tr.tableLocale, "tr");
});

test("the UI loads the sample in the interface language", async () => {
  const src = await readFile(new URL("../../src/state/useDocument.ts", import.meta.url), "utf8");
  assert.match(src, /lang === "tr" \? essay : essayEn/);
  assert.doesNotMatch(src, /tableLocale: "tr"/);
});

test("a table with no explicit language follows the request's interface language", () => {
  assert.equal(normalizeLocale(undefined), "en");
  assert.equal(withLang("tr", () => normalizeLocale("")), "tr");
  assert.equal(withLang("en", () => normalizeLocale(null)), "en");
  assert.equal(withLang("tr", () => normalizeLocale("en")), "en");
});
