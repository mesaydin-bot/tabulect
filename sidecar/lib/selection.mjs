/**
 * Line / paragraph units for keyboard highlight.
 * Step size is the window; arrows move or (with Shift) accumulate.
 */

export const STEP_IDS = ["1", "2", "3", "4", "5", "paragraph"];

export function normalizeStep(raw) {
  const value = String(raw ?? "1");
  if (value === "paragraph") return "paragraph";
  const n = Number.parseInt(value, 10);
  if (n >= 1 && n <= 5) return String(n);
  return "1";
}

export function lineRanges(text) {
  const raw = String(text ?? "");
  if (raw.length === 0) return [{ start: 0, end: 0, text: "" }];
  const parts = raw.split("\n");
  const lines = [];
  let start = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const line = parts[i];
    const end = start + line.length;
    lines.push({ start, end, text: line });
    start = end + (i < parts.length - 1 ? 1 : 0);
  }
  return lines;
}

const SENTENCE_END = /[.!?…:;]$/;

export function looksLikeHardWrap(prev, next) {
  const a = String(prev || "").replace(/\s+$/g, "");
  const b = String(next || "").replace(/^\s+/g, "");
  if (!a || !b) return false;
  const listish = (line) => /^\s*(\d+|[ivxlc]+)([.)]|\s)/i.test(line) || /^\s*[-*•·]\s/.test(line);
  if (listish(a) || listish(b)) return false;
  if (/[-–—]$/.test(a) && /^[\p{L}]/u.test(b)) return true;
  const core = a.replace(/[)”»"']+$/g, "");
  if (SENTENCE_END.test(a) || SENTENCE_END.test(core)) return false;
  if (/^[\p{Ll}]/u.test(b)) return true;
  if (/[,;]$/.test(a)) return true;
  if (a.length <= 40 && /^[\p{Lu}]/u.test(b)) return false;
  return a.length <= 78 && b.length <= 78 && /[\p{L})]$/u.test(a);
}

function wrapFlowToVisualLines(raw, flowStart, flowEnd, width) {
  const segment = raw.slice(flowStart, flowEnd);
  const tokens = [];
  const re = /\S+|\s+/g;
  let match = re.exec(segment);
  while (match) {
    const start = flowStart + match.index;
    const text = match[0];
    const ws = /^\s+$/.test(text);
    tokens.push({
      start,
      end: start + text.length,
      ws,
      count: ws ? (/\n/.test(text) ? 1 : text.length) : text.length,
    });
    match = re.exec(segment);
  }
  const lines = [];
  let i = 0;
  while (i < tokens.length) {
    while (i < tokens.length && tokens[i].ws) i += 1;
    if (i >= tokens.length) break;
    let used = 0;
    const start = tokens[i].start;
    let end = tokens[i].end;
    let j = i;
    while (j < tokens.length) {
      const tok = tokens[j];
      const add = tok.ws ? (used === 0 ? 0 : 1) : tok.count;
      if (!tok.ws && used > 0 && used + add > width) break;
      if (!tok.ws || used > 0) {
        end = tok.end;
        used += add;
      }
      j += 1;
      if (!tok.ws && used >= width) break;
    }
    if (j === i) {
      end = tokens[i].end;
      j = i + 1;
    }
    lines.push({ start, end, text: raw.slice(start, end) });
    i = j;
  }
  return lines.length ? lines : [{ start: flowStart, end: flowEnd, text: raw.slice(flowStart, flowEnd) }];
}

export function visualLineRanges(text, charsPerLine = 72) {
  const raw = String(text ?? "");
  if (!raw.length) return [{ start: 0, end: 0, text: "" }];
  const width = Math.max(12, Math.floor(charsPerLine) || 72);
  const paras = paragraphRanges(raw);
  const result = [];
  for (const para of paras) {
    const physical = lineRanges(para.text).map((line) => ({
      start: para.start + line.start,
      end: para.start + line.start + line.text.length,
      text: line.text,
    }));
    const flows = [];
    for (const line of physical) {
      const prev = flows[flows.length - 1];
      const prevLine = prev?.lines[prev.lines.length - 1];
      if (prev && prevLine && looksLikeHardWrap(prevLine.text, line.text)) {
        prev.lines.push(line);
        prev.end = line.end;
      } else {
        flows.push({ start: line.start, end: line.end, lines: [line] });
      }
    }
    for (const flow of flows) {
      result.push(...wrapFlowToVisualLines(raw, flow.start, flow.end, width));
    }
  }
  return result.length ? result : [{ start: 0, end: raw.length, text: raw }];
}

export function indexOfUnitOffset(units, chunkId, offset) {
  const exact = units.findIndex(
    (unit) => unit.chunkId === chunkId && offset >= unit.start && offset < Math.max(unit.end, unit.start + 1),
  );
  if (exact >= 0) return exact;
  return units.findIndex((unit) => unit.chunkId === chunkId && offset >= unit.start && offset <= unit.end);
}

export function paragraphRanges(text) {
  const raw = String(text ?? "");
  if (!raw.length) return [{ start: 0, end: 0, text: "" }];
  const ranges = [];
  const re = /\n[ \t]*\n+/g;
  let last = 0;
  let match = re.exec(raw);
  while (match) {
    const end = match.index;
    const slice = raw.slice(last, end);
    if (slice.trim()) ranges.push({ start: last, end, text: slice });
    last = match.index + match[0].length;
    match = re.exec(raw);
  }
  if (last < raw.length) {
    const slice = raw.slice(last);
    if (slice.trim() || ranges.length === 0) {
      ranges.push({ start: last, end: raw.length, text: slice });
    }
  }
  return ranges.length ? ranges : [{ start: 0, end: raw.length, text: raw }];
}

export function buildLineIndex(chunks) {
  const units = [];
  for (const chunk of chunks || []) {
    const local = lineRanges(chunk.text);
    for (const line of local) {
      units.push({
        kind: "line",
        chunkId: chunk.id,
        start: line.start,
        end: line.end,
        text: line.text,
        page: chunk.page ?? null,
      });
    }
  }
  return units;
}

export function buildParagraphIndex(chunks) {
  const units = [];
  for (const chunk of chunks || []) {
    const local = paragraphRanges(chunk.text);
    for (const para of local) {
      units.push({
        kind: "paragraph",
        chunkId: chunk.id,
        start: para.start,
        end: para.end,
        text: para.text,
        page: chunk.page ?? null,
      });
    }
  }
  return units;
}

export function unitsForStep(chunks, step, opts = {}) {
  const mode = normalizeStep(step);
  if (mode === "paragraph") return buildParagraphIndex(chunks);
  const charsPerLine = Number(opts.charsPerLine) || 72;
  const units = [];
  for (const chunk of chunks || []) {
    for (const item of visualLineRanges(chunk.text, charsPerLine)) {
      units.push({
        kind: "line",
        chunkId: chunk.id,
        start: item.start,
        end: item.end,
        text: item.text,
        page: chunk.page ?? null,
      });
    }
  }
  return units;
}

export function stepWidth(step) {
  const mode = normalizeStep(step);
  if (mode === "paragraph") return 1;
  return Number.parseInt(mode, 10) || 1;
}

export function clampWindow(start, end, length) {
  if (length <= 0) return { start: 0, end: 0, empty: true };
  const lo = Math.max(0, Math.min(start, length - 1));
  const hi = Math.max(lo, Math.min(end, length - 1));
  return { start: lo, end: hi, empty: false };
}

export function windowAt(index, step, length) {
  const width = stepWidth(step);
  if (length <= 0) return { start: 0, end: 0, empty: true };
  const start = Math.max(0, Math.min(index, length - 1));
  return clampWindow(start, start + width - 1, length);
}

/**
 * @param {{ start: number, end: number } | null} current
 * @param {{ direction: -1 | 1, shift?: boolean, step?: string, length: number }} opts
 */
export function moveHighlight(current, { direction, shift = false, step = "1", length }) {
  const width = stepWidth(step);
  if (length <= 0) return { start: 0, end: 0, empty: true };
  if (!current || current.empty) {
    if (direction < 0) return windowAt(Math.max(0, length - width), step, length);
    return windowAt(0, step, length);
  }
  if (!shift) {
    const next = direction > 0 ? current.end + 1 : current.start - width;
    return windowAt(next, step, length);
  }
  if (direction > 0) {
    return clampWindow(current.start, current.end + width, length);
  }
  return clampWindow(current.start - width, current.end, length);
}

export function spansFromUnits(units, start, end) {
  if (!units?.length) return [];
  const lo = Math.max(0, start);
  const hi = Math.min(units.length - 1, end);
  if (lo > hi) return [];
  const spans = [];
  for (let i = lo; i <= hi; i += 1) {
    const unit = units[i];
    const last = spans[spans.length - 1];
    if (last && last.chunkId === unit.chunkId && last.end === unit.start) {
      last.end = unit.end;
      last.text = `${last.text}${unit.text.startsWith("\n") ? "" : last.text.endsWith("\n") ? "" : "\n"}${unit.text}`.replace(
        /\n+/g,
        (m, offset) => (offset === 0 ? m : "\n"),
      );
      continue;
    }
    if (last && last.chunkId === unit.chunkId && unit.start >= last.start && unit.start <= last.end + 1) {
      last.end = Math.max(last.end, unit.end);
      last.text = last.text && unit.text ? `${last.text}\n${unit.text}` : last.text || unit.text;
      continue;
    }
    spans.push({
      chunkId: unit.chunkId,
      start: unit.start,
      end: unit.end,
      page: unit.page ?? null,
      text: unit.text,
    });
  }
  return spans;
}

export function textFromSpans(spans) {
  return (spans || [])
    .map((span) => String(span.text || ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function searchUnits(units, query) {
  const q = String(query || "").trim().toLocaleLowerCase("tr");
  if (!q) return [];
  const hits = [];
  units.forEach((unit, index) => {
    const hay = String(unit.text || "").toLocaleLowerCase("tr");
    if (hay.includes(q)) hits.push(index);
  });
  return hits;
}
