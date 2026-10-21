import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { indexDocument, searchCorpus } from "../lib/corpus.mjs";

test("corpus indexes chunks and retrieves only requested docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-cor-"));
  await indexDocument(
    {
      id: "doc-a",
      title: "Yavaş okuma",
      chunks: [{ id: "c-1", text: "Yavaş okumak bir yapı işidir.", page: 2 }],
      bookmarks: [{ id: "b-1", text: "Derinlik hızdan önemlidir.", page: 3 }],
    },
    root,
  );
  await indexDocument(
    {
      id: "doc-b",
      title: "Başka kitap",
      chunks: [{ id: "c-2", text: "Bu cümle yalnızca ikinci kitapta geçer.", page: 1 }],
      bookmarks: [],
    },
    root,
  );
  const openOnly = searchCorpus("yavaş okumak", { excludeIds: ["doc-b"], limit: 4, root });
  assert.ok(openOnly.every((hit) => hit.documentId === "doc-a"));
  const other = searchCorpus("ikinci kitapta", { includeIds: ["doc-b"], excludeIds: ["doc-a"], limit: 4, root });
  assert.equal(other[0]?.documentId, "doc-b");
  assert.match(other[0].text, /ikinci kitapta/);
});

test("corpus prefers one hit when a bookmark span is already in a passage", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-cor-dedupe-"));
  await indexDocument(
    {
      id: "doc-dup",
      title: "Tek kitap",
      chunks: [{ id: "c-1", text: "Yavaş okumak bir yapı işidir. Derinlik hızdan önemlidir.", page: 2 }],
      bookmarks: [{ id: "b-1", text: "Derinlik hızdan önemlidir.", page: 3 }],
    },
    root,
  );
  const hits = searchCorpus("derinlik hızdan", { includeIds: ["doc-dup"], limit: 8, root });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "chunk");
});
