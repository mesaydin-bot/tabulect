import type { BookmarkSpan, Chunk, HighlightRange, StepSize } from "../types/document";

export type SourceUnit = {
  kind: "line" | "paragraph" | "word" | "phrase";
  chunkId: string;
  start: number;
  end: number;
  text: string;
  page: number | null;
};

export function normalizeStep(raw: string | null | undefined): StepSize {
  if (raw === "paragraph") return "paragraph";
  if (raw === "1" || raw === "2" || raw === "3" || raw === "4" || raw === "5") return raw;
  return "1";
}

export function lineRanges(text: string): Array<{ start: number; end: number; text: string }> {
  const raw = text ?? "";
  if (raw.length === 0) return [{ start: 0, end: 0, text: "" }];
  const parts = raw.split("\n");
  const lines: Array<{ start: number; end: number; text: string }> = [];
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
const CLOSING_END = /[)”»"']$/;

export function looksLikeHardWrap(prev: string, next: string): boolean {
  const a = String(prev || "").replace(/\s+$/g, "");
  const b = String(next || "").replace(/^\s+/g, "");
  if (!a || !b) return false;
  const listish = (line: string) =>
    /^\s*(\d+|[ivxlc]+)([.)]|\s)/i.test(line) || /^\s*[-*•·]\s/.test(line);
  if (listish(a) || listish(b)) return false;
  if (/[-–—]$/.test(a) && /^[\p{L}]/u.test(b)) return true;
  const core = a.replace(/[)”»"']+$/g, "");
  if (SENTENCE_END.test(a) || SENTENCE_END.test(core)) return false;
  if (CLOSING_END.test(a) && SENTENCE_END.test(core)) return false;
  if (/^[\p{Ll}]/u.test(b)) return true;
  if (/[,;]$/.test(a)) return true;
  if (a.length <= 40 && /^[\p{Lu}]/u.test(b)) return false;
  return a.length <= 78 && b.length <= 78 && /[\p{L})]$/u.test(a);
}

function wrapFlowToVisualLines(
  raw: string,
  flowStart: number,
  flowEnd: number,
  width: number,
): Array<{ start: number; end: number; text: string }> {
  const segment = raw.slice(flowStart, flowEnd);
  const tokens: Array<{ start: number; end: number; ws: boolean; count: number }> = [];
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
  const lines: Array<{ start: number; end: number; text: string }> = [];
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

/** Readable lines as the source pane wraps them (HTML collapses lone newlines). */
export function visualLineRanges(
  text: string,
  charsPerLine = 72,
): Array<{ start: number; end: number; text: string }> {
  const raw = text ?? "";
  if (!raw.length) return [{ start: 0, end: 0, text: "" }];
  const width = Math.max(12, Math.floor(charsPerLine) || 72);
  const paras = paragraphRanges(raw);
  const result: Array<{ start: number; end: number; text: string }> = [];
  for (const para of paras) {
    const physical = lineRanges(para.text).map((line) => ({
      start: para.start + line.start,
      end: para.start + line.start + line.text.length,
      text: line.text,
    }));
    const flows: Array<{ start: number; end: number; lines: typeof physical }> = [];
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

export function indexOfUnitOffset(units: SourceUnit[], chunkId: string, offset: number): number {
  const exact = units.findIndex(
    (unit) => unit.chunkId === chunkId && offset >= unit.start && offset < Math.max(unit.end, unit.start + 1),
  );
  if (exact >= 0) return exact;
  return units.findIndex((unit) => unit.chunkId === chunkId && offset >= unit.start && offset <= unit.end);
}

export function paragraphRanges(text: string): Array<{ start: number; end: number; text: string }> {
  const raw = text ?? "";
  if (!raw.length) return [{ start: 0, end: 0, text: "" }];
  const ranges: Array<{ start: number; end: number; text: string }> = [];
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

export function unitsForStep(
  chunks: Chunk[],
  step: StepSize,
  opts: { charsPerLine?: number } = {},
): SourceUnit[] {
  const units: SourceUnit[] = [];
  const kind = step === "paragraph" ? "paragraph" : "line";
  const charsPerLine = opts.charsPerLine ?? 72;
  for (const chunk of chunks) {
    const local =
      kind === "paragraph" ? paragraphRanges(chunk.text) : visualLineRanges(chunk.text, charsPerLine);
    for (const item of local) {
      units.push({
        kind,
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

export function stepWidth(step: StepSize): number {
  return step === "paragraph" ? 1 : Number.parseInt(step, 10) || 1;
}

export function clampWindow(start: number, end: number, length: number): HighlightRange {
  if (length <= 0) return { start: 0, end: 0, empty: true };
  const lo = Math.max(0, Math.min(start, length - 1));
  const hi = Math.max(lo, Math.min(end, length - 1));
  return { start: lo, end: hi, empty: false };
}

export function windowAt(index: number, step: StepSize, length: number): HighlightRange {
  const width = stepWidth(step);
  if (length <= 0) return { start: 0, end: 0, empty: true };
  const start = Math.max(0, Math.min(index, length - 1));
  return clampWindow(start, start + width - 1, length);
}

export function moveHighlight(
  current: HighlightRange | null,
  opts: { direction: -1 | 1; shift?: boolean; step: StepSize; length: number },
): HighlightRange {
  const width = stepWidth(opts.step);
  if (opts.length <= 0) return { start: 0, end: 0, empty: true };
  if (!current || current.empty) {
    if (opts.direction < 0) return windowAt(Math.max(0, opts.length - width), opts.step, opts.length);
    return windowAt(0, opts.step, opts.length);
  }
  if (!opts.shift) {
    const next = opts.direction > 0 ? current.end + 1 : current.start - width;
    return windowAt(next, opts.step, opts.length);
  }
  if (opts.direction > 0) return clampWindow(current.start, current.end + width, opts.length);
  return clampWindow(current.start - width, current.end, opts.length);
}

export function spansFromUnits(units: SourceUnit[], start: number, end: number): Array<BookmarkSpan & { text: string }> {
  if (!units.length) return [];
  const lo = Math.max(0, start);
  const hi = Math.min(units.length - 1, end);
  if (lo > hi) return [];
  const spans: Array<BookmarkSpan & { text: string }> = [];
  for (let i = lo; i <= hi; i += 1) {
    const unit = units[i];
    const last = spans[spans.length - 1];
    if (last && last.chunkId === unit.chunkId && unit.start <= last.end + 1) {
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

export function textFromSpans(spans: Array<{ text?: string }>): string {
  return spans
    .map((span) => String(span.text || ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function searchUnits(units: SourceUnit[], query: string): number[] {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return [];
  const hits: number[] = [];
  units.forEach((unit, index) => {
    if (String(unit.text || "").toLocaleLowerCase("tr").includes(q)) hits.push(index);
  });
  return hits;
}

export function rangesByChunk(
  units: SourceUnit[],
  highlight: HighlightRange | null,
): Map<string, Array<{ start: number; end: number }>> {
  const map = new Map<string, Array<{ start: number; end: number }>>();
  if (!highlight || highlight.empty || !units.length) return map;
  const spans = spansFromUnits(units, highlight.start, highlight.end);
  for (const span of spans) {
    const list = map.get(span.chunkId) || [];
    list.push({ start: span.start, end: span.end });
    map.set(span.chunkId, list);
  }
  return map;
}
