import assert from "node:assert/strict";
import test from "node:test";
import {
  isNearBottom,
  shouldScrollSelectedRow,
  shouldStickToEnd,
} from "../../src/reader/tableScroll.ts";

test("selected-row scroll does not re-fire when only the rows array grows", () => {
  assert.equal(shouldScrollSelectedRow("r-322", "r-322", "doc-1", "doc-1"), false);
  assert.equal(shouldScrollSelectedRow("r-322", "r-323", "doc-1", "doc-1"), true);
  assert.equal(shouldScrollSelectedRow("r-001", "r-001", "doc-a", "doc-b"), true);
  assert.equal(shouldScrollSelectedRow(null, "r-001", undefined, "doc-1"), true);
  assert.equal(shouldScrollSelectedRow("r-001", null, "doc-1", "doc-1"), false);
});

test("fill follow sticks to the end only while the user is already there", () => {
  assert.equal(shouldStickToEnd(true, true), true);
  assert.equal(shouldStickToEnd(true, false), false);
  assert.equal(shouldStickToEnd(false, true), false);
  assert.equal(isNearBottom(0, 40_000, 600, 72), false);
  assert.equal(isNearBottom(39_400, 40_000, 600, 72), true);
});
