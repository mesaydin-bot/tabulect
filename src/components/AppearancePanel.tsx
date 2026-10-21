import { useEffect, useRef } from "react";
import type { TableLocale } from "../types/document";
import { CHROME } from "../locale/ui";
import {
  FONT_STACKS,
  THEME_IDS,
  type Appearance,
  type AppearanceTheme,
} from "../reader/appearance";

type Props = {
  locale: TableLocale;
  open: boolean;
  appearance: Appearance;
  exportDir: string;
  onOpen: () => void;
  onClose: () => void;
  onAppearance: (next: Partial<Appearance>) => void;
  onExportDir: (value: string) => void;
};

const THEME_LABEL: Record<AppearanceTheme, string> = {
  white: "White",
  paper: "Paper",
  sepia: "Sepia",
  dusk: "Dusk",
  dark: "Dark",
  night: "Night",
  forest: "Forest",
  slate: "Slate",
};

export function AppearancePanel({
  locale,
  open,
  appearance,
  exportDir,
  onOpen,
  onClose,
  onAppearance,
  onExportDir,
}: Props) {
  const chrome = CHROME[locale];
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  return (
    <div className="tool-wrap" ref={rootRef}>
      <button
        type="button"
        className={open ? "icon-btn is-on" : "icon-btn"}
        aria-label={chrome.appearance}
        aria-expanded={open}
        title={chrome.appearance}
        onClick={() => (open ? onClose() : onOpen())}
      >
        Aa
      </button>
      {open ? (
        <div className="tool-pop appearance-pop" role="dialog" aria-label={chrome.appearance}>
          <p className="tool-label">{chrome.themeLabel}</p>
          <div className="tool-row wrap">
            {THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={appearance.theme === id ? "chip is-on" : "chip"}
                onClick={() => onAppearance({ theme: id })}
              >
                {THEME_LABEL[id]}
              </button>
            ))}
          </div>
          <p className="tool-label">{chrome.fontFamily}</p>
          <div className="tool-row">
            {(["system", "serif", "sans", "mono"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={appearance.fontFamily === id ? "chip is-on" : "chip"}
                style={{ fontFamily: FONT_STACKS[id] }}
                onClick={() => onAppearance({ fontFamily: id })}
              >
                {id === "system"
                  ? chrome.fontSystem
                  : id === "serif"
                    ? chrome.fontSerif
                    : id === "sans"
                      ? chrome.fontSans
                      : chrome.fontMono}
              </button>
            ))}
          </div>
          <label className="tool-label">
            {chrome.fontSize}
            <input
              type="range"
              min={13}
              max={26}
              value={appearance.fontSize}
              onChange={(event) => onAppearance({ fontSize: Number(event.target.value) })}
            />
          </label>
          <label className="tool-label">
            {chrome.lineHeight}
            <input
              type="range"
              min={1.2}
              max={2.2}
              step={0.02}
              value={appearance.lineHeight}
              onChange={(event) => onAppearance({ lineHeight: Number(event.target.value) })}
            />
          </label>
          <label className="tool-label">
            {chrome.paragraphGap}
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.1}
              value={appearance.paragraphGap}
              onChange={(event) => onAppearance({ paragraphGap: Number(event.target.value) })}
            />
          </label>
          <label className="tool-label">
            {locale === "tr" ? "Okuma genişliği" : "Reading width"} · {appearance.readingWidth}
            <input type="range" min={45} max={90} step={5} value={appearance.readingWidth}
              onChange={(event) => onAppearance({ readingWidth: Number(event.target.value) })} />
          </label>
          <div className="reading-options">
            {([
              ["paragraphNumbers", locale === "tr" ? "Paragraf numaraları" : "Paragraph numbers"],
              ["firstSentenceBold", locale === "tr" ? "İlk cümleyi vurgula" : "Emphasize first sentence"],
              ["readingFocus", locale === "tr" ? "Okuduğum paragrafı işaretle" : "Mark reading paragraph"],
            ] as const).map(([key, label]) => (
              <label key={key}><input type="checkbox" checked={appearance[key]}
                onChange={(event) => onAppearance({ [key]: event.target.checked })} />{label}</label>
            ))}
          </div>
          <div className="color-row">
            <label>
              {chrome.colorInk}
              <input
                type="color"
                value={appearance.ink || "#1a1a1a"}
                onChange={(event) => onAppearance({ ink: event.target.value })}
              />
            </label>
            <label>
              {chrome.colorPaper}
              <input
                type="color"
                value={appearance.paper || "#ffffff"}
                onChange={(event) => onAppearance({ paper: event.target.value })}
              />
            </label>
            <label>
              {chrome.colorMark}
              <input
                type="color"
                value={appearance.mark || "#ffe08a"}
                onChange={(event) => onAppearance({ mark: event.target.value })}
              />
            </label>
          </div>
          <label className="tool-label">
            {chrome.exportDir}
            <input
              className="dir-input"
              value={exportDir}
              onChange={(event) => onExportDir(event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
