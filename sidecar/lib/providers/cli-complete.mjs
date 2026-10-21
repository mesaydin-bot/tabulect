import { runCommand } from "../util.mjs";
import { invokeError } from "./probe.mjs";
import { extractSessionId } from "./sessions.mjs";
import { removePromptDir, writePromptFile } from "./run.mjs";

function looksLikeAuthFailure(result) {
  const blob = `${result.stdout}
${result.stderr}`.toLowerCase();
  return /not logged|unauthoriz|unauthenticated|please log|sign in required|login required|auth(?:entication)? (?:failed|required)|401/.test(
    blob,
  );
}

function looksLikeTransientCli(result) {
  const blob = `${result.stdout}
${result.stderr}`.toLowerCase();
  return /workspace trust|do you trust this|untrusted workspace|--trust|not a tty|is not a tty|is a tty|term=dumb|dumb terminal|non-interactive|headless|rate limit|quota|usage limit|timed out|timeout|empty output|no such command|unknown command|unrecognized arguments/.test(
    blob,
  );
}

function looksLikeArgvFailure(result) {
  const blob = `${result.stdout}
${result.stderr}`;
  return /no such command|unknown command|unrecognized arguments/i.test(blob);
}

const PROMPT_VALUE_FLAGS = new Set(["--prompt", "--command", "-p", "-c"]);

/** `--prompt TEXT` already carries the prompt; do not also pipe stdin. Stdin-only patterns keep stdin. */
export function patternWantsStdin(pattern, defaultStdin = true) {
  const list = Array.isArray(pattern) ? pattern : [];
  if (list.includes("--input-format")) return true;
  for (let i = 0; i < list.length; i += 1) {
    if (PROMPT_VALUE_FLAGS.has(list[i]) && (list[i + 1] === "{prompt}" || list[i + 1] === "{file}")) {
      return false;
    }
  }
  return defaultStdin;
}

/** Prefer stdout; some CLIs print JSON only on stderr after a non-zero exit. */
export function usableCliText(result) {
  const out = String(result?.stdout || "");
  if (out.trim()) return out;
  const err = String(result?.stderr || "");
  if (/[{[]/.test(err) && /rows|claim|applied|chunkId/.test(err)) return err;
  return "";
}

/**
 * Try argv patterns. `{prompt}` is the full prompt, `{file}` a temp prompt path.
 * Stdin also receives the prompt unless `stdin` is false.
 * Empty output / trust / TTY failures skip to the next pattern; they are not auth failures.
 */
export async function completeWithPatterns({
  bin,
  label,
  prompt,
  patterns,
  timeoutMs = 180_000,
  env,
  cwd,
  stdin = true,
  meta = false,
}) {
  const written = await writePromptFile(prompt);
  try {
    let last = "";
    for (const pattern of patterns) {
      const args = pattern.map((part) => {
        if (part === "{file}") return written.path;
        if (part === "{prompt}") return prompt;
        return part;
      });
      const result = await runCommand(bin, args, {
        timeoutMs,
        input: patternWantsStdin(pattern, stdin) ? prompt : undefined,
        env,
        cwd,
        maxBuffer: 2 * 1024 * 1024,
      });
      const blob = `${result.stdout}
${result.stderr}`;
      last = blob.trim().slice(0, 700) || (result.timedOut ? "timed out" : "empty output");
      if (looksLikeAuthFailure(result)) {
        throw new Error(invokeError(label, `Not logged in. ${last}`));
      }
      if (/usage limit|hit your usage|rate limit|quota/i.test(blob)) {
        last = blob.slice(0, 500).trim() || last;
        continue;
      }
      if (looksLikeArgvFailure(result)) {
        last = blob.slice(0, 500).trim() || last;
        continue;
      }
      const text = usableCliText(result);
      if (text.trim()) {
        const sessionId = extractSessionId(blob) || extractSessionId(text);
        return meta ? { text, sessionId } : text;
      }
      if (looksLikeTransientCli(result) || result.timedOut || !result.ok) {
        continue;
      }
    }
    throw new Error(invokeError(label, last || "empty output"));
  } finally {
    await removePromptDir(written.dir);
  }
}
