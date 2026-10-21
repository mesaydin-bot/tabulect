import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Note, NoteFolder } from "../api/client";
import { CHROME } from "../locale/ui";
import { MarkdownPreview } from "../reader/markdown";
import { jumpTextareaToOffset, parseNoteOutline } from "../reader/outline";
import type { NotesSaveState } from "../state/useNotes";
import type { TableLocale } from "../types/document";

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
  open: boolean;
  notes: Note[];
  folders: NoteFolder[];
  activeId: string | null;
  draftTitle: string;
  draftBody: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  saveState: NotesSaveState;
  busyId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveFolder: (noteId: string, folderId: string | null) => Promise<void>;
  onExport: (format: ExportFormat) => void;
};

function saveLabel(chrome: (typeof CHROME)["tr"], state: NotesSaveState) {
  if (state === "saving" || state === "dirty") return chrome.notesSaving;
  if (state === "saved") return chrome.notesSaved;
  if (state === "error") return chrome.notesSaveError;
  return chrome.notesAutosave;
}

export function NotesPanel({
  locale,
  open,
  notes,
  folders,
  activeId,
  draftTitle,
  draftBody,
  status,
  error,
  saveState,
  busyId,
  onClose,
  onSelect,
  onTitle,
  onBody,
  onCreate,
  onRename,
  onDelete,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onExport,
}: Props) {
  const chrome = CHROME[locale];
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [folderFilter, setFolderFilter] = useState<"all" | "unfiled" | string>("all");
  const [query, setQuery] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");

  const outline = useMemo(() => parseNoteOutline(draftBody), [draftBody]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return notes.filter((item) => {
      if (folderFilter === "unfiled" && item.folderId) return false;
      if (folderFilter !== "all" && folderFilter !== "unfiled" && item.folderId !== folderFilter) return false;
      if (!q) return true;
      return `${item.title} ${item.body}`.toLocaleLowerCase("tr").includes(q);
    });
  }, [folderFilter, notes, query]);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setExportOpen(false);
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

  if (!open) return null;

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renameId) return;
    const title = renameValue.trim();
    if (!title) return;
    await onRename(renameId, title);
    setRenameId(null);
  }

  return (
    <div className="inspector-root notes-root">
      <button type="button" className="inspector-scrim" aria-label={chrome.notesClose} onClick={onClose} />
      <aside className="notes" role="dialog" aria-label={chrome.notes}>
        <header className="inspector-head notes-head">
          <h2>
            {chrome.notes}
            {notes.length ? <span className="library-count"> {notes.length}</span> : null}
          </h2>
          <div className="notes-head-actions">
            <span className={saveState === "error" ? "notes-save is-err" : "notes-save"} aria-live="polite">
              {saveLabel(chrome, saveState)}
            </span>
            <button type="button" className="text-btn" onClick={onCreate}>
              {chrome.notesNew}
            </button>
            <div className="export-menu" ref={exportRef}>
              <button
                type="button"
                className={exportOpen ? "text-btn is-on" : "text-btn"}
                disabled={!draftTitle.trim() && !draftBody.trim()}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((openMenu) => !openMenu)}
              >
                {chrome.notesExport}
              </button>
              {exportOpen ? (
                <div className="export-pop" role="menu" aria-label={chrome.notesExport}>
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
            <button type="button" className="icon-btn" onClick={onClose}>
              {chrome.notesClose}
            </button>
          </div>
        </header>
        {error ? <p className="library-error">{error}</p> : null}
        <div className="notes-body">
          <section className="notes-sidebar" aria-label={chrome.notesFolders}>
            <input
              className="bookmark-search notes-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={chrome.notesSearch}
              aria-label={chrome.notesSearch}
            />
            <div className="folder-bar">
              <button
                type="button"
                className={folderFilter === "all" ? "chip is-on" : "chip"}
                onClick={() => setFolderFilter("all")}
              >
                {chrome.folderAll}
              </button>
              <button
                type="button"
                className={folderFilter === "unfiled" ? "chip is-on" : "chip"}
                onClick={() => setFolderFilter("unfiled")}
              >
                {chrome.folderUnfiled}
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={folderFilter === folder.id ? "chip is-on" : "chip"}
                  onClick={() => setFolderFilter(folder.id)}
                >
                  {folder.name}
                </button>
              ))}
            </div>
            <form
              className="folder-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newFolder.trim();
                if (!name) return;
                void onCreateFolder(name).then(() => setNewFolder(""));
              }}
            >
              <input
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder={chrome.folderName}
                aria-label={chrome.folderName}
              />
              <button type="submit" className="text-btn" disabled={!newFolder.trim()}>
                {chrome.folderCreate}
              </button>
            </form>
            {folderFilter !== "all" && folderFilter !== "unfiled" ? (
              <div className="library-actions notes-folder-actions">
                {folderRenameId === folderFilter ? (
                  <form
                    className="library-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!folderRenameValue.trim()) return;
                      void onRenameFolder(folderFilter, folderRenameValue.trim()).then(() => setFolderRenameId(null));
                    }}
                  >
                    <input
                      value={folderRenameValue}
                      onChange={(event) => setFolderRenameValue(event.target.value)}
                      aria-label={chrome.folderRename}
                    />
                    <button type="submit" className="text-btn">
                      {chrome.libraryRenameSave}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const folder = folders.find((item) => item.id === folderFilter);
                        setFolderRenameId(folderFilter);
                        setFolderRenameValue(folder?.name || "");
                      }}
                    >
                      {chrome.folderRename}
                    </button>
                    <button
                      type="button"
                      className="text-btn is-danger"
                      onClick={() => {
                        void onDeleteFolder(folderFilter).then(() => setFolderFilter("all"));
                      }}
                    >
                      {chrome.folderDelete}
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {status === "loading" && notes.length === 0 ? (
              <p className="inspector-empty">{chrome.notesLoading}</p>
            ) : visible.length === 0 ? (
              <p className="inspector-empty">{chrome.notesEmpty}</p>
            ) : (
              <ul className="library-list notes-list">
                {visible.map((item) => {
                  const current = item.id === activeId;
                  const busy = busyId === item.id;
                  return (
                    <li key={item.id} className={current ? "library-item is-current" : "library-item"}>
                      <button type="button" className="library-open" disabled={busy} onClick={() => onSelect(item.id)}>
                        <strong className="library-title">{item.title || chrome.notesUntitled}</strong>
                      </button>
                      {renameId === item.id ? (
                        <form className="library-rename" onSubmit={(event) => void submitRename(event)}>
                          <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            aria-label={chrome.libraryRename}
                            autoFocus
                          />
                          <button type="submit" className="text-btn" disabled={busy || !renameValue.trim()}>
                            {chrome.libraryRenameSave}
                          </button>
                          <button type="button" className="text-btn" onClick={() => setRenameId(null)}>
                            {chrome.libraryRenameCancel}
                          </button>
                        </form>
                      ) : confirmId === item.id ? (
                        <div className="library-confirm">
                          <p>{chrome.notesDeleteConfirm}</p>
                          <button
                            type="button"
                            className="text-btn is-danger"
                            disabled={busy}
                            onClick={() => void onDelete(item.id).then(() => setConfirmId(null))}
                          >
                            {chrome.libraryDeleteYes}
                          </button>
                          <button type="button" className="text-btn" onClick={() => setConfirmId(null)}>
                            {chrome.libraryDeleteNo}
                          </button>
                        </div>
                      ) : (
                        <div className="library-actions">
                          <button
                            type="button"
                            className="text-btn"
                            disabled={busy}
                            onClick={() => {
                              setConfirmId(null);
                              setRenameId(item.id);
                              setRenameValue(item.title);
                            }}
                          >
                            {chrome.libraryRename}
                          </button>
                          <label className="folder-move">
                            <span className="visually-hidden">{chrome.folderMove}</span>
                            <select
                              aria-label={chrome.folderMove}
                              value={item.folderId || ""}
                              disabled={busy}
                              onChange={(event) => {
                                const value = event.target.value;
                                void onMoveFolder(item.id, value || null);
                              }}
                            >
                              <option value="">{chrome.folderUnfiled}</option>
                              {folders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button type="button" className="text-btn is-danger" disabled={busy} onClick={() => setConfirmId(item.id)}>
                            {chrome.libraryDelete}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="notes-outline" aria-label={chrome.notesOutline}>
            <h3>{chrome.notesOutline}</h3>
            {outline.length === 0 ? (
              <p className="inspector-empty">{chrome.notesNoOutline}</p>
            ) : (
              <ol>
                {outline.map((item) => (
                  <li key={item.id} className={`notes-outline-item is-h${item.level}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (editorRef.current) jumpTextareaToOffset(editorRef.current, item.offset);
                        setView("edit");
                      }}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="notes-editor-pane" aria-label={chrome.notesEditor}>
            {activeId ? (
              <>
                <div className="notes-editor-bar">
                  <input
                    className="notes-title"
                    value={draftTitle}
                    onChange={(event) => onTitle(event.target.value)}
                    aria-label={chrome.libraryRename}
                    placeholder={chrome.notesUntitled}
                  />
                  <div className="output-tabs">
                    <button
                      type="button"
                      className={view === "edit" ? "chip is-on" : "chip"}
                      onClick={() => setView("edit")}
                    >
                      {chrome.notesEditor}
                    </button>
                    <button
                      type="button"
                      className={view === "preview" ? "chip is-on" : "chip"}
                      onClick={() => setView("preview")}
                    >
                      {chrome.outputPreview}
                    </button>
                  </div>
                </div>
                {view === "preview" ? (
                  draftBody.trim() ? (
                    <div className="notes-preview">
                      <MarkdownPreview content={draftBody} />
                    </div>
                  ) : (
                    <p className="output-empty">{chrome.notesEditorHint}</p>
                  )
                ) : (
                  <textarea
                    ref={editorRef}
                    className="notes-editor"
                    value={draftBody}
                    onChange={(event) => onBody(event.target.value)}
                    spellCheck={false}
                    placeholder={chrome.notesEditorHint}
                    aria-label={chrome.notesEditor}
                  />
                )}
              </>
            ) : (
              <p className="output-empty">{chrome.notesEmpty}</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
