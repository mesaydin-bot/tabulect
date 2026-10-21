import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shortDocTitle } from "../../src/reader/title.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("top bar title keeps at most five words then ...", () => {
  assert.equal(shortDocTitle("Yavaş okumanın savunusu"), "Yavaş okumanın savunusu");
  assert.equal(
    shortDocTitle("How to Read a Book and Why It Matters Today"),
    "How to Read a Book...",
  );
  assert.equal(shortDocTitle("  one   two  three  four  five  six "), "one two three four five...");
  assert.equal(shortDocTitle(""), "");
});

test("DocumentShell uses the short title and full title tooltip", async () => {
  const src = await readFile(join(root, "src/components/DocumentShell.tsx"), "utf8");
  assert.match(src, /shortDocTitle\(state\.doc\.title\)/);
  assert.match(src, /title=\{state\.doc\.title\}/);
  assert.doesNotMatch(src, /<h1 className="doc-title">\{state\.doc\.title\}<\/h1>/);
});
