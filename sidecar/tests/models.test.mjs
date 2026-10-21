import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODELS,
  curatedModels,
  insertArgvPair,
  modelCatalog,
  modelFlagArgs,
  normalizeModelId,
  resolveModel,
  withModelFlag,
} from "../lib/providers/models.mjs";
import { cursorHeadlessPatterns } from "../lib/providers/cursor.mjs";
import { kimiArgvSendsPrompt, kimiHeadlessPatterns } from "../lib/providers/kimi.mjs";
import { codexHeadlessPatterns } from "../lib/providers/codex.mjs";

test("normalizeModelId strips effort brackets and rejects junk", () => {
  assert.equal(normalizeModelId("composer-1[effort=medium]"), "composer-1");
  assert.equal(normalizeModelId("  auto  "), "auto");
  assert.equal(normalizeModelId("gpt-5.4"), "gpt-5.4");
  assert.equal(normalizeModelId("not a model!"), "");
  assert.equal(normalizeModelId(""), "");
});

test("Cursor defaults to auto; others keep an empty CLI default", () => {
  assert.equal(DEFAULT_MODELS.cursor, "auto");
  assert.equal(resolveModel("cursor"), "auto");
  assert.equal(resolveModel("kimi"), "");
  assert.equal(resolveModel("codex", ""), "");
  assert.equal(resolveModel("cursor", "composer-2.5"), "composer-2.5");
  assert.equal(resolveModel("kimi", null, "kimi-k2.5"), "kimi-k2.5");
  assert.ok(curatedModels("cursor").includes("auto"));
  assert.ok(curatedModels("cursor").includes("composer-2.5"));
  assert.equal(curatedModels("cursor").includes("composer-1[effort=medium]"), false);
});

test("withModelFlag inserts Cursor --model before the prompt", () => {
  const cwd = "/tmp/tabulect-workspace";
  for (const binName of ["agent", "cursor"]) {
    const patterns = cursorHeadlessPatterns(cwd, binName, "composer-2.5");
    for (const args of patterns) {
      const blob = args.join(" ");
      assert.match(blob, /--model composer-2\.5/);
      assert.equal(args.includes("composer-1[effort=medium]"), false);
      const modelAt = args.indexOf("--model");
      const promptAt = args.findIndex((part) => part === "{prompt}" || part === "{file}");
      assert.ok(modelAt >= 0 && promptAt > modelAt);
    }
  }
  const auto = cursorHeadlessPatterns(cwd, "agent");
  assert.match(auto[0].join(" "), /--model auto/);
});

test("Kimi omits --model until set, and still sends --prompt TEXT", () => {
  const unset = kimiHeadlessPatterns();
  for (const args of unset) {
    assert.equal(args.includes("--model"), false);
    assert.equal(kimiArgvSendsPrompt(args), true, args.join(" "));
  }
  const set = kimiHeadlessPatterns("kimi-k2.5");
  for (const args of set) {
    assert.equal(kimiArgvSendsPrompt(args), true, args.join(" "));
    const modelAt = args.indexOf("--model");
    assert.equal(args[modelAt + 1], "kimi-k2.5");
    const promptAt = args.lastIndexOf("{prompt}");
    if (promptAt >= 0) {
      assert.ok(["--prompt", "--command", "-p", "-c"].includes(args[promptAt - 1]), args.join(" "));
    }
  }
});

test("Codex uses -m only when a model is chosen", () => {
  const unset = codexHeadlessPatterns();
  for (const args of unset) {
    assert.equal(args.includes("-m"), false);
    assert.ok(args.includes("-"));
  }
  const set = codexHeadlessPatterns("gpt-5.4");
  for (const args of set) {
    const flagAt = args.indexOf("-m");
    assert.equal(args[flagAt + 1], "gpt-5.4");
    assert.ok(args.indexOf("-") > flagAt);
  }
});

test("modelCatalog is a short curated list, not every vendor id", () => {
  const catalog = modelCatalog();
  assert.equal(catalog.cursor.default, "auto");
  assert.equal(catalog.cursor.flag, "--model");
  assert.equal(catalog.codex.flag, "-m");
  assert.equal(catalog.kimi.default, "");
  assert.ok(catalog.cursor.choices.includes("auto"));
  assert.ok(catalog.cursor.choices.includes("composer-2.5"));
  assert.ok(catalog.cursor.choices.length <= 12);
  assert.equal(catalog.cursor.choices.includes("composer-1[effort=medium]"), false);
});

test("insertArgvPair replaces an existing flag value", () => {
  assert.deepEqual(insertArgvPair(["--model", "old", "{prompt}"], "--model", "auto"), [
    "--model",
    "auto",
    "{prompt}",
  ]);
  assert.deepEqual(modelFlagArgs("kimi", ""), []);
  assert.deepEqual(withModelFlag([["{prompt}"]], "kimi", ""), [["{prompt}"]]);
});
