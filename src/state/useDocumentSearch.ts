import { useDeferredValue, useMemo, useState } from "react";
import type { Chunk } from "../types/document";
import { buildSearchIndex, searchDocument, type SearchHit, type SearchOptions } from "../reader/search";

export function useDocumentSearch(chunks: Chunk[], command: string, documentId: string) {
  const query = command.startsWith("/") ? "" : command.trim();
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false });
  const deferredQuery = useDeferredValue(query);
  const index = useMemo(() => buildSearchIndex(chunks, options.caseSensitive), [chunks, options.caseSensitive]);
  const hits = useMemo(() => searchDocument(index, deferredQuery, options.wholeWord), [index, deferredQuery, options.wholeWord]);
  const [selection, setSelection] = useState<{ hits: SearchHit[]; documentId: string; index: number; tick: number } | null>(null);
  const busy = query !== deferredQuery;
  const activeIndex = !busy && selection?.hits === hits && selection.documentId === documentId ? selection.index : -1;
  const activeHit = activeIndex >= 0 ? hits[activeIndex] : null;
  const select = (index: number) => {
    if (busy || !hits[index]) return;
    setSelection((previous) => ({ hits, documentId, index, tick: (previous?.tick || 0) + 1 }));
  };
  return { query, options, setOptions, hits, busy, activeIndex, activeHit, select, jumpTick: selection?.tick || 0 };
}
