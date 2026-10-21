import assert from "node:assert/strict";
import test from "node:test";
import { resolveCorpusScope } from "../lib/scope.mjs";

const documents = [
  { id: "doc-open", title: "Açık kitap", folderId: null },
  { id: "doc-other", title: "How to Read a Book", folderId: "fld-1" },
  { id: "doc-third", title: "Deneme", folderId: "fld-1" },
];
const folders = [{ id: "fld-1", name: "Klasikler" }];

test("default scope is the open document only", () => {
  const scope = resolveCorpusScope({
    instruction: "",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "open");
  assert.equal(scope.searchCorpus, false);
  assert.deepEqual(scope.extraIds, []);
});

test("Tabulect without a corpus ask stays open-only", () => {
  const scope = resolveCorpusScope({
    instruction: "tablo yap",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "open");
  assert.equal(scope.searchCorpus, false);
});

test("@mention and picker ids add named sources", () => {
  const mentioned = resolveCorpusScope({
    instruction: 'şu kitaba da bak @\"How to Read a Book\"',
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(mentioned.mode, "explicit");
  assert.equal(mentioned.searchCorpus, true);
  assert.ok(mentioned.extraIds.includes("doc-other"));
  assert.equal(mentioned.extraIds.includes("doc-open"), false);

  const picked = resolveCorpusScope({
    mentionIds: ["doc-third"],
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.deepEqual(picked.extraIds, ["doc-third"]);
});

test("kitapları listele stays open-document unless corpus is asked", () => {
  const scope = resolveCorpusScope({
    instruction: "kitapları listele",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "open");
  assert.equal(scope.searchCorpus, false);
});

test("explicit corpus phrase searches the library", () => {
  const scope = resolveCorpusScope({
    instruction: "kitaplıktan da bak",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "corpus");
  assert.equal(scope.searchCorpus, true);
  assert.ok(scope.extraIds.includes("doc-other"));
});

test("@library searches the local corpus without treating the token as a book title", () => {
  const scope = resolveCorpusScope({
    instruction: "Adler özeti @library",
    documents: [...documents, { id: "doc-tablo", title: "Tablo tarifleri", folderId: null }],
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "corpus");
  assert.equal(scope.searchCorpus, true);
  assert.equal(scope.extraIds.includes("doc-tablo"), true);
});

test("an unknown @mention does not expand local corpus by itself", () => {
  const scope = resolveCorpusScope({
    instruction: "notlara bak @otherapp",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "open");
  assert.equal(scope.searchCorpus, false);
});

test("@all is an explicit local corpus ask", () => {
  const scope = resolveCorpusScope({
    instruction: "karşılaştır @all",
    documents,
    folders,
    openDocumentId: "doc-open",
  });
  assert.equal(scope.mode, "corpus");
  assert.equal(scope.searchCorpus, true);
});

test("notes stay out of default Tabulect scope and enter with @library", () => {
  const notes = [{ id: "nte-1", title: "Adler defteri", folderId: null }];
  const open = resolveCorpusScope({
    instruction: "tablo yap",
    documents,
    folders,
    notes,
    openDocumentId: "doc-open",
  });
  assert.equal(open.mode, "open");
  assert.equal(open.searchCorpus, false);
  const tablo = resolveCorpusScope({
    instruction: "özetle @library",
    documents,
    folders,
    notes,
    openDocumentId: "doc-open",
  });
  assert.equal(tablo.mode, "corpus");
  assert.ok(tablo.extraIds.includes("nte-1"));
});

test("only @library opens the library; old aliases are ordinary text", async () => {
  const { parseAppMentions, isAppMentionToken } = await import("../lib/mentions.mjs");
  assert.equal(isAppMentionToken("library"), true);
  assert.equal(isAppMentionToken("all"), true);
  for (const alias of ["tablo", "tabulect", "kitaplik", "tumu", "tümü"]) assert.equal(isAppMentionToken(alias), false, alias);
  assert.equal(parseAppMentions("özet @tablo").localLibrary, false);
});

test("sidecar messages follow the request language, English by default", async () => {
  const { t, withLang } = await import("../lib/i18n.mjs");
  assert.equal(t("untitledNote"), "Untitled note");
  assert.equal(withLang("tr", () => t("untitledNote")), "Adsız not");
  assert.equal(withLang("tr-TR", () => t("theAiReplyTimedOut0", "x")), "AI yanıtı zaman aşımına uğradı (x).");
});
