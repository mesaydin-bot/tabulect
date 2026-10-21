/**
 * Opens a subscription CLI's OFFICIAL login command in a terminal window.
 * Only fixed, built-in commands run; nothing from the request is executed.
 * Tabulect never reads, copies or stores tokens: the CLI keeps its own login
 * in the current user's home directory / keychain.
 */
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SCRUBBED_ENV, which } from "../util.mjs";

export const SUBSCRIPTIONS = {
  codex: {
    binaries: ["codex"],
    login: ["login"],
    install: "npm install -g @openai/codex",
    docs: "https://developers.openai.com/codex/auth/",
  },
  kimi: {
    binaries: ["kimi"],
    login: ["login"],
    install: "npm install -g @moonshot-ai/kimi-code",
    docs: "https://moonshotai.github.io/kimi-code/en/guides/getting-started",
  },
  antigravity: {
    binaries: ["agy", "antigravity"],
    login: [],
    install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    docs: "https://antigravity.google/docs/cli/install/",
  },
  claude: {
    binaries: ["claude"],
    login: ["auth", "login"],
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    docs: "https://code.claude.com/docs/en/authentication",
  },
  cursor: {
    binaries: ["cursor-agent", "agent"],
    login: ["login"],
    install: "curl https://cursor.com/install -fsS | bash",
    docs: "https://cursor.com/docs/cli/overview",
  },
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function loginCommandText(id, bin) {
  const def = SUBSCRIPTIONS[id];
  const name = basename(bin || def?.binaries[0] || id);
  return def?.login.length ? `${name} ${def.login.join(" ")}` : name;
}

export function loginScript(id, bin) {
  const def = SUBSCRIPTIONS[id];
  const unset = SCRUBBED_ENV.source
    .replace(/^\^\(|\)\$$/g, "")
    .split("|")
    .filter((key) => /^[A-Z0-9_]+$/.test(key));
  const line = [shellQuote(bin), ...def.login].join(" ");
  return [
    "#!/bin/bash",
    `unset ${unset.join(" ")}`,
    `echo "Tabulect: ${loginCommandText(id, bin)}"`,
    line,
    `read -r -p "Return to Tabulect and press Re-check. / Tabulect'e dönüp Yeniden denetle'ye basın. [Enter] "`,
    "",
  ].join("\n");
}

async function firstBin(def) {
  for (const name of def.binaries) {
    const path = await which(name);
    if (path) return path;
  }
  return null;
}

function launchTerminal(scriptPath) {
  const attempts =
    process.platform === "darwin"
      ? [["open", ["-a", "Terminal", scriptPath]]]
      : process.platform === "linux"
        ? [
            ["x-terminal-emulator", ["-e", "bash", scriptPath]],
            ["gnome-terminal", ["--", "bash", scriptPath]],
            ["konsole", ["-e", "bash", scriptPath]],
            ["xterm", ["-e", "bash", scriptPath]],
          ]
        : [];
  return new Promise((resolve) => {
    const next = (index) => {
      if (index >= attempts.length) return resolve(false);
      const [cmd, args] = attempts[index];
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.once("error", () => next(index + 1));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    };
    next(0);
  });
}

export async function openLogin(id) {
  const def = SUBSCRIPTIONS[id];
  if (!def) {
    const error = new Error(`Unknown subscription "${id}".`);
    error.status = 400;
    throw error;
  }
  const bin = await firstBin(def);
  if (!bin) {
    const error = new Error(`Not installed. Install it first: ${def.install}`);
    error.status = 424;
    throw error;
  }
  const dir = join(tmpdir(), `tabulect-login-${process.pid}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const scriptPath = join(dir, `login-${id}.command`);
  await writeFile(scriptPath, loginScript(id, bin), { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  const command = loginCommandText(id, bin);
  if (!(await launchTerminal(scriptPath))) {
    return { opened: false, command };
  }
  return { opened: true, command };
}
