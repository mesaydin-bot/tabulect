import { firstBinary, loggedOutError, missingCliError } from "./probe.mjs";
import { completeWithPatterns } from "./cli-complete.mjs";
import { withModelFlag } from "./models.mjs";
import { applySessionFlags } from "./sessions.mjs";
import { runCommand } from "../util.mjs";

const BINARIES = ["claude"];
const LABEL = "Claude Code";

/**
 * `claude auth status` prints JSON and exits 0 only when signed in. Only a claude.ai
 * subscription login counts: API keys, apiKeyHelper scripts, long-lived OAuth tokens
 * and cloud providers are refused, so Tabulect never bills a metered key.
 */
export function classifyClaudeAuth(stdout, ok = true) {
  let data = null;
  try {
    data = JSON.parse(String(stdout || "").trim());
  } catch {
    /* text output from an older CLI */
  }
  const method = data?.authMethod;
  if (method === "claude.ai") return "connected";
  if (["api_key", "api_key_helper", "oauth_token", "third_party"].includes(method)) return "api_key";
  if (method === "none" || data?.loggedIn === false || !ok) return "login_required";
  return "unknown";
}

export async function resolveClaude() {
  const override = process.env.TABULECT_CLI_CLAUDE;
  const found = override ? { name: "claude", path: override } : await firstBinary(BINARIES);
  if (!found) {
    return { id: "claude", label: LABEL, available: false, loggedIn: false, error: missingCliError(LABEL, BINARIES) };
  }
  if (override) {
    return { id: "claude", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  let status = "unknown";
  try {
    const result = await runCommand(found.path, ["auth", "status"], { timeoutMs: 12_000 });
    status = classifyClaudeAuth(result.stdout, result.ok);
  } catch {
    status = "unknown";
  }
  if (status === "connected") {
    return { id: "claude", label: LABEL, available: true, loggedIn: true, status, bin: found.path, error: null };
  }
  return {
    id: "claude",
    label: LABEL,
    available: true,
    loggedIn: false,
    status,
    bin: found.path,
    error: loggedOutError(
      LABEL,
      status === "api_key"
        ? "Claude Code is signed in with an API key, token or cloud provider. Tabulect only uses your Claude subscription: run `claude auth logout` then `claude auth login`."
        : "Run: claude auth login",
    ),
  };
}

export const CLAUDE_HEADLESS_ENV = { TERM: "dumb", CI: "1", NO_COLOR: "1" };

/** Text-only print mode: no tools, no MCP servers, no slash commands; the prompt arrives on stdin. */
export function claudeHeadlessPatterns(model) {
  const raw = [
    ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--permission-mode", "dontAsk"],
  ];
  return withModelFlag(raw, "claude", model);
}

/** `--output-format json` returns one result object; keep its text and session id. */
export function readClaudeResult(raw) {
  const text = String(raw?.text ?? raw ?? "");
  let data = null;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return { text, sessionId: raw?.sessionId || "" };
  }
  if (data?.is_error || (data?.subtype && data.subtype !== "success")) {
    throw new Error(`${LABEL} failed. ${String(data.result || data.subtype || "").slice(0, 300)} No table data was fabricated.`);
  }
  return { text: String(data?.result ?? ""), sessionId: String(data?.session_id || raw?.sessionId || "") };
}

export function createClaudeAdapter(resolved, { model } = {}) {
  return {
    id: "claude",
    label: LABEL,
    async complete(prompt, opts = {}) {
      const raw = await completeWithPatterns({
        bin: resolved.bin,
        label: LABEL,
        prompt,
        timeoutMs: 240_000,
        env: CLAUDE_HEADLESS_ENV,
        cwd: opts.cwd,
        meta: true,
        patterns: applySessionFlags("claude", claudeHeadlessPatterns(model), opts.session),
      });
      const result = readClaudeResult(raw);
      return opts.meta ? result : result.text;
    },
  };
}
