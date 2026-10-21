import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dataRoot, pathsFor } from "./store.mjs";
import { pathExists } from "./util.mjs";

export const THEME_IDS = ["white", "paper", "sepia", "dusk", "dark", "night", "forest", "slate"];

export function defaultSettings() {
  return {
    exportDir: join(homedir(), "Downloads"),
    appearance: {
      theme: "white",
      ink: "",
      paper: "",
      mark: "",
      lineHeight: 1.62,
      paragraphGap: 0.8,
      fontSize: 18,
      fontFamily: "serif",
    },
  };
}

function settingsPath(root = dataRoot()) {
  return join(pathsFor(root).root, "settings.json");
}

function clamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function normalizeSettings(raw) {
  const base = defaultSettings();
  const incoming = raw && typeof raw === "object" ? raw : {};
  const appearance = incoming.appearance && typeof incoming.appearance === "object" ? incoming.appearance : {};
  const theme = THEME_IDS.includes(appearance.theme) ? appearance.theme : base.appearance.theme;
  const color = (value) =>
    typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim()) ? value.trim() : "";
  return {
    exportDir:
      typeof incoming.exportDir === "string" && incoming.exportDir.trim() && isAbsolute(incoming.exportDir.trim())
        ? resolve(incoming.exportDir.trim())
        : base.exportDir,
    appearance: {
      theme,
      ink: color(appearance.ink),
      paper: color(appearance.paper),
      mark: color(appearance.mark),
      lineHeight: clamp(appearance.lineHeight, 1.2, 2.4, base.appearance.lineHeight),
      paragraphGap: clamp(appearance.paragraphGap, 0, 2.4, base.appearance.paragraphGap),
      fontSize: clamp(appearance.fontSize, 13, 28, base.appearance.fontSize),
      fontFamily: ["system", "serif", "sans", "mono"].includes(appearance.fontFamily)
        ? appearance.fontFamily
        : base.appearance.fontFamily,
    },
  };
}

export async function loadSettings(root = dataRoot()) {
  const dest = settingsPath(root);
  if (!(await pathExists(dest))) return defaultSettings();
  try {
    return normalizeSettings(JSON.parse(await readFile(dest, "utf8")));
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(partial, root = dataRoot()) {
  const current = await loadSettings(root);
  const next = normalizeSettings({
    ...current,
    ...partial,
    appearance: { ...current.appearance, ...(partial?.appearance || {}) },
  });
  const paths = pathsFor(root);
  await mkdir(paths.root, { recursive: true });
  await writeFile(settingsPath(root), JSON.stringify(next, null, 2), "utf8");
  return next;
}
