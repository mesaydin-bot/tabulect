import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  createNoteFolder,
  deleteNote,
  deleteNoteFolder,
  exportNoteFile,
  listNotes,
  moveNoteFolder,
  patchNote,
  renameNoteFolder,
  type Note,
  type NoteFolder,
} from "../api/client";

const LAST_NOTE = "tabulect:lastNoteId";
const AUTOSAVE_MS = 600;

function readLastNoteId() {
  try {
    return localStorage.getItem(LAST_NOTE);
  } catch {
    return null;
  }
}

function writeLastNoteId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_NOTE, id);
    else localStorage.removeItem(LAST_NOTE);
  } catch {
    /* ignore */
  }
}

export type NotesSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function useNotes(online: boolean) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<NotesSaveState>("idle");
  const [busyId, setBusyId] = useState<string | null>(null);
  const skipAutosave = useRef(false);
  const saveGen = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const applySnap = useCallback((snap: { notes: Note[]; folders: NoteFolder[] }, preferredId?: string | null) => {
    setNotes(snap.notes);
    setFolders(snap.folders);
    const want = preferredId || activeIdRef.current || readLastNoteId();
    const next = (want && snap.notes.find((item) => item.id === want)) || snap.notes[0] || null;
    skipAutosave.current = true;
    setActiveId(next?.id || null);
    setDraftTitle(next?.title || "");
    setDraftBody(next?.body || "");
    writeLastNoteId(next?.id || null);
    setSaveState("idle");
  }, []);

  const refresh = useCallback(async () => {
    if (!online) return;
    setStatus((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const snap = await listNotes();
      applySnap(snap);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [applySnap, online]);

  useEffect(() => {
    if (!online) return;
    void refresh();
  }, [online, refresh]);

  const selectNote = useCallback((id: string) => {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    skipAutosave.current = true;
    setActiveId(note.id);
    setDraftTitle(note.title);
    setDraftBody(note.body);
    writeLastNoteId(note.id);
    setSaveState("idle");
    setError(null);
  }, [notes]);

  const flushSave = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return null;
    const current = notes.find((item) => item.id === id);
    if (!current) return null;
    if (current.title === draftTitle && current.body === draftBody) {
      setSaveState("saved");
      return current;
    }
    const gen = ++saveGen.current;
    setSaveState("saving");
    try {
      const result = await patchNote(id, { title: draftTitle, body: draftBody });
      if (gen !== saveGen.current) return result.note;
      setNotes(result.notes);
      setFolders(result.folders);
      setSaveState("saved");
      setError(null);
      return result.note;
    } catch (err) {
      if (gen !== saveGen.current) return null;
      setSaveState("error");
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [draftBody, draftTitle, notes]);

  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    if (!activeId) return;
    setSaveState("dirty");
    const timer = window.setTimeout(() => {
      void flushSaveRef.current();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [activeId, draftBody, draftTitle]);

  return {
    notes,
    folders,
    activeId,
    active: notes.find((item) => item.id === activeId) || null,
    draftTitle,
    draftBody,
    status,
    error,
    saveState,
    busyId,
    setDraftTitle,
    setDraftBody,
    selectNote,
    refresh,
    flushSave,
    create: async (partial?: { title?: string; body?: string; folderId?: string | null }) => {
      const result = await createNote({
        title: partial?.title,
        body: partial?.body ?? "",
        folderId: partial?.folderId,
      });
      applySnap(result, result.note.id);
      setStatus("ready");
      return result.note;
    },
    rename: async (id: string, title: string) => {
      setBusyId(id);
      try {
        const result = await patchNote(id, { title });
        setNotes(result.notes);
        setFolders(result.folders);
        if (id === activeIdRef.current) {
          skipAutosave.current = true;
          setDraftTitle(result.note.title);
        }
      } finally {
        setBusyId(null);
      }
    },
    remove: async (id: string) => {
      setBusyId(id);
      try {
        const snap = await deleteNote(id);
        const nextId = id === activeIdRef.current ? snap.notes[0]?.id || null : activeIdRef.current;
        applySnap(snap, nextId);
      } finally {
        setBusyId(null);
      }
    },
    createFolder: async (name: string) => {
      const snap = await createNoteFolder(name);
      setNotes(snap.notes);
      setFolders(snap.folders);
    },
    renameFolder: async (id: string, name: string) => {
      const snap = await renameNoteFolder(id, name);
      setNotes(snap.notes);
      setFolders(snap.folders);
    },
    deleteFolder: async (id: string) => {
      const snap = await deleteNoteFolder(id);
      setNotes(snap.notes);
      setFolders(snap.folders);
    },
    moveToFolder: async (noteId: string, folderId: string | null) => {
      const snap = await moveNoteFolder(noteId, folderId);
      setNotes(snap.notes);
      setFolders(snap.folders);
    },
    exportActive: async (format: "md" | "html" | "pdf" | "docx" | "xlsx") => {
      const saved = await flushSave();
      const title = saved?.title || draftTitle || "not";
      const content = saved?.body ?? draftBody;
      await exportNoteFile({ format, title, content, filename: `${title}.${format === "xlsx" ? "xlsx" : format}` });
    },
  };
}
