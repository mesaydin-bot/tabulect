import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { completeWithPatterns, patternWantsStdin, usableCliText } from "../lib/providers/cli-complete.mjs";
import { CODEX_HEADLESS_ENV, codexHeadlessPatterns } from "../lib/providers/codex.mjs";
import { CURSOR_HEADLESS_ENV, cursorHeadlessPatterns } from "../lib/providers/cursor.mjs";
import { kimiArgvSendsPrompt, kimiHeadlessPatterns } from "../lib/providers/kimi.mjs";

test("Cursor headless argv is print + --trust + ask mode, never -f (force-run)", () => {
  const cwd = "/tmp/tabulect-workspace";
  for (const binName of ["agent", "cursor"]) {
    const patterns = cursorHeadlessPatterns(cwd, binName);
    assert.ok(patterns.length >= 2);
    for (const args of patterns) {
      const blob = args.join(" ");
      assert.match(blob, /(^| )-p( |$)|--print/);
      assert.match(blob, /--trust/);
      assert.doesNotMatch(blob, /(^| )-f( |$)/);
      assert.match(blob, /--mode ask/);
      assert.match(blob, /--workspace/);
      assert.match(blob, /--model auto/);
    }
  }
  assert.equal(CURSOR_HEADLESS_ENV.CI, "1");
});

test("Codex headless env is a TTY-like TERM, never dumb", () => {
  assert.notEqual(CODEX_HEADLESS_ENV.TERM, "dumb");
  assert.match(CODEX_HEADLESS_ENV.TERM, /xterm/);
  const patterns = codexHeadlessPatterns();
  assert.ok(patterns.some((args) => args.includes("exec") && args.includes("-")));
  assert.ok(patterns.every((args) => !args.includes("--full-auto")));
  assert.ok(patterns.every((args) => args.join(" ").includes("--sandbox read-only")));
});

test("Kimi headless patterns pass the prompt as --prompt TEXT, never a positional command", () => {
  const patterns = kimiHeadlessPatterns();
  assert.ok(patterns.length >= 3);
  for (const args of patterns) {
    assert.equal(kimiArgvSendsPrompt(args), true, args.join(" "));
    assert.ok(!(args.length === 1 && args[0] === "--quiet"));
    const promptAt = args.lastIndexOf("{prompt}");
    if (promptAt >= 0) {
      assert.ok(
        ["--prompt", "--command", "-p", "-c"].includes(args[promptAt - 1]),
        `positional prompt is a Kimi command: ${args.join(" ")}`,
      );
    }
  }
  assert.equal(patternWantsStdin(["--quiet", "--prompt", "{prompt}"]), false);
  assert.equal(patternWantsStdin(["--print", "--input-format", "text"]), true);
  const broken = ["--print", "--quiet", "--final-message-only", "--output-format", "text", "{prompt}"];
  assert.equal(kimiArgvSendsPrompt(broken), false);
});

test("Kimi completeWithPatterns skips 'No such command' positional argv and uses --prompt", async () => {
  const FAKE_KIMI = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-kimi.mjs");
  await chmod(FAKE_KIMI, 0o755);
  await assert.rejects(
    () =>
      completeWithPatterns({
        bin: FAKE_KIMI,
        label: "Kimi",
        prompt: "Say OK\nCHUNK c-001 --- hello ---",
        timeoutMs: 8000,
        patterns: [
          ["--print", "--quiet", "--final-message-only", "--output-format", "text", "{prompt}"],
          ["--print", "--quiet", "{prompt}"],
        ],
      }),
    /No such command/,
  );
  const text = await completeWithPatterns({
    bin: FAKE_KIMI,
    label: "Kimi",
    prompt: "CHUNK c-009 --- Yavaş okumak bir yapı işidir. ---",
    timeoutMs: 8000,
    patterns: kimiHeadlessPatterns(),
  });
  assert.match(text, /c-009/);
  assert.match(text, /claim/);
});

test("completeWithPatterns treats whitespace-only CLI output as empty, not success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-cli-blank-"));
  const bin = join(dir, "fake-cli.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node
process.stdout.write("\\n");
process.exit(0);
`,
  );
  await chmod(bin, 0o755);
  await assert.rejects(
    () =>
      completeWithPatterns({
        bin,
        label: "Codex / ChatGPT",
        prompt: "CHUNK c-001 --- hello ---",
        timeoutMs: 4000,
        patterns: [["{prompt}"]],
      }),
    /empty output/,
  );
});

test("usableCliText accepts JSON on stderr when stdout is empty", () => {
  const json = '{"rows":[{"chunkId":"c-001","claim":"x"}]}';
  assert.equal(usableCliText({ stdout: "", stderr: json }).trim(), json);
  assert.equal(usableCliText({ stdout: "  hello  ", stderr: json }).includes("hello"), true);
});

test("completeWithPatterns skips Workspace Trust then uses --trust -f", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-cli-trust-"));
  const bin = join(dir, "fake-cli.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes("--trust") || !args.includes("-f")) {
  process.stderr.write("Workspace Trust: Do you trust this folder? pass --trust\\n");
  process.exit(1);
}
process.stdout.write('{"rows":[{"chunkId":"c-001","claim":"ok"}]}');
`,
  );
  await chmod(bin, 0o755);
  const text = await completeWithPatterns({
    bin,
    label: "Cursor CLI",
    prompt: "fill this table",
    timeoutMs: 8000,
    patterns: [["{prompt}"], ["-p", "--trust", "-f", "{prompt}"]],
  });
  assert.match(text, /c-001/);
});

test("completeWithPatterns skips TERM=dumb then succeeds with a TTY-like env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-cli-tty-"));
  const bin = join(dir, "fake-cli.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node
const term = String(process.env.TERM || "");
if (!term || term === "dumb") {
  process.stderr.write("Error: TERM=dumb / not a TTY\\n");
  process.exit(1);
}
process.stdout.write('{"rows":[{"chunkId":"c-002","claim":"ok"}]}');
`,
  );
  await chmod(bin, 0o755);
  const text = await completeWithPatterns({
    bin,
    label: "Codex / ChatGPT",
    prompt: "fill this table",
    timeoutMs: 8000,
    env: CODEX_HEADLESS_ENV,
    patterns: [["exec", "-"]],
  });
  assert.match(text, /c-002/);
});
