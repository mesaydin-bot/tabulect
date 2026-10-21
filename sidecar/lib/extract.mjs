import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SOURCE_TYPES } from "./schema.mjs";
import {
  headingTitle,
  pathExists,
  runCommand,
  stripTags,
  titleFromFilename,
  which,
} from "./util.mjs";

export class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractError";
  }
}

const EXT_MAP = {
  ".pdf": "pdf",
  ".epub": "epub",
  ".html": "html",
  ".htm": "html",
  ".md": "md",
  ".markdown": "md",
  ".docx": "docx",
};

const MIME_MAP = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "text/html": "html",
  "text/markdown": "md",
  "text/plain": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export function detectSourceType({ filename = "", mime = "" } = {}) {
  const lowerMime = String(mime || "").split(";")[0].trim().toLowerCase();
  if (MIME_MAP[lowerMime]) return MIME_MAP[lowerMime];
  const name = String(filename || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  throw new ExtractError(
    `unsupported type for ${filename || mime || "upload"}. Use PDF, EPUB, HTML, MD, or DOCX.`,
  );
}

export function pagesFromPlainText(text, title) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  return {
    title,
    pages: [{ page: 1, text: clean }],
    text: clean,
    usedOcr: false,
    textLayerUsable: clean.length > 0,
  };
}

export function extractMarkdown(buffer, filename) {
  const text = buffer.toString("utf8");
  const title = headingTitle(text, titleFromFilename(filename));
  return pagesFromPlainText(text, title);
}

export function extractHtml(buffer, filename) {
  const raw = buffer.toString("utf8");
  const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const text = stripTags(raw);
  const title =
    (titleMatch && titleMatch[1].trim()) ||
    (h1Match && stripTags(h1Match[1])) ||
    headingTitle(text, titleFromFilename(filename));
  return pagesFromPlainText(text, title);
}

async function unzipList(filePath) {
  const unzip = await which("unzip");
  if (!unzip) throw new ExtractError("unzip is required to read DOCX/EPUB");
  const listed = await runCommand(unzip, ["-Z", "-1", filePath], { timeoutMs: 30_000 });
  if (!listed.ok) {
    throw new ExtractError(`not a zip archive: ${listed.stderr || listed.stdout}`);
  }
  return listed.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function unzipEntry(filePath, entry) {
  const unzip = await which("unzip");
  const result = await runCommand(unzip, ["-p", filePath, entry], { timeoutMs: 30_000 });
  if (!result.ok) {
    throw new ExtractError(`failed to read ${entry}: ${result.stderr || "unzip error"}`);
  }
  return result.stdout;
}

export async function extractDocx(filePath, filename) {
  const names = await unzipList(filePath);
  if (!names.includes("word/document.xml")) {
    throw new ExtractError("DOCX is missing word/document.xml");
  }
  const xml = await unzipEntry(filePath, "word/document.xml");
  const paragraphs = [];
  const parts = xml.split(/<w:p[\s>]/);
  for (const part of parts.slice(1)) {
    const texts = [...part.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) =>
      stripTags(m[1]),
    );
    const line = texts.join("").trim();
    if (line) paragraphs.push(line);
  }
  const text = paragraphs.join("\n\n");
  if (!text) throw new ExtractError("DOCX contained no readable text");
  return pagesFromPlainText(text, headingTitle(text, titleFromFilename(filename)));
}

function parseContainerRootfile(xml) {
  const match = xml.match(/full-path="([^"]+)"/i);
  if (!match) throw new ExtractError("EPUB container.xml has no rootfile");
  return match[1];
}

function parseOpfSpine(opf, opfDir) {
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = tag.match(/\bid="([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (id && href) manifest.set(id, href);
  }
  const hrefs = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = match[0].match(/\bidref="([^"]+)"/i)?.[1];
    if (!idref) continue;
    const href = manifest.get(idref);
    if (href) hrefs.push(join(opfDir, decodeURIComponent(href)).replace(/\\/g, "/"));
  }
  return hrefs;
}

export async function extractEpub(filePath, filename) {
  const names = await unzipList(filePath);
  const containerName =
    names.find((n) => n.toLowerCase() === "meta-inf/container.xml") ||
    names.find((n) => n.toLowerCase().endsWith("container.xml"));
  if (!containerName) throw new ExtractError("EPUB is missing META-INF/container.xml");
  const container = await unzipEntry(filePath, containerName);
  const rootfile = parseContainerRootfile(container);
  const opf = await unzipEntry(filePath, rootfile);
  const opfDir = rootfile.includes("/") ? rootfile.slice(0, rootfile.lastIndexOf("/")) : "";
  let hrefs = parseOpfSpine(opf, opfDir);
  if (hrefs.length === 0) {
    hrefs = names.filter((n) => /\.(x?html|htm)$/i.test(n));
  }
  const pages = [];
  const texts = [];
  let page = 1;
  for (const href of hrefs) {
    const entry = names.find((n) => n.replace(/\\/g, "/") === href) || href;
    if (!names.includes(entry) && !names.includes(href)) continue;
    let html;
    try {
      html = await unzipEntry(filePath, names.includes(entry) ? entry : href);
    } catch {
      continue;
    }
    const text = stripTags(html);
    if (!text) continue;
    pages.push({ page, text });
    texts.push(text);
    page += 1;
  }
  if (pages.length === 0) throw new ExtractError("EPUB contained no readable HTML");
  const text = texts.join("\n\n");
  const titleMatch = opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  return {
    title: (titleMatch && titleMatch[1].trim()) || headingTitle(text, titleFromFilename(filename)),
    pages,
    text,
    usedOcr: false,
    textLayerUsable: true,
  };
}

export async function pdfPageCount(filePath) {
  const pdfinfo = await which("pdfinfo");
  if (!pdfinfo) return null;
  const result = await runCommand(pdfinfo, [filePath], { timeoutMs: 20_000 });
  const match = result.stdout.match(/Pages:\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export async function pdftotextPage(filePath, page) {
  const bin = await which("pdftotext");
  if (!bin) {
    throw new ExtractError(
      "PDF extract requires Poppler pdftotext. Install poppler-utils (Linux) or poppler (macOS).",
    );
  }
  const args = ["-layout", "-enc", "UTF-8"];
  if (page != null) args.push("-f", String(page), "-l", String(page));
  args.push(filePath, "-");
  const result = await runCommand(bin, args, { timeoutMs: 60_000 });
  if (!result.ok) {
    throw new ExtractError(`pdftotext failed: ${result.stderr || result.stdout || "unknown"}`);
  }
  return result.stdout.replace(/\r\n/g, "\n").trim();
}

export async function extractPdfTextLayer(filePath, filename) {
  const count = (await pdfPageCount(filePath)) || 1;
  const pages = [];
  const parts = [];
  for (let page = 1; page <= count; page += 1) {
    const text = await pdftotextPage(filePath, page);
    pages.push({ page, text });
    if (text) parts.push(text);
  }
  const text = parts.join("\n\n");
  return {
    title: titleFromFilename(filename),
    pages,
    text,
    usedOcr: false,
    textLayerUsable: false,
    pageCount: count,
  };
}

export async function extractFile({ filePath, buffer, filename, mime, sourceType }) {
  const type = sourceType || detectSourceType({ filename, mime });
  if (!SOURCE_TYPES.includes(type)) {
    throw new ExtractError(`unsupported sourceType ${type}`);
  }
  if (type === "md") {
    const bytes = buffer ?? (await readFile(filePath));
    return { ...extractMarkdown(bytes, filename), sourceType: type };
  }
  if (type === "html") {
    const bytes = buffer ?? (await readFile(filePath));
    return { ...extractHtml(bytes, filename), sourceType: type };
  }

  if (!filePath) {
    throw new ExtractError(`${type} extract needs a persisted file path`);
  }
  if (!(await pathExists(filePath))) throw new ExtractError(`file not found: ${filePath}`);

  if (type === "docx") {
    return { ...(await extractDocx(filePath, filename)), sourceType: type, filePath };
  }
  if (type === "epub") {
    return { ...(await extractEpub(filePath, filename)), sourceType: type, filePath };
  }
  return { ...(await extractPdfTextLayer(filePath, filename)), sourceType: type, filePath };
}
