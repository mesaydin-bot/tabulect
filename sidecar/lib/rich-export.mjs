/**
 * Export preview content as md / html / pdf / docx / xlsx.
 * Non-md formats render from the preview HTML (or markdown → HTML).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { markdownToHtml, parseHtmlTables, previewPlainText, previewTables, stripHtml, walkHtmlBlocks, wrapHtmlDocument, wrapPrintDocument } from "./markdown.mjs";
import { buildWorkbookXlsx, zipEntries } from "./xlsx.mjs";
import { printHtmlToPdf, resolveChrome } from "./chrome-print.mjs";

export const EXPORT_FORMATS = ["md", "html", "pdf", "docx", "xlsx"];

export function safeFilename(name, ext) {
  const base = String(name || "tabulect")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "tabulect";
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  return `${base}${suffix}`;
}

export function renderPreviewHtml(title, content) {
  const raw = String(content || "");
  const body = markdownToHtml(raw);
  return wrapHtmlDocument(title, body);
}

export function renderPrintHtml(title, content) {
  const raw = String(content || "");
  const body = markdownToHtml(raw);
  return wrapPrintDocument(title, body);
}

const PDF_CHAR_FOLD = {
  ğ: "g",
  ü: "u",
  ş: "s",
  ı: "i",
  ö: "o",
  ç: "c",
  Ğ: "G",
  Ü: "U",
  Ş: "S",
  İ: "I",
  Ö: "O",
  Ç: "C",
  â: "a",
  î: "i",
  û: "u",
  Â: "A",
  Î: "I",
  Û: "U",
  ä: "a",
  ë: "e",
  ï: "i",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  Æ: "AE",
  Œ: "OE",
  ñ: "n",
  Ñ: "N",
};

function foldLatin(text) {
  let s = String(text || "")
    .replace(/→|⇒|➜|▸|►|▶|➔|➜/g, "->")
    .replace(/←|⇐/g, "<-")
    .replace(/↔|⇄/g, "<->")
    .replace(/[—–−‒]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[•●·‣∙]/g, "-")
    .replace(/\u00a0/g, " ");
  s = s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
    if (PDF_CHAR_FOLD[ch]) return PDF_CHAR_FOLD[ch];
    const nfd = ch.normalize("NFD").replace(/\p{M}/gu, "");
    if (nfd && nfd !== ch && /^[\x20-\x7E]+$/.test(nfd)) return nfd;
    return "";
  });
  return s.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
}

function pdfEscape(text) {
  return foldLatin(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLines(text, width = 88) {
  const lines = [];
  for (const para of String(text || "").split(/\n/)) {
    if (!para) {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width) {
        if (current) lines.push(current);
        if (word.length > width) {
          for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
          current = "";
        } else {
          current = word;
        }
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

const PDF_PAGE_W = 612;
const PDF_PAGE_H = 792;
const PDF_MARGIN = 48;

function charsForWidth(widthPt, fontSize) {
  return Math.max(6, Math.floor(widthPt / (fontSize * 0.5)));
}

function blockText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-")
    .replace(/&rarr;/gi, "->")
    .replace(/&larr;/gi, "<-");
}

function parseMermaidEdges(inner) {
  const html = String(inner || "");
  const edgeDivs = [...html.matchAll(/<div class="mermaid-edge"[^>]*>([\s\S]*?)<\/div>/gi)];
  const asEdge = (from, to, label) => ({
    from: stripHtml(from || "").trim(),
    to: stripHtml(to || "").trim(),
    label: stripHtml(label || "").trim(),
  });
  if (edgeDivs.length) {
    return edgeDivs
      .map((match) => {
        const chunk = match[1];
        const nodes = [...chunk.matchAll(/<span class="mermaid-node"[^>]*>([\s\S]*?)<\/span>/gi)].map((item) =>
          stripHtml(item[1]),
        );
        const label = stripHtml((chunk.match(/<span class="mermaid-edge-label"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "");
        if (nodes.length >= 2) return asEdge(nodes[0], nodes[1], label);
        const text = stripHtml(chunk);
        const parts = text.split(/\s*(?:→|->)\s*/);
        if (parts.length >= 2) return asEdge(parts[0], parts.slice(1).join(" -> "), label);
        return asEdge(text, "", label);
      })
      .filter((edge) => edge.from);
  }
  const nodes = [...html.matchAll(/<span class="mermaid-node"[^>]*>([\s\S]*?)<\/span>/gi)].map((item) => stripHtml(item[1]));
  if (nodes.length >= 2) {
    const edges = [];
    for (let i = 0; i < nodes.length - 1; i += 1) edges.push(asEdge(nodes[i], nodes[i + 1], ""));
    return edges;
  }
  const text = stripHtml(html);
  return text ? [asEdge(text, "", "")] : [];
}

function looksLikeHeader(block) {
  const text = stripHtml(block.inner);
  if (!text || text.length > 140) return false;
  const style = block.attrs || "";
  if (/background\s*:/i.test(style) && !/grid-template|display:\s*(grid|flex)/i.test(style)) return true;
  if (/letter-spacing/i.test(style) && text.length < 90) return true;
  if (block.tag === "div" && !/<p\b/i.test(block.inner) && text.length < 80) return true;
  return false;
}

function looksLikeColumns(block) {
  if (/grid-template-columns|display:\s*grid|display:\s*flex/i.test(block.attrs || "")) return true;
  const kids = walkHtmlBlocks(block.inner).filter((item) => item.tag === "div");
  return kids.length >= 2 && kids.length <= 4;
}

function parseColumn(block) {
  const kids = walkHtmlBlocks(block.inner);
  if (kids.length >= 2) {
    const title = stripHtml(kids[0].inner);
    const body = kids
      .slice(1)
      .map((item) => blockText(item.html))
      .filter(Boolean)
      .join("\n");
    if (title.length <= 48) return { title, body: body || title };
  }
  const text = blockText(block.html);
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].length <= 40) return { title: lines[0], body: lines.slice(1).join("\n") };
  return { title: "", body: text };
}

function parseHtmlCard(block) {
  const kids = walkHtmlBlocks(block.inner);
  const card = { header: "", columns: [], sections: [], footer: "" };
  if (!kids.length) {
    const text = blockText(block.html);
    if (text) card.sections.push({ title: "", body: text });
    return card;
  }
  let i = 0;
  if (looksLikeHeader(kids[0])) {
    card.header = stripHtml(kids[0].inner);
    i = 1;
  }
  const gridAt = kids.findIndex((item, index) => index >= i && looksLikeColumns(item));
  if (gridAt >= 0) {
    for (const item of kids.slice(i, gridAt)) {
      const text = blockText(item.html);
      if (text) card.sections.push({ title: "", body: text });
    }
    const colKids = walkHtmlBlocks(kids[gridAt].inner).filter((item) => item.tag === "div" || item.tag === "p" || item.tag === "section");
    if (colKids.length >= 2) card.columns = colKids.map(parseColumn).filter((col) => col.body || col.title);
    i = gridAt + 1;
  }
  const rest = kids.slice(i);
  rest.forEach((item, index) => {
    const text = blockText(item.html);
    if (!text) return;
    const isLast = index === rest.length - 1;
    if (isLast && (rest.length > 1 || card.columns.length || /<strong\b/i.test(item.html))) {
      card.footer = text;
      return;
    }
    card.sections.push({ title: "", body: text });
  });
  if (!card.header && !card.columns.length && !card.sections.length && !card.footer) {
    const text = blockText(block.html);
    if (text) card.sections.push({ title: "", body: text });
  }
  return card;
}

function blocksFromHtml(html) {
  const blocks = [];
  for (const block of walkHtmlBlocks(html)) {
    const tag = block.tag;
    const inner = block.inner;
    if (tag === "table") {
      const tables = parseHtmlTables(block.html);
      if (tables[0]) blocks.push({ type: "table", table: tables[0] });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item, i) => {
        const prefix = tag === "ol" ? `${i + 1}. ` : "- ";
        return `${prefix}${stripHtml(item[1])}`;
      });
      if (items.length) blocks.push({ type: "list", lines: items });
      continue;
    }
    if (tag === "div") {
      if (/\bmermaid-diagram\b/.test(`${block.attrs} ${inner}`)) {
        const edges = parseMermaidEdges(inner);
        if (edges.length) blocks.push({ type: "mermaid", edges });
        continue;
      }
      const nestedTables = parseHtmlTables(block.html);
      const card = parseHtmlCard(block);
      const hasCard =
        card.header || card.columns.length || card.sections.length || card.footer || nestedTables.length;
      if (hasCard && (card.header || card.columns.length || nestedTables.length || /border|background|grid-template/i.test(block.attrs || ""))) {
        if (nestedTables.length && !card.columns.length) card.table = nestedTables[0];
        blocks.push({ type: "card", ...card });
        continue;
      }
      if (nestedTables.length) {
        for (const table of nestedTables) blocks.push({ type: "table", table });
        continue;
      }
      const text = stripHtml(inner);
      if (text) blocks.push({ type: "para", text });
      continue;
    }
    const text = stripHtml(inner);
    if (text) blocks.push({ type: /^h[1-6]$/.test(tag) ? "heading" : "para", text });
  }
  return blocks;
}

function previewPdfBlocks(content) {
  const blocks = blocksFromHtml(markdownToHtml(content));
  if (!blocks.length) {
    const plain = previewPlainText(content);
    for (const line of plain.split(/\n+/)) {
      if (line.trim()) blocks.push({ type: "para", text: line });
    }
  }
  return blocks;
}

function assemblePdf(pageStreams) {
  const streams = pageStreams.length ? pageStreams : [""];
  const objects = [];
  const romanId = 3;
  const boldId = 4;
  objects.push(`${romanId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> endobj\n`);
  objects.push(`${boldId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >> endobj\n`);
  let obj = 5;
  const contentIds = [];
  for (const stream of streams) {
    const id = obj;
    obj += 1;
    contentIds.push(id);
    objects.push(
      `${id} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`,
    );
  }
  const kids = [];
  contentIds.forEach((contentId) => {
    const id = obj;
    obj += 1;
    kids.push(`${id} 0 R`);
    objects.push(
      `${id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_W} ${PDF_PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${romanId} 0 R /F2 ${boldId} 0 R >> >> >> endobj\n`,
    );
  });
  const pagesObj = `2 0 obj << /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >> endobj\n`;
  const catalog = `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`;
  const body = [catalog, pagesObj, ...objects];
  let offset = 0;
  const offsets = [0];
  const chunks = ["%PDF-1.4\n"];
  offset = chunks[0].length;
  for (const part of body) {
    offsets.push(offset);
    chunks.push(part);
    offset += Buffer.byteLength(part);
  }
  const xrefPos = offset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.concat([...chunks, xref, trailer].map((part) => Buffer.from(part)));
}

function paintPdfPages(blocks) {
  const pages = [[]];
  let y = PDF_PAGE_H - PDF_MARGIN;
  const usable = PDF_PAGE_W - PDF_MARGIN * 2;

  const cmds = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push([]);
    y = PDF_PAGE_H - PDF_MARGIN;
  };
  const ensure = (height) => {
    if (y - height < PDF_MARGIN) newPage();
  };
  const textLine = (line, { size = 11, bold = false, gap = 14 } = {}) => {
    ensure(gap);
    const font = bold ? "F2" : "F1";
    cmds().push(`BT /${font} ${size} Tf ${PDF_MARGIN} ${y - size} Td (${pdfEscape(line)}) Tj ET`);
    y -= gap;
  };
  const para = (text, opts) => {
    const size = opts?.size ?? 11;
    const width = charsForWidth(usable, size);
    for (const line of wrapLines(text, width)) {
      if (line === "") {
        y -= 6;
        continue;
      }
      textLine(line, opts);
    }
  };

  const drawTable = (table) => {
    const headers = Array.isArray(table.headers) ? table.headers : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const cols = Math.max(headers.length, ...rows.map((row) => row.length), 1);
    const colW = usable / cols;
    const fontSize = cols > 6 ? 7 : cols > 4 ? 8 : 9;
    const lineGap = fontSize + 3;
    const pad = 4;
    const inner = Math.max(12, colW - pad * 2);
    const wrapCell = (value) => wrapLines(String(value || ""), charsForWidth(inner, fontSize));

    const paintRow = (cells, header) => {
      const padded = Array.from({ length: cols }, (_, i) => cells[i] || "");
      const wrapped = padded.map(wrapCell);
      const linesHigh = Math.max(1, ...wrapped.map((lines) => lines.length));
      const rowH = linesHigh * lineGap + pad * 2;
      const pageRoom = PDF_PAGE_H - PDF_MARGIN * 2;
      if (rowH > pageRoom) {
        ensure(pageRoom);
      } else {
        ensure(rowH);
      }
      const top = y;
      const bottom = top - Math.min(rowH, y - PDF_MARGIN);
      cmds().push("q");
      for (let i = 0; i < cols; i += 1) {
        const x = PDF_MARGIN + i * colW;
        if (header) cmds().push("0.90 0.90 0.90 rg");
        else cmds().push("1 1 1 rg");
        cmds().push("0.35 0.35 0.35 RG");
        cmds().push(`${x.toFixed(2)} ${bottom.toFixed(2)} ${colW.toFixed(2)} ${(top - bottom).toFixed(2)} re B`);
      }
      cmds().push("0 0 0 rg");
      for (let i = 0; i < cols; i += 1) {
        const x = PDF_MARGIN + i * colW;
        let ty = top - pad - fontSize;
        const font = header ? "F2" : "F1";
        for (const line of wrapped[i]) {
          if (ty < bottom + 2) break;
          cmds().push(`BT /${font} ${fontSize} Tf ${(x + pad).toFixed(2)} ${ty.toFixed(2)} Td (${pdfEscape(line)}) Tj ET`);
          ty -= lineGap;
        }
      }
      cmds().push("Q");
      y = bottom;
    };

    if (headers.length) paintRow(headers, true);
    for (const row of rows) paintRow(row, false);
    y -= 10;
  };

  const roundPath = (x, y, w, h, r) => {
    const radius = Math.min(r, w / 2, h / 2);
    const k = radius * 0.4472;
    const x2 = x + w;
    const y2 = y + h;
    return [
      `${(x + radius).toFixed(2)} ${y.toFixed(2)} m`,
      `${(x2 - radius).toFixed(2)} ${y.toFixed(2)} l`,
      `${(x2 - radius + k).toFixed(2)} ${y.toFixed(2)} ${x2.toFixed(2)} ${(y + radius - k).toFixed(2)} ${x2.toFixed(2)} ${(y + radius).toFixed(2)} c`,
      `${x2.toFixed(2)} ${(y2 - radius).toFixed(2)} l`,
      `${x2.toFixed(2)} ${(y2 - radius + k).toFixed(2)} ${(x2 - radius + k).toFixed(2)} ${y2.toFixed(2)} ${(x2 - radius).toFixed(2)} ${y2.toFixed(2)} c`,
      `${(x + radius).toFixed(2)} ${y2.toFixed(2)} l`,
      `${(x + radius - k).toFixed(2)} ${y2.toFixed(2)} ${x.toFixed(2)} ${(y2 - radius + k).toFixed(2)} ${x.toFixed(2)} ${(y2 - radius).toFixed(2)} c`,
      `${x.toFixed(2)} ${(y + radius).toFixed(2)} l`,
      `${x.toFixed(2)} ${(y + radius - k).toFixed(2)} ${(x + radius - k).toFixed(2)} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)} c`,
      "h",
    ].join(" ");
  };

  const box = (x, bottom, w, h, { fill = "0.98 0.98 0.98 rg", stroke = "0.45 0.45 0.45 RG", radius = 0 } = {}) => {
    cmds().push("q");
    if (fill) cmds().push(fill);
    if (stroke) cmds().push(stroke);
    if (radius > 0) cmds().push(`${roundPath(x, bottom, w, h, radius)} B`);
    else cmds().push(`${x.toFixed(2)} ${bottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
    cmds().push("Q");
  };

  const textAt = (x, baseline, line, { size = 11, bold = false, fill = "0 0 0 rg" } = {}) => {
    cmds().push("q");
    cmds().push(fill);
    const font = bold ? "F2" : "F1";
    cmds().push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${pdfEscape(line)}) Tj ET`);
    cmds().push("Q");
  };

  const drawChip = (x, bottom, w, h, lines, { size = 8 } = {}) => {
    box(x, bottom, w, h, { fill: "1 1 1 rg", stroke: "0.50 0.50 0.50 RG", radius: 0 });
    let ty = bottom + h - 5 - size;
    for (const line of lines) {
      if (ty < bottom + 2) break;
      textAt(x + 5, ty, line, { size });
      ty -= size + 2;
    }
  };

  const drawMermaid = (edges) => {
    const pad = 8;
    const arrowW = 42;
    const innerW = usable - pad * 2;
    const chipW = Math.max(80, (innerW - arrowW) / 2);
    const size = 8;
    const lineGap = size + 2;
    const rows = edges.map((edge) => {
      const from = wrapLines(foldLatin(edge.from), charsForWidth(chipW - 10, size));
      const to = wrapLines(foldLatin(edge.to || ""), charsForWidth(chipW - 10, size));
      const label = foldLatin(edge.label || "");
      const linesHigh = Math.max(from.length || 1, to.length || (edge.to ? 1 : 0), 1);
      const chipH = linesHigh * lineGap + 10;
      const rowH = chipH + (label ? 10 : 0);
      return { from, to, label, chipH, rowH };
    });
    y -= 6;
    for (const row of rows) {
      ensure(row.rowH + 8);
      const bottom = y - row.rowH;
      const chipBottom = bottom + (row.label ? 8 : 0);
      const leftX = PDF_MARGIN + pad;
      const rightX = PDF_MARGIN + pad + chipW + arrowW;
      box(PDF_MARGIN, bottom, usable, row.rowH, {
        fill: "0.96 0.96 0.96 rg",
        stroke: "0.72 0.72 0.72 RG",
        radius: 6,
      });
      if (row.from.length) drawChip(leftX, chipBottom, chipW, row.chipH, row.from, { size });
      if (row.to.length) drawChip(rightX, chipBottom, chipW, row.chipH, row.to, { size });
      const midX = PDF_MARGIN + pad + chipW;
      const midY = chipBottom + row.chipH / 2 - 3;
      textAt(midX + 8, midY, "->", { size: 10, fill: "0.35 0.35 0.35 rg" });
      if (row.label) textAt(midX + 2, chipBottom - 1, row.label, { size: 7, fill: "0.35 0.35 0.35 rg" });
      y = bottom - 5;
    }
    y -= 4;
  };

  const drawCard = (card) => {
    const pad = 8;
    const size = 9;
    const headerSize = 10;
    const wrapW = charsForWidth(usable - pad * 2, size);
    const headerLines = card.header ? wrapLines(foldLatin(card.header), charsForWidth(usable - pad * 2, headerSize)) : [];
    const sectionBlocks = (card.sections || []).map((item) => ({
      lines: wrapLines(foldLatin(item.body), wrapW),
    }));
    const footerLines = card.footer ? wrapLines(foldLatin(card.footer), wrapW) : [];
    const colW = (usable - pad * 3) / 2;
    const colWrap = charsForWidth(colW - 8, size);
    const columns = (card.columns || []).map((col) => ({
      title: foldLatin(col.title || ""),
      lines: wrapLines(foldLatin(col.body || ""), colWrap),
    }));
    const colH = columns.length
      ? Math.max(...columns.map((col) => (col.title ? 14 : 0) + Math.max(col.lines.length, 1) * (size + 3) + 8), 24)
      : 0;
    const headerH = headerLines.length ? headerLines.length * (headerSize + 3) + 10 : 0;
    const sectionsH = sectionBlocks.reduce((sum, item) => sum + item.lines.length * (size + 3) + 6, 0);
    const footerH = footerLines.length ? footerLines.length * (size + 3) + 10 : 0;
    const totalH = pad + headerH + sectionsH + colH + footerH + pad;
    ensure(Math.min(totalH + 4, PDF_PAGE_H - PDF_MARGIN * 2));
    const top = y;
    const bottom = top - totalH;
    box(PDF_MARGIN, bottom, usable, totalH, {
      fill: "0.97 0.96 0.90 rg",
      stroke: "0.77 0.72 0.66 RG",
      radius: 8,
    });
    let cursor = top;
    if (headerH) {
      box(PDF_MARGIN, cursor - headerH, usable, headerH, {
        fill: "0.17 0.14 0.09 rg",
        stroke: "0.17 0.14 0.09 RG",
        radius: 0,
      });
      let ty = cursor - 8 - headerSize;
      for (const line of headerLines) {
        textAt(PDF_MARGIN + pad, ty, line, { size: headerSize, bold: true, fill: "0.97 0.96 0.90 rg" });
        ty -= headerSize + 3;
      }
      cursor -= headerH;
    }
    for (const section of sectionBlocks) {
      let ty = cursor - pad - size;
      for (const line of section.lines) {
        textAt(PDF_MARGIN + pad, ty, line, { size });
        ty -= size + 3;
      }
      cursor = ty + size;
    }
    if (columns.length) {
      const pair = columns.slice(0, 2);
      pair.forEach((col, i) => {
        const x = PDF_MARGIN + pad + i * (colW + pad);
        let ty = cursor - 12 - size;
        if (col.title) {
          textAt(x, ty, col.title, { size: 8, bold: true, fill: "0.45 0.38 0.30 rg" });
          ty -= 12;
        }
        for (const line of col.lines) {
          textAt(x, ty, line, { size });
          ty -= size + 3;
        }
      });
      if (pair.length === 2) {
        const mid = PDF_MARGIN + pad + colW + pad / 2;
        cmds().push("q 0.77 0.72 0.66 RG 0.5 w");
        cmds().push(`${mid.toFixed(2)} ${(cursor - 8).toFixed(2)} m ${mid.toFixed(2)} ${(cursor - colH).toFixed(2)} l S Q`);
      }
      cursor -= colH;
    }
    if (footerLines.length) {
      let ty = cursor - 10 - size;
      footerLines.forEach((line, i) => {
        textAt(PDF_MARGIN + pad, ty, line, { size, bold: i === 0 });
        ty -= size + 3;
      });
    }
    y = bottom - 10;
  };

  for (const block of blocks) {
    if (block.type === "table") {
      y -= 6;
      drawTable(block.table);
      continue;
    }
    if (block.type === "mermaid") {
      drawMermaid(block.edges || []);
      continue;
    }
    if (block.type === "card") {
      y -= 6;
      drawCard(block);
      continue;
    }
    if (block.type === "heading") {
      y -= 6;
      para(block.text, { size: 14, bold: true, gap: 18 });
      continue;
    }
    if (block.type === "list") {
      for (const line of block.lines) para(line, { size: 11, gap: 13 });
      y -= 4;
      continue;
    }
    para(block.text, { size: 11, gap: 14 });
    y -= 4;
  }

  if (!pages[0].length) pages[0].push("BT /F1 11 Tf 48 744 Td ( ) Tj ET");
  return pages.map((list) => list.join("\n"));
}

export function contentToPdf(title, content) {
  const blocks = [];
  if (title) blocks.push({ type: "heading", text: String(title) });
  blocks.push(...previewPdfBlocks(content));
  return assemblePdf(paintPdfPages(blocks));
}

export async function contentToPdfAsync(title, content) {
  const forcePainter = String(process.env.TABULECT_PDF_ENGINE || "").toLowerCase() === "painter";
  if (!forcePainter) {
    const chrome = await resolveChrome();
    if (chrome) {
      const html = renderPrintHtml(title, content);
      const printed = await printHtmlToPdf(html, { chromePath: chrome });
      if (printed) return printed;
    }
  }
  return contentToPdf(title, content);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wText(text, bold = false) {
  const run = `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  return `<w:p>${run}</w:p>`;
}

function wTable(table) {
  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1);
  const grid = Array.from({ length: width }, () => "<w:gridCol w:w=\"2400\"/>").join("");
  const rowXml = (cells, header = false) => {
    const padded = Array.from({ length: width }, (_, i) => cells[i] || "");
    return `<w:tr>${padded
      .map(
        (cell) =>
          `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${wText(cell, header)}</w:tc>`,
      )
      .join("")}</w:tr>`;
  };
  const body = [table.headers.length ? rowXml(table.headers, true) : "", ...table.rows.map((row) => rowXml(row))]
    .filter(Boolean)
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function wShaded(text, fill = "2C2418", color = "F7F6E6", bold = true) {
  return `<w:p><w:pPr><w:shd w:val="clear" w:fill="${fill}"/></w:pPr><w:r><w:rPr>${
    bold ? "<w:b/>" : ""
  }<w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function wMermaid(edges) {
  return (edges || [])
    .map((edge) =>
      wTable({
        headers: [],
        rows: [[edge.from || "", edge.label ? `-> ${edge.label}` : "->", edge.to || ""]],
      }),
    )
    .join("\n");
}

function wCard(card) {
  const parts = [];
  if (card.header) parts.push(wShaded(card.header));
  for (const section of card.sections || []) {
    if (section.body) parts.push(wText(section.body));
  }
  if (card.columns?.length) {
    parts.push(
      wTable({
        headers: card.columns.map((col) => col.title || ""),
        rows: [card.columns.map((col) => col.body || "")],
      }),
    );
  }
  if (card.table) parts.push(wTable(card.table));
  if (card.footer) parts.push(wText(card.footer, true));
  return parts.join("\n");
}

export function contentToDocxXml(title, content) {
  const html = markdownToHtml(content);
  const parts = [];
  if (title) parts.push(wText(title, true));
  const blocks = blocksFromHtml(html);
  for (const block of blocks) {
    if (block.type === "table") {
      parts.push(wTable(block.table));
      continue;
    }
    if (block.type === "mermaid") {
      parts.push(wMermaid(block.edges));
      continue;
    }
    if (block.type === "card") {
      parts.push(wCard(block));
      continue;
    }
    if (block.type === "list") {
      for (const line of block.lines) parts.push(wText(line));
      continue;
    }
    parts.push(wText(block.text, block.type === "heading"));
  }
  if (!blocks.length) {
    const plain = previewPlainText(content);
    for (const line of plain.split(/\n+/)) {
      if (line.trim()) parts.push(wText(line));
    }
  }
  if (!parts.length) parts.push(wText(""));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${parts.join("\n")}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body>
</w:document>`;
}

export function contentToDocx(title, content) {
  const document = contentToDocxXml(title, content);
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return zipEntries([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document },
  ]);
}

export function contentToXlsx(title, content) {
  const tables = previewTables(content);
  if (tables[0]) {
    const width = Math.max(tables[0].headers.length, ...tables[0].rows.map((row) => row.length), 1);
    const headers = Array.from({ length: width }, (_, i) => tables[0].headers[i] || `C${i + 1}`);
    const rows = tables[0].rows.map((row) => headers.map((_, i) => row[i] || ""));
    return buildWorkbookXlsx({ sheetName: title || "Tablo", headers, rows });
  }
  const lines = previewPlainText(content)
    .split(/\n/)
    .map((line) => [line])
    .filter((row) => row[0]);
  return buildWorkbookXlsx({
    sheetName: title || "Cikti",
    headers: [title || "Metin"],
    rows: lines.length ? lines : [[""]],
  });
}

export async function buildExport({ format, title, content }) {
  const kind = EXPORT_FORMATS.includes(format) ? format : "md";
  if (kind === "md") {
    return {
      filename: safeFilename(title, ".md"),
      mime: "text/markdown; charset=utf-8",
      buffer: Buffer.from(String(content || ""), "utf8"),
    };
  }
  if (kind === "html") {
    return {
      filename: safeFilename(title, ".html"),
      mime: "text/html; charset=utf-8",
      buffer: Buffer.from(renderPreviewHtml(title, content), "utf8"),
    };
  }
  if (kind === "pdf") {
    return {
      filename: safeFilename(title, ".pdf"),
      mime: "application/pdf",
      buffer: await contentToPdfAsync(title, content),
    };
  }
  if (kind === "docx") {
    return {
      filename: safeFilename(title, ".docx"),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: contentToDocx(title, content),
    };
  }
  return {
    filename: safeFilename(title, ".xlsx"),
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: contentToXlsx(title, content),
  };
}

export async function writeExportFile(built, directory) {
  const dir = String(directory || "").trim();
  if (!dir) throw new Error("export directory is required");
  await mkdir(dir, { recursive: true });
  const dest = join(dir, built.filename);
  if (extname(dest) !== extname(built.filename)) {
    throw new Error("invalid export path");
  }
  await writeFile(dest, built.buffer);
  return { path: dest, filename: basename(dest), directory: dirname(dest) };
}
