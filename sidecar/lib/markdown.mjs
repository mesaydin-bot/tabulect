/**
 * Small markdown helpers for preview/export. No extra dependency.
 */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function looksLikeHtml(raw) {
  const text = String(raw || "").trim();
  if (!text) return false;
  if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text)) return true;
  return /^<(?:div|section|article|table|p|h[1-6]|ul|ol|pre)\b/i.test(text);
}

export function parseMarkdownTables(raw) {
  const text = String(raw || "");
  const tables = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] || "";
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-/.test(next)) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      tables.push({ headers: header, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

function splitRow(line) {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function inlineMarkdown(raw) {
  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  return text;
}

const ALLOWED_TAGS = new Set([
  "div",
  "span",
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "small",
  "sup",
  "sub",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "img",
  "a",
  "section",
  "article",
  "figure",
  "figcaption",
  "aside",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const ALLOWED_ATTRS = new Set(["class", "id", "style", "href", "src", "alt", "title", "width", "height", "colspan", "rowspan"]);

function sanitizeStyle(value) {
  const raw = String(value || "");
  if (/expression|javascript:|@import|behavior|-moz-binding/i.test(raw)) return "";
  return raw.replace(/</g, "");
}

function sanitizeAttrs(tag, rawAttrs) {
  const out = [];
  const re = /([a-zA-Z:_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match = re.exec(rawAttrs);
  while (match) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    match = re.exec(rawAttrs);
    if (name.startsWith("on")) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) continue;
    if (name === "style") {
      const style = sanitizeStyle(value);
      if (style) out.push(`style="${escapeHtml(style)}"`);
      continue;
    }
    if (name === "href") {
      out.push(`href="${escapeHtml(value)}" rel="noreferrer"`);
      continue;
    }
    out.push(`${name}="${escapeHtml(value)}"`);
  }
  if (tag === "a" && !out.some((item) => item.startsWith("rel="))) out.push('rel="noreferrer"');
  return out.length ? ` ${out.join(" ")}` : "";
}

export function sanitizeHtml(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math)[^>]*>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g, (all, name, attrs) => {
    const tag = String(name).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (all.startsWith("</")) return `</${tag}>`;
    const self = VOID_TAGS.has(tag) || /\/>$/.test(all.trim());
    return `<${tag}${sanitizeAttrs(tag, attrs)}${self ? " /" : ""}>`;
  });
  return s;
}

const MERMAID_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|journey|gitGraph)\b/i;

export function isMermaidStart(line) {
  return MERMAID_START.test(String(line || "").trim());
}

function cleanMermaidLabel(label) {
  return String(label || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNodeToken(token) {
  const t = String(token || "").trim();
  const m = t.match(
    /^([A-Za-z][\w-]*)(?:\[["']([^"']+)["']\]|\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?/,
  );
  if (!m) return null;
  return { id: m[1], label: cleanMermaidLabel(m[2] || m[3] || m[4] || m[5] || m[1]) };
}

export function mermaidToHtml(source) {
  const text = String(source || "").trim();
  const first = (text.split(/\n/)[0] || "").trim();
  if (/^sequenceDiagram\b/i.test(first)) {
    const rows = [];
    for (const line of text.split(/\n/).slice(1)) {
      const m = line.trim().match(/^(\S+)\s*-+>+(\S+)\s*:\s*(.+)$/);
      if (m) rows.push(`${escapeHtml(m[1])} → ${escapeHtml(m[2])}: ${escapeHtml(m[3])}`);
    }
    const body = rows.length
      ? rows.map((row) => `<div class="mermaid-edge">${row}</div>`).join("")
      : `<div class="mermaid-edge">${escapeHtml(text.replace(/^sequenceDiagram\b/i, "").trim())}</div>`;
    return `<div class="mermaid-diagram" data-kind="sequence">${body}</div>`;
  }
  const nodes = new Map();
  const edges = [];
  for (const rawLine of text.split(/\n/).slice(1)) {
    const line = rawLine.trim();
    if (!line || /^(subgraph|end|style|classDef|class|linkStyle|click)\b/i.test(line)) continue;
    const em = line.match(/^(.+?)\s*(-->|---|-.->|==>|--)\s*(?:\|([^|]+)\|)?\s*(.+)$/);
    if (em) {
      const left = parseNodeToken(em[1]);
      const right = parseNodeToken(em[4]);
      if (left && right) {
        if (!nodes.has(left.id)) nodes.set(left.id, left.label);
        if (!nodes.has(right.id)) nodes.set(right.id, right.label);
        edges.push({
          from: left.id,
          to: right.id,
          label: cleanMermaidLabel(String(em[3] || "").replace(/^["']|["']$/g, "")),
        });
      }
      continue;
    }
    const solo = parseNodeToken(line);
    if (solo && !nodes.has(solo.id)) nodes.set(solo.id, solo.label);
  }
  if (!edges.length && !nodes.size) {
    const labels = [...text.matchAll(/\[["']([^"']+)["']\]|\[([^\]]+)\]/g)].map((m) => m[1] || m[2]).filter(Boolean);
    if (labels.length) {
      return `<div class="mermaid-diagram" data-kind="graph">${labels
        .map((label) => `<span class="mermaid-node">${escapeHtml(label)}</span>`)
        .join('<span class="mermaid-arrow">→</span>')}</div>`;
    }
    return `<div class="mermaid-diagram" data-kind="graph"><div class="mermaid-edge">${escapeHtml(
      text.replace(MERMAID_START, "").trim() || "Diagram",
    )}</div></div>`;
  }
  const body = edges.length
    ? edges
        .map((edge) => {
          const label = edge.label ? `<span class="mermaid-edge-label">${escapeHtml(edge.label)}</span>` : "";
          return `<div class="mermaid-edge"><span class="mermaid-node">${escapeHtml(
            nodes.get(edge.from) || edge.from,
          )}</span><span class="mermaid-arrow">→${label}</span><span class="mermaid-node">${escapeHtml(
            nodes.get(edge.to) || edge.to,
          )}</span></div>`;
        })
        .join("")
    : [...nodes.values()].map((label) => `<span class="mermaid-node">${escapeHtml(label)}</span>`).join("");
  return `<div class="mermaid-diagram" data-kind="flowchart">${body}</div>`;
}

function fenceLang(line) {
  return String(line || "")
    .replace(/^\s*```/, "")
    .trim()
    .toLowerCase();
}

function isHtmlOpenLine(line) {
  return /^\s*<(div|section|article|table|p|h[1-6]|ul|ol|figure|blockquote|aside)\b/i.test(line);
}

function htmlTagDelta(line) {
  let delta = 0;
  const re = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match = re.exec(line);
  while (match) {
    const tag = match[1].toLowerCase();
    const token = match[0];
    match = re.exec(line);
    if (token.startsWith("</")) delta -= 1;
    else if (!VOID_TAGS.has(tag) && !/\/>$/.test(token)) delta += 1;
  }
  return delta;
}

function consumeHtmlBlock(lines, start) {
  const buf = [lines[start]];
  let depth = htmlTagDelta(lines[start]);
  let i = start + 1;
  while (i < lines.length && (depth > 0 || (depth === 0 && i === start + 1 && !buf.join("").includes("</")))) {
    if (depth <= 0 && i > start + 1 && !lines[i].trim()) break;
    if (depth <= 0 && i > start && /^\s*(```|# |\||flowchart\b|graph\b)/i.test(lines[i])) break;
    buf.push(lines[i]);
    depth += htmlTagDelta(lines[i]);
    i += 1;
    if (i - start > 80) break;
    if (depth <= 0 && i > start + 1) break;
  }
  return { html: sanitizeHtml(buf.join("\n")), next: i };
}

function consumeMermaidBlock(lines, start) {
  const buf = [lines[start]];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      const peek = lines[i + 1] || "";
      if (!peek.trim() || /^\s*(```|# |\||<)/.test(peek) || isMermaidStart(peek) || isHtmlOpenLine(peek)) break;
    }
    if (/^\s*```/.test(line) || (/^\s*# /.test(line) && buf.length > 1) || (/^\s*\|/.test(line) && /^\s*\|?\s*:?-/.test(lines[i + 1] || ""))) {
      break;
    }
    if (isHtmlOpenLine(line)) break;
    buf.push(line);
    i += 1;
    if (i - start > 80) break;
  }
  return { html: mermaidToHtml(buf.join("\n")), next: i };
}

export function markdownToHtml(raw) {
  const source = String(raw || "").replace(/\r\n/g, "\n");
  if (!source.trim()) return "";
  if (looksLikeHtml(source) && /<\/[a-z]+>/i.test(source)) return sanitizeHtml(source);
  const lines = source.split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const body = para.join(" ").trim();
    if (body) out.push(`<p>${inlineMarkdown(body)}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const lang = fenceLang(line);
      const fence = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        fence.push(lines[i]);
        i += 1;
      }
      const body = fence.join("\n");
      if (lang === "mermaid" || isMermaidStart(fence[0] || "")) out.push(mermaidToHtml(body));
      else if (lang === "html" || lang === "htm" || looksLikeHtml(body)) out.push(sanitizeHtml(body));
      else out.push(`<pre><code>${escapeHtml(body)}</code></pre>`);
      i += 1;
      continue;
    }
    if (isMermaidStart(line)) {
      flushPara();
      const block = consumeMermaidBlock(lines, i);
      out.push(block.html);
      i = block.next;
      continue;
    }
    if (isHtmlOpenLine(line)) {
      flushPara();
      const block = consumeHtmlBlock(lines, i);
      out.push(block.html);
      i = block.next;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-/.test(lines[i + 1] || "")) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flushPara();
  return out.join("\n");
}

export function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function stripHtml(html) {
  return decodeHtmlEntities(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMarkdownTokens(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\|?\s*:?-+:?\s*\|.*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rendered preview as plain text — no leftover `#` / `**` / table pipes. */
export function htmlToPlainText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<\/(p|h[1-6]|div|pre|blockquote)>/gi, "\n\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseHtmlTables(html) {
  const tables = [];
  const blocks = String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const raw of blocks) {
    const headers = [...raw.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => stripHtml(match[1]));
    const rows = [];
    for (const tr of raw.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      if (/<th/i.test(tr) && !/<td/i.test(tr)) continue;
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
      if (cells.length) rows.push(cells);
    }
    if (headers.length || rows.length) tables.push({ headers, rows });
  }
  return tables;
}

export function previewTables(content) {
  const html = markdownToHtml(content);
  const fromHtml = parseHtmlTables(html);
  if (fromHtml.length) return fromHtml;
  return parseMarkdownTables(content).map((table) => ({
    headers: table.headers.map(stripMarkdownTokens),
    rows: table.rows.map((row) => row.map(stripMarkdownTokens)),
  }));
}

export function previewPlainText(content) {
  return htmlToPlainText(markdownToHtml(content));
}

export function walkHtmlBlocks(html) {
  const source = String(html || "");
  const blocks = [];
  const openRe = /<(h[1-6]|p|pre|ul|ol|table|div)(\s[^>]*)?>/gi;
  let i = 0;
  while (i < source.length) {
    openRe.lastIndex = i;
    const open = openRe.exec(source);
    if (!open) {
      const rest = source.slice(i);
      if (stripHtml(rest).trim()) blocks.push({ tag: "p", attrs: "", inner: rest, html: rest });
      break;
    }
    if (open.index > i) {
      const between = source.slice(i, open.index);
      if (stripHtml(between).trim()) blocks.push({ tag: "p", attrs: "", inner: between, html: between });
    }
    const tag = open[1].toLowerCase();
    const attrs = open[2] || "";
    const afterOpen = open.index + open[0].length;
    const closeRe = new RegExp(`</${tag}\\s*>|<${tag}\\b[^>]*>`, "gi");
    closeRe.lastIndex = afterOpen;
    let depth = 1;
    let end = -1;
    let match = closeRe.exec(source);
    while (match) {
      if (match[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          end = match.index;
          i = match.index + match[0].length;
          break;
        }
      } else if (!/\/>$/.test(match[0])) {
        depth += 1;
      }
      match = closeRe.exec(source);
    }
    if (end < 0) {
      const inner = source.slice(afterOpen);
      blocks.push({ tag, attrs, inner, html: source.slice(open.index) });
      break;
    }
    blocks.push({
      tag,
      attrs,
      inner: source.slice(afterOpen, end),
      html: source.slice(open.index, i),
    });
  }
  return blocks;
}

export function wrapHtmlDocument(title, body) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title || "Tabulect")}</title>
<style>
${PREVIEW_CSS}
</style>
</head>
<body>
<article class="md-preview">
${body}
</article>
</body>
</html>`;
}

const PREVIEW_CSS = `
  html, body { background: #fff; color: #1a1a1a; }
  body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; margin: 0; padding: 0; }
  .md-preview { width: 100%; max-width: none; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 16px; line-height: 1.55; }
  .md-preview table { border-collapse: collapse; table-layout: fixed; width: 100%; max-width: 100%; margin: 0.8rem 0; }
  .md-preview th, .md-preview td { border: 1px solid #ccc; padding: 0.4rem 0.55rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
  .md-preview th { background: #f4f4f4; }
  .md-preview img, .md-preview pre, .md-preview code { max-width: 100%; }
  .md-preview pre { background: #f6f6f6; padding: 0.8rem; overflow-x: auto; }
  .md-preview .mermaid-diagram { display: flex; flex-direction: column; gap: 0.55rem; margin: 1rem 0; padding: 0.85rem 1rem; border: 1px solid #ccc; border-radius: 10px; background: #f7f7f7; }
  .md-preview .mermaid-edge { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.95em; }
  .md-preview .mermaid-node { display: inline-block; padding: 0.28rem 0.55rem; border: 1px solid #bbb; border-radius: 8px; background: #fff; }
  .md-preview .mermaid-arrow { color: #666; }
  .md-preview .mermaid-edge-label { font-size: 0.85em; color: #666; }
  .md-preview > div:not(.mermaid-diagram) { max-width: 100%; overflow-x: auto; }
`;

/** Same preview HTML Chrome prints to PDF (WYSIWYG). */
export function wrapPrintDocument(title, body) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title || "Tabulect")}</title>
<style>
@page { size: A4; margin: 14mm; }
${PREVIEW_CSS}
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    html, body { background: #fff; }
    .md-preview { font-size: 12.5pt; }
  }
</style>
</head>
<body>
<article class="md-preview">
${body}
</article>
</body>
</html>`;
}
