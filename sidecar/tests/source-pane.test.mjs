import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { highlightMovingEdge, markBoxForEdge, markScrollDelta } from "../lib/source-scroll.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("source pane is normal flow, not absolute virtual rows", async () => {
  const src = await readFile(join(root, "src/components/SourcePane.tsx"), "utf8");
  assert.doesNotMatch(src, /useVirtualizer/);
  assert.doesNotMatch(src, /translateY/);
  assert.doesNotMatch(src, /align:\s*"center"/);
  assert.match(src, /scrollMarkIntoBand|markScrollDelta/);
  assert.match(src, /onCharsPerLine/);
  assert.match(src, /followKeysRef/);
  assert.match(src, /source-inner/);
});

test("keyboard mark stays put inside the mid-pane band", () => {
  const view = { viewTop: 0, viewHeight: 600 };
  assert.equal(
    markScrollDelta({ ...view, markTop: 240, markBottom: 258 }),
    0,
    "line near 40% does not scroll",
  );
  assert.equal(markScrollDelta({ ...view, markTop: 180, markBottom: 198 }), 0);
  assert.equal(markScrollDelta({ ...view, markTop: 360, markBottom: 378 }), 0);
});

test("leaving the band recenters toward 40%", () => {
  const view = { viewTop: 0, viewHeight: 600 };
  const down = markScrollDelta({ ...view, markTop: 520, markBottom: 538 });
  assert.ok(down > 200, `expected a downward correction, got ${down}`);
  const up = markScrollDelta({ ...view, markTop: 20, markBottom: 38 });
  assert.ok(up < -100, `expected an upward correction, got ${up}`);
  const target = 600 * 0.4;
  const mid = (520 + 538) / 2;
  assert.equal(down, mid - target);
});

test("shift accumulate follows the moving edge, not the selection start", () => {
  assert.equal(highlightMovingEdge({ start: 0, end: 0 }, { start: 0, end: 4 }), "end");
  assert.equal(highlightMovingEdge({ start: 2, end: 6 }, { start: 0, end: 6 }), "start");
  assert.equal(highlightMovingEdge({ start: 3, end: 4 }, { start: 5, end: 6 }), "end");
  const tall = markBoxForEdge({ top: 100, bottom: 500 }, "end", 22);
  assert.equal(tall.markBottom, 500);
  assert.equal(tall.markTop, 478);
  const view = { viewTop: 0, viewHeight: 600 };
  const delta = markScrollDelta({ ...view, ...tall });
  assert.ok(delta > 100, `growing bottom should pull the pane, got ${delta}`);
});
