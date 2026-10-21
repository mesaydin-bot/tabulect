/**
 * Prompt templates live in the data directory. Defaults can be restored.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dataRoot, pathsFor } from "./store.mjs";
import { pathExists } from "./util.mjs";

const TR_SELECTION =
  "Seçili metni bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her hücre seçilen pasaja dayansın. Uydurma. Hücreler kısa ve net olsun. Kullanıcı açıkça diyagram, mermaid, flowchart veya HTML kart istemedikçe yalnızca tabloyu ver; tablodan sonra mermaid, flowchart veya süs HTML ekleme.";
const TR_BOOKMARKS =
  "Aşağıdaki yer imlerini tek bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her satır bir yer imine karşılık gelsin. Metinde olmayan iddia uydurma. Kullanıcı açıkça diyagram, mermaid, flowchart veya HTML kart istemedikçe yalnızca tabloyu ver; tablodan sonra mermaid, flowchart veya süs HTML ekleme.";

/**
 * Built-in prompts are English by default (international use). `bodyTr` is the Turkish
 * translation, used when the interface language is Turkish. A user may edit any template;
 * an edited built-in is marked `customized` and can be reset to the default.
 */
export const DEFAULT_TEMPLATES = [
  {
    id: "tpl-selection-table",
    name: "Seçim → tablo",
    nameEn: "Selection → table",
    scope: "selection",
    builtin: true,
    customized: false,
    body:
      "Turn the selected text into a reading table. Return a markdown table with the columns: Main idea | Reasoning | Example | Practical tip. Ground every cell in the selected passage. Do not invent anything. Keep cells short and clear. Unless the user explicitly asks for a diagram, Mermaid, flowchart or HTML card, return only the table; do not append Mermaid, flowcharts or decorative HTML after it.",
    bodyTr: TR_SELECTION,
  },
  {
    id: "tpl-bookmarks-table",
    name: "Yer imleri → tablo",
    nameEn: "Bookmarks → table",
    scope: "bookmarks",
    builtin: true,
    customized: false,
    body:
      "Turn the bookmarks below into one reading table. Return a markdown table with the columns: Main idea | Reasoning | Example | Practical tip. One row per bookmark. Do not invent claims that are not in the text. Unless the user explicitly asks for a diagram, Mermaid, flowchart or HTML card, return only the table; do not append Mermaid, flowcharts or decorative HTML after it.",
    bodyTr: TR_BOOKMARKS,
  },
];

/** Bodies that count as "not customized" (older defaults and the translations). */
const PREVIOUS_BUILTIN_BODIES = new Set([
  "Seçili metni tabloya dönüştür.",
  "Yer imlerini tabloya dönüştür.",
  "Seçili metni bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her hücre seçilen pasaja dayansın. Uydurma. Hücreler kısa ve net olsun.",
  "Aşağıdaki yer imlerini tek bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her satır bir yer imine karşılık gelsin. Metinde olmayan iddia uydurma.",
  TR_SELECTION,
  TR_BOOKMARKS,
]);

function isDefaultBody(fallback, body) {
  return !body || PREVIOUS_BUILTIN_BODIES.has(body) || body === fallback.body || body === fallback.bodyTr;
}

export function refreshBuiltinTemplate(item) {
  const fallback = DEFAULT_TEMPLATES.find((tpl) => tpl.id === item?.id);
  if (!fallback || !item?.builtin) return item;
  const body = String(item.body || "").trim();
  if (isDefaultBody(fallback, body)) {
    return { ...item, name: fallback.name, nameEn: fallback.nameEn, body: fallback.body, customized: false };
  }
  return { ...item, customized: true };
}

/** The prompt text to send: a non-customized built-in follows the interface language. */
export function templateBody(template, lang = "en") {
  if (!template) return "";
  const fallback = DEFAULT_TEMPLATES.find((tpl) => tpl.id === template.id);
  if (template.builtin && !template.customized && fallback) {
    return lang === "tr" ? fallback.bodyTr : fallback.body;
  }
  return String(template.body || "");
}

/** Templates as shown to the user, with built-in bodies in the chosen language. */
export function localizeTemplates(list, lang = "en") {
  return (list || []).map((item) => ({ ...item, body: templateBody(item, lang) }));
}

export async function resetTemplate(id, root = dataRoot()) {
  const fallback = DEFAULT_TEMPLATES.find((tpl) => tpl.id === id);
  if (!fallback) return null;
  const list = await loadTemplates(root);
  const index = list.findIndex((item) => item.id === id);
  const restored = { ...fallback };
  if (index >= 0) list[index] = restored;
  else list.unshift(restored);
  return saveTemplates(list, root);
}

function templatesPath(root = dataRoot()) {
  return join(pathsFor(root).root, "templates.json");
}

function normalizeTemplate(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `tpl-${index + 1}`;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Template ${index + 1}`;
  const scope = raw.scope === "bookmarks" ? "bookmarks" : raw.scope === "custom" ? "custom" : "selection";
  return {
    id,
    name,
    nameEn: typeof raw.nameEn === "string" ? raw.nameEn : name,
    scope,
    builtin: raw.builtin === true,
    customized: raw.customized === true,
    body: typeof raw.body === "string" ? raw.body : "",
  };
}

export async function loadTemplates(root = dataRoot()) {
  const dest = templatesPath(root);
  if (!(await pathExists(dest))) return DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  try {
    const raw = JSON.parse(await readFile(dest, "utf8"));
    const list = Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw) ? raw : [];
    const parsed = list.map(normalizeTemplate).filter(Boolean);
    if (parsed.length === 0) return DEFAULT_TEMPLATES.map((item) => ({ ...item }));
    const have = new Set(parsed.map((item) => item.id));
    const merged = parsed.map((item) => refreshBuiltinTemplate(item));
    for (const fallback of DEFAULT_TEMPLATES) {
      if (!have.has(fallback.id)) merged.unshift({ ...fallback });
    }
    const dirty = merged.some((item) => {
      const before = parsed.find((row) => row.id === item.id);
      return item.body !== (before?.body ?? "") || item.customized !== before?.customized;
    });
    if (dirty) await saveTemplates(merged, root);
    return merged;
  } catch {
    return DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  }
}

export async function saveTemplates(templates, root = dataRoot()) {
  const paths = pathsFor(root);
  await mkdir(paths.root, { recursive: true });
  const list = (templates || []).map(normalizeTemplate).filter(Boolean);
  await writeFile(templatesPath(root), JSON.stringify({ templates: list }, null, 2), "utf8");
  return list;
}

export async function upsertTemplate(partial, root = dataRoot()) {
  const list = await loadTemplates(root);
  const incoming = normalizeTemplate({ ...partial, id: partial.id || randomUUID() });
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index >= 0) {
    const current = list[index];
    const fallback = DEFAULT_TEMPLATES.find((tpl) => tpl.id === current.id);
    const customized = current.builtin && fallback ? !isDefaultBody(fallback, incoming.body.trim()) : false;
    list[index] = {
      ...current,
      ...incoming,
      builtin: current.builtin,
      customized,
      body: customized || !fallback ? incoming.body : fallback.body,
    };
  } else {
    list.push({ ...incoming, builtin: false });
  }
  return saveTemplates(list, root);
}

export async function deleteTemplate(id, root = dataRoot()) {
  const list = await loadTemplates(root);
  const next = list.filter((item) => item.id !== id);
  if (next.length === list.length) return null;
  return saveTemplates(next, root);
}

export const DEFAULT_TABLE_TEMPLATE_ID = "tpl-selection-table";
export const NONE_TEMPLATE_IDS = new Set(["", "none", "tpl-none"]);

export function isNoneTemplate(id) {
  return NONE_TEMPLATE_IDS.has(String(id || "").trim());
}

export function templateById(templates, id) {
  const key = String(id || "").trim();
  if (isNoneTemplate(key)) return null;
  return (templates || []).find((item) => item.id === key) || null;
}

export function resolveTableTemplate(templates, id) {
  return templateById(templates, id) || templateById(templates, DEFAULT_TABLE_TEMPLATE_ID) || templates?.[0] || null;
}
