import assert from "node:assert/strict";
import test from "node:test";
import { chunkConfig, chunkExtracted, packUnits } from "../lib/chunk.mjs";

test("new extracts pack across pages toward 900–2200 chars", () => {
  const page = (n, chars) => ({
    page: n,
    text: `Başlık ${n}. ${"okumak ".repeat(Math.ceil(chars / 7))}`.slice(0, chars),
  });
  const { chunks } = chunkExtracted({
    title: "epub",
    pages: [page(1, 400), page(2, 400), page(3, 400)],
  });
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.length < 3, "short pages must pack together, not 1:1");
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks[0].text.length >= 800);
});

test("fragments under 80 characters merge into a neighbor", () => {
  const packed = packUnits(
    [
      { text: "Kısa.", page: 1 },
      { text: `Uzun gövde. ${"okumak ".repeat(140)}`, page: 1 },
      { text: "Not.", page: 2 },
    ],
    { min: 900, max: 2200, fragment: 80 },
  );
  assert.equal(packed.length, 1);
  assert.match(packed[0].text, /Kısa/);
  assert.match(packed[0].text, /Not/);
});

test("chunkConfig reads env overrides", () => {
  process.env.TABULECT_CHUNK_MIN = "280";
  process.env.TABULECT_CHUNK_MAX = "900";
  const cfg = chunkConfig();
  assert.equal(cfg.min, 280);
  assert.equal(cfg.max, 900);
  delete process.env.TABULECT_CHUNK_MIN;
  delete process.env.TABULECT_CHUNK_MAX;
  const def = chunkConfig();
  assert.equal(def.min, 900);
  assert.equal(def.max, 2200);
});
