import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Appearance } from "../reader/appearance";
import { firstSentenceEnd, readingParagraphs, readReadingPosition, writeReadingPosition, type ReadingPosition } from "../reader/reading";
import type { Bookmark, Chunk, HighlightRange, TableLocale } from "../types/document";
import { markedSegments, type SearchHit, type TextMark } from "../reader/search";
import { CHROME } from "../locale/ui";
import { rangesByChunk, type SourceUnit } from "../reader/selection";
import type { AutoAxis, FineMode, WordStep } from "../reader/fine-reading";
import {
  highlightMovingEdge,
  markBoxForEdge,
  markIsFullyVisible,
  markScrollDelta,
} from "../reader/source-scroll";

const WORD_STEPS: WordStep[] = [1, 2, 3, 4, 5];

type Props = {
  locale: TableLocale;
  documentId: string;
  appearance: Appearance;
  navigationTick: number;
  searching: boolean;
  returnTick: number;
  onReturnReading: () => void;
  onResumePosition: (chunkId: string, offset: number) => void;
  chunks: Chunk[];
  units: SourceUnit[];
  highlight: HighlightRange | null;
  bookmarks: Bookmark[];
  searchHits: SearchHit[];
  activeSearchHit: SearchHit | null;
  searchJumpTick: number;
  paneLayout: string;
  typeTick: string;
  onFocusPosition: (chunkId: string, offset: number) => void;
  fineMode: FineMode;
  onFineMode: (mode: FineMode) => void;
  wordStep: WordStep;
  onWordStep: (step: WordStep) => void;
  autoPlaying: boolean;
  autoWpm: number;
  autoAxis: AutoAxis;
  onToggleAutoPlay: () => void;
  onAutoWpm: (wpm: number) => void;
  onAutoAxis: (axis: AutoAxis) => void;
  finePending: boolean;
  fineError: string | null;
  onFineRetry: () => void;
  onCharsPerLine?: (chars: number) => void;
};

function markText(text: string, ranges: TextMark[], leadEnd: number) {
  if (leadEnd) ranges = [...ranges, { start: 0, end: leadEnd, className: "first-sentence" }];
  if (!ranges.length) return text;
  return markedSegments(text, ranges).map((part) => /(?:quote|bookmark|search)-mark/.test(part.className) ? (
    <mark key={part.start} className={part.className} data-search-hit={part.searchId}>{part.text}</mark>
  ) : <span key={part.start} className={part.className || undefined}>{part.text}</span>);
}

function scrollMarkIntoBand(
  scroller: HTMLElement,
  mark: HTMLElement,
  followBand: boolean,
  edge: "start" | "end" | "mark",
  rapid: boolean,
) {
  const view = scroller.getBoundingClientRect();
  const box = mark.getBoundingClientRect();
  const focus = followBand ? markBoxForEdge(box, edge) : { markTop: box.top, markBottom: box.bottom };
  const visible = markIsFullyVisible({
    viewTop: view.top,
    viewHeight: view.height,
    markTop: focus.markTop,
    markBottom: focus.markBottom,
  });
  if (!followBand && visible) return;
  const delta = followBand
    ? markScrollDelta({
        viewTop: view.top,
        viewHeight: view.height,
        markTop: focus.markTop,
        markBottom: focus.markBottom,
      })
    : box.top < view.top
      ? box.top - view.top - 20
      : box.bottom > view.bottom
        ? box.bottom - view.bottom + 20
        : 0;
  if (Math.abs(delta) < 1) return;
  const next = Math.max(0, scroller.scrollTop + delta);
  if (followBand && Math.abs(delta) > 12 && !rapid) {
    scroller.scrollTo({ top: next, behavior: "smooth" });
    return;
  }
  scroller.scrollTop = next;
}

export function SourcePane({
  locale,
  documentId,
  appearance,
  navigationTick,
  searching,
  returnTick,
  onReturnReading,
  onResumePosition,
  chunks,
  units,
  highlight,
  bookmarks,
  searchHits,
  activeSearchHit,
  searchJumpTick,
  paneLayout,
  typeTick,
  onFocusPosition,
  fineMode,
  onFineMode,
  wordStep,
  onWordStep,
  autoPlaying,
  autoWpm,
  autoAxis,
  onToggleAutoPlay,
  onAutoWpm,
  onAutoAxis,
  finePending,
  fineError,
  onFineRetry,
  onCharsPerLine,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const onCharsRef = useRef(onCharsPerLine);
  const followKeysRef = useRef(false);
  const prevRangeRef = useRef<{ start: number; end: number } | null>(null);
  const lastScrollAtRef = useRef(0);
  const paragraphNodesRef = useRef<HTMLElement[]>([]);
  const positionRef = useRef<ReadingPosition | null>(null);
  const originRef = useRef<ReadingPosition | null>(null);
  const restoreTargetRef = useRef<{ chunkId: string; offset: number } | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const resumeRef = useRef(onResumePosition);
  resumeRef.current = onResumePosition;
  const [canReturn, setCanReturn] = useState(false);
  const [hasOrigin, setHasOrigin] = useState(false);
  const [visibleParagraph, setVisibleParagraph] = useState<number | null>(null);
  const paragraphs = useMemo(() => readingParagraphs(chunks), [chunks]);
  const paragraphsByChunk = useMemo(() => {
    const map = new Map<string, typeof paragraphs>();
    for (const paragraph of paragraphs) {
      const items = map.get(paragraph.chunkId) || [];
      items.push(paragraph);
      map.set(paragraph.chunkId, items);
    }
    return map;
  }, [paragraphs]);
  onCharsRef.current = onCharsPerLine;

  const range = highlight && !highlight.empty ? { start: highlight.start, end: highlight.end } : null;
  const movingEdge = highlightMovingEdge(prevRangeRef.current, range);
  const focusIndex = range == null ? null : movingEdge === "end" ? range.end : range.start;
  const activeChunkId = focusIndex != null ? (units[focusIndex]?.chunkId ?? null) : null;
  const activeUnitRef = useRef<SourceUnit | null>(null);
  activeUnitRef.current = focusIndex != null ? units[focusIndex] : null;

  const capturePosition = (includeSelection = true): ReadingPosition | null => {
    const scroller = parentRef.current;
    const nodes = paragraphNodesRef.current;
    if (!scroller?.clientHeight || !nodes.length) return positionRef.current;
    const view = scroller.getBoundingClientRect();
    // Rects are ordered; avoid measuring every paragraph on each scroll.
    let lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (nodes[mid].getBoundingClientRect().bottom <= view.top) lo = mid + 1;
      else hi = mid;
    }
    const paragraph = nodes[lo];
    const rect = paragraph.getBoundingClientRect();
    const chunkId = paragraph.dataset.chunkId!;
    const offset = Number(paragraph.dataset.start);
    const selected = includeSelection ? activeUnitRef.current : null;
    const previous = positionRef.current;
    const visibleSelection = selected && Array.from(scroller.querySelectorAll<HTMLElement>(".quote-mark")).some((mark) => {
      const box = mark.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });
    setVisibleParagraph(Number(paragraph.dataset.paragraphNumber));
    return { chunkId, offset, progress: Math.max(-2, Math.min(1, (view.top - rect.top) / Math.max(1, rect.height))),
      selectionChunkId: visibleSelection ? selected.chunkId : !includeSelection ? previous?.selectionChunkId : undefined,
      selectionOffset: visibleSelection ? selected.start : !includeSelection ? previous?.selectionOffset : undefined };
  };

  const restorePosition = (position: ReadingPosition | null) => {
    const scroller = parentRef.current;
    const paragraph = paragraphNodesRef.current.find((node) => node.dataset.chunkId === position?.chunkId &&
      Number(node.dataset.start) <= position!.offset && Number(node.dataset.end) > position!.offset);
    if (!scroller || !paragraph || !position || !scroller.clientHeight) return false;
    const rect = paragraph.getBoundingClientRect();
    scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + rect.height * position.progress;
    const selectionChunkId = position.selectionChunkId || position.chunkId;
    restoreTargetRef.current = { chunkId: selectionChunkId, offset: position.selectionOffset ?? position.offset };
    followKeysRef.current = false;
    resumeRef.current(selectionChunkId, position.selectionOffset ?? position.offset);
    setVisibleParagraph(Number(paragraph.dataset.paragraphNumber));
    positionRef.current = position;
    // Width changes can rebuild visual reading units after the first layout.
    // Reapply the viewport anchor once that measurement has settled.
    if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = requestAnimationFrame(() => {
        const box = paragraph.getBoundingClientRect();
        if (paragraph.isConnected && scroller.clientHeight) {
          scroller.scrollTop += box.top - scroller.getBoundingClientRect().top + box.height * position.progress;
        }
        restoreTargetRef.current = null;
        restoreFrameRef.current = null;
      });
    });
    return true;
  };

  useLayoutEffect(() => {
    paragraphNodesRef.current = Array.from(parentRef.current?.querySelectorAll<HTMLElement>(".source-paragraph") || []);
  }, [paragraphs]);

  useLayoutEffect(() => {
    originRef.current = null;
    setHasOrigin(false);
    prevRangeRef.current = null;
    positionRef.current = readReadingPosition(documentId);
    const restored = restorePosition(positionRef.current);
    if (!restored && parentRef.current) parentRef.current.scrollTop = 0;
    setCanReturn(restored);
    return () => {
      if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
      restoreTargetRef.current = null;
      const position = originRef.current || positionRef.current;
      if (position) writeReadingPosition(documentId, position);
    };
  }, [documentId]);

  // Capture before the selection/search scrolling effects below run.
  useLayoutEffect(() => {
    if (!searching || originRef.current) return;
    originRef.current = positionRef.current || capturePosition(false);
    setHasOrigin(Boolean(originRef.current));
    setCanReturn(Boolean(originRef.current));
  }, [searching]);

  useLayoutEffect(() => {
    if (!navigationTick) return;
    if (!originRef.current) originRef.current = capturePosition(false);
    setHasOrigin(Boolean(originRef.current));
    setCanReturn(Boolean(originRef.current));
  }, [navigationTick]);

  useLayoutEffect(() => {
    if (!returnTick) return;
    if (restorePosition(originRef.current || positionRef.current)) {
      originRef.current = null;
      setHasOrigin(false);
      setCanReturn(true);
    }
  }, [returnTick]);

  useEffect(() => {
    const scroller = parentRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (originRef.current) return; // keep the reading place during an excursion
      const position = capturePosition();
      if (!position) return;
      positionRef.current = position;
      writeReadingPosition(documentId, position);
      setCanReturn(true);
    };
    const schedule = () => {
      // Cache immediately so a quick search, document switch or close uses the latest viewport.
      if (!originRef.current) {
        const position = capturePosition();
        if (position) positionRef.current = position;
      }
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    scroller?.addEventListener("scroll", schedule, { passive: true });
    const flush = () => {
      const position = originRef.current || positionRef.current;
      if (position) writeReadingPosition(documentId, position);
    };
    window.addEventListener("pagehide", flush);
    schedule();
    return () => {
      clearTimeout(timer);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("pagehide", flush);
    };
  }, [documentId, paragraphs, highlight]);

  useEffect(() => {
    const scroller = parentRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "j", "k", " "].includes(event.key)) {
        followKeysRef.current = true;
      }
    };
    const stopFollow = () => {
      followKeysRef.current = false;
    };
    window.addEventListener("keydown", onKey, true);
    scroller?.addEventListener("wheel", stopFollow, { passive: true });
    scroller?.addEventListener("pointerdown", stopFollow);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      scroller?.removeEventListener("wheel", stopFollow);
      scroller?.removeEventListener("pointerdown", stopFollow);
    };
  }, []);

  useLayoutEffect(() => {
    const scroller = parentRef.current;
    const nextRange = highlight && !highlight.empty ? { start: highlight.start, end: highlight.end } : null;
    if (!scroller || !activeChunkId || !nextRange) {
      prevRangeRef.current = nextRange;
      return;
    }
    if (restoreTargetRef.current) {
      prevRangeRef.current = nextRange;
      return;
    }
    const chunk = scroller.querySelector<HTMLElement>(`[data-chunk-id="${activeChunkId}"]`);
    const marks = chunk ? Array.from(chunk.querySelectorAll<HTMLElement>(".quote-mark")) : [];
    const mark =
      (movingEdge === "end" ? marks[marks.length - 1] : marks[0]) ||
      chunk ||
      scroller.querySelector<HTMLElement>(".source-chunk.is-active");
    if (!mark) {
      prevRangeRef.current = nextRange;
      return;
    }
    const follow = followKeysRef.current || autoPlaying;
    const rapid = Date.now() - lastScrollAtRef.current < 90;
    scrollMarkIntoBand(scroller, mark, follow, movingEdge, rapid);
    if (follow) {
      followKeysRef.current = false;
      lastScrollAtRef.current = Date.now();
    }
    prevRangeRef.current = nextRange;
  }, [activeChunkId, highlight, movingEdge, autoPlaying]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const report = () => {
      const sample = el.querySelector<HTMLElement>(".source-chunk p");
      const chunk = el.querySelector<HTMLElement>(".source-chunk");
      const padL = chunk ? Number.parseFloat(getComputedStyle(chunk).paddingLeft) || 0 : 18;
      const padR = chunk ? Number.parseFloat(getComputedStyle(chunk).paddingRight) || 0 : 18;
      const inner = Math.max(40, sample?.clientWidth || el.clientWidth - padL - padR);
      let avg = 9;
      if (sample) {
        const probe = document.createElement("span");
        const cs = getComputedStyle(sample);
        probe.style.cssText =
          "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;pointer-events:none";
        probe.style.font = cs.font;
        probe.textContent = "abcdefghijklmnopqrstuvwxyz";
        el.appendChild(probe);
        avg = probe.getBoundingClientRect().width / 26;
        probe.remove();
      }
      const chars = Math.max(20, Math.floor(inner / Math.max(avg, 5)));
      onCharsRef.current?.(chars);
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [typeTick, chunks.length]);

  const selectionMap = useMemo(() => rangesByChunk(units, highlight), [units, highlight]);
  const searchMap = useMemo(() => {
    const map = new Map<string, TextMark[]>();
    for (const hit of searchHits) for (const span of hit.spans) {
      const ranges = map.get(span.chunkId) || [];
      ranges.push({ ...span, searchId: hit.id, className: hit === activeSearchHit ? "search-mark search-mark-active" : "search-mark" });
      map.set(span.chunkId, ranges);
    }
    return map;
  }, [searchHits, activeSearchHit]);
  useLayoutEffect(() => {
    if (!activeSearchHit || paneLayout === "table") return;
    const scroller = parentRef.current;
    const mark = scroller?.querySelector<HTMLElement>(`[data-search-hit="${activeSearchHit.id}"]`);
    if (!scroller || !mark) return;
    // An exact occurrence anchor, independent of the reading-line selection.
    // Only scroll this pane; never move the result list or the outer window.
    const view = scroller.getBoundingClientRect();
    const rect = mark.getClientRects()[0] || mark.getBoundingClientRect();
    scroller.scrollTop += rect.top - view.top - view.height * 0.35;
    followKeysRef.current = false;
  }, [activeSearchHit, searchJumpTick, paneLayout, typeTick]);

  return (
    <div className="source-pane">
      <div className="pane-label source-toolbar">
        <span>{CHROME[locale].sourceLabel}</span>
        <div className="reading-navigation">
        <label className="fine-reading-mode">
          <span aria-hidden="true">← →</span>
          <select aria-label={locale === "tr" ? "Sağ-sol oklarla okuma" : "Left/right reading mode"}
            value={fineMode} onChange={(event) => { onFineMode(event.target.value as FineMode); event.target.blur(); }}>
            <option value="word">{locale === "tr" ? "Kelime" : "Word"}</option>
            <option value="grammar">{locale === "tr" ? "Anlamlı öbek (Anında)" : "Meaningful phrase (Instant)"}</option>
            <option value="phrase">{locale === "tr" ? "Anlamlı öbek (AI + Hibrit)" : "Meaningful phrase (AI + Hybrid)"}</option>
          </select>
        </label>
        {fineMode === "word" ? (
          <label className="fine-reading-mode word-step-field">
            <span>{locale === "tr" ? "Kelime sayısı" : "Words"}</span>
            <select
              aria-label={locale === "tr" ? "Kelime adımı sayısı" : "Word step count"}
              value={wordStep}
              onChange={(event) => {
                onWordStep(Number(event.target.value) as WordStep);
                event.target.blur();
              }}
            >
              {WORD_STEPS.map((n) => (
                <option key={n} value={n}>
                  {locale === "tr" ? `${n} kelime` : `${n} ${n === 1 ? "word" : "words"}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="speed-reader-controls" role="group" aria-label={locale === "tr" ? "Hızlı okuma kontrolleri" : "Speed reading controls"}>
          <button
            type="button"
            className={autoPlaying ? "text-btn is-on speed-play-btn" : "text-btn speed-play-btn"}
            aria-pressed={autoPlaying}
            onClick={(event) => {
              onToggleAutoPlay();
              event.currentTarget.blur();
            }}
            title={locale === "tr" ? "Otomatik ilerlemeyi başlat/durdur (Boşluk tuşu)" : "Start/pause auto-advance (Space)"}
          >
            {autoPlaying
              ? (locale === "tr" ? "⏸ Duraklat" : "⏸ Pause")
              : (locale === "tr" ? "▶ Oynat" : "▶ Play")}
          </button>
          <select
            className="speed-axis-select"
            aria-label={locale === "tr" ? "Otomatik ilerleme yönü" : "Auto-advance direction"}
            value={autoAxis}
            onChange={(event) => {
              onAutoAxis(event.target.value as AutoAxis);
              event.target.blur();
            }}
          >
            <option value="horizontal">{locale === "tr" ? "→ Sağ ok (Kelime / Öbek)" : "→ Right (Word / Phrase)"}</option>
            <option value="vertical">{locale === "tr" ? "↓ Aşağı ok (Satır / Paragraf)" : "↓ Down (Line / Paragraph)"}</option>
          </select>
          <div className="speed-wpm-control">
            <button
              type="button"
              className="text-btn speed-step-btn"
              aria-label={locale === "tr" ? "Hızı azalt" : "Decrease speed"}
              onClick={(event) => {
                onAutoWpm(autoWpm - 20);
                event.currentTarget.blur();
              }}
            >
              −
            </button>
            <input
              type="range"
              className="speed-wpm-slider"
              aria-label={locale === "tr" ? "Okuma hızı (dk/kelime)" : "Reading speed (WPM)"}
              min={60}
              max={900}
              step={20}
              value={autoWpm}
              onChange={(event) => onAutoWpm(Number(event.target.value))}
            />
            <button
              type="button"
              className="text-btn speed-step-btn"
              aria-label={locale === "tr" ? "Hızı artır" : "Increase speed"}
              onClick={(event) => {
                onAutoWpm(autoWpm + 20);
                event.currentTarget.blur();
              }}
            >
              +
            </button>
            <span className="speed-wpm-label">
              {autoWpm} {locale === "tr" ? "dk/klm" : "WPM"}
            </span>
          </div>
        </div>
        {hasOrigin ? <button type="button" className="text-btn return-reading" onClick={() => {
          const position = capturePosition();
          originRef.current = null;
          setHasOrigin(false);
          if (position) {
            positionRef.current = position;
            writeReadingPosition(documentId, position);
          }
        }}>{locale === "tr" ? "Buradan devam" : "Continue here"}</button> : null}
        <button type="button" className="text-btn return-reading" disabled={!canReturn} onClick={onReturnReading}>
          {locale === "tr" ? "Kaldığım yere dön" : "Back to reading"}
        </button>
        </div>
      </div>
      <div className="fine-reading-status" role="status" aria-live="polite">
        {autoPlaying ? (
          locale === "tr"
            ? `▶ Otomatik okuma aktif (${autoWpm} dk/klm · ${autoAxis === "horizontal" ? (fineMode === "word" ? `${wordStep} kelime` : "Anlamlı öbek") : "Satır / paragraf"}) · Boşluk (Space) ile duraklat`
            : `▶ Auto-reading active (${autoWpm} WPM · ${autoAxis === "horizontal" ? (fineMode === "word" ? `${wordStep} words` : "Meaningful phrase") : "Line / paragraph"}) · Space to pause`
        ) : finePending ? (
          locale === "tr" ? "AI öbekleri arka planda hazırlanıyor · Hızlı gramer öbekleriyle beklemeden ilerleniyor…" : "Preparing AI phrases in background · Moving instantly with grammar phrases…"
        ) : fineMode === "grammar" ? (
          locale === "tr" ? "← → Anlamlı öbek (Anında gramer) · Boşluk ile otomatik oku · Shift ile seçimi genişlet" : "← → Meaningful phrase (Instant grammar) · Space to auto-read · Shift extends selection"
        ) : fineMode === "phrase" ? (
          locale === "tr" ? "← → Anlamlı öbek (AI + Önden hazırlama) · Boşluk ile otomatik oku · Shift ile seçimi genişlet" : "← → Meaningful phrase (AI + Prefetch) · Space to auto-read · Shift extends selection"
        ) : (
          locale === "tr" ? `← → Kelime (${wordStep}) · ↑ ↓ Satır / paragraf · Boşluk ile otomatik oku · Shift ile seçimi genişlet` : `← → Word (${wordStep}) · ↑ ↓ Line / paragraph · Space to auto-read · Shift extends selection`
        )}
        {fineError ? <span className="fine-reading-error">{fineError} <button type="button" className="text-btn" onClick={onFineRetry}>{locale === "tr" ? "Tekrar dene" : "Retry"}</button></span> : null}
      </div>
      {chunks.length === 0 ? <p className="empty-columns">{CHROME[locale].noChunks}</p> : null}
      <div ref={parentRef} className="source-scroll">
        <div className={`source-inner${appearance.paragraphNumbers ? "" : " without-numbers"}`} style={{ maxWidth: `calc(${appearance.readingWidth}ch + 5rem)` }}>
          {chunks.map((chunk) => {
            const marks: TextMark[] = [];
            for (const range of selectionMap.get(chunk.id) || []) {
              marks.push({ ...range, className: "quote-mark" });
            }
            for (const bookmark of bookmarks) {
              const spans = bookmark.spans?.length
                ? bookmark.spans
                : [{ chunkId: bookmark.chunkId, start: bookmark.start, end: bookmark.end }];
              for (const span of spans) {
                if (span.chunkId === chunk.id) {
                  marks.push({ start: span.start, end: span.end, className: "bookmark-mark" });
                }
              }
            }
            marks.push(...(searchMap.get(chunk.id) || []));
            return (
              <article
                key={chunk.id}
                data-chunk-id={chunk.id}
                className={activeChunkId === chunk.id ? "source-chunk is-active" : "source-chunk"}
              >
                {chunk.page != null ? (
                  <span className="chunk-page">
                    {CHROME[locale].page} {chunk.page}
                  </span>
                ) : null}
                {(paragraphsByChunk.get(chunk.id) || []).map((paragraph) => {
                  const unit = focusIndex != null ? units[focusIndex] : null;
                  const isActive = unit?.chunkId === chunk.id && unit.start >= paragraph.start && unit.start < paragraph.end;
                  const paragraphMarks = marks.filter((mark) => mark.end > paragraph.start && mark.start < paragraph.end)
                    .map((mark) => ({ ...mark, start: Math.max(0, mark.start - paragraph.start), end: Math.min(paragraph.text.length, mark.end - paragraph.start) }));
                  return (
                    <div key={paragraph.start} className={`source-paragraph${appearance.readingFocus && (isActive || (!unit && visibleParagraph === paragraph.number)) ? " is-reading" : ""}`}
                      data-chunk-id={chunk.id} data-start={paragraph.start} data-end={paragraph.end} data-paragraph-number={paragraph.number}
                      onClick={() => {
                        onFocusPosition(chunk.id, paragraph.start);
                      }}>
                      {appearance.paragraphNumbers ? <span className="paragraph-number" aria-hidden="true">{String(paragraph.number).padStart(3, "0")}</span> : null}
                      <p>{markText(paragraph.text, paragraphMarks, appearance.firstSentenceBold ? firstSentenceEnd(paragraph.text) : 0)}</p>
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
