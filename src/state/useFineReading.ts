import { useEffect, useMemo, useRef, useState } from "react";
import { prepareReadingPhrases, type ProviderId } from "../api/client";
import {
  exactFineSpans,
  fineUnits,
  normalizeWordStep,
  readingPassages,
  unitAt,
  type FineMode,
  type FineUnit,
  type Passage,
  type TextRange,
  type WordStep,
} from "../reader/fine-reading";
import type { SourceUnit } from "../reader/selection";
import type { Chunk, HighlightRange } from "../types/document";

const MODE_KEY = "tabulect:horizontal-mode";
const WORD_STEP_KEY = "tabulect:word-step";

const readMode = (): FineMode => {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === "phrase" || raw === "grammar") return raw;
    return "word";
  } catch {
    return "word";
  }
};

const readWordStep = (): WordStep => {
  try {
    return normalizeWordStep(localStorage.getItem(WORD_STEP_KEY));
  } catch {
    return 1;
  }
};

export function useFineReading({ documentId, chunks, provider, model, anchor }: {
  documentId: string; chunks: Chunk[]; provider: ProviderId; model: string; anchor?: SourceUnit;
}) {
  const [mode, setModeState] = useState<FineMode>(readMode);
  const [wordStep, setWordStepState] = useState<WordStep>(readWordStep);
  const context = useMemo(() => ({
    documentId,
    passages: readingPassages(chunks),
    cache: new Map<string, TextRange[]>(),
    requests: new Map<string, Promise<TextRange[]>>(),
    failures: new Map<string, string>(),
    indexes: new Map<string, FineUnit[]>(),
    controller: new AbortController(),
    mounted: false,
  }), [documentId, chunks, provider, model]);
  const live = useRef(context); live.current = context;
  const [selection, setSelection] = useState<{ context: typeof context; mode: FineMode; units: FineUnit[] } | null>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [status, setStatus] = useState<{ context: typeof context; pending: boolean; provisional: boolean; error: string | null } | null>(null);
  const intent = useRef(0);
  const lastMove = useRef<{ direction: -1 | 1; shift: boolean } | null>(null);
  const active = selection?.context === context ? selection : null;
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const restored = useRef<{ documentId: string; chunkId: string; start: number } | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const wordStepRef = useRef(wordStep); wordStepRef.current = wordStep;

  useEffect(() => {
    context.mounted = true;
    return () => {
      context.mounted = false;
      queueMicrotask(() => { if (!context.mounted) context.controller.abort(); });
    };
  }, [context]);

  const syncBackgroundStatus = () => {
    if (live.current !== context || context.controller.signal.aborted) return;
    const isPending = context.requests.size > 0;
    setStatus((prev) => {
      if (prev?.context !== context) {
        return isPending ? { context, pending: true, provisional: false, error: null } : prev;
      }
      if (prev.pending === isPending) return prev;
      return { ...prev, pending: isPending };
    });
  };

  const ensure = (p: Passage, retry = false) => {
    const cached = context.cache.get(p.key);
    if (cached) return Promise.resolve(cached);
    const existing = context.requests.get(p.key);
    if (existing) return existing;
    if (!retry && context.failures.has(p.key)) return Promise.reject(new Error(context.failures.get(p.key)));
    const request = prepareReadingPhrases({ text: p.text, provider, model, retry }, context.controller.signal)
      .then((ranges) => {
        context.cache.set(p.key, ranges);
        context.indexes.delete("phrase");
        context.indexes.delete("phrase:hybrid");
        context.failures.delete(p.key);
        return ranges;
      })
      .catch((error) => {
        if (!context.controller.signal.aborted) {
          context.failures.set(p.key, String(error.message || error));
        }
        throw error;
      })
      .finally(() => {
        context.requests.delete(p.key);
        syncBackgroundStatus();
      });
    context.requests.set(p.key, request);
    syncBackgroundStatus();
    return request;
  };

  const prefetch = (point?: { chunkId: string; start: number }) => {
    if (!context.passages.length) return;
    const index = unitAt(context.passages, point);
    // Prepare the active passage and the next passage in the background.
    for (const p of context.passages.slice(index, index + 2)) {
      void ensure(p).catch(() => {});
    }
  };

  // Proactive paragraph-focused prefetch when entering phrase mode or moving with ↑/↓
  useEffect(() => {
    if (mode !== "phrase" || !context.passages.length) return;
    const target = (selectionRef.current?.context === context ? selectionRef.current.units[0] : undefined) ||
      (restored.current?.documentId === documentId ? restored.current : undefined) ||
      anchor;
    const timer = setTimeout(() => {
      if (live.current === context && modeRef.current === "phrase") {
        prefetch(target);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [context, documentId, mode, anchor?.chunkId, anchor?.start]);

  const reset = (point?: { chunkId: string; start: number }) => {
    intent.current++;
    if (point) {
      restored.current = { ...point, documentId };
    } else if (selectionRef.current?.context === context && selectionRef.current.units[0]) {
      const u = selectionRef.current.units[0];
      restored.current = { documentId, chunkId: u.chunkId, start: u.start };
    }
    selectionRef.current = null;
    setSelection(null);
    setStatus(null);
    lastMove.current = null;
  };

  const indexedUnits = (selectedMode: FineMode, stepCount: WordStep, hybridFallback = false) => {
    const cacheKey = selectedMode === "word"
      ? `word:${stepCount}`
      : selectedMode === "phrase" && hybridFallback
        ? "phrase:hybrid"
        : selectedMode;
    let all = context.indexes.get(cacheKey);
    if (!all) {
      all = fineUnits(context.passages, selectedMode, context.cache, hybridFallback, stepCount);
      context.indexes.set(cacheKey, all);
    }
    return all;
  };

  const move = async (direction: -1 | 1, shift: boolean, retry = false): Promise<boolean> => {
    const requestIntent = ++intent.current;
    const selectedMode = modeRef.current;
    const currentWordStep = wordStepRef.current;
    const previous = selectionRef.current?.context === context && selectionRef.current.mode === selectedMode ? selectionRef.current : null;
    lastMove.current = { direction, shift };
    const point = previous?.units[0] || (selectionRef.current?.context === context ? selectionRef.current.units[0] : undefined) ||
      (restored.current?.documentId === documentId ? restored.current : undefined) || anchorRef.current;
    const choose = (all: FineUnit[]) => {
      if (!previous) return unitAt(all, point);
      const edge = direction > 0 ? previous.units[previous.units.length - 1] : previous.units[0];
      const at = unitAt(all, { chunkId: edge.chunkId, start: direction > 0 ? edge.end - 1 : edge.start });
      return Math.max(0, Math.min(all.length - 1, at + direction));
    };
    try {
      if (selectedMode === "phrase" && retry) {
        let rawAll = indexedUnits(selectedMode, currentWordStep, false);
        if (!rawAll.length) return false;
        const origin = rawAll[unitAt(rawAll, point)];
        if (origin?.pending) {
          setStatus({ context, pending: true, provisional: false, error: null });
          await ensure(context.passages.find((p) => p.key === origin.passageKey)!, true);
          rawAll = indexedUnits(selectedMode, currentWordStep, false);
        }
        const targetIdx = choose(rawAll);
        if (rawAll[targetIdx]?.pending) {
          setStatus({ context, pending: true, provisional: false, error: null });
          await ensure(context.passages.find((p) => p.key === rawAll[targetIdx].passageKey)!, true);
        }
      }

      const all = indexedUnits(selectedMode, currentWordStep, selectedMode === "phrase");
      if (!all.length) return false;
      const index = choose(all);
      if (live.current !== context || requestIntent !== intent.current || selectedMode !== modeRef.current) return false;

      if (previous && !shift && previous.units.length === 1) {
        const prevIdx = unitAt(all, previous.units[0]);
        if (prevIdx === index) return false;
      }

      const start = shift && previous ? Math.min(unitAt(all, previous.units[0]), index) : index;
      const end = shift && previous ? Math.max(unitAt(all, {
        chunkId: previous.units[previous.units.length - 1].chunkId,
        start: previous.units[previous.units.length - 1].end - 1,
      }), index) : index;
      const units = all.slice(start, end + 1);
      const next = { context, mode: selectedMode, units };
      restored.current = { documentId, chunkId: all[index].chunkId, start: all[index].start };
      selectionRef.current = next;
      setSelection(next);

      if (selectedMode === "phrase") {
        const usedProvisional = units.some((u) => u.provisional);
        const passageError = units.map((u) => context.failures.get(u.passageKey)).find(Boolean) || null;
        prefetch(all[index]);
        setStatus({
          context,
          pending: context.requests.size > 0,
          provisional: usedProvisional,
          error: passageError,
        });
      } else {
        setStatus({ context, pending: false, provisional: false, error: null });
      }
      return true;
    } catch (error) {
      if (live.current !== context || requestIntent !== intent.current || context.controller.signal.aborted) return false;
      setStatus({ context, pending: false, provisional: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const selected = active?.units || [];
  return {
    mode,
    wordStep,
    active: Boolean(active),
    units: selected,
    highlight: selected.length ? { start: 0, end: selected.length - 1 } as HighlightRange : null,
    spans: useMemo(() => exactFineSpans(chunks, selected), [chunks, selection]),
    pending: Boolean(status?.context === context && status.pending),
    provisional: Boolean(status?.context === context && status.provisional),
    error: status?.context === context ? status.error : null,
    move,
    reset,
    retry: () => {
      const action = lastMove.current;
      if (action) void move(action.direction, action.shift, true);
    },
    setMode: (next: FineMode) => {
      intent.current++;
      modeRef.current = next;
      setModeState(next);
      setStatus(null);
      try { localStorage.setItem(MODE_KEY, next); } catch { /* storage unavailable */ }
      if (next === "phrase") prefetch(active?.units[0] || anchor);
    },
    setWordStep: (raw: WordStep) => {
      const next = normalizeWordStep(raw);
      intent.current++;
      wordStepRef.current = next;
      setWordStepState(next);
      try { localStorage.setItem(WORD_STEP_KEY, String(next)); } catch { /* storage unavailable */ }
      if (selectionRef.current?.context === context && selectionRef.current.mode === "word" && selectionRef.current.units.length) {
        const origin = selectionRef.current.units[0];
        const all = indexedUnits("word", next, false);
        if (all.length) {
          const idx = unitAt(all, origin);
          const updated = { context, mode: "word" as FineMode, units: [all[idx]] };
          selectionRef.current = updated;
          setSelection(updated);
        }
      }
    },
  };
}
