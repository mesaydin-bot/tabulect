import { useMemo, useState, type FormEvent } from "react";
import type { LibraryDocument, LibraryFolder } from "../api/client";
import { CHROME } from "../locale/ui";
import type { Bookmark, TableLocale } from "../types/document";

type Tab = "docs" | "bookmarks";

type Props = {
  locale: TableLocale;
  open: boolean;
  items: LibraryDocument[];
  folders?: LibraryFolder[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  busyId: string | null;
  currentId: string | null;
  sourceKind: "fixture" | "live";
  bookmarks: Bookmark[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onShowFixture: () => void;
  onDeleteBookmark: (id: string) => void;
  onJumpBookmark: (bookmark: Bookmark) => void;
  onMoveBookmark: (id: string, direction: -1 | 1) => void;
  onCreateFolder?: (name: string) => Promise<void>;
  onRenameFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;
  onMoveDocumentFolder?: (documentId: string, folderId: string | null) => Promise<void>;
};

function formatUpdated(iso: string | null, locale: TableLocale) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LibraryPanel({
  locale,
  open,
  items,
  folders = [],
  status,
  error,
  busyId,
  currentId,
  sourceKind,
  bookmarks,
  onClose,
  onOpen,
  onDelete,
  onRename,
  onShowFixture,
  onDeleteBookmark,
  onJumpBookmark,
  onMoveBookmark,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDocumentFolder,
}: Props) {
  const chrome = CHROME[locale];
  const [tab, setTab] = useState<Tab>("docs");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<"all" | "unfiled" | string>("all");
  const [newFolder, setNewFolder] = useState("");
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState("");

  const filteredBookmarks = useMemo(() => {
    const q = bookmarkQuery.trim().toLocaleLowerCase("tr");
    if (!q) return bookmarks;
    return bookmarks.filter((item) => `${item.text} ${item.note}`.toLocaleLowerCase("tr").includes(q));
  }, [bookmarkQuery, bookmarks]);

  const visibleDocs = useMemo(() => {
    if (folderFilter === "all") return items;
    if (folderFilter === "unfiled") return items.filter((item) => !item.folderId);
    return items.filter((item) => item.folderId === folderFilter);
  }, [folderFilter, items]);

  if (!open) return null;

  function startRename(item: LibraryDocument) {
    setConfirmId(null);
    setRenameId(item.id);
    setRenameValue(item.title);
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renameId) return;
    const title = renameValue.trim();
    if (!title) return;
    await onRename(renameId, title);
    setRenameId(null);
  }

  return (
    <div className="inspector-root library-root">
      <button type="button" className="inspector-scrim" aria-label={chrome.libraryClose} onClick={onClose} />
      <aside className="library" role="dialog" aria-label={chrome.library}>
        <header className="inspector-head">
          <h2>
            {chrome.library}
            {items.length ? <span className="library-count"> {items.length}</span> : null}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            {chrome.libraryClose}
          </button>
        </header>
        <div className="library-tabs">
          <button type="button" className={tab === "docs" ? "chip is-on" : "chip"} onClick={() => setTab("docs")}>
            {chrome.libraryTabDocs}
          </button>
          <button
            type="button"
            className={tab === "bookmarks" ? "chip is-on" : "chip"}
            onClick={() => setTab("bookmarks")}
          >
            {chrome.libraryTabBookmarks}
            {bookmarks.length ? ` · ${bookmarks.length}` : ""}
          </button>
        </div>
        {error ? <p className="library-error">{error}</p> : null}

        {tab === "bookmarks" ? (
          <div className="bookmark-pane">
            <input
              className="bookmark-search"
              value={bookmarkQuery}
              onChange={(event) => setBookmarkQuery(event.target.value)}
              placeholder={chrome.bookmarkSearch}
              aria-label={chrome.bookmarkSearch}
            />
            {filteredBookmarks.length === 0 ? (
              <p className="inspector-empty">{chrome.bookmarkEmpty}</p>
            ) : (
              <ul className="library-list">
                {filteredBookmarks.map((item) => (
                  <li key={item.id} className="library-item">
                    <button type="button" className="library-open" onClick={() => onJumpBookmark(item)}>
                      <strong className="library-title">{item.text.slice(0, 140) || item.id}</strong>
                      <span className="library-meta">
                        {item.page != null ? `${chrome.page} ${item.page} · ` : ""}
                        {item.createdAt ? formatUpdated(item.createdAt, locale) : ""}
                      </span>
                    </button>
                    <div className="library-actions">
                      <button type="button" className="text-btn" onClick={() => onJumpBookmark(item)}>
                        {chrome.bookmarkJump}
                      </button>
                      <button type="button" className="text-btn" onClick={() => onMoveBookmark(item.id, -1)}>
                        {chrome.bookmarkUp}
                      </button>
                      <button type="button" className="text-btn" onClick={() => onMoveBookmark(item.id, 1)}>
                        {chrome.bookmarkDown}
                      </button>
                      <button type="button" className="text-btn is-danger" onClick={() => onDeleteBookmark(item.id)}>
                        {chrome.bookmarkDelete}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : status === "loading" && items.length === 0 ? (
          <p className="inspector-empty">{chrome.libraryLoading}</p>
        ) : items.length === 0 ? (
          <div className="library-empty">
            <p>{status === "error" ? chrome.libraryError : chrome.libraryEmpty}</p>
            <button type="button" className="text-btn" onClick={onShowFixture}>
              {chrome.libraryDemo}
            </button>
          </div>
        ) : (
          <div className="folder-pane">
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
            {onCreateFolder ? (
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
            ) : null}
            {folderFilter !== "all" && folderFilter !== "unfiled" ? (
              <div className="library-actions">
                {folderRenameId === folderFilter ? (
                  <form
                    className="library-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!folderRenameValue.trim() || !onRenameFolder) return;
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
                        if (!onDeleteFolder) return;
                        void onDeleteFolder(folderFilter).then(() => setFolderFilter("all"));
                      }}
                    >
                      {chrome.folderDelete}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          <ul className="library-list">
            {visibleDocs.map((item) => {
              const current = sourceKind === "live" && item.id === currentId;
              const busy = busyId === item.id;
              const updated = formatUpdated(item.updatedAt, locale);
              return (
                <li key={item.id} className={current ? "library-item is-current" : "library-item"}>
                  <button type="button" className="library-open" disabled={busy} onClick={() => onOpen(item.id)}>
                    <strong className="library-title">
                      <span>{item.title || item.id}</span>
                      {current ? <span className="badge">{chrome.libraryCurrent}</span> : null}
                    </strong>
                    <span className="library-meta">
                      {item.sourceType.toUpperCase()} · {item.bookmarkCount ?? 0} {chrome.libraryBookmarks} ·{" "}
                      {item.chunkCount} {chrome.libraryChunks}
                    </span>
                    {updated ? (
                      <span className="library-updated">
                        {chrome.libraryUpdated} {updated}
                      </span>
                    ) : null}
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
                      <p>{chrome.libraryDeleteConfirm}</p>
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
                      <button type="button" className="text-btn" disabled={busy} onClick={() => startRename(item)}>
                        {chrome.libraryRename}
                      </button>
                      {onMoveDocumentFolder ? (
                        <label className="folder-move">
                          <span className="visually-hidden">{chrome.folderMove}</span>
                          <select
                            aria-label={chrome.folderMove}
                            value={item.folderId || ""}
                            disabled={busy}
                            onChange={(event) => {
                              const value = event.target.value;
                              void onMoveDocumentFolder(item.id, value || null);
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
                      ) : null}
                      <button type="button" className="text-btn" disabled={busy} onClick={() => setConfirmId(item.id)}>
                        {chrome.libraryDelete}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
