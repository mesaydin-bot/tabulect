import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPdfTextLayer, pdftotextPage } from "./extract.mjs";
import { runCommand, which } from "./util.mjs";

export class OcrError extends Error {
  constructor(message) {
    super(message);
    this.name = "OcrError";
  }
}

/** Letters / words that count as a usable native text layer. */
export const MIN_LETTERS_PER_PAGE = 40;
export const MIN_WORDS_PER_PAGE = 8;
export const USABLE_PAGE_RATIO = 0.5;

export function pageTextStats(text) {
  const raw = String(text || "");
  const letters = (raw.match(/\p{L}/gu) || []).length;
  const words = (raw.match(/\p{L}[\p{L}'’-]*\p{L}/gu) || []).length;
  const digits = (raw.match(/\p{N}/gu) || []).length;
  return { letters, words, digits, length: raw.trim().length };
}

export function isPageTextUsable(text) {
  const stats = pageTextStats(text);
  return stats.letters >= MIN_LETTERS_PER_PAGE && stats.words >= MIN_WORDS_PER_PAGE;
}

export function evaluateTextLayer(pages) {
  if (!pages.length) {
    return { usable: false, usablePages: 0, totalPages: 0, reason: "PDF has no pages" };
  }
  const usablePages = pages.filter((p) => isPageTextUsable(p.text)).length;
  const ratio = usablePages / pages.length;
  if (usablePages === 0) {
    return {
      usable: false,
      usablePages,
      totalPages: pages.length,
      reason: "no page has a usable text layer",
    };
  }
  if (ratio < USABLE_PAGE_RATIO) {
    return {
      usable: false,
      usablePages,
      totalPages: pages.length,
      reason: `only ${usablePages}/${pages.length} pages have a usable text layer`,
    };
  }
  return { usable: true, usablePages, totalPages: pages.length, reason: "native text layer" };
}

export async function probeOcrTools() {
  const [ocrmypdf, tesseract, pdftoppm, pdftotext, convert] = await Promise.all([
    which("ocrmypdf"),
    which("tesseract"),
    which("pdftoppm"),
    which("pdftotext"),
    which("convert"),
  ]);
  return {
    ocrmypdf: Boolean(ocrmypdf),
    tesseract: Boolean(tesseract),
    poppler: Boolean(pdftoppm && pdftotext),
    pdftoppm: Boolean(pdftoppm),
    pdftotext: Boolean(pdftotext),
    imagemagick: Boolean(convert),
    languages: "tur+eng",
  };
}

async function runOcrmypdf(inputPath, outputPath, { force = true } = {}) {
  const bin = await which("ocrmypdf");
  if (!bin) return null;
  const args = [
    "--language",
    "tur+eng",
    "--deskew",
    "--rotate-pages",
    "--optimize",
    "1",
    "--jpeg-quality",
    "80",
    "--png-quality",
    "80",
    "--output-type",
    "pdf",
    "--skip-big",
    "80",
    force ? "--force-ocr" : "--skip-text",
    inputPath,
    outputPath,
  ];
  const result = await runCommand(bin, args, { timeoutMs: 15 * 60_000 });
  if (!result.ok) {
    throw new OcrError(
      `ocrmypdf failed: ${(result.stderr || result.stdout || "unknown").slice(0, 800)}`,
    );
  }
  return outputPath;
}

async function deskewPng(pngPath) {
  const convert = await which("convert");
  if (!convert) return pngPath;
  const out = `${pngPath}.deskew.png`;
  const result = await runCommand(convert, [pngPath, "-deskew", "40%", out], {
    timeoutMs: 60_000,
  });
  return result.ok ? out : pngPath;
}

async function runTesseractPoppler(inputPath) {
  const pdftoppm = await which("pdftoppm");
  const tesseract = await which("tesseract");
  if (!pdftoppm || !tesseract) {
    throw new OcrError(
      "Free local OCR needs ocrmypdf, or Tesseract + Poppler (pdftoppm). No cloud OCR is used.",
    );
  }
  const tmp = await mkdtemp(join(tmpdir(), "tabulect-ocr-"));
  try {
    const prefix = join(tmp, "page");
    const raster = await runCommand(
      pdftoppm,
      ["-png", "-r", "300", "-gray", inputPath, prefix],
      { timeoutMs: 10 * 60_000 },
    );
    if (!raster.ok) {
      throw new OcrError(`pdftoppm failed: ${raster.stderr || "unknown"}`);
    }
    const files = (await readdir(tmp))
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort();
    if (files.length === 0) throw new OcrError("pdftoppm produced no page images");
    const pages = [];
    const parts = [];
    for (let i = 0; i < files.length; i += 1) {
      const png = await deskewPng(join(tmp, files[i]));
      const ocr = await runCommand(
        tesseract,
        [png, "stdout", "-l", "tur+eng", "--psm", "4", "--oem", "1"],
        { timeoutMs: 180_000 },
      );
      if (!ocr.ok) {
        throw new OcrError(`tesseract failed on page ${i + 1}: ${ocr.stderr || "unknown"}`);
      }
      const text = ocr.stdout.replace(/\r\n/g, "\n").trim();
      pages.push({ page: i + 1, text });
      if (text) parts.push(text);
    }
    return { pages, text: parts.join("\n\n") };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * If the PDF already has a usable text layer, return it.
 * Otherwise OCR locally with ocrmypdf (preferred) or Tesseract+Poppler.
 * Languages: tur+eng. Deskew + quality flags. Never calls a cloud OCR API.
 */
export async function resolvePdfText(filePath, filename, textLayer) {
  const layer = textLayer ?? (await extractPdfTextLayer(filePath, filename));
  const verdict = evaluateTextLayer(layer.pages);
  if (verdict.usable) {
    return {
      ...layer,
      usedOcr: false,
      textLayerUsable: true,
      ocrEngine: null,
      ocrNote: verdict.reason,
    };
  }

  const tools = await probeOcrTools();
  if (!tools.ocrmypdf && !(tools.tesseract && tools.pdftoppm)) {
    throw new OcrError(
      `PDF has no usable text layer (${verdict.reason}). Install ocrmypdf or tesseract-ocr + poppler-utils with tur+eng traineddata. Cloud OCR is not used.`,
    );
  }

  let engine = "ocrmypdf";
  let pages;
  let text;
  if (tools.ocrmypdf) {
    const tmp = await mkdtemp(join(tmpdir(), "tabulect-ocrpdf-"));
    const outputPath = join(tmp, "ocr.pdf");
    try {
      await runOcrmypdf(filePath, outputPath, { force: verdict.usablePages === 0 });
      const extracted = await extractPdfTextLayer(outputPath, filename);
      pages = extracted.pages;
      text = extracted.text;
    } catch (error) {
      if (tools.tesseract && tools.pdftoppm) {
        engine = "tesseract+poppler";
        const fallback = await runTesseractPoppler(filePath);
        pages = fallback.pages;
        text = fallback.text;
      } else {
        throw error;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  } else {
    engine = "tesseract+poppler";
    const fallback = await runTesseractPoppler(filePath);
    pages = fallback.pages;
    text = fallback.text;
  }

  if (!text.trim()) {
    throw new OcrError(
      `Local OCR (${engine}, tur+eng) produced no text. The scan may be blank or unreadable.`,
    );
  }

  return {
    title: layer.title,
    pages,
    text,
    usedOcr: true,
    textLayerUsable: false,
    ocrEngine: engine,
    ocrNote: `${verdict.reason}; ocr=${engine} tur+eng deskew`,
    sourceType: "pdf",
    filePath,
  };
}

export async function ocrSingleImagePage(filePath, page) {
  const text = await pdftotextPage(filePath, page);
  return text;
}
