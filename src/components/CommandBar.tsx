import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { LibraryDocument } from "../api/client";
import type { PromptTemplate, TableLocale } from "../types/document";
import { CHROME } from "../locale/ui";
import type { OutputMode } from "../reader/output-mode";

type Props = {
  locale: TableLocale;
  value: string;
  pending: boolean;
  error: string | null;
  templates: PromptTemplate[];
  templateId: string;
  searchHits: number;
  activeSearchIndex: number;
  searchBusy: boolean;
  onSearchStep: (direction: -1 | 1) => void;
  onValue: (value: string) => void;
  onTemplate: (id: string) => void;
  onSaveTemplate: (template: { id?: string; name: string; body: string }) => void;
  onDeleteTemplate: (id: string) => void;
  onResetTemplate?: (id: string) => void;
  onInstruct: (instruction: string) => Promise<boolean>;
  onTableAi: () => void;
  onNewChat?: () => void;
  chatExists?: boolean | null;
  outputMode?: OutputMode;
  onOutputMode?: (mode: OutputMode) => void;
  library?: LibraryDocument[];
  currentId?: string | null;
  extraSourceIds?: string[];
  onToggleSource?: (id: string) => void;
};

export function CommandBar({
  locale,
  value,
  pending,
  error,
  templates,
  templateId,
  searchHits,
  activeSearchIndex,
  searchBusy,
  onSearchStep,
  onValue,
  onTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  onResetTemplate,
  onInstruct,
  onTableAi,
  onNewChat,
  chatExists,
  outputMode = "new",
  onOutputMode,
  library = [],
  currentId,
  extraSourceIds = [],
  onToggleSource,
}: Props) {
  const chrome = CHROME[locale];
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (value.startsWith("/")) onValue("");
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value, onValue]);
  const [manage, setManage] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const instruction = value.startsWith("/");
  const armed = value.trim().length > 1 && instruction;

  const active = useMemo(
    () => templates.find((item) => item.id === templateId) || null,
    [templateId, templates],
  );

  useEffect(() => {
    if (!manage || !active) return;
    setDraftName(locale === "en" && active.nameEn ? active.nameEn : active.name);
    setDraftBody(active.body);
  }, [active, locale, manage]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!instruction) { onSearchStep(1); return; }
    const text = value.replace(/^\//, "").trim();
    if (!text || pending) return;
    await onInstruct(text);
  }

  return (
    <div className="command-row">
      <form className={armed ? "instruct-row is-armed" : "instruct-row"} onSubmit={submit}>
        <input
          ref={inputRef}
          className="instruct-input"
          type="search"
          value={value}
          placeholder={chrome.instructPlaceholder}
          aria-label={chrome.instructPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={pending && instruction}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (!instruction && event.key === "Enter") {
              event.preventDefault();
              onSearchStep(event.shiftKey ? -1 : 1);
            }
            if (!instruction && event.key === "Escape") {
              event.preventDefault();
              onValue("");
            }
          }}
          onChange={(event) => onValue(event.target.value)}
        />
        {instruction ? (
          <button type="submit" className="instruct-go" disabled={!armed || pending}>
            {pending ? chrome.instructPending : chrome.instructApply}
          </button>
        ) : value.trim() ? (
          <div className="search-navigation" role="group" aria-label={locale === "tr" ? "Sonuçlarda gezin" : "Navigate matches"}>
            <span className="search-count">{searchBusy ? "…" : `${activeSearchIndex + 1} / ${searchHits}`}</span>
            <button type="button" className="text-btn" disabled={searchBusy || !searchHits} onClick={() => onSearchStep(-1)} aria-label={locale === "tr" ? "Önceki eşleşme" : "Previous match"} title="Shift+Enter">↑</button>
            <button type="button" className="text-btn" disabled={searchBusy || !searchHits} onClick={() => onSearchStep(1)} aria-label={locale === "tr" ? "Sonraki eşleşme" : "Next match"} title="Enter">↓</button>
          </div>
        ) : null}
      </form>
      <label className="template-pick">
        <span>{chrome.templates}</span>
        <select value={templateId} onChange={(event) => onTemplate(event.target.value)}>
          <option value="">{chrome.templateNone}</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {locale === "en" && item.nameEn ? item.nameEn : item.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="text-btn" onClick={() => setManage((open) => !open)}>
        {chrome.templates}
      </button>
      <div className="command-ai">
        {onOutputMode ? (
          <div className="locale-switch output-mode" role="group" aria-label={chrome.outputMode}>
            <button
              type="button"
              className={outputMode === "append" ? "is-on" : undefined}
              aria-pressed={outputMode === "append"}
              disabled={pending}
              onClick={() => onOutputMode("append")}
            >
              {chrome.outputAppend}
            </button>
            <button
              type="button"
              className={outputMode === "new" ? "is-on" : undefined}
              aria-pressed={outputMode === "new"}
              disabled={pending}
              onClick={() => onOutputMode("new")}
            >
              {chrome.outputNew}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="text-btn is-ai"
          disabled={pending}
          onClick={onTableAi}
          title={chrome.tableAiShortcut}
          aria-keyshortcuts="T"
        >
          {pending ? chrome.tableAiPending : chrome.tableAi}
        </button>
        {onNewChat ? (
          <button type="button" className="text-btn" disabled={pending} onClick={onNewChat}>
            {chrome.outputNewChat}
          </button>
        ) : null}
        {chatExists != null ? (
          <span className="chat-status" role="status" title={locale === "tr" ? "Belge değişse de seçili sağlayıcının sohbeti korunur. Ekle / Yeni yalnızca çıktı alanını değiştirir." : "The selected provider keeps its conversation across documents. Append / New only changes the output area."}>
            {locale === "tr" ? (chatExists ? "Sohbet korunuyor" : "Yeni sohbet hazır") : (chatExists ? "Conversation retained" : "New conversation ready")}
          </span>
        ) : null}
      </div>
      {onToggleSource ? (
        <div className="source-scope">
          <button
            type="button"
            className={sourcesOpen ? "text-btn is-on" : "text-btn"}
            disabled={pending}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            {chrome.sourceAdd}
          </button>
          <span className="source-scope-label">
            {extraSourceIds.length
              ? `${chrome.sourceScopeExtra} ${extraSourceIds.length}`
              : chrome.sourceScopeOpen}
          </span>
          {sourcesOpen ? (
            <div className="source-pop" role="listbox" aria-label={chrome.sourceAdd}>
              {library
                .filter((item) => item.id !== currentId)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={extraSourceIds.includes(item.id) ? "export-item is-on" : "export-item"}
                    onClick={() => onToggleSource(item.id)}
                  >
                    {item.title || item.id}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="instruct-error" role="alert">
          {error}
        </p>
      ) : null}
      {manage ? (
        <div className="template-editor">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={chrome.templateName}
            aria-label={chrome.templateName}
          />
          <textarea
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            placeholder={chrome.templateBody}
            aria-label={chrome.templateBody}
          />
          <div className="library-actions">
            <button
              type="button"
              className="text-btn"
              disabled={!draftName.trim() || !draftBody.trim() || !active}
              onClick={() => {
                if (!active) return;
                onSaveTemplate({ id: active.id, name: draftName.trim(), body: draftBody.trim() });
              }}
            >
              {chrome.templateSave}
            </button>
            <button
              type="button"
              className="text-btn"
              disabled={!draftName.trim() || !draftBody.trim()}
              onClick={() => {
                onSaveTemplate({ name: draftName.trim(), body: draftBody.trim() });
              }}
            >
              {chrome.templateAdd}
            </button>
            {active && active.builtin && onResetTemplate ? (
              <button
                type="button"
                className="text-btn"
                disabled={!active.customized}
                title={chrome.templateResetHint}
                onClick={() => onResetTemplate(active.id)}
              >
                {chrome.templateReset}
              </button>
            ) : null}
            {active && !active.builtin ? (
              <button type="button" className="text-btn is-danger" onClick={() => onDeleteTemplate(active.id)}>
                {chrome.templateDelete}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
