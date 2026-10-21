import { anyAuthFile, firstBinary, loggedOutError, missingCliError, probeLoginStatus } from "./probe.mjs";
import { completeWithPatterns } from "./cli-complete.mjs";
import { withModelFlag } from "./models.mjs";
import { applySessionFlags } from "./sessions.mjs";

const BINARIES = ["agy", "antigravity"];
const LABEL = "Antigravity";
const AUTH_PATHS = [
  ".antigravity/auth.json",
  ".config/antigravity/auth.json",
  ".gemini/antigravity-cli/auth.json",
  ".gemini/oauth_creds.json",
  ".config/gemini/oauth_creds.json",
];

export async function resolveAntigravity() {
  const override = process.env.TABULECT_CLI_ANTIGRAVITY;
  const found = override ? { name: "antigravity", path: override } : await firstBinary(BINARIES);
  if (!found) {
    return { id: "antigravity", label: LABEL, available: false, loggedIn: false, error: missingCliError(LABEL, BINARIES) };
  }
  if (override) {
    return { id: "antigravity", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  // Current AGY keeps the Google login in the system keyring. A `/usage` probe answers
  // only when the user's own Google account is signed in.
  const status = await probeLoginStatus(found.path, ["-p", "/usage", "--output-format", "json"], (out, ok) =>
    ok && /\{/.test(out) ? "connected" : "unknown",
  );
  const auth = status === "connected" ? null : await anyAuthFile(AUTH_PATHS);
  if (status === "connected" || auth) {
    return { id: "antigravity", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  if (status === "login_required") {
    return { id: "antigravity", label: LABEL, available: true, loggedIn: false, status, bin: found.path, error: loggedOutError(LABEL, "Run: agy (then sign in with Google)") };
  }
  // Could not confirm either way: let the user try; the CLI reports auth failures itself.
  return {
    id: "antigravity",
    label: LABEL,
    available: true,
    loggedIn: true,
    status: "unknown",
    bin: found.path,
    error: null,
  };
}

export function antigravityHeadlessPatterns(model) {
  return withModelFlag(
    [
      ["ask", "--json", "{prompt}"],
      ["--print", "{prompt}"],
    ],
    "antigravity",
    model,
  );
}

export function createAntigravityAdapter(resolved, { model } = {}) {
  return {
    id: "antigravity",
    label: LABEL,
    async complete(prompt, opts = {}) {
      return completeWithPatterns({
        bin: resolved.bin,
        label: LABEL,
        prompt,
        timeoutMs: 240_000,
        cwd: opts.cwd,
        meta: opts.meta,
        patterns: applySessionFlags("antigravity", antigravityHeadlessPatterns(model), opts.session),
      });
    },
  };
}
