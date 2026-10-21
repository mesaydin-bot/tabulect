import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FONT_STACKS, readerFontStack } from "../../src/reader/appearance.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "New York", "Iowan Old Style", Palatino, "Times New Roman", serif';

test("reader stacks are installed system faces, not bundled webfonts", () => {
  assert.equal(FONT_STACKS.mono, MONO);
  assert.equal(FONT_STACKS.sans, SANS);
  assert.equal(FONT_STACKS.system, SANS);
  assert.equal(FONT_STACKS.serif, SERIF);
  assert.equal(readerFontStack("mono"), MONO);
  const joined = Object.values(FONT_STACKS).join(" ");
  assert.doesNotMatch(joined, /Inter|JetBrains|Roboto|Source Code/);
});

test("mono stack is a real monospace family list", () => {
  const stack = FONT_STACKS.mono;
  for (const face of ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono"]) {
    assert.match(stack, new RegExp(face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(stack, /(?:^|,\s*)monospace\s*$/);
  assert.doesNotMatch(stack, /Georgia|system-ui|Segoe UI|Helvetica|Inter/);
});

test("reader style writes the stack instead of a circular CSS variable", async () => {
  const src = await readFile(join(root, "src/state/useDocument.ts"), "utf8");
  assert.match(src, /readerFontStack\(appearance\.fontFamily\)/);
  assert.doesNotMatch(src, /"--reader-font-family":\s*`?var\(--reader-font-family\)/);
  assert.match(src, /appearance\.fontFamily/);
});

test("reader, preview, and editor consume --reader-font-family", async () => {
  const css = await readFile(join(root, "src/styles.css"), "utf8");
  assert.match(css, /\.source-chunk p[\s\S]*?font-family:\s*var\(--reader-font-family\)/);
  assert.match(css, /\.md-preview[\s\S]*?font-family:\s*var\(--reader-font-family\)/);
  assert.match(css, /\.output-editor[\s\S]*?font-family:\s*var\(--reader-font-family\)/);
  assert.match(css, /\.shell\[data-font="mono"\][\s\S]*?--reader-font-family:\s*var\(--font-mono\)/);
  assert.match(css, /--font-mono:\s*ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace/);
  assert.doesNotMatch(css, /@font-face|fonts\.google|Inter|JetBrains/);
});
