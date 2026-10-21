import { useCallback, useEffect, useState, type DragEvent } from "react";
import { isTauriRuntime } from "../api/client";
import { CHROME } from "../locale/ui";
import { useUiLang } from "../locale/i18n";
import { SubscriptionsPanel } from "./SubscriptionsPanel";
import { useDocumentState } from "../state/useDocument";
import { useNotes } from "../state/useNotes";
import { AppearancePanel } from "./AppearancePanel";
import { CommandBar } from "./CommandBar";
import { LibraryPanel } from "./LibraryPanel";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotesPanel } from "./NotesPanel";
import { ACCEPT_EXT, OpenDropZone } from "./OpenDropZone";
import { OutputPane } from "./OutputPane";
import { SearchResults } from "./SearchResults";
import { useDocumentSearch } from "../state/useDocumentSearch";
import { indexOfUnitOffset } from "../reader/selection";
import { SourcePane } from "./SourcePane";
import { SplitPane } from "./SplitPane";
import { ThemeToggle } from "./ThemeToggle";
import { shortDocTitle } from "../reader/title";
import type { StepSize } from "../types/document";

const STEPS: StepSize[] = ["1", "2", "3", "4", "5", "paragraph"];

export function DocumentShell() {
  const state = useDocumentState();
  const [navigationTick, setNavigationTick] = useState(0);
  const [returnTick, setReturnTick] = useState(0);
  const { moveSelection, commitBookmark, ingestFile, ingestPath, pickAndIngest } = state;
  const search = useDocumentSearch(state.doc.chunks, state.command, state.doc.id);
  const selectSearchResult = (index: number) => {
    if (search.busy) return;
    const hit = search.hits[index];
    if (!hit) return;
    setNavigationTick((tick) => tick + 1);
    search.select(index);
    if (state.paneLayout === "table") state.setPaneLayout("source");
    const span = hit.spans[0];
    const unit = indexOfUnitOffset(state.units, span.chunkId, span.start);
    if (unit >= 0) state.focusUnit(unit);
  };
  const stepSearch = (direction: -1 | 1) => {
    if (!search.hits.length) return;
    const next = search.activeIndex < 0 ? (direction === 1 ? 0 : search.hits.length - 1)
      : (search.activeIndex + direction + search.hits.length) % search.hits.length;
    selectSearchResult(next);
  };
  // Interface language is independent of the per-document table-output language.
  const [uiLang, setUiLang] = useUiLang();
  // Built-in prompt templates follow the interface language.
  const reloadTemplates = state.reloadTemplates;
  useEffect(() => {
    void reloadTemplates();
  }, [uiLang, reloadTemplates]);
  const locale = uiLang;
  const tableLocale = state.doc.tableLocale;
  const chrome = CHROME[locale];
  const [stacked, setStacked] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1280,
  );
  const [dropActive, setDropActive] = useState(false);
  const [panel, setPanel] = useState<"appearance" | "subscriptions" | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const notes = useNotes(state.backend === "online");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const apply = () => setStacked(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (search.query && ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g" || event.key === "F3")) {
        event.preventDefault();
        stepSearch(event.shiftKey ? -1 : 1);
        return;
      }
      if (target?.closest(".search-panel, .search-navigation")) {
        if (event.key === "Escape") state.setCommand("");
        return;
      }
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (event.key === "Escape") {
        if (state.warnAll) {
          state.setWarnAll(false);
          return;
        }
        if (libraryOpen) {
          setLibraryOpen(false);
          return;
        }
        if (notesOpen) {
          setNotesOpen(false);
          return;
        }
        if (panel) {
          setPanel(null);
          return;
        }
        if (search.query) { state.setCommand(""); return; }
        state.clearHighlight();
        return;
      }
      if (libraryOpen || notesOpen || panel || state.warnAll) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('[role="separator"], [role="slider"], button')) return;
      // One-keystroke shortcut for the Tabulect action (selection/bookmarks → CLI table).
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        void state.runTableAi();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        state.toggleAutoPlay();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (state.autoPlaying && state.autoAxis !== "horizontal") state.setAutoAxis("horizontal");
        void state.fine.move(event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        if (state.autoPlaying && state.autoAxis !== "vertical") state.setAutoAxis("vertical");
        state.moveSelection(1, event.shiftKey);
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        if (state.autoPlaying && state.autoAxis !== "vertical") state.setAutoAxis("vertical");
        state.moveSelection(-1, event.shiftKey);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void commitBookmark();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveSelection, commitBookmark, panel, libraryOpen, notesOpen, state, search, stepSearch]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") setDropActive(true);
        else if (event.payload.type === "leave") setDropActive(false);
        else if (event.payload.type === "drop") {
          setDropActive(false);
          const path = event.payload.paths?.[0];
          if (path && ACCEPT_EXT.test(path)) void ingestPath(path);
        }
      });
      if (cancelled) unlisten();
      else stop = unlisten;
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ingestPath]);

  function takeDroppedFile(event: DragEvent) {
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !ACCEPT_EXT.test(file.name)) return;
    void ingestFile(file);
  }

  const onFlash = useCallback((_ok: boolean) => {
    /* command bar shows its own error */
  }, []);

  const typeTick = `${state.appearance.fontFamily}-${state.appearance.fontSize}-${state.appearance.lineHeight}-${state.appearance.paragraphGap}-${state.appearance.readingWidth}-${state.appearance.paragraphNumbers}`;

  return (
    <div
      className="shell is-content-first"
      data-theme={state.appearance.theme}
      data-font={state.appearance.fontFamily}
      style={state.readerStyle}
      onDragEnter={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) setDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropActive(false);
      }}
      onDrop={takeDroppedFile}
    >
      <header className="topbar">
        <div className="topbar-row">
          <div className="topbar-lead">
            <h1 className="doc-title" title={state.doc.title}>
              {shortDocTitle(state.doc.title)}
            </h1>
            {state.sourceKind === "fixture" ? <span className="badge badge-fixture">{chrome.fixtureBadge}</span> : null}
            {state.backend === "offline" ? <span className="badge badge-warn">{chrome.backendOffline}</span> : null}
          </div>
          <div className="topbar-chrome">
            <button
              type="button"
              className={libraryOpen ? "text-btn is-on" : "text-btn"}
              aria-expanded={libraryOpen}
              aria-label={chrome.libraryOpen}
              onClick={() => {
                setNotesOpen(false);
                setLibraryOpen((open) => !open);
              }}
            >
              {chrome.library}
              {state.library.length ? ` · ${state.library.length}` : ""}
            </button>
            <button
              type="button"
              className={notesOpen ? "text-btn is-on" : "text-btn"}
              aria-expanded={notesOpen}
              aria-label={chrome.notesOpen}
              onClick={() => {
                setLibraryOpen(false);
                setNotesOpen((open) => !open);
              }}
            >
              {chrome.notes}
              {notes.notes.length ? ` · ${notes.notes.length}` : ""}
            </button>
            <label className="step-field">
              <span>{chrome.stepLabel}</span>
              <select value={state.stepSize} onChange={(event) => state.setStepSize(event.target.value as StepSize)}>
                {STEPS.map((step) => (
                  <option key={step} value={step}>
                    {step === "paragraph" ? chrome.stepParagraph : step}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="topbar-actions">
          <OpenDropZone
            locale={locale}
            provider={state.provider}
            model={state.model}
            providers={state.providers}
            backendOnline={state.backend !== "offline"}
            ingest={state.ingest}
            sourceKind={state.sourceKind}
            onProvider={state.setProvider}
            onModel={state.setModel}
            onFile={(file) => void ingestFile(file)}
            onOpenNative={() => void pickAndIngest()}
            onReloadFixture={state.reloadFixture}
          />
          <AppearancePanel
            locale={locale}
            open={panel === "appearance"}
            appearance={state.appearance}
            exportDir={state.exportDir}
            onOpen={() => setPanel("appearance")}
            onClose={() => setPanel(null)}
            onAppearance={state.setAppearance}
            onExportDir={state.setExportDir}
          />
          <SubscriptionsPanel
            locale={locale}
            open={panel === "subscriptions"}
            onOpen={() => setPanel("subscriptions")}
            onClose={() => setPanel(null)}
          />
          <span className="ui-lang-label" title={chrome.uiLanguage}>{chrome.uiLanguage}</span>
          <LocaleSwitcher locale={uiLang} onChange={setUiLang} />
          <span className="ui-lang-label" title={chrome.tableLanguage}>{chrome.tableLanguage}</span>
          <LocaleSwitcher locale={tableLocale} onChange={state.setTableLocale} />
          <div className="pane-toggle" role="group" aria-label="panes">
            <button
              type="button"
              className={state.paneLayout === "source" ? "chip is-on" : "chip"}
              onClick={() => state.setPaneLayout("source")}
            >
              {chrome.paneSource}
            </button>
            <button
              type="button"
              className={state.paneLayout === "both" ? "chip is-on" : "chip"}
              onClick={() => state.setPaneLayout("both")}
            >
              {chrome.paneBoth}
            </button>
            <button
              type="button"
              className={state.paneLayout === "table" ? "chip is-on" : "chip"}
              onClick={() => state.setPaneLayout("table")}
            >
              {chrome.paneOutput}
            </button>
          </div>
          <ThemeToggle
            theme={state.appearance.theme === "sepia" || state.appearance.theme === "paper" ? "sepia" : state.appearance.theme === "white" ? "white" : "dark"}
            onCycle={state.cycleTheme}
            toggleLabel={chrome.themeToggle}
            whiteLabel={locale === "tr" ? "Beyaz" : "White"}
            sepiaLabel={locale === "tr" ? "Sepya" : "Sepia"}
            darkLabel={locale === "tr" ? "Koyu" : "Dark"}
          />
          </div>
        </div>
        <CommandBar
          locale={locale}
          value={state.command}
          pending={state.aiPending}
          error={state.aiError}
          templates={state.templates}
          templateId={state.templateId}
          searchHits={search.hits.length}
          activeSearchIndex={search.activeIndex}
          searchBusy={search.busy}
          onSearchStep={stepSearch}
          onValue={state.setCommand}
          onTemplate={state.setTemplateId}
          onSaveTemplate={(template) => void state.saveTemplate(template)}
          onDeleteTemplate={(id) => void state.removeTemplate(id)}
          onResetTemplate={(id) => void state.resetTemplate(id)}
          onInstruct={async (instruction) => {
            const ok = await state.applyInstruction(instruction);
            onFlash(ok);
            return ok;
          }}
          onTableAi={() => void state.runTableAi()}
          onNewChat={() => void state.resetChat()}
          chatExists={state.chatExists}
          outputMode={state.outputMode}
          onOutputMode={state.setOutputMode}
          library={state.library}
          currentId={state.sourceKind === "live" ? state.doc.id : null}
          extraSourceIds={state.extraSourceIds}
          onToggleSource={state.toggleExtraSource}
        />
        {state.ingest.status === "uploading" || state.ingest.status === "running" ? (
          <div className="ingest-meter topbar-meter" role="progressbar" aria-valuenow={state.ingest.pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${Math.max(2, state.ingest.pct)}%` }} />
          </div>
        ) : null}
        {dropActive ? (
          <div className="drop-overlay" aria-hidden="true">
            <p>{chrome.dropActive}</p>
            <p className="drop-sub">{chrome.openFormats}</p>
          </div>
        ) : null}
      </header>
      <div className="reader-workspace">
      {search.query ? <SearchResults locale={locale} hits={search.hits} activeIndex={search.activeIndex} busy={search.busy}
        options={search.options} onOptions={search.setOptions} onSelect={selectSearchResult} onClose={() => state.setCommand("")} /> : null}
      <SplitPane
        ratio={state.splitterRatio}
        stacked={stacked}
        ariaLabel={chrome.splitterAria}
        onRatio={state.persistSplitter}
        layout={state.paneLayout}
      >
        {[
          <SourcePane
            key="source"
            locale={locale}
            documentId={state.doc.id}
            appearance={state.appearance}
            navigationTick={navigationTick}
            searching={Boolean(search.query)}
            returnTick={returnTick}
            onReturnReading={() => {
              state.setCommand("");
              if (state.paneLayout === "table") state.setPaneLayout("source");
              setReturnTick((tick) => tick + 1);
            }}
            onResumePosition={state.resumeReading}
            fineMode={state.fine.mode}
            onFineMode={state.fine.setMode}
            wordStep={state.fine.wordStep}
            onWordStep={state.fine.setWordStep}
            autoPlaying={state.autoPlaying}
            autoWpm={state.autoWpm}
            autoAxis={state.autoAxis}
            onToggleAutoPlay={state.toggleAutoPlay}
            onAutoWpm={state.setAutoWpm}
            onAutoAxis={state.setAutoAxis}
            finePending={state.fine.pending}
            fineError={state.fine.error}
            onFineRetry={state.fine.retry}
            chunks={state.doc.chunks}
            units={state.readingUnits}
            highlight={state.readingHighlight}
            bookmarks={state.doc.bookmarks}
            searchHits={search.query && !search.busy ? search.hits : []}
            activeSearchHit={search.activeHit}
            searchJumpTick={search.jumpTick}
            paneLayout={state.paneLayout}
            typeTick={typeTick}
            onFocusPosition={state.resumeReading}
            onCharsPerLine={state.setCharsPerLine}
          />,
          <OutputPane
            key="output"
            locale={locale}
            output={state.output}
            draft={state.outputDraft}
            pending={state.aiPending}
            outputMode={state.outputMode}
            error={state.aiError}
            savedPath={state.savedPath}
            onDraft={state.setOutputDraft}
            onSave={() => void state.saveCurrentOutput()}
            onExport={(format) => void state.exportCurrent(format)}
            onNewChat={() => void state.resetChat()}
          />,
        ]}
      </SplitPane>
      </div>
      {state.warnAll ? (
        <div className="confirm-root">
          <button type="button" className="inspector-scrim" onClick={() => state.setWarnAll(false)} />
          <div className="confirm-card" role="alertdialog" aria-labelledby="warn-title">
            <h2 id="warn-title">{chrome.tableAiWarnTitle}</h2>
            <p>{chrome.tableAiWarnBody}</p>
            <div className="library-actions">
              <button type="button" className="text-btn is-ai" onClick={() => void state.runTableAi({ forceAll: true })}>
                {chrome.tableAiWarnYes}
              </button>
              <button type="button" className="text-btn" onClick={() => state.setWarnAll(false)}>
                {chrome.tableAiWarnNo}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <LibraryPanel
        locale={locale}
        open={libraryOpen}
        items={state.library}
        folders={state.folders}
        status={state.libraryStatus}
        error={state.libraryError}
        busyId={state.libraryBusyId}
        currentId={state.sourceKind === "live" ? state.doc.id : null}
        sourceKind={state.sourceKind}
        bookmarks={state.doc.bookmarks}
        onClose={() => setLibraryOpen(false)}
        onOpen={(id) => {
          void state.openLibraryDocument(id).then(() => setLibraryOpen(false));
        }}
        onDelete={(id) => state.deleteLibraryDocument(id)}
        onRename={(id, title) => state.renameLibraryDocument(id, title)}
        onShowFixture={state.reloadFixture}
        onDeleteBookmark={(id) => void state.removeBookmark(id)}
        onMoveBookmark={(id, direction) => void state.moveBookmark(id, direction)}
        onCreateFolder={(name) => state.createFolder(name)}
        onRenameFolder={(id, name) => state.renameFolder(id, name)}
        onDeleteFolder={(id) => state.deleteFolder(id)}
        onMoveDocumentFolder={(id, folderId) => state.moveDocumentFolder(id, folderId)}
        onJumpBookmark={(bookmark) => {
          setNavigationTick((tick) => tick + 1);
          state.jumpBookmark(bookmark);
          setLibraryOpen(false);
        }}
      />
      <NotesPanel
        locale={locale}
        open={notesOpen}
        notes={notes.notes}
        folders={notes.folders}
        activeId={notes.activeId}
        draftTitle={notes.draftTitle}
        draftBody={notes.draftBody}
        status={notes.status}
        error={notes.error}
        saveState={notes.saveState}
        busyId={notes.busyId}
        onClose={() => setNotesOpen(false)}
        onSelect={notes.selectNote}
        onTitle={notes.setDraftTitle}
        onBody={notes.setDraftBody}
        onCreate={() => {
          void notes.create({ title: chrome.notesUntitled });
        }}
        onRename={(id, title) => notes.rename(id, title)}
        onDelete={(id) => notes.remove(id)}
        onCreateFolder={(name) => notes.createFolder(name)}
        onRenameFolder={(id, name) => notes.renameFolder(id, name)}
        onDeleteFolder={(id) => notes.deleteFolder(id)}
        onMoveFolder={(id, folderId) => notes.moveToFolder(id, folderId)}
        onExport={(format) => void notes.exportActive(format)}
      />
    </div>
  );
}
