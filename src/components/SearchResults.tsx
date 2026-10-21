import { useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TableLocale } from "../types/document";
import type { SearchHit, SearchOptions } from "../reader/search";

type Props = {
  locale: TableLocale;
  hits: SearchHit[];
  activeIndex: number;
  busy: boolean;
  options: SearchOptions;
  onOptions: (options: SearchOptions) => void;
  onSelect: (index: number) => void;
  onClose: () => void;
};

export function SearchResults({ locale, hits, activeIndex, busy, options, onOptions, onSelect, onClose }: Props) {
  const tr = locale === "tr";
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: busy ? 0 : hits.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 100, overscan: 5 });
  useLayoutEffect(() => {
    if (activeIndex >= 0) virtual.scrollToIndex(activeIndex, { align: "auto" });
    else if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeIndex, hits, virtual]);

  return (
    <aside className="search-panel" aria-label={tr ? "Belgede arama" : "Find in document"}>
      <div className="search-panel-heading">
        <h2>{tr ? "Belgede arama" : "Find in document"}</h2>
        <button className="text-btn" onClick={onClose} aria-label={tr ? "Aramayı kapat" : "Close search"} title="Esc">×</button>
      </div>
      <div className="search-options">
        <button className="text-btn" aria-pressed={options.caseSensitive} onClick={() => onOptions({ ...options, caseSensitive: !options.caseSensitive })}>
          {tr ? "Büyük/küçük harf" : "Match case"}
        </button>
        <button className="text-btn" aria-pressed={options.wholeWord} onClick={() => onOptions({ ...options, wholeWord: !options.wholeWord })}>
          {tr ? "Tam kelime" : "Whole word"}
        </button>
      </div>
      <div className="search-panel-status" role="status" aria-live="polite">
        {busy ? (tr ? "Aranıyor…" : "Searching…") : `${hits.length.toLocaleString(tr ? "tr" : "en")} ${tr ? "eşleşme" : "matches"}${activeIndex >= 0 ? ` · ${activeIndex + 1}. ${tr ? "sonuç" : "result"}` : ""}`}
      </div>
      {!busy && !hits.length ? <p className="search-empty">{tr ? "Eşleşme bulunamadı. Daha kısa bir ifade deneyin veya arama seçeneklerini değiştirin." : "No matches. Try a shorter phrase or change the search options."}</p> : null}
      <div ref={scrollRef} className="search-results" role="list" aria-label={tr ? "Arama sonuçları" : "Search results"} aria-busy={busy}>
        <div className="search-results-inner" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((row) => {
            const hit = hits[row.index];
            const page = hit.spans[0]?.page;
            return <div key={row.key} role="listitem" aria-posinset={row.index + 1} aria-setsize={hits.length}
              className="search-result-row" data-index={row.index} ref={virtual.measureElement} style={{ transform: `translateY(${row.start}px)` }}>
              <button className={`search-result${activeIndex === row.index ? " is-active" : ""}`} aria-current={activeIndex === row.index ? "location" : undefined}
                onClick={() => onSelect(row.index)}
                onKeyDown={(event) => {
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    const next = event.key === "Home" ? 0 : event.key === "End" ? hits.length - 1 : (row.index + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
                    onSelect(next);
                    virtual.scrollToIndex(next, { align: "auto" });
                    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"] button`)?.focus({ preventScroll: true }));
                  }
                }}>
                <span className="search-result-location"><span>{page != null ? `${tr ? "Sayfa" : "Page"} ${page}` : `${tr ? "Bölüm" : "Section"} ${hit.chunkNumber}`}</span><span>{row.index + 1}</span></span>
                <span className="search-result-snippet">{hit.before}<mark>{hit.match}</mark>{hit.after}</span>
              </button>
            </div>;
          })}
        </div>
      </div>
      <div className="search-panel-help">{tr ? "Sonuca tıkla → metindeki yerine git" : "Select a result to jump to the passage"}<br />{tr ? "Enter: sonraki · Shift+Enter: önceki" : "Enter: next · Shift+Enter: previous"}</div>
    </aside>
  );
}
