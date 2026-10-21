import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../util.mjs";
import { anyAuthFile, firstBinary, loggedOutError, missingCliError, probeLoginStatus } from "./probe.mjs";
import { completeWithPatterns } from "./cli-complete.mjs";
import { withModelFlag } from "./models.mjs";
import { applySessionFlags, extractSessionId } from "./sessions.mjs";

const BINARIES = ["cursor-agent", "agent", "cursor"];
const LABEL = "Cursor CLI";
const AUTH_PATHS = [
  ".cursor/auth.json",
  ".config/cursor/auth.json",
  "Library/Application Support/Cursor/User/globalStorage",
];

async function workspaceDir() {
  const dir = join(homedir(), ".local/share/tabulect/agent-workspace");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function resolveCursor() {
  const override = process.env.TABULECT_CLI_CURSOR;
  const found = override ? { name: "cursor", path: override } : await firstBinary(BINARIES);
  if (!found) {
    return { id: "cursor", label: LABEL, available: false, loggedIn: false, error: missingCliError(LABEL, BINARIES) };
  }
  if (override) {
    return { id: "cursor", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  const argv = found.name === "cursor" ? ["agent", "status"] : ["status"];
  const status = await probeLoginStatus(found.path, argv, (out) =>
    /not logged in|login required|unauthenticated/i.test(out) ? "login_required" : /logged in|signed in|@/i.test(out) ? "connected" : "unknown",
  );
  const auth = status === "unknown" ? await anyAuthFile(AUTH_PATHS) : null;
  if (status === "connected" || auth) {
    return { id: "cursor", label: LABEL, available: true, loggedIn: true, status: "connected", bin: found.path, error: null };
  }
  return {
    id: "cursor",
    label: LABEL,
    available: true,
    loggedIn: false,
    bin: found.path,
    status,
    error: loggedOutError(LABEL, "Run: cursor-agent login"),
  };
}

export function cursorHeadlessPatterns(cwd, binName, model = "auto") {
  const print = ["-p", "--output-format", "text", "--trust", "--workspace", cwd, "--mode", "ask"];
  const raw =
    binName === "cursor"
      ? [
          ["agent", ...print, "{prompt}"],
          ["agent", "-p", "--trust", "--output-format", "text", "--workspace", cwd, "--mode", "ask", "{file}"],
        ]
      : [
          [...print, "{prompt}"],
          ["-p", "--trust", "--output-format", "text", "--workspace", cwd, "--mode", "ask", "{file}"],
        ];
  return withModelFlag(raw, "cursor", model);
}

export const CURSOR_HEADLESS_ENV = { TERM: "dumb", CI: "1", NO_COLOR: "1" };

async function tryCreateCursorChat(bin, binName, cwd) {
  const argv = binName === "cursor" ? ["agent", "create-chat"] : ["create-chat"];
  try {
    const result = await runCommand(bin, argv, {
      timeoutMs: 20_000,
      cwd,
      env: CURSOR_HEADLESS_ENV,
    });
    return extractSessionId(`${result.stdout}\n${result.stderr}`) || String(result.stdout || "").trim().split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

export function createCursorAdapter(resolved, { model } = {}) {
  const binName = String(resolved.bin || "").split("/").pop();
  const selected = model == null || String(model).trim() === "" ? "auto" : model;
  return {
    id: "cursor",
    label: LABEL,
    async complete(prompt, opts = {}) {
      const cwd = opts.cwd || (await workspaceDir());
      let session = opts.session;
      if (opts.meta && !session?.id && !session?.continued) {
        const created = await tryCreateCursorChat(resolved.bin, binName, cwd);
        if (created) session = { id: created, continued: true };
      }
      return completeWithPatterns({
        bin: resolved.bin,
        label: LABEL,
        prompt,
        timeoutMs: 240_000,
        cwd,
        env: CURSOR_HEADLESS_ENV,
        meta: opts.meta,
        patterns: applySessionFlags("cursor", cursorHeadlessPatterns(cwd, binName, selected), session),
      });
    },
  };
}
