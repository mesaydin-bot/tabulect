import { anyAuthFile, firstBinary, loggedOutError, missingCliError, probeLoginStatus } from "./probe.mjs";
import { completeWithPatterns } from "./cli-complete.mjs";
import { withModelFlag } from "./models.mjs";
import { applySessionFlags } from "./sessions.mjs";

const BINARIES = ["kimi", "kimi-cli"];
const LABEL = "Kimi";
const AUTH_PATHS = [
  ".kimi/credentials/kimi-code.json",
  ".kimi/credentials.json",
  ".kimi-code/credentials/kimi-code.json",
  ".config/kimi/auth.json",
];

export async function resolveKimi() {
  const override = process.env.TABULECT_CLI_KIMI;
  const found = override ? { name: "kimi", path: override } : await firstBinary(BINARIES);
  if (!found) {
    return { id: "kimi", label: LABEL, available: false, loggedIn: false, error: missingCliError(LABEL, BINARIES) };
  }
  if (override) {
    return { id: "kimi", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  // Real check: only providers backed by the user's Kimi OAuth login count (never API keys).
  const status = await probeLoginStatus(found.path, ["provider", "list", "--json"], (_out, _ok, stdout) => {
    try {
      const data = JSON.parse(stdout);
      const providers = Object.values(data?.providers || {});
      return providers.some((p) => p && p.oauth && p.type === "kimi") ? "connected" : "login_required";
    } catch {
      return "unknown";
    }
  });
  const auth = status === "unknown" ? await anyAuthFile(AUTH_PATHS) : null;
  if (status === "connected" || auth) {
    return { id: "kimi", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  return {
    status: "login_required",
    id: "kimi",
    label: LABEL,
    available: true,
    loggedIn: false,
    bin: found.path,
    error: loggedOutError(LABEL, "Run: kimi login"),
  };
}

export const KIMI_HEADLESS_ENV = { TERM: "dumb", CI: "1", NO_COLOR: "1" };

/** Flags whose next argv token is the prompt text, not a subcommand. */
export const KIMI_PROMPT_FLAGS = ["--prompt", "--command", "-p", "-c"];

/**
 * Kimi treats a bare positional as a COMMAND (`No such command 'Say OK'`).
 * The prompt must be `--prompt/--command/-p/-c TEXT`, or stdin with `--input-format`.
 */
export function kimiHeadlessPatterns(model) {
  const raw = [
    ["--quiet", "--prompt", "{prompt}"],
    ["--print", "--output-format", "text", "--final-message-only", "--prompt", "{prompt}"],
    ["--quiet", "-p", "{prompt}"],
    ["--quiet", "--command", "{prompt}"],
    ["--quiet", "--prompt", "{file}"],
    ["--print", "--input-format", "text"],
  ];
  return withModelFlag(raw, "kimi", model);
}

/** True when `{prompt}`/`{file}` is only the value of a prompt flag, or stdin-only. */
export function kimiArgvSendsPrompt(args) {
  const list = Array.isArray(args) ? args : [];
  const promptTokens = list.filter((part) => part === "{prompt}" || part === "{file}");
  if (promptTokens.length === 0) {
    return list.includes("--input-format");
  }
  for (let i = 0; i < list.length; i += 1) {
    if ((list[i] === "{prompt}" || list[i] === "{file}") && !KIMI_PROMPT_FLAGS.includes(list[i - 1])) {
      return false;
    }
  }
  return true;
}

export function createKimiAdapter(resolved, { model } = {}) {
  return {
    id: "kimi",
    label: LABEL,
    async complete(prompt, opts = {}) {
      return completeWithPatterns({
        bin: resolved.bin,
        label: LABEL,
        prompt,
        timeoutMs: 180_000,
        env: KIMI_HEADLESS_ENV,
        cwd: opts.cwd,
        meta: opts.meta,
        patterns: applySessionFlags("kimi", kimiHeadlessPatterns(model), opts.session),
      });
    },
  };
}
