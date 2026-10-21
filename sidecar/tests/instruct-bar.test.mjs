import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("slash instruct is split from the Tabulect bookmark warning", async () => {
  const src = await readFile(join(root, "src/state/useDocument.ts"), "utf8");
  const apply = src.slice(src.indexOf("const applyInstruction"), src.indexOf("const saveCurrentOutput"));
  const tablo = src.slice(src.indexOf("const runTableAi"), src.indexOf("const applyInstruction"));
  assert.match(apply, /source:\s*"instruction"/);
  assert.match(apply, /allBookmarks:\s*false/);
  assert.match(apply, /setWarnAll\(false\)/);
  assert.match(apply, /templateId/);
  assert.doesNotMatch(apply, /setWarnAll\(true\)/);
  assert.doesNotMatch(apply, /runTableAi\(\s*\{\s*instruction/);
  assert.match(src, /const \[templateId, setTemplateId\] = useState\(""\)/);
  assert.match(tablo, /setWarnAll\(true\)/);
  assert.match(tablo, /forceAll/);
  assert.match(tablo, /tpl-selection-table/);
  assert.doesNotMatch(tablo, /instruction:/);
});

test("command bar strips the slash and calls onInstruct, not Tabulect", async () => {
  const src = await readFile(join(root, "src/components/CommandBar.tsx"), "utf8");
  assert.match(src, /replace\(\/\^\\\//);
  assert.match(src, /await onInstruct\(text\)/);
  assert.doesNotMatch(src, /onTableAi\(\)/);
  assert.match(src, /chrome\.templateNone/);
  assert.match(src, /<option value="">\{chrome\.templateNone\}<\/option>/);
});

test("locale labels Özgür / Free as the empty template", async () => {
  const src = await readFile(join(root, "src/locale/ui.ts"), "utf8");
  assert.match(src, /templateNone: "Özgür"/);
  assert.match(src, /templateNone: "Free"/);
});

test("slash instruct and Tabulect share finishTableJob so Ekle/Yeni applies to both", async () => {
  const src = await readFile(join(root, "src/state/useDocument.ts"), "utf8");
  const apply = src.slice(src.indexOf("const applyInstruction"), src.indexOf("const saveCurrentOutput"));
  const tablo = src.slice(src.indexOf("const runTableAi"), src.indexOf("const applyInstruction"));
  assert.match(apply, /return finishTableJob/);
  assert.match(tablo, /return finishTableJob/);
});
