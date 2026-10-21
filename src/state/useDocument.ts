import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import essay from "../fixtures/essay.json";
import essayEn from "../fixtures/essay-en.json";
import { initialUiLang } from "../locale/i18n";
import { useFineReading } from "./useFineReading";
import {
  normalizeWpm,
  stepDelayMs,
  type AutoAxis,
} from "../reader/fine-reading";
import {
  addBookmark,
  deleteBookmark,
  deleteDocument,
  deleteTemplate,
  resetTemplate,
  exportOutput,
  getDocument,
  getSettings,
  getCliSessions,
  createFolder as postCreateFolder,
  deleteFolder as postDeleteFolder,
  listLibrary,
  listProviders,
  moveDocumentFolder as postMoveDocumentFolder,
  listTemplates,
  patchSettings,
  pickDocumentFromShell,
  postIngest,
  postIngestPath,
  postTableAi,
  probeBackendFromShell,
  resetCliSession,
  renameDocument,
  renameFolder as postRenameFolder,
  reorderBookmarks as postReorderBookmarks,
  saveLiveDocument,
  saveOutputFile,
  upsertTemplate,
  waitIngestFromShell,
  JobLostError,
  type IngestEvent,
  type LibraryDocument,
  type LibraryFolder,
  type ProviderId,
  type ProviderStatus,
} from "../api/client";
import {
  migrateDocument,
  type Bookmark,
  type Document,
  type HighlightRange,
  type PromptTemplate,
  type StepSize,
  type TableLocale,
} from "../types/document";
import {
  applyAppearance,
  readAppearance,
  readerFontStack,
  writeAppearance,
  type Appearance,
} from "../reader/appearance";
import { defaultModel, normalizeModelId, readStoredModels, writeStoredModels, type ModelMap } from "../reader/models";
import {
  moveHighlight,
  normalizeStep,
  spansFromUnits,
  textFromSpans,
  unitsForStep,
  windowAt,
  indexOfUnitOffset,
} from "../reader/selection";
import {
  readOutputMode,
  writeOutputMode,
  type OutputMode,
} from "../reader/output-mode";

const LOCALE_KEY = "tabulect:tableLocale";
const SPLIT_KEY = "tabulect:splitterRatio";
const PROVIDER_KEY = "tabulect:provider";
const PANE_KEY = "tabulect:paneLayout";
const STEP_KEY = "tabulect:stepSize";
const LAST_DOC = "tabulect:lastDocumentId";
const AUTO_WPM_KEY = "tabulect:auto-wpm";
const AUTO_AXIS_KEY = "tabulect:auto-axis";

export type PaneLayout = "both" | "source" | "table";
export type BackendFlag = "checking" | "online" | "offline";
export type SourceKind = "fixture" | "live";
export type IngestStatus = "idle" | "uploading" | "running" | "done" | "error";

/**
 * First-run sample in the interface language: Bacon's "Of Studies" (public domain) in English,
 * the original Turkish essay in the Turkish interface. Its table language follows the UI too.
 */
function cloneFixture(lang = initialUiLang()): Document {
  return migrateDocument(structuredClone(lang === "tr" ? essay : essayEn) as Document);
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function readProvider(): ProviderId {
  return readStored(PROVIDER_KEY, ["codex", "kimi", "antigravity", "cursor", "claude"] as const, "codex");
}

function readAutoWpm(): number {
  try {
    return normalizeWpm(localStorage.getItem(AUTO_WPM_KEY));
  } catch {
    return 240;
  }
}

function readAutoAxis(): AutoAxis {
  return readStored(AUTO_AXIS_KEY, ["horizontal", "vertical"] as const, "horizontal");
}

function readSplitter(): number {
  try {
    const n = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(n) && n >= 0.22 && n <= 0.78) return n;
  } catch {
    /* ignore */
  }
  return 0.46;
}

function writeLastDocumentId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_DOC, id);
    else localStorage.removeItem(LAST_DOC);
  } catch {
    /* ignore */
  }
}

export function useDocumentState() {
  const [doc, setDoc] = useState<Document>(() => cloneFixture());
  const [sourceKind, setSourceKind] = useState<SourceKind>("fixture");
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const initial = readAppearance();
    applyAppearance(initial);
    return initial;
  });
  const [paneLayout, setPaneLayoutState] = useState<PaneLayout>(() =>
    readStored(PANE_KEY, ["both", "source", "table"] as const, "both"),
  );
  const [splitterRatio, setSplitterRatio] = useState(readSplitter);
  const [backend, setBackend] = useState<BackendFlag>("checking");
  const [provider, setProviderState] = useState<ProviderId>(readProvider);
  const [models, setModels] = useState<ModelMap>(() => readStoredModels());
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [stepSize, setStepSizeState] = useState<StepSize>(() => normalizeStep(localStorage.getItem(STEP_KEY)));
  const [highlight, setHighlight] = useState<HighlightRange | null>(null);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [autoWpm, setAutoWpmState] = useState<number>(readAutoWpm);
  const [autoAxis, setAutoAxisState] = useState<AutoAxis>(readAutoAxis);
  const [command, setCommand] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([
    {
      id: "tpl-selection-table",
      name: "Seçim → tablo",
      nameEn: "Selection → table",
      scope: "selection",
      builtin: true,
      body: "Seçili metni bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her hücre seçilen pasaja dayansın. Uydurma. Hücreler kısa ve net olsun. Kullanıcı açıkça diyagram, mermaid, flowchart veya HTML kart istemedikçe yalnızca tabloyu ver; tablodan sonra mermaid, flowchart veya süs HTML ekleme.",
    },
    {
      id: "tpl-bookmarks-table",
      name: "Yer imleri → tablo",
      nameEn: "Bookmarks → table",
      scope: "bookmarks",
      builtin: true,
      body: "Aşağıdaki yer imlerini tek bir okuma tablosuna dönüştür. Markdown tablosu döndür. Sütunlar: Ana fikir | Gerekçe | Örnek | Pratik öneri. Her satır bir yer imine karşılık gelsin. Metinde olmayan iddia uydurma. Kullanıcı açıkça diyagram, mermaid, flowchart veya HTML kart istemedikçe yalnızca tabloyu ver; tablodan sonra mermaid, flowchart veya süs HTML ekleme.",
    },
  ]);
  const [templateId, setTemplateId] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [outputDraft, setOutputDraft] = useState("");
  const [outputMode, setOutputModeState] = useState<OutputMode>(readOutputMode);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [chatExists, setChatExists] = useState<boolean | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [warnAll, setWarnAll] = useState(false);
  const [ingest, setIngest] = useState<{
    status: IngestStatus;
    jobId: string | null;
    phase: IngestEvent["phase"] | null;
    pct: number;
    message: string;
    error: string | null;
  }>({ status: "idle", jobId: null, phase: null, pct: 0, message: "", error: null });
  const [library, setLibrary] = useState<LibraryDocument[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [extraSourceIds, setExtraSourceIds] = useState<string[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);

  const [charsPerLine, setCharsPerLineState] = useState(72);
  const sourceKindRef = useRef<SourceKind>("fixture");
  // While the first-run sample is shown, switching the interface language swaps the sample
  // (and its table language) to match. User documents keep their own table language.
  useEffect(() => {
    const sync = () => {
      if (sourceKindRef.current === "fixture") setDoc(cloneFixture());
    };
    window.addEventListener("tabulect:uiLang", sync);
    return () => window.removeEventListener("tabulect:uiLang", sync);
  }, []);
  const aiPendingRef = useRef(false);
  useEffect(() => {
    let current = true;
    setChatExists(null);
    if (!aiPending) void getCliSessions().then((sessions) => {
      const key = `${provider}:${provider === "cursor" ? doc.id : "app"}`;
      if (current) setChatExists(sessions.some((session) => session.key === key && Boolean(session.id)));
    }).catch(() => {});
    return () => { current = false; };
  }, [provider, doc.id, aiPending]);
  const outputModeRef = useRef<OutputMode>(outputMode);
  const outputDraftRef = useRef(outputDraft);
  const docIdRef = useRef(doc.id);
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  outputModeRef.current = outputMode;
  outputDraftRef.current = outputDraft;
  docIdRef.current = doc.id;
  sourceKindRef.current = sourceKind;
  const units = useMemo(
    () => unitsForStep(doc.chunks, stepSize, { charsPerLine }),
    [doc.chunks, stepSize, charsPerLine],
  );
  const prevUnitsRef = useRef(units);
  const prevUnitsDocumentRef = useRef(doc.id);
  const fine = useFineReading({
    documentId: doc.id,
    chunks: doc.chunks,
    provider,
    model: normalizeModelId(models[provider] ?? defaultModel(provider)),
    anchor: highlight && !highlight.empty ? units[highlight.start] : undefined,
  });
  const fineRef = useRef(fine); fineRef.current = fine;
  const selectionSpans = useMemo(() => {
    if (fine.active) return fine.spans;
    if (!highlight || highlight.empty) return [];
    return spansFromUnits(units, highlight.start, highlight.end);
  }, [highlight, units, fine.active, fine.spans]);
  const selectionText = useMemo(() => textFromSpans(selectionSpans), [selectionSpans]);

  useEffect(() => {
    const prevUnits = prevUnitsRef.current;
    const previousDocumentId = prevUnitsDocumentRef.current;
    prevUnitsRef.current = units;
    prevUnitsDocumentRef.current = doc.id;
    // The child restores a saved position during layout. Never map that new selection through the previous book.
    if (previousDocumentId !== doc.id) return;
    if (prevUnits === units || !prevUnits.length) return;
    setHighlight((current) => {
      if (!current || current.empty) return current;
      const from = prevUnits[current.start];
      if (!from) return windowAt(0, stepSize, units.length);
      const idx = indexOfUnitOffset(units, from.chunkId, from.start);
      return windowAt(idx >= 0 ? idx : 0, stepSize, units.length);
    });
  }, [doc.id, stepSize, units]);

  useEffect(() => {
    applyAppearance(appearance);
    writeAppearance(appearance);
  }, [appearance]);

  useEffect(() => {

    try {
      localStorage.setItem(LOCALE_KEY, doc.tableLocale);
    } catch {
      /* ignore */
    }
  }, [doc.tableLocale]);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(splitterRatio));
      localStorage.setItem(PROVIDER_KEY, provider);
      localStorage.setItem(STEP_KEY, stepSize);
    } catch {
      /* ignore */
    }
  }, [splitterRatio, provider, stepSize]);

  const model = models[provider] ?? defaultModel(provider);
  const modelForApi =
    provider === "cursor" ? normalizeModelId(model) || "auto" : normalizeModelId(model);

  useEffect(() => {
    writeStoredModels(models);
  }, [models]);

  const applyDocument = useCallback((next: Document, kind: SourceKind) => {
    const incoming = migrateDocument(next);
    const switched = docIdRef.current !== incoming.id;
    if (switched) {
      setAutoPlaying(false);
      setHighlight(null);
    }
    setDoc((previous) => {
      // Metadata updates (including Enter/bookmark) must not rebuild the reader or its search results.
      const sameChunks = previous.id === incoming.id && previous.chunks.length === incoming.chunks.length &&
        previous.chunks.every((chunk, i) => {
          const nextChunk = incoming.chunks[i];
          return chunk.id === nextChunk.id && chunk.text === nextChunk.text && chunk.page === nextChunk.page &&
            chunk.start === nextChunk.start && chunk.end === nextChunk.end;
        });
      return sameChunks ? { ...incoming, chunks: previous.chunks } : incoming;
    });
    setSourceKind(kind);
    docIdRef.current = incoming.id;
    if (!aiPendingRef.current || switched) {
      setOutputDraft(incoming.outputs[0]?.content || "");
    }
    if (kind === "live") writeLastDocumentId(incoming.id);
  }, []);

  const reloadTemplates = useCallback(async () => {
    try {
      setTemplates(await listTemplates());
    } catch {
      /* backend offline */
    }
  }, []);

  const refreshBackend = useCallback(async () => {
    const probe = await probeBackendFromShell();
    setBackend(probe.online ? "online" : "offline");
    if (probe.online) {
      try {
        setProviders(await listProviders());
        setTemplates(await listTemplates());
        const settings = await getSettings();
        setExportDir(settings.exportDir || "");
      } catch {
        setProviders([]);
      }
    }
    return probe.online;
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLibraryStatus((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const snap = await listLibrary();
      setLibrary(snap.documents);
      setFolders(snap.folders);
      setLibraryError(null);
      setLibraryStatus("ready");
      return snap.documents;
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
      setLibraryStatus("error");
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await refreshBackend();
      if (cancelled || !ok) return;
      const items = await refreshLibrary();
      if (cancelled || sourceKindRef.current === "live") return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_DOC);
      } catch {
        last = null;
      }
      const preferred = (last && items.find((item) => item.id === last)) || items[0];
      if (!preferred) return;
      try {
        const live = await getDocument(preferred.id);
        if (!cancelled) applyDocument(live, "live");
      } catch {
        /* stay on fixture */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDocument, refreshBackend, refreshLibrary]);

  const ensureLive = useCallback(async () => {
    if (sourceKindRef.current === "live") return doc;
    const saved = await saveLiveDocument(doc);
    applyDocument(saved, "live");
    await refreshLibrary();
    return saved;
  }, [applyDocument, doc, refreshLibrary]);

  const moveSelection = useCallback(
    (direction: -1 | 1, shift: boolean): boolean => {
      if (!units.length) return false;
      const selected = fineRef.current.units;
      const point = direction > 0 ? selected[selected.length - 1] : selected[0];
      fineRef.current.reset();
      const prev = highlightRef.current;
      const index = point ? indexOfUnitOffset(units, point.chunkId, point.start) : -1;
      const current = index >= 0 ? windowAt(index, stepSize, units.length) : prev;
      if (!shift && direction > 0 && current && !current.empty && current.end >= units.length - 1 && index < 0) {
        return false;
      }
      const next = moveHighlight(current, { direction, shift, step: stepSize, length: units.length });
      highlightRef.current = next;
      setHighlight(next);
      return true;
    },
    [stepSize, units],
  );

  // Automatic speed-reading timer loop (supports both → word/phrase and ↓ line/paragraph)
  useEffect(() => {
    if (!autoPlaying) return;
    const minWords = autoAxis === "horizontal" && fine.mode === "word" ? fine.wordStep : 1;
    const delay = stepDelayMs(selectionText || "kelime", autoWpm, minWords);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      if (autoAxis === "horizontal") {
        const moved = await fineRef.current.move(1, false);
        if (!moved && !cancelled) setAutoPlaying(false);
      } else {
        const moved = moveSelection(1, false);
        if (!moved && !cancelled) setAutoPlaying(false);
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoPlaying, autoAxis, autoWpm, selectionText, highlight, fine.units, fine.mode, fine.wordStep, moveSelection]);

  const setAutoWpm = useCallback((raw: number) => {
    const next = normalizeWpm(raw);
    setAutoWpmState(next);
    try {
      localStorage.setItem(AUTO_WPM_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const setAutoAxis = useCallback((next: AutoAxis) => {
    const axis: AutoAxis = next === "vertical" ? "vertical" : "horizontal";
    setAutoAxisState(axis);
    try {
      localStorage.setItem(AUTO_AXIS_KEY, axis);
    } catch {
      /* ignore */
    }
  }, []);

  const stopAutoPlay = useCallback(() => {
    setAutoPlaying(false);
  }, []);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlaying((playing) => {
      if (playing) return false;
      if (autoAxis === "horizontal") {
        if (!fineRef.current.active) {
          void fineRef.current.move(1, false);
        }
      } else if (fineRef.current.active || !highlightRef.current || highlightRef.current.empty) {
        const selected = fineRef.current.units;
        const point = selected[0];
        fineRef.current.reset();
        const idx = point ? indexOfUnitOffset(units, point.chunkId, point.start) : -1;
        const next = windowAt(idx >= 0 ? idx : 0, stepSize, units.length);
        highlightRef.current = next;
        setHighlight(next);
      }
      return true;
    });
  }, [autoAxis, stepSize, units]);

  const focusUnit = useCallback(
    (index: number) => {
      fineRef.current.reset();
      const next = windowAt(index, stepSize, units.length);
      highlightRef.current = next;
      setHighlight(next);
    },
    [stepSize, units.length],
  );

  const commitBookmark = useCallback(async () => {
    if (!selectionText) return;
    const first = selectionSpans[0];
    if (!first) return;
    try {
      const live = await ensureLive();
      const result = await addBookmark(live.id, {
        text: selectionText,
        chunkId: first.chunkId,
        start: first.start,
        end: first.end,
        page: first.page,
        spans: selectionSpans.map((span) => ({
          chunkId: span.chunkId,
          start: span.start,
          end: span.end,
          page: span.page,
        })),
      });
      if (docIdRef.current !== live.id) return;
      applyDocument(result.document, "live");
      await refreshLibrary();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    }
  }, [applyDocument, ensureLive, refreshLibrary, selectionSpans, selectionText]);

  const clearHighlight = useCallback(() => {
    setAutoPlaying(false);
    fineRef.current.reset();
    highlightRef.current = null;
    setHighlight(null);
  }, []);

  const removeBookmark = useCallback(
    async (id: string) => {
      try {
        const live = await ensureLive();
        const next = await deleteBookmark(live.id, id);
        applyDocument(next, "live");
        await refreshLibrary();
      } catch (error) {
        setLibraryError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyDocument, ensureLive, refreshLibrary],
  );

  const moveBookmark = useCallback(
    async (id: string, direction: -1 | 1) => {
      const list = doc.bookmarks || [];
      const index = list.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
      const ids = list.map((item) => item.id);
      const swap = ids[nextIndex];
      ids[nextIndex] = ids[index];
      ids[index] = swap;
      try {
        const live = await ensureLive();
        const next = await postReorderBookmarks(live.id, ids);
        applyDocument(next, "live");
      } catch (error) {
        setLibraryError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyDocument, doc.bookmarks, ensureLive],
  );

  const jumpBookmark = useCallback(
    (bookmark: Bookmark) => {
      setAutoPlaying(false);
      fineRef.current.reset({ chunkId: bookmark.chunkId, start: bookmark.start });
      const index = units.findIndex(
        (unit) => unit.chunkId === bookmark.chunkId && unit.start <= bookmark.start && unit.end >= bookmark.start,
      );
      if (index >= 0) {
        const next = windowAt(index, stepSize, units.length);
        highlightRef.current = next;
        setHighlight(next);
      }
    },
    [stepSize, units],
  );

  const waitForJob = useCallback(
    async (jobId: string) => {
      setIngest((prev) => ({ ...prev, status: "running", jobId }));
      const finalEvent = await waitIngestFromShell(jobId, (event) => {
        setIngest({
          status: event.phase === "error" ? "error" : event.phase === "done" ? "done" : "running",
          jobId,
          phase: event.phase,
          pct: event.pct,
          message: event.message,
          error: event.phase === "error" ? event.error : null,
        });
        if (event.documentId && !aiPendingRef.current) {
          void getDocument(event.documentId)
            .then((live) => applyDocument(live, "live"))
            .catch(() => {});
        }
      });
      if (finalEvent.documentId) {
        const live = await getDocument(finalEvent.documentId);
        applyDocument(live, "live");
        await refreshLibrary();
      }
      return finalEvent;
    },
    [applyDocument, refreshLibrary],
  );

  const ensureBackend = useCallback(async () => {
    const ok = backend === "online" || (await refreshBackend());
    if (!ok) {
      setIngest({
        status: "error",
        jobId: null,
        phase: "error",
        pct: 0,
        message: "",
        error: "backend-offline",
      });
    }
    return ok;
  }, [backend, refreshBackend]);

  const ingestFile = useCallback(
    async (file: File) => {
      if (!(await ensureBackend())) return;
      setIngest({ status: "uploading", jobId: null, phase: "queued", pct: 1, message: file.name, error: null });
      try {
        const { jobId } = await postIngest({ file, provider, model: modelForApi, tableLocale: doc.tableLocale });
        await waitForJob(jobId);
      } catch (error) {
        setIngest((prev) => ({
          ...prev,
          status: "error",
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [doc.tableLocale, ensureBackend, modelForApi, provider, waitForJob],
  );

  const ingestPath = useCallback(
    async (filePath: string, filename?: string) => {
      if (!(await ensureBackend())) return;
      const name = filename || filePath.split(/[/\\]/).pop() || filePath;
      setIngest({ status: "uploading", jobId: null, phase: "queued", pct: 1, message: name, error: null });
      try {
        const { jobId } = await postIngestPath({
          filePath,
          filename: name,
          provider,
          model: modelForApi,
          tableLocale: doc.tableLocale,
        });
        await waitForJob(jobId);
      } catch (error) {
        setIngest((prev) => ({
          ...prev,
          status: "error",
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [doc.tableLocale, ensureBackend, modelForApi, provider, waitForJob],
  );

  const pickAndIngest = useCallback(async () => {
    const picked = await pickDocumentFromShell();
    if (!picked) return;
    await ingestPath(picked.path, picked.name);
  }, [ingestPath]);

  const finishTableJob = useCallback(
    async (body: Parameters<typeof postTableAi>[0]) => {
      const append = outputModeRef.current === "append";
      const baseContent = append ? outputDraftRef.current : "";
      aiPendingRef.current = true;
      setAiPending(true);
      setAiError(null);
      try {
        const live = await ensureLive();
        const { jobId } = await postTableAi({
          ...body,
          documentId: live.id,
          provider,
          model: modelForApi,
          tableLocale: live.tableLocale,
          append,
          baseContent: append ? baseContent : undefined,
        });
        await waitForJob(jobId);
        const latest = await getDocument(live.id);
        aiPendingRef.current = false;
        setAiPending(false);
        applyDocument(latest, "live");
        setOutputDraft(latest.outputs[0]?.content || "");
        return true;
      } catch (error) {
        aiPendingRef.current = false;
        if (error instanceof JobLostError) {
          setAiPending(false);
          return false;
        }
        setAiError(error instanceof Error ? error.message : String(error));
        setAiPending(false);
        return false;
      }
    },
    [applyDocument, ensureLive, modelForApi, provider, waitForJob],
  );

  const runTableAi = useCallback(
    async (opts?: { forceAll?: boolean }) => {
      if (!(await ensureBackend())) return false;
      const hasSelection = Boolean(selectionText);
      if (!hasSelection && !opts?.forceAll) {
        setWarnAll(true);
        return false;
      }
      setWarnAll(false);
      const tableTemplate =
        templateId && templateId !== "none" && templateId !== "tpl-none"
          ? templateId
          : "tpl-selection-table";
      return finishTableJob({
        documentId: "",
        provider,
        tableLocale: doc.tableLocale,
        templateId: tableTemplate,
        selection: hasSelection ? { text: selectionText } : undefined,
        allBookmarks: !hasSelection,
        mentionIds: extraSourceIds,
      });
    },
    [doc.tableLocale, ensureBackend, extraSourceIds, finishTableJob, provider, selectionText, templateId],
  );

  const applyInstruction = useCallback(
    async (instruction: string) => {
      const text = String(instruction || "").trim();
      if (!text) return false;
      if (!(await ensureBackend())) return false;
      setWarnAll(false);
      return finishTableJob({
        documentId: "",
        provider,
        tableLocale: doc.tableLocale,
        templateId,
        instruction: text,
        source: "instruction",
        selection: selectionText ? { text: selectionText } : undefined,
        allBookmarks: false,
        mentionIds: extraSourceIds,
      });
    },
    [doc.tableLocale, ensureBackend, extraSourceIds, finishTableJob, provider, selectionText, templateId],
  );

  const saveCurrentOutput = useCallback(async () => {
    if (!outputDraft.trim()) return;
    try {
      const saved = await saveOutputFile({
        format: "md",
        title: doc.title,
        content: outputDraft,
        directory: exportDir || undefined,
      });
      setSavedPath(saved.path);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    }
  }, [doc.title, exportDir, outputDraft]);

  const exportCurrent = useCallback(
    async (format: "md" | "html" | "pdf" | "docx" | "xlsx") => {
      try {
        await exportOutput({ format, title: doc.title, content: outputDraft });
      } catch (error) {
        setAiError(error instanceof Error ? error.message : String(error));
      }
    },
    [doc.title, outputDraft],
  );

  const openLibraryDocument = useCallback(
    async (id: string) => {
      setLibraryBusyId(id);
      try {
        applyDocument(await getDocument(id), "live");
      } catch (error) {
        setLibraryError(error instanceof Error ? error.message : String(error));
      } finally {
        setLibraryBusyId(null);
      }
    },
    [applyDocument],
  );

  const deleteLibraryDocument = useCallback(
    async (id: string) => {
      setLibraryBusyId(id);
      try {
        await deleteDocument(id);
        const items = await refreshLibrary();
        if (sourceKindRef.current === "live" && doc.id === id) {
          if (items[0]) applyDocument(await getDocument(items[0].id), "live");
          else applyDocument(cloneFixture(), "fixture");
        }
      } catch (error) {
        setLibraryError(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        setLibraryBusyId(null);
      }
    },
    [applyDocument, doc.id, refreshLibrary],
  );

  const renameLibraryDocument = useCallback(
    async (id: string, title: string) => {
      const updated = await renameDocument(id, title);
      if (doc.id === id) setDoc((prev) => ({ ...prev, title: updated.title }));
      await refreshLibrary();
    },
    [doc.id, refreshLibrary],
  );

  const readerStyle = useMemo(() => {
    const style: CSSProperties & Record<string, string> = {
      "--reader-font-family": readerFontStack(appearance.fontFamily),
      "--reader-font-size": `${appearance.fontSize}px`,
      "--reader-line-height": String(appearance.lineHeight),
      "--reader-para-gap": `${appearance.paragraphGap}rem`,
    };
    return style;
  }, [appearance.fontFamily, appearance.fontSize, appearance.lineHeight, appearance.paragraphGap]);

  return {
    doc,
    sourceKind,
    appearance,
    setAppearance: (partial: Partial<Appearance>) => setAppearance((prev) => ({ ...prev, ...partial })),
    paneLayout,
    setPaneLayout: (next: PaneLayout) => {
      setPaneLayoutState(next);
      try {
        localStorage.setItem(PANE_KEY, next);
      } catch {
        /* ignore */
      }
    },
    splitterRatio,
    persistSplitter: (ratio: number) => setSplitterRatio(Math.min(0.78, Math.max(0.22, ratio))),
    backend,
    provider,
    model,
    providers,
    setProvider: setProviderState,
    setModel: (next: string) => setModels((prev) => ({ ...prev, [provider]: next })),
    stepSize,
    setStepSize: (next: StepSize) => {
      const point = fineRef.current.units[0];
      fineRef.current.reset();
      setStepSizeState(next);
      const nextUnits = unitsForStep(doc.chunks, next, { charsPerLine });
      setHighlight((prev) => {
        if ((!prev || prev.empty) && !point) return prev;
        const from = point || units[prev!.start];
        if (!from) return windowAt(0, next, nextUnits.length);
        const idx = indexOfUnitOffset(nextUnits, from.chunkId, from.start);
        const updated = windowAt(idx >= 0 ? idx : 0, next, nextUnits.length);
        highlightRef.current = updated;
        return updated;
      });
    },
    setCharsPerLine: (next: number) => {
      const n = Math.max(20, Math.min(160, Math.round(next)));
      setCharsPerLineState((prev) => (Math.abs(prev - n) < 2 ? prev : n));
    },
    highlight,
    units,
    fine,
    autoPlaying,
    autoWpm,
    autoAxis,
    setAutoWpm,
    setAutoAxis,
    toggleAutoPlay,
    stopAutoPlay,
    readingUnits: fine.active ? fine.units : units,
    readingHighlight: fine.active ? fine.highlight : highlight,
    command,
    setCommand,
    selectionText,
    templates,
    templateId,
    setTemplateId,
    saveTemplate: async (partial: { id?: string; name: string; body: string }) => {
      setTemplates(await upsertTemplate(partial));
    },
    removeTemplate: async (id: string) => {
      setTemplates(await deleteTemplate(id));
    },
    resetTemplate: async (id: string) => {
      setTemplates(await resetTemplate(id));
    },
    reloadTemplates,
    ingest,
    library,
    folders,
    extraSourceIds,
    toggleExtraSource: (id: string) => {
      setExtraSourceIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    },
    clearExtraSources: () => setExtraSourceIds([]),
    libraryStatus,
    libraryError,
    libraryBusyId,
    exportDir,
    setExportDir: (value: string) => {
      setExportDir(value);
      void patchSettings({ exportDir: value }).catch(() => {});
    },
    outputDraft,
    setOutputDraft,
    outputMode,
    setOutputMode: (next: OutputMode) => {
      const mode = next === "append" ? "append" : "new";
      setOutputModeState(mode);
      writeOutputMode(mode);
    },
    output: doc.outputs[0] || null,
    aiPending,
    aiError,
    chatExists,
    savedPath,
    warnAll,
    setWarnAll,
    setTableLocale: (locale: TableLocale) => setDoc((prev) => ({ ...prev, tableLocale: locale })),
    cycleTheme: () =>
      setAppearance((prev) => {
        const order = ["white", "paper", "sepia", "dusk", "dark", "night", "forest", "slate"] as const;
        const index = order.indexOf(prev.theme);
        return { ...prev, theme: order[(index + 1) % order.length] };
      }),
    readerStyle,
    moveSelection,
    focusUnit,
    resumeReading: (chunkId: string, offset: number) => {
      fineRef.current.reset({ chunkId, start: offset });
      const index = indexOfUnitOffset(units, chunkId, offset);
      if (index >= 0) {
        const next = windowAt(index, stepSize, units.length);
        highlightRef.current = next;
        setHighlight(next);
      }
    },
    clearHighlight,
    commitBookmark,
    removeBookmark,
    moveBookmark,
    jumpBookmark,
    ingestFile,
    ingestPath,
    pickAndIngest,
    runTableAi,
    applyInstruction,
    resetChat: async () => {
      if (aiPendingRef.current) return;
      aiPendingRef.current = true;
      setAiPending(true);
      try {
        await resetCliSession({
          provider,
          documentId: doc.id,
        });
        setAiError(null);
        setChatExists(false);
      } catch (error) {
        setAiError(error instanceof Error ? error.message : String(error));
      } finally {
        aiPendingRef.current = false;
        setAiPending(false);
      }
    },
    saveCurrentOutput,
    exportCurrent,
    reloadFixture: () => applyDocument(cloneFixture(), "fixture"),
    openLibraryDocument,
    deleteLibraryDocument,
    renameLibraryDocument,
    createFolder: async (name: string) => {
      const snap = await postCreateFolder(name);
      setLibrary(snap.documents);
      setFolders(snap.folders);
    },
    renameFolder: async (id: string, name: string) => {
      const snap = await postRenameFolder(id, name);
      setLibrary(snap.documents);
      setFolders(snap.folders);
    },
    deleteFolder: async (id: string) => {
      const snap = await postDeleteFolder(id);
      setLibrary(snap.documents);
      setFolders(snap.folders);
    },
    moveDocumentFolder: async (documentId: string, folderId: string | null) => {
      const snap = await postMoveDocumentFolder(documentId, folderId);
      setLibrary(snap.documents);
      setFolders(snap.folders);
    },
  };
}
