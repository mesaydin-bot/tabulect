import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createNote,
  createNoteFolder,
  deleteNote,
  deleteNoteFolder,
  listNotes,
  loadNote,
  moveNoteToFolder,
  parseNoteOutline,
  patchNote,
  renameNoteFolder,
} from "../lib/notes.mjs";
import { searchCorpus, searchLibraryCorpus, librarySnapshot } from "../lib/corpus.mjs";
import { buildExport } from "../lib/rich-export.mjs";
import { saveDocument } from "../lib/store.mjs";
import { resolveCorpusScope } from "../lib/scope.mjs";

test("note outline comes from markdown headings", () => {
  const items = parseNoteOutline("# Adler\n\nGiriş.\n\n## Tempo\n\nYavaş oku.\n### Derinlik\n");
  assert.equal(items.length, 3);
  assert.equal(items[0].level, 1);
  assert.equal(items[0].text, "Adler");
  assert.equal(items[1].level, 2);
  assert.equal(items[1].text, "Tempo");
  assert.equal(items[2].level, 3);
  assert.ok(items[1].offset > items[0].offset);
});

test("note CRUD, folders, move, and delete persist", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-notes-"));
  const folder = await createNoteFolder("Okuma", root);
  const note = await createNote(
    { title: "Adler", body: "# Adler\n\nYavaş okumak bir yapı işidir.", folderId: folder.id },
    root,
  );
  assert.equal(note.title, "Adler");
  assert.equal(note.folderId, folder.id);
  const listed = await listNotes(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].folderId, folder.id);

  const renamed = await patchNote(note.id, { title: "Adler notu" }, root);
  assert.equal(renamed.title, "Adler notu");
  const bodyPatched = await patchNote(note.id, { body: "# Adler\n\nDerinlik hızdan önemlidir." }, root);
  assert.match(bodyPatched.body, /Derinlik hızdan/);

  await renameNoteFolder(folder.id, "Arşiv", root);
  const moved = await moveNoteToFolder(note.id, null, root);
  assert.equal(moved.folderId, null);

  await deleteNoteFolder(folder.id, root);
  const afterFolder = await loadNote(note.id, root);
  assert.equal(afterFolder.folderId, null);

  const removed = await deleteNote(note.id, root);
  assert.equal(removed, true);
  assert.equal((await listNotes(root)).length, 0);
  assert.equal(await loadNote(note.id, root), null);
});

test("notes are indexed for @library / corpus search with bookmarks", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-notes-cor-"));
  await saveDocument(
    {
      id: "doc-open",
      title: "Açık kitap",
      sourceType: "md",
      tableLocale: "tr",
      chunks: [{ id: "c-1", text: "Okumak bir hız yarışı değildir.", page: 1, start: 0, end: 31 }],
      bookmarks: [
        {
          id: "b-1",
          text: "Yer imi: tempo düşünceye bağlanır.",
          chunkId: "c-1",
          start: 0,
          end: 12,
          page: 2,
          note: "",
        },
      ],
      rows: [],
      outputs: [],
    },
    root,
  );
  const note = await createNote(
    {
      title: "Adler defteri",
      body: "# Adler\n\nYavaş okumak bir yapı işidir. Bu cümle yalnızca notta geçer.",
    },
    root,
  );

  const noteHits = searchCorpus("yalnızca notta", { limit: 8, root });
  assert.ok(noteHits.some((hit) => hit.documentId === note.id && hit.kind === "note"));
  assert.match(noteHits.find((hit) => hit.kind === "note").text, /yalnızca notta/);

  const bookmarkHits = searchCorpus("tempo düşünceye", { limit: 8, root });
  assert.ok(bookmarkHits.some((hit) => hit.kind === "bookmark"));

  const libraryHits = searchLibraryCorpus("yavaş okumak", { limit: 8, root });
  assert.ok(libraryHits.some((hit) => hit.meta.kind === "note"));
  assert.ok(libraryHits.some((hit) => hit.source === "library"));

  const snap = await librarySnapshot({ query: "yavaş okumak", root });
  assert.equal(snap.source, "library");
  assert.ok(snap.notes.some((item) => item.id === note.id && /yalnızca notta/.test(item.body)));
  assert.ok(snap.bookmarks.some((item) => item.id === "b-1"));
  assert.ok(snap.hits.some((hit) => hit.meta.kind === "note"));

  const scope = resolveCorpusScope({
    instruction: "Adler defteri @library",
    documents: [{ id: "doc-open", title: "Açık kitap", folderId: null }],
    notes: [{ id: note.id, title: "Adler defteri", folderId: null }],
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "corpus");
  assert.equal(scope.searchCorpus, true);
  assert.ok(scope.extraIds.includes(note.id));

  const openOnly = resolveCorpusScope({
    instruction: "özetle",
    documents: [{ id: "doc-open", title: "Açık kitap", folderId: null }],
    notes: [{ id: note.id, title: "Adler defteri", folderId: null }],
    openDocumentId: "doc-open",
  });
  assert.equal(openOnly.mode, "open");
  assert.equal(openOnly.searchCorpus, false);
});

test("note export uses the same rich-export formats", async () => {
  const body = `# Adler

| Ana fikir | Gerekçe |
| --- | --- |
| Yavaş oku | Derinlik |
`;
  const md = await buildExport({ format: "md", title: "Adler", content: body });
  assert.match(md.filename, /Adler\.md/);
  assert.match(md.buffer.toString("utf8"), /Yavaş oku/);

  const html = await buildExport({ format: "html", title: "Adler", content: body });
  assert.match(html.buffer.toString("utf8"), /<h1>Adler<\/h1>/);
  assert.match(html.buffer.toString("utf8"), /<table>/);

  const docx = await buildExport({ format: "docx", title: "Adler", content: body });
  assert.ok(docx.buffer.slice(0, 2).equals(Buffer.from("PK")));

  const xlsx = await buildExport({ format: "xlsx", title: "Adler", content: body });
  assert.ok(xlsx.buffer.slice(0, 2).equals(Buffer.from("PK")));

  const pdf = await buildExport({ format: "pdf", title: "Adler", content: body });
  assert.match(pdf.mime, /pdf/);
  assert.ok(pdf.buffer.length > 40);
});
