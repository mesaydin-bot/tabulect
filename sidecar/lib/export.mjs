/**
 * Export a saved (or in-memory) document as .xlsx.
 * Keys stay English camelCase; headers follow tableLocale.
 */
import { COLUMN_KEYS, migrateDocument, normalizeLocale, validateDocument } from "./schema.mjs";
import { buildWorkbookXlsx } from "./xlsx.mjs";

export const EXPORT_COLUMN_KEYS = ["rowNumber", "page", ...COLUMN_KEYS];

export const EXPORT_HEADERS = {
  tr: {
    rowNumber: "#",
    page: "Sayfa",
    claim: "Ana iddia",
    warrant: "Gerekçe",
    fact: "Olgu",
    example: "Örnek",
    definition: "Tanım",
    exception: "İstisna / çekince",
    openQuestion: "Açık soru",
    citation: "Alıntı / kaynak",
    practicalSuggestion: "Pratik öneriler",
    objection: "İtiraz",
  },
  en: {
    rowNumber: "#",
    page: "Page",
    claim: "Claim",
    warrant: "Warrant",
    fact: "Fact",
    example: "Example",
    definition: "Definition",
    exception: "Exception / caveat",
    openQuestion: "Open question",
    citation: "Citation",
    practicalSuggestion: "Practical tips",
    objection: "Objection",
  },
};

export function parseExportColumns(raw) {
  if (raw == null || raw === "") return null;
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  const seen = new Set();
  const columns = [];
  for (const key of list) {
    if (!EXPORT_COLUMN_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    columns.push(key);
  }
  return columns.length ? columns : null;
}

export function defaultExportColumns(doc) {
  const hasPage = (doc.rows || []).some((row) => {
    const page = row?.quoteAnchor?.page ?? row?.page;
    return page != null && page !== "";
  });
  return hasPage ? ["rowNumber", "page", ...COLUMN_KEYS] : ["rowNumber", ...COLUMN_KEYS];
}

function cellText(row, key, index) {
  if (key === "rowNumber") return String(index + 1);
  if (key === "page") {
    const page = row?.quoteAnchor?.page ?? row?.page;
    return page == null ? "" : String(page);
  }
  const value = row?.[key];
  if (value == null) return "";
  return String(value);
}

export function filenameForDocument(doc) {
  const title = String(doc?.title || "table")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${title || "table"}.xlsx`;
}

/** ASCII fallback for the quoted filename= parameter (HTTP headers are latin1). */
export function asciiFilename(filename) {
  const base = String(filename || "table.xlsx")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base.endsWith(".xlsx") ? base : `${base || "table"}.xlsx`;
}

export function documentToXlsx(input, { columns } = {}) {
  const { doc } = migrateDocument(input);
  validateDocument(doc);
  const locale = normalizeLocale(doc.tableLocale);
  const keys = parseExportColumns(columns) || defaultExportColumns(doc);
  const labels = EXPORT_HEADERS[locale] || EXPORT_HEADERS.tr;
  const headers = keys.map((key) => labels[key] || key);
  const rows = (doc.rows || []).map((row, index) => keys.map((key) => cellText(row, key, index)));
  return buildWorkbookXlsx({
    sheetName: locale === "en" ? "Table" : "Tablo",
    headers,
    rows,
  });
}
