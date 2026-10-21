import { useEffect, useRef, useState } from "react";
import { isTauriRuntime, PROVIDER_IDS, type ProviderId, type ProviderStatus, type IngestEvent } from "../api/client";
import { CHROME, PROVIDER_LABELS } from "../locale/ui";
import { curatedModels, defaultModel, normalizeModelId } from "../reader/models";
import type { IngestStatus } from "../state/useDocument";
import type { TableLocale } from "../types/document";

const ACCEPT =
  ".pdf,.epub,.html,.htm,.md,.markdown,.docx,application/pdf,application/epub+zip,text/html,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ACCEPT_EXT = /\.(pdf|epub|html|htm|md|markdown|docx)$/i;

type ModelFieldProps = {
  id: string;
  listId: string;
  label: string;
  value: string;
  placeholder: string;
  title: string;
  disabled: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
};

function ModelField({
  id,
  listId,
  label,
  value,
  placeholder,
  title,
  disabled,
  compact,
  onChange,
  onCommit,
}: ModelFieldProps) {
  return (
    <label className={compact ? "provider-field model-field is-compact" : "provider-field model-field"}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={label}
        title={title}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit(event.target.value)}
      />
    </label>
  );
}

type Props = {
  locale: TableLocale;
  provider: ProviderId;
  model: string;
  providers: ProviderStatus[];
  backendOnline: boolean;
  ingest: {
    status: IngestStatus;
    phase: IngestEvent["phase"] | null;
    pct: number;
    message: string;
    error: string | null;
  };
  sourceKind: "fixture" | "live";
  onProvider: (id: ProviderId) => void;
  onModel: (model: string) => void;
  onFile: (file: File) => void;
  onOpenNative: () => void;
  onReloadFixture: () => void;
};

export function OpenDropZone({
  locale,
  provider,
  model,
  providers,
  backendOnline,
  ingest,
  sourceKind,
  onProvider,
  onModel,
  onFile,
  onOpenNative,
  onReloadFixture,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const chrome = CHROME[locale];
  const labels = PROVIDER_LABELS[locale];
  const selected = providers.find((item) => item.id === provider);
  const busy = ingest.status === "uploading" || ingest.status === "running";
  const modelChoices = curatedModels(provider);
  const listId = `tabular-model-${provider}`;
  const modelValue = model || defaultModel(provider);
  const modelTitle = `${chrome.modelLabel}: ${modelValue || chrome.modelDefault}`;
  const modelPlaceholder = provider === "cursor" ? "auto" : chrome.modelDefault;

  function commitModel(raw: string) {
    const cleaned = normalizeModelId(raw);
    onModel(provider === "cursor" ? cleaned || "auto" : cleaned);
  }

  useEffect(() => {
    if (!menu) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  function openPicker() {
    if (busy) return;
    setMenu(false);
    if (isTauriRuntime()) {
      onOpenNative();
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div className="tool-wrap open-control" ref={rootRef}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="open-zone-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        className="text-btn open-btn"
        disabled={busy}
        title={chrome.openFormats}
        aria-label={chrome.openFile}
        onClick={openPicker}
      >
        {chrome.openFile}
      </button>
      <button
        type="button"
        className={menu ? "icon-btn is-on" : "icon-btn"}
        aria-label={chrome.providerLabel}
        aria-expanded={menu}
        title={`${chrome.providerLabel}: ${labels[provider]} · ${modelTitle}`}
        onClick={() => setMenu((value) => !value)}
      >
        ···
      </button>
      <ModelField
        id="tabular-model-chrome"
        listId={listId}
        label={chrome.modelLabel}
        value={modelValue}
        placeholder={modelPlaceholder}
        title={modelTitle}
        disabled={busy}
        compact
        onChange={onModel}
        onCommit={commitModel}
      />
      <datalist id={listId}>
        {provider !== "cursor" ? <option value="" label={chrome.modelDefault} /> : null}
        {modelChoices.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {menu ? (
        <div className="tool-pop" role="dialog" aria-label={chrome.openFile}>
          <label className="provider-field">
            <span>{chrome.providerLabel}</span>
            <select
              value={provider}
              disabled={busy}
              onChange={(event) => onProvider(event.target.value as ProviderId)}
            >
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {labels[id]}
                </option>
              ))}
            </select>
          </label>
          <ModelField
            id="tabular-model-menu"
            listId={listId}
            label={chrome.modelLabel}
            value={modelValue}
            placeholder={modelPlaceholder}
            title={modelTitle}
            disabled={busy}
            onChange={onModel}
            onCommit={commitModel}
          />
          {sourceKind === "live" ? (
            <button type="button" className="text-btn" onClick={onReloadFixture}>
              {chrome.reloadFixture}
            </button>
          ) : null}
          <p className="tool-label ingest-status" aria-live="polite">
            {!backendOnline ? (
              <span className="ingest-error">{chrome.backendNeeded}</span>
            ) : ingest.status === "error" ? (
              <span className="ingest-error">
                {ingest.error === "backend-offline"
                  ? chrome.backendNeeded
                  : ingest.error || chrome.ingestError}
              </span>
            ) : busy ? (
              <span>
                {ingest.pct}% {ingest.phase ? `${ingest.phase} · ` : ""}
                {ingest.message}
              </span>
            ) : selected?.error && !selected.loggedIn ? (
              <span className="ingest-quiet">{selected.error}</span>
            ) : (
              <span className="ingest-quiet">{chrome.ingestIdle}</span>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
