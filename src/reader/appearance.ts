export const THEME_IDS = ["white", "paper", "sepia", "dusk", "dark", "night", "forest", "slate"] as const;
export type AppearanceTheme = (typeof THEME_IDS)[number];

export type Appearance = {
  theme: AppearanceTheme;
  ink: string;
  paper: string;
  mark: string;
  lineHeight: number;
  paragraphGap: number;
  fontSize: number;
  fontFamily: "system" | "serif" | "sans" | "mono";
  paragraphNumbers: boolean;
  firstSentenceBold: boolean;
  readingFocus: boolean;
  readingWidth: number;
};

/** Installed macOS / Windows / Linux system faces only — no bundled webfonts. */
export const FONT_STACKS: Record<Appearance["fontFamily"], string> = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "New York", "Iowan Old Style", Palatino, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

export function readerFontStack(id: Appearance["fontFamily"]): string {
  return FONT_STACKS[id] ?? FONT_STACKS.serif;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "white",
  ink: "",
  paper: "",
  mark: "",
  lineHeight: 1.62,
  paragraphGap: 1.2,
  fontSize: 18,
  fontFamily: "serif",
  paragraphNumbers: true,
  firstSentenceBold: true,
  readingFocus: true,
  readingWidth: 70,
};

export const APPEARANCE_KEY = "tabulect:appearance";

export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      ...DEFAULT_APPEARANCE,
      ...parsed,
      theme: THEME_IDS.includes(parsed.theme as AppearanceTheme)
        ? (parsed.theme as AppearanceTheme)
        : DEFAULT_APPEARANCE.theme,
      readingWidth: Number.isFinite(parsed.readingWidth) ? Math.max(45, Math.min(90, parsed.readingWidth!)) : DEFAULT_APPEARANCE.readingWidth,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(next: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.classList.remove("dark", "light", "white", "sepia", "paper", "dusk", "night", "forest", "slate");
  root.classList.add(appearance.theme);
  if (appearance.theme === "sepia" || appearance.theme === "paper") root.classList.add("light");
  if (appearance.theme === "dusk" || appearance.theme === "night" || appearance.theme === "slate") {
    root.classList.add("dark");
  }
  root.dataset.theme = appearance.theme;
  root.dataset.font = appearance.fontFamily;
  const style = root.style;
  style.setProperty("--reader-font-family", readerFontStack(appearance.fontFamily));
  style.setProperty("--reader-font-size", `${appearance.fontSize}px`);
  style.setProperty("--reader-line-height", String(appearance.lineHeight));
  style.setProperty("--reader-para-gap", `${appearance.paragraphGap}rem`);
  if (appearance.ink) style.setProperty("--ink", appearance.ink);
  else style.removeProperty("--ink");
  if (appearance.paper) style.setProperty("--paper", appearance.paper);
  else style.removeProperty("--paper");
  if (appearance.mark) style.setProperty("--mark", appearance.mark);
  else style.removeProperty("--mark");
}
