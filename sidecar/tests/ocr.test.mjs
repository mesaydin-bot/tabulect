import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractFile } from "../lib/extract.mjs";
import {
  evaluateTextLayer,
  isPageTextUsable,
  pageTextStats,
  probeOcrTools,
  resolvePdfText,
} from "../lib/ocr.mjs";
import { writeTextPdf } from "./helpers/pdf.mjs";

test("page text stats detect a usable layer", () => {
  assert.equal(isPageTextUsable(""), false);
  assert.equal(isPageTextUsable("ab 12"), false);
  const usable =
    "Okumak bir hız yarışı değildir. Metin üzerine eğilince iskeletini gösteren bir yapıdır.";
  assert.equal(isPageTextUsable(usable), true);
  assert.ok(pageTextStats(usable).words >= 8);
});

test("evaluateTextLayer requires enough usable pages", () => {
  const good = {
    page: 1,
    text: "Bu sayfada yeterince harf ve kelime vardır çünkü tespit eşiğini geçmek zorundayız.",
  };
  assert.equal(evaluateTextLayer([good]).usable, true);
  assert.equal(evaluateTextLayer([{ page: 1, text: "" }]).usable, false);
  assert.equal(
    evaluateTextLayer([good, { page: 2, text: "" }, { page: 3, text: "" }]).usable,
    false,
  );
});

test("resolvePdfText skips OCR when the text layer is usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-ocr-"));
  const pdf = await writeTextPdf(
    join(dir, "ok.pdf"),
    "Okumak bir hiz yarisi degildir. Metin uzerine egilince iskeletini gosteren bir yapidir ve yeterince kelime vardir.",
  );
  const layer = await extractFile({ filePath: pdf, filename: "ok.pdf" });
  const resolved = await resolvePdfText(pdf, "ok.pdf", layer);
  assert.equal(resolved.usedOcr, false);
  assert.equal(resolved.textLayerUsable, true);
  assert.match(resolved.text, /iskelet/i);
});

test("OCR tools probe reports local binaries only", async () => {
  const tools = await probeOcrTools();
  assert.equal(tools.languages, "tur+eng");
  assert.equal(typeof tools.ocrmypdf, "boolean");
  assert.equal(typeof tools.tesseract, "boolean");
  assert.equal(typeof tools.poppler, "boolean");
});
