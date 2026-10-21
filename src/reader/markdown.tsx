function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(raw: string) {
  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  return text;
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function looksLikeHtml(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return false;
  if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text)) return true;
  return /^<(?:div|section|article|table|p|h[1-6]|ul|ol|pre)\b/i.test(text);
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

function sanitizeStyle(value: string) {
  const raw = String(value || "");
  if (/expression|javascript:|@import|behavior|-moz-binding/i.test(raw)) return "";
  return raw.replace(/</g, "");
}

function sanitizeAttrs(tag: string, rawAttrs: string) {
  const out: string[] = [];
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

export function sanitizeHtml(html: string) {
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

export function isMermaidStart(line: string) {
  return MERMAID_START.test(String(line || "").trim());
}

function cleanMermaidLabel(label: string) {
  return String(label || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNodeToken(token: string) {
  const t = String(token || "").trim();
  const m = t.match(/^([A-Za-z][\w-]*)(?:\[["']([^"']+)["']\]|\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?/);
  if (!m) return null;
  return { id: m[1], label: cleanMermaidLabel(m[2] || m[3] || m[4] || m[5] || m[1]) };
}

export function mermaidToHtml(source: string) {
  const text = String(source || "").trim();
  const first = (text.split(/\n/)[0] || "").trim();
  if (/^sequenceDiagram\b/i.test(first)) {
    const rows: string[] = [];
    for (const line of text.split(/\n/).slice(1)) {
      const m = line.trim().match(/^(\S+)\s*-+>+(\S+)\s*:\s*(.+)$/);
      if (m) rows.push(`${escapeHtml(m[1])} → ${escapeHtml(m[2])}: ${escapeHtml(m[3])}`);
    }
    const body = rows.length
      ? rows.map((row) => `<div class="mermaid-edge">${row}</div>`).join("")
      : `<div class="mermaid-edge">${escapeHtml(text.replace(/^sequenceDiagram\b/i, "").trim())}</div>`;
    return `<div class="mermaid-diagram" data-kind="sequence">${body}</div>`;
  }
  const nodes = new Map<string, string>();
  const edges: Array<{ from: string; to: string; label: string }> = [];
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
        .map((label) => `<span class="mermaid-node">${escapeHtml(cleanMermaidLabel(label))}</span>`)
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

function fenceLang(line: string) {
  return String(line || "")
    .replace(/^\s*```/, "")
    .trim()
    .toLowerCase();
}

function isHtmlOpenLine(line: string) {
  return /^\s*<(div|section|article|table|p|h[1-6]|ul|ol|figure|blockquote|aside)\b/i.test(line);
}

function htmlTagDelta(line: string) {
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

function consumeHtmlBlock(lines: string[], start: number) {
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

function consumeMermaidBlock(lines: string[], start: number) {
  const buf = [lines[start]];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      const peek = lines[i + 1] || "";
      if (!peek.trim() || /^\s*(```|# |\||<)/.test(peek) || isMermaidStart(peek) || isHtmlOpenLine(peek)) break;
    }
    if (
      /^\s*```/.test(line) ||
      (/^\s*# /.test(line) && buf.length > 1) ||
      (/^\s*\|/.test(line) && /^\s*\|?\s*:?-/.test(lines[i + 1] || ""))
    ) {
      break;
    }
    if (isHtmlOpenLine(line)) break;
    buf.push(line);
    i += 1;
    if (i - start > 80) break;
  }
  return { html: mermaidToHtml(buf.join("\n")), next: i };
}

export function markdownToHtml(raw: string) {
  const source = String(raw || "").replace(/\r\n/g, "\n");
  if (!source.trim()) return "";
  if (looksLikeHtml(source) && /<\/[a-z]+>/i.test(source)) return sanitizeHtml(source);
  const lines = source.split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
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
      const fence: string[] = [];
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
      const rows: string[][] = [];
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
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
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

export function MarkdownPreview({ content }: { content: string }) {
  const html = markdownToHtml(content);
  if (!html) return <p className="output-empty-inline">—</p>;
  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
