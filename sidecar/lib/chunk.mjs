import { padId } from "./util.mjs";

const DEFAULT_MIN = 900;
const DEFAULT_MAX = 2200;
const DEFAULT_FRAGMENT = 80;

function envPositive(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function chunkConfig() {
  let min = envPositive(process.env.TABULECT_CHUNK_MIN, DEFAULT_MIN);
  let max = envPositive(process.env.TABULECT_CHUNK_MAX, DEFAULT_MAX);
  const fragment = envPositive(process.env.TABULECT_CHUNK_FRAGMENT, DEFAULT_FRAGMENT);
  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min, max, fragment };
}

function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean);
}

function unitsFromPages(pages) {
  const units = [];
  for (const page of pages) {
    const paras = splitParagraphs(page.text);
    const texts = paras.length ? paras : page.text.trim() ? [page.text.trim()] : [];
    for (const text of texts) {
      units.push({ text, page: page.page ?? null });
    }
  }
  return units;
}

/**
 * Pack across pages. Merge fragments under `fragment` chars into a neighbor.
 * New extracts only — existing documents keep their stored chunks.
 */
export function packUnits(units, config = chunkConfig()) {
  const { min, max, fragment } = config;
  const packed = [];
  let buf = null;
  const flush = () => {
    if (buf) packed.push(buf);
    buf = null;
  };
  for (const unit of units) {
    if (!unit?.text) continue;
    if (!buf) {
      buf = { text: unit.text, page: unit.page ?? null };
      continue;
    }
    const nextLen = buf.text.length + unit.text.length + 2;
    const tiny = unit.text.length < fragment || buf.text.length < fragment;
    if (tiny || buf.text.length < min || nextLen <= max) {
      if (!tiny && nextLen > max * 1.35 && buf.text.length >= min) {
        flush();
        buf = { text: unit.text, page: unit.page ?? null };
      } else {
        buf = { text: `${buf.text}\n\n${unit.text}`, page: buf.page };
      }
    } else {
      flush();
      buf = { text: unit.text, page: unit.page ?? null };
    }
  }
  flush();
  return packed;
}

export function chunkExtracted({ pages, title }) {
  const packed = packUnits(unitsFromPages(pages || []));
  const chunks = [];
  let cursor = 0;
  packed.forEach((unit, index) => {
    const text = unit.text;
    const start = cursor;
    const end = start + text.length;
    chunks.push({
      id: padId("c", index),
      text,
      page: unit.page ?? null,
      start,
      end,
    });
    cursor = end + 2;
  });
  return {
    title,
    chunks,
  };
}
