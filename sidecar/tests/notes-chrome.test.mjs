import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("Kitaplık and Notlar live in a non-clipped topbar chrome cluster", async () => {
  const src = await readFile(join(root, "src/components/DocumentShell.tsx"), "utf8");
  const css = await readFile(join(root, "src/styles.css"), "utf8");

  const leadStart = src.indexOf('className="topbar-lead"');
  const chromeStart = src.indexOf('className="topbar-chrome"');
  const actionsStart = src.indexOf('className="topbar-actions"');
  assert.ok(leadStart > 0 && chromeStart > leadStart && actionsStart > chromeStart);

  const lead = src.slice(leadStart, chromeStart);
  const chrome = src.slice(chromeStart, actionsStart);
  assert.match(lead, /doc-title/);
  assert.doesNotMatch(lead, /chrome\.library/);
  assert.doesNotMatch(lead, /chrome\.notes/);
  assert.match(chrome, /chrome\.library/);
  assert.match(chrome, /chrome\.notes/);
  assert.match(chrome, /chrome\.stepLabel/);
  assert.match(chrome, /setNotesOpen\(false\)/);
  assert.match(chrome, /setLibraryOpen\(false\)/);

  const leadRule = css.match(/\.topbar-lead \{[^}]+\}/)?.[0] ?? "";
  assert.match(leadRule, /overflow:\s*hidden/);

  const chromeRule = css.match(/\.topbar-chrome \{[^}]+\}/)?.[0] ?? "";
  assert.match(chromeRule, /flex:\s*0 0 auto/);
  assert.doesNotMatch(chromeRule, /overflow:\s*hidden/);

  const rowRule = css.match(/\.topbar-row \{[^}]+\}/)?.[0] ?? "";
  assert.match(rowRule, /flex-wrap:\s*wrap/);
});
