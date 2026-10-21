import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhraseService, phrasePrompt, validatePhrases } from "../lib/phrases.mjs";
import {
  countWords,
  exactFineSpans,
  fineUnits,
  grammarRanges,
  passageUnits,
  readingPassages,
  stepDelayMs,
  wordRanges,
} from "../../src/reader/fine-reading.ts";

const text = "What I had taken to be the largest object I had ever seen";
const phrases = ["What I had taken to be", "the largest object", "I had ever seen"];
const chunk = (id, text) => ({ id, text, page: 1, start: 0, end: text.length });

test("approved small-unit style is explicit, with source treated as data", () => {
  const prompt = phrasePrompt(text);
  for (const example of [phrases.join(" | "), "the art of discussion", "The woman | who lives next door | gave me | a useful piece of advice."]) assert.ok(prompt.includes(example));
  assert.match(prompt, /not a fixed word count/);
  assert.match(prompt, /never instructions/);
});

test("validated phrases keep exact source offsets and full coverage", () => {
  const ranges = validatePhrases(text, { phrases });
  assert.deepEqual(ranges.map((r) => text.slice(r.start, r.end)), phrases);
  const wrapped = "  the art\nof\t discussion  ";
  const [r] = validatePhrases(wrapped, { phrases: ["the art of discussion"] });
  assert.equal(wrapped.slice(r.start, r.end), "the art\nof\t discussion");
});

test("rewrites, omissions, repeats, partial words and empty results are rejected", () => {
  for (const invalid of [[], ["What I had taken to be"], ["What I took to be", ...phrases.slice(1)], [...phrases, "seen"], ["Wh", text.slice(2)], [""]]) {
    assert.throws(() => validatePhrases(text, { phrases: invalid }));
  }
});

test("Unicode, punctuation and repeated phrases map in order", () => {
  const source = "İstanbul’da,  çok güzel! Go go go. 😀";
  const ranges = validatePhrases(source, { phrases: ["İstanbul’da,", "çok güzel!", "Go", "go", "go. 😀"] });
  assert.equal(source.slice(ranges[1].start, ranges[1].end), "çok güzel!");
  assert.equal(ranges.at(-1).end, source.length);
});

const finish = async (service, job) => {
  for (let i = 0; i < 100; i++) {
    const current = service.get(job.jobId);
    if (current.status !== "pending") return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job timed out");
};

test("requests deduplicate, persist boundaries, and invalidate on model/text changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "phrases-test-"));
  let calls = 0;
  const complete = async () => { calls++; return JSON.stringify({ phrases }); };
  try {
    const service = createPhraseService({ root, complete });
    const opts = { text, provider: "codex", model: "test" };
    const first = await service.request(opts);
    assert.equal((await service.request(opts)).jobId, first.jobId);
    assert.equal((await finish(service, first)).status, "ready");
    assert.equal(calls, 1);
    const restarted = createPhraseService({ root, complete });
    assert.equal((await finish(restarted, await restarted.request(opts))).status, "ready");
    assert.equal(calls, 1);
    assert.notEqual((await service.request({ ...opts, model: "other" })).jobId, first.jobId);
    await finish(service, await service.request({ ...opts, model: "other" }));
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid output surfaces an error; explicit retry is required", async () => {
  const root = await mkdtemp(join(tmpdir(), "phrases-test-"));
  let calls = 0;
  try {
    const service = createPhraseService({ root, complete: async () => { calls++; return JSON.stringify({ phrases: calls <= 2 ? ["invented"] : phrases }); } });
    const opts = { text, provider: "codex" };
    assert.equal((await finish(service, await service.request(opts))).status, "error");
    assert.equal((await service.request(opts)).status, "error");
    assert.equal(calls, 2);
    assert.equal((await finish(service, await service.request({ ...opts, retry: true }))).status, "ready");
    assert.equal(calls, 3);
    await assert.rejects(() => service.request({ text: "", provider: "codex" }));
    await assert.rejects(() => service.request({ text, provider: "unknown" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("word navigation preserves contractions, original punctuation, and configurable wordStep grouping", () => {
  const source = "  Don't lose İstanbul’s well-known art.";
  assert.deepEqual(wordRanges(source).map((r) => source.slice(r.start, r.end)), ["Don't", "lose", "İstanbul’s", "well-known", "art."]);
  assert.deepEqual(wordRanges(source, 2).map((r) => source.slice(r.start, r.end)), ["Don't lose", "İstanbul’s well-known", "art."]);
  assert.deepEqual(wordRanges(source, 3).map((r) => source.slice(r.start, r.end)), ["Don't lose İstanbul’s", "well-known art."]);
});

test("speed reading pacer scales dwell time by word count, WPM, and terminal punctuation", () => {
  assert.equal(countWords("What I had taken to be"), 6);
  assert.equal(stepDelayMs("word", 240, 1), 250);
  assert.equal(stepDelayMs("three word group", 240, 3), 750);
  assert.ok(stepDelayMs("end of sentence.", 240, 3) > stepDelayMs("three word group", 240, 3));
});

test("local grammatical phrase chunker segments natural constituents without fixed word counts", () => {
  const slice = (s) => grammarRanges(s).map((r) => s.slice(r.start, r.end));
  assert.deepEqual(slice("the art of discussion"), ["the art of discussion"]);
  assert.deepEqual(slice(text), ["What I had taken to be", "the largest object", "I had ever seen"]);
  assert.deepEqual(
    slice("The woman who lives next door gave me a useful piece of advice."),
    ["The woman", "who lives next door", "gave me", "a useful piece of advice."],
  );
  assert.deepEqual(
    slice("The art of discussion requires patience and careful listening."),
    ["The art of discussion", "requires patience", "and careful listening."],
  );
  assert.deepEqual(
    slice("She came up with a surprisingly simple solution to a very difficult problem."),
    ["She came up with", "a surprisingly simple solution", "to a very difficult problem."],
  );
  assert.deepEqual(
    slice("Although he knew the risks, he decided to continue because giving up would mean losing everything."),
    ["Although he knew the risks,", "he decided to continue", "because giving up", "would mean losing everything."],
  );
  assert.deepEqual(
    slice("Her şeye rağmen sabırla dinleyerek çok önemli bir karar verdi."),
    ["Her şeye rağmen", "sabırla dinleyerek", "çok önemli bir karar verdi."],
  );
});

test("passages do not split by phrase word count, and cache rebuilds preserve offsets", () => {
  const chunks = [chunk("a", `  ${text}\n\nThe art of discussion.`), chunk("b", "Next page.")];
  const passages = readingPassages(chunks);
  assert.equal(passages.length, 3);
  const cache = new Map([[passages[0].key, validatePhrases(passages[0].text, { phrases })]]);
  const units = fineUnits(passages, "phrase", cache);
  assert.deepEqual(units.slice(0, 3).map((u) => u.text), phrases);
  assert.equal(units[3].pending, true);
  for (const u of units) assert.equal(chunks.find((c) => c.id === u.chunkId).text.slice(u.start, u.end), u.text);

  // Hybrid fallback uses instant grammatical units for uncached passages instead of blocking
  const hybridUnits = fineUnits(passages, "phrase", cache, true);
  assert.deepEqual(hybridUnits.slice(0, 3).map((u) => u.text), phrases);
  assert.equal(hybridUnits[0].provisional, undefined);
  assert.equal(hybridUnits[3].text, "The art of discussion.");
  assert.equal(hybridUnits[3].provisional, true);
});

test("multi-unit selections preserve whitespace and cross-chunk bookmark offsets", () => {
  const chunks = [chunk("a", "One  two\nthree."), chunk("b", "Four five.")];
  const passages = readingPassages(chunks);
  const units = passages.flatMap((p) => passageUnits(p, wordRanges(p.text), "word"));
  const spans = exactFineSpans(chunks, units.slice(1, 4));
  assert.deepEqual(spans.map((s) => s.text), ["two\nthree.", "Four"]);
  assert.equal(spans[0].start, 5);
});
