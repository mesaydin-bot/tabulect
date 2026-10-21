import { useEffect, useRef, useState } from "react";
import type { OutputArtifact, TableLocale } from "../types/document";
import { CHROME } from "../locale/ui";
import { MarkdownPreview, markdownToHtml } from "../reader/markdown";
import type { OutputMode } from "../reader/output-mode";

type ExportFormat = "md" | "html" | "pdf" | "docx" | "xlsx";

const EXPORT_FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "md", label: "Markdown" },
  { format: "html", label: "HTML" },
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "DOCX" },
  { format: "xlsx", label: "Excel" },
];

type Props = {
  locale: TableLocale;
  output: OutputArtifact | null;
  draft: string;
  pending: boolean;
  outputMode?: OutputMode;
  error: string | null;
  savedPath: string | null;
  onDraft: (value: string) => void;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
  onNewChat?: () => void;
};

function htmlDocument(title: string, content: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
  <style>
    body{font-family:Georgia,serif;line-height:1.55;padding:1rem;color:#222}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #ccc;padding:.4rem;vertical-align:top}
    img{max-width:100%}
    .mermaid-diagram{display:flex;flex-direction:column;gap:.5rem;margin:1rem 0;padding:.85rem 1rem;border:1px solid #ccc;border-radius:10px;background:#f7f7f7}
    .mermaid-edge{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem}
    .mermaid-node{display:inline-block;padding:.28rem .55rem;border:1px solid #bbb;border-radius:8px;background:#fff}
    .mermaid-arrow{color:#666}
    .mermaid-edge-label{font-size:.85em;color:#666}
  </style>
  </head><body>${markdownToHtml(content)}</body></html>`;
}

export function OutputPane({
  locale,
  output,
  draft,
  pending,
  outputMode = "new",
  error,
  savedPath,
  onDraft,
  onSave,
  onExport,
  onNewChat,
}: Props) {
  const chrome = CHROME[locale];
  const [tab, setTab] = useState<"preview" | "edit" | "html">("preview");
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const canExport = Boolean(draft.trim()) && !pending;
  const keepDraft = outputMode === "append" && Boolean(draft.trim());

  useEffect(() => {
    if (!exportOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  return (
    <div className="output-pane">
      <div className="output-head">
        <div className="output-toolbar">
          <div className="output-toolbar-main">
            <span className="pane-label">{chrome.outputLabel}</span>
            <div className="output-tabs">
              <button type="button" className={tab === "preview" ? "chip is-on" : "chip"} onClick={() => setTab("preview")}>
                {chrome.outputPreview}
              </button>
              <button type="button" className={tab === "edit" ? "chip is-on" : "chip"} onClick={() => setTab("edit")}>
                {chrome.outputEdit}
              </button>
              <button type="button" className={tab === "html" ? "chip is-on" : "chip"} onClick={() => setTab("html")}>
                {chrome.outputHtml}
              </button>
            </div>
            <div className="output-actions">
              <button type="button" className="text-btn" disabled={!canExport} onClick={onSave}>
                {chrome.outputSave}
              </button>
              <div className="export-menu" ref={exportRef}>
                <button
                  type="button"
                  className={exportOpen ? "text-btn is-on" : "text-btn"}
                  disabled={!canExport}
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  onClick={() => setExportOpen((open) => !open)}
                >
                  {chrome.outputExport}
                </button>
                {exportOpen ? (
                  <div className="export-pop" role="menu" aria-label={chrome.outputExport}>
                    {EXPORT_FORMATS.map((item) => (
                      <button
                        key={item.format}
                        type="button"
                        role="menuitem"
                        className="export-item"
                        onClick={() => {
                          setExportOpen(false);
                          onExport(item.format);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {onNewChat ? (
                <button type="button" className="text-btn" disabled={pending} onClick={onNewChat}>
                  {chrome.outputNewChat}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {savedPath ? (
          <p className="output-saved">
            {chrome.outputSaved}: {savedPath}
          </p>
        ) : null}
        {error ? (
          <p className="instruct-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {pending && !keepDraft ? (
        <p className="output-empty">{chrome.outputLoading}</p>
      ) : !draft.trim() ? (
        <p className="output-empty">{chrome.outputEmpty}</p>
      ) : (
        <>
          {pending ? (
            <p className="output-appending" role="status">
              {chrome.outputAppending}
            </p>
          ) : null}
          {tab === "edit" ? (
            <textarea
              className="output-editor"
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              spellCheck={false}
            />
          ) : tab === "html" ? (
            <iframe
              className="output-html"
              title={chrome.outputHtml}
              sandbox="allow-same-origin"
              srcDoc={htmlDocument(output?.title || chrome.outputLabel, draft)}
            />
          ) : (
            <div className="output-preview">
              <MarkdownPreview content={draft} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
