import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCommand, which } from "../util.mjs";

async function fileOk(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function firstBinary(names) {
  for (const name of names) {
    const path = await which(name);
    if (path) return { name, path };
  }
  return null;
}

export async function anyAuthFile(relPaths) {
  const home = homedir();
  for (const rel of relPaths) {
    const path = rel.startsWith("/") ? rel : join(home, rel);
    if (await fileOk(path)) return path;
  }
  return null;
}

export async function commandLooksLoggedIn(bin, argSets) {
  for (const args of argSets) {
    const result = await runCommand(bin, args, { timeoutMs: 12_000 });
    const blob = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (/not logged|unauthoriz|unauthenticated|please log|sign in|login required|auth(?:entication)? (?:failed|required)/i.test(blob)) {
      return { ok: false, detail: blob.slice(0, 400).trim() };
    }
    if (result.ok) return { ok: true, detail: (result.stdout || result.stderr).slice(0, 200).trim() };
  }
  return null;
}

/**
 * Ask the official CLI itself whether the current user is signed in.
 * `classify(output, ok)` returns "connected" | "login_required" | "api_key" | "unknown".
 * Nothing is read from or written to credential files; tokens never pass through Tabulect.
 */
export async function probeLoginStatus(bin, args, classify, timeoutMs = 12_000) {
  try {
    const result = await runCommand(bin, args, { timeoutMs });
    const out = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (/not logged|unauthoriz|unauthenticated|please log|login required|auth(?:entication)? (?:failed|required)/i.test(out)) {
      return "login_required";
    }
    return classify(out, result.ok, String(result.stdout || "")) || "unknown";
  } catch {
    return "unknown";
  }
}

export function missingCliError(label, binaries) {
  return `${label} was not found (${binaries.join(", ")}). Install the subscription CLI and sign in. Tabulect does not accept API keys and will not invent table rows.`;
}

export function loggedOutError(label, extra = "") {
  const tail = extra ? ` Details: ${extra}` : "";
  return `${label} is installed but not logged in.${tail} Sign in to the subscription CLI, then retry. Tabulect will not invent table rows.`;
}

export function invokeError(label, extra = "") {
  return `${label} failed.${extra ? ` ${extra}` : ""} No table data was fabricated.`;
}
