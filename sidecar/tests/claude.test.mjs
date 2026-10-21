import assert from "node:assert/strict";
import test from "node:test";
import { classifyClaudeAuth, claudeHeadlessPatterns, readClaudeResult } from "../lib/providers/claude.mjs";
import { applySessionFlags } from "../lib/providers/sessions.mjs";
import { SUBSCRIPTIONS, loginScript } from "../lib/providers/login.mjs";
import { PROVIDER_IDS } from "../lib/schema.mjs";
import { subscriptionEnv } from "../lib/util.mjs";

test("Claude Code is a provider with the official login command", () => {
  assert.ok(PROVIDER_IDS.includes("claude"));
  assert.deepEqual(SUBSCRIPTIONS.claude.login, ["auth", "login"]);
  const script = loginScript("claude", "/usr/local/bin/claude");
  assert.match(script, /'\/usr\/local\/bin\/claude' auth login/);
  assert.match(script, /unset .*ANTHROPIC_API_KEY.*CLAUDE_CODE_OAUTH_TOKEN/);
});

test("only a claude.ai subscription login is connected", () => {
  assert.equal(classifyClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai"}'), "connected");
  for (const method of ["api_key", "api_key_helper", "oauth_token", "third_party"]) {
    assert.equal(classifyClaudeAuth(JSON.stringify({ loggedIn: true, authMethod: method })), "api_key");
  }
  assert.equal(classifyClaudeAuth('{"loggedIn":false,"authMethod":"none"}', false), "login_required");
});

test("print mode is text-only, model flag and resume are inserted", () => {
  const [pattern] = claudeHeadlessPatterns("sonnet");
  assert.deepEqual(pattern.slice(0, 3), ["-p", "--output-format", "json"]);
  assert.equal(pattern[pattern.indexOf("--tools") + 1], "");
  assert.equal(pattern[pattern.indexOf("--model") + 1], "sonnet");
  const [resumed] = applySessionFlags("claude", claudeHeadlessPatterns(""), { id: "abc-123", continued: true });
  assert.equal(resumed[resumed.indexOf("--resume") + 1], "abc-123");
});

test("JSON results are unwrapped; error results never become table text", () => {
  assert.deepEqual(readClaudeResult({ text: '{"type":"result","subtype":"success","is_error":false,"result":"{\\"rows\\":[]}","session_id":"s1"}' }), { text: '{"rows":[]}', sessionId: "s1" });
  assert.throws(() => readClaudeResult({ text: '{"type":"result","subtype":"error_max_turns","is_error":true}' }), /No table data was fabricated/);
});

test("Anthropic keys, tokens and cloud switches are scrubbed from child processes", () => {
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_BASE_URL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = "secret";
    const env = subscriptionEnv();
    for (const key of keys) assert.equal(env[key], undefined, key);
  } finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});
