import { firstBinary, loggedOutError, missingCliError, probeLoginStatus } from "./probe.mjs";
import { completeWithPatterns } from "./cli-complete.mjs";
import { withModelFlag } from "./models.mjs";
import { applySessionFlags } from "./sessions.mjs";

const BINARIES = ["codex", "chatgpt"];
const LABEL = "Codex / ChatGPT";

export async function resolveCodex() {
  const override = process.env.TABULECT_CLI_CODEX;
  const found = override ? { name: "codex", path: override } : await firstBinary(BINARIES);
  if (!found) {
    return { id: "codex", label: LABEL, available: false, loggedIn: false, error: missingCliError(LABEL, BINARIES) };
  }
  if (override) {
    return { id: "codex", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  // Real check through the official CLI: `codex login status` reports "Logged in using ChatGPT".
  // A metered API-key login is not accepted as a subscription connection.
  const status = await probeLoginStatus(found.path, ["login", "status"], (out) =>
    /using chatgpt/i.test(out) ? "connected" : /api key/i.test(out) ? "api_key" : "login_required",
  );
  if (status === "connected") {
    return { id: "codex", label: LABEL, available: true, loggedIn: true, status, bin: found.path, error: null };
  }
  return {
    id: "codex",
    label: LABEL,
    available: true,
    loggedIn: false,
    status,
    bin: found.path,
    error: loggedOutError(
      LABEL,
      status === "api_key"
        ? "Codex is signed in with an API key. Tabulect only uses your ChatGPT subscription: run `codex logout` then `codex login`."
        : "Run: codex login",
    ),
  };
}

export const CODEX_HEADLESS_ENV = {
  TERM: "xterm-256color",
  NO_COLOR: "1",
  CI: "1",
};

export function codexHeadlessPatterns(model) {
  const raw = [
    ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-c", "suppress_unstable_features_warning=true", "-c", 'forced_login_method="chatgpt"', "-"],
    ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-c", "approval_policy=never", "--color", "never", "-c", "suppress_unstable_features_warning=true", "-c", 'forced_login_method="chatgpt"', "-"],
    ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-c", 'forced_login_method="chatgpt"', "--json", "-"],
  ];
  return withModelFlag(raw, "codex", model);
}

export function createCodexAdapter(resolved, { model } = {}) {
  return {
    id: "codex",
    label: LABEL,
    async complete(prompt, opts = {}) {
      return completeWithPatterns({
        bin: resolved.bin,
        label: LABEL,
        prompt,
        timeoutMs: 240_000,
        env: CODEX_HEADLESS_ENV,
        cwd: opts.cwd,
        meta: opts.meta,
        patterns: applySessionFlags("codex", codexHeadlessPatterns(model), opts.session),
      });
    },
  };
}
