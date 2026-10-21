import { useCallback, useEffect, useState } from "react";
import type { TableLocale } from "../types/document";

/**
 * Interface language (menus, buttons, messages). Independent of the per-document
 * table-output locale. Persisted in localStorage; defaults to the OS language.
 */
export type UiLang = TableLocale;

export const UI_LANG_KEY = "tabulect:uiLang";
const EVENT = "tabulect:uiLang";

export function initialUiLang(): UiLang {
  try {
    const stored = localStorage.getItem(UI_LANG_KEY);
    if (stored === "tr" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function useUiLang(): [UiLang, (lang: UiLang) => void] {
  const [lang, setLangState] = useState<UiLang>(initialUiLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    const sync = () => setLangState(initialUiLang());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [lang]);
  const setLang = useCallback((next: UiLang) => {
    try {
      localStorage.setItem(UI_LANG_KEY, next);
    } catch {
      /* ignore */
    }
    setLangState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [lang, setLang];
}
