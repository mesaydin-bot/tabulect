import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants, readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function padId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

export function expandHome(path) {
  if (!path) return path;
  if (path.startsWith("~/")) {
    return join(process.env.HOME || "", path.slice(2));
  }
  return path;
}

export async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** GUI apps often spawn with a stripped PATH. */
export function searchPath() {
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/opt/homebrew/opt/node/bin",
    "/usr/bin",
    "/bin",
    process.env.HOME ? join(process.env.HOME, ".local/bin") : null,
    process.env.HOME ? join(process.env.HOME, ".nvm/current/bin") : null,
    process.env.HOME ? join(process.env.HOME, ".npm-global/bin") : null,
  ].filter(Boolean);
  const current = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return [...new Set([...extras, ...current])].join(delimiter);
}

/**
 * Environment for every child process. Subscription mode must never silently fall
 * back to metered API credentials, so API-key / base-URL variables are removed.
 * Each user's own CLI login (in their own $HOME) is the only credential source.
 */
export const SCRUBBED_ENV = /^(OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_ORG_ID|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_PROFILE|ANTHROPIC_FEDERATION_RULE_ID|ANTHROPIC_ORGANIZATION_ID|ANTHROPIC_IDENTITY_TOKEN_FILE|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GENAI_USE_GCA|GOOGLE_GEMINI_BASE_URL|KIMI_API_KEY|KIMI_BASE_URL|KIMI_MODEL_.+|MOONSHOT_API_KEY|CURSOR_API_KEY|CURSOR_AUTH_TOKEN|CODEX_THREAD_ID|CODEX_INTERNAL_.+|TABULECT_TOKEN)$/;

export function subscriptionEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (SCRUBBED_ENV.test(key)) delete env[key];
  }
  return { ...env, PATH: searchPath(), ...extra };
}

export async function which(name, extraDirs = []) {
  if (!name) return null;
  if (name.includes("/") || name.includes("\\")) {
    return (await isExecutable(name)) ? name : null;
  }
  const dirs = [
    ...extraDirs,
    ...searchPath().split(delimiter),
  ];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function ignoreStreamError(stream) {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("error", () => {});
}

const activeCliPids = new Set();
let peakCli = 0;

function notifyWorkerCliHeartbeat() {
  if (String(process.env.TABULECT_FILL_WORKER || "") !== "1") return;
  if (typeof process.send !== "function") return;
  try {
    process.send({ type: "heartbeat", clis: inFlightCliCount(process.pid, liveCliCount()) });
  } catch {
    /* parent gone */
  }
}

function trackCliPid(pid) {
  if (!pid || pid === process.pid) return;
  activeCliPids.add(pid);
  if (activeCliPids.size > peakCli) peakCli = activeCliPids.size;
  notifyWorkerCliHeartbeat();
}

function countPids(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter((id) => /^\d+$/.test(id)).length;
}

function countPgrepChildren(pid) {
  try {
    const result = spawnSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      timeout: 800,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error) return 0;
    return countPids(result.stdout);
  } catch {
    return 0;
  }
}

function countProcChildren(pid) {
  try {
    return countPids(readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8"));
  } catch {
    /* not Linux, or the task file is gone */
  }
  try {
    let n = 0;
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const close = stat.lastIndexOf(") ");
        if (close < 0) continue;
        const rest = stat.slice(close + 2).split(" ");
        if (Number(rest[1]) === pid) n += 1;
      } catch {
        /* raced with exit */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Direct child processes of pid (kimi/codex under a fill-worker). */
export function descendantCount(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(countPgrepChildren(n), countProcChildren(n));
}

/** IPC-reported CLIs plus OS children of the fill-worker. */
export function inFlightCliCount(workerPid, reported = 0) {
  const n = Number(reported) || 0;
  return Math.max(n, descendantCount(workerPid));
}

/** Provider CLI children of this process (not nested fill-workers). */
export function liveCliCount() {
  let n = 0;
  for (const pid of [...activeCliPids]) {
    if (!pid || pid === process.pid) {
      activeCliPids.delete(pid);
      continue;
    }
    try {
      process.kill(pid, 0);
      n += 1;
    } catch {
      activeCliPids.delete(pid);
    }
  }
  return n;
}

export function resetCliPeak() {
  peakCli = 0;
}

export function cliPeak() {
  return peakCli;
}

function killProcessGroup(child) {
  if (!child?.pid || child.pid === process.pid) return;
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

export function runCommand(command, args, options = {}) {
  const {
    cwd,
    input,
    timeoutMs = 120_000,
    env,
    maxBuffer = 12 * 1024 * 1024,
  } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: subscriptionEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    trackCliPid(child.pid);
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    ignoreStreamError(child.stdin);
    ignoreStreamError(child.stdout);
    ignoreStreamError(child.stderr);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (child.pid) activeCliPids.delete(child.pid);
      notifyWorkerCliHeartbeat();
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child);
      finish({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\ntimed out`.trim(),
        timedOut: true,
        error: null,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBuffer) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBuffer) stderr.push(chunk);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        stdout: "",
        stderr: error.message,
        timedOut: false,
        error,
      });
    });
    child.on("exit", (code) => {
      finish({
        ok: code === 0 && !timedOut,
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        error: null,
      });
    });
    if (input != null) {
      try {
        child.stdin.write(input);
      } catch {
        /* CLI closed stdin — not an auth failure */
      }
    }
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
  });
}

export function titleFromFilename(name) {
  const base = String(name || "document").replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").trim() || "document";
}

export function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

export function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/(div|h[1-6]|li|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function headingTitle(text, fallback) {
  const md = text.match(/^#\s+(.+)$/m);
  if (md) return md[1].trim();
  const line = text.split(/\n/).map((s) => s.trim()).find((s) => s.length >= 4 && s.length <= 80);
  return line || fallback;
}

export function exeDirFromMeta(url) {
  return dirname(new URL(url).pathname);
}
