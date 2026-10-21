import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { completeFreeform } from "../lib/providers/index.mjs";
import {
  applySessionFlags,
  clearSessions,
  extractSessionId,
  getSession,
  looksLikeResumeFailure,
  sessionKey,
  setSession,
} from "../lib/providers/sessions.mjs";
import { cursorHeadlessPatterns } from "../lib/providers/cursor.mjs";
import { kimiArgvSendsPrompt, kimiHeadlessPatterns } from "../lib/providers/kimi.mjs";
import { codexHeadlessPatterns } from "../lib/providers/codex.mjs";

test("persistent providers share one conversation across documents", () => {
  clearSessions();
  assert.equal(sessionKey("cursor", "doc-1"), "cursor:doc-1");
  setSession("cursor", "doc-1", { id: "chat-a" });
  setSession("kimi", "doc-1", { id: "kim-a" });
  assert.equal(getSession("cursor", "doc-1").id, "chat-a");
  assert.equal(getSession("kimi", "doc-1").id, "kim-a");
  clearSessions({ providerId: "cursor", documentId: "doc-1" });
  assert.equal(getSession("cursor", "doc-1"), null);
  assert.equal(getSession("kimi", "doc-1").id, "kim-a");
  clearSessions();
});

test("extractSessionId reads common CLI envelopes", () => {
  assert.equal(extractSessionId('{"session_id":"7f7116f0-a04f-4a8b-b994-a4ce80ac2875"}'), "7f7116f0-a04f-4a8b-b994-a4ce80ac2875");
  assert.equal(extractSessionId('{"chatId": "abc-123"}'), "abc-123");
  assert.equal(extractSessionId("To resume this session: kimi -r sess99"), "sess99");
});

test("Cursor resume uses --resume id; continue is --continue; --trust stays", () => {
  const cwd = "/tmp/tabulect-workspace";
  const fresh = applySessionFlags("cursor", cursorHeadlessPatterns(cwd, "agent"), null);
  for (const args of fresh) {
    assert.equal(args.includes("--continue"), false);
    assert.equal(args.includes("--resume"), false);
    assert.ok(args.includes("--trust"));
  }
  const resumed = applySessionFlags("cursor", cursorHeadlessPatterns(cwd, "agent"), { id: "chat-9" });
  for (const args of resumed) {
    assert.ok(args.includes("--resume"));
    assert.equal(args[args.indexOf("--resume") + 1], "chat-9");
    assert.ok(args.includes("--trust"));
    assert.equal(args.includes("-f"), false);
  }
  const cont = applySessionFlags("cursor", cursorHeadlessPatterns(cwd, "agent"), { continued: true });
  assert.ok(cont.every((args) => args.includes("--continue")));
});

test("Kimi resume is --session/--continue, never -c", () => {
  const resumed = applySessionFlags("kimi", kimiHeadlessPatterns(), { id: "kim-1" });
  for (const args of resumed) {
    assert.equal(args[0], "--session");
    assert.equal(args[1], "kim-1");
    assert.equal(kimiArgvSendsPrompt(args), true, args.join(" "));
    assert.equal(args.includes("-c") && args[args.indexOf("-c") + 1] === "kim-1", false);
  }
  const cont = applySessionFlags("kimi", kimiHeadlessPatterns(), { continued: true });
  for (const args of cont) {
    assert.equal(args[0], "--continue");
    assert.equal(kimiArgvSendsPrompt(args), true, args.join(" "));
  }
});

test("Codex resume is exec resume <id>|--last", () => {
  const resumed = applySessionFlags("codex", codexHeadlessPatterns(), { id: "sess-1" });
  for (const args of resumed) {
    assert.deepEqual(args.slice(0, 3), ["exec", "resume", "sess-1"]);
  }
  const last = applySessionFlags("codex", codexHeadlessPatterns(), { continued: true });
  for (const args of last) {
    assert.deepEqual(args.slice(0, 3), ["exec", "resume", "--last"]);
  }
});

test("legacy Cursor resume failure preserves the conversation and surfaces an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-sess-"));
  process.env.TABULECT_DATA = dir;
  const bin = join(dir, "fake-cli.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
let prompt = "";
try { prompt = readFileSync(0, "utf8"); } catch { prompt = ""; }
if (args.includes("resume") || args.includes("--resume") || args.includes("--continue")) {
  process.stderr.write("unknown session: cannot resume\\n");
  process.exit(1);
}
process.stderr.write(JSON.stringify({ session_id: "fresh-2" }) + "\\n");
process.stdout.write("ok-table\\n");
`,
  );
  await chmod(bin, 0o755);
  clearSessions();
  process.env.TABULECT_CLI_CURSOR = bin;
  setSession("cursor", "doc-r", { id: "dead-1", continued: true });
  assert.equal(looksLikeResumeFailure("unknown session: cannot resume"), true);
  await assert.rejects(completeFreeform({
    providerId: "cursor",
    prompt: "TABLE_AI\nSOURCE_BEGIN\nhi\nSOURCE_END\n",
    documentId: "doc-r",
  }), /no new conversation was started/);
  assert.equal(getSession("cursor", "doc-r")?.id, "dead-1");
  delete process.env.TABULECT_CLI_CURSOR;
  delete process.env.TABULECT_DATA;
  clearSessions();
});
