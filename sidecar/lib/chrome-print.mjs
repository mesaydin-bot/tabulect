/**
 * Print preview HTML to PDF with a local Chrome/Chromium.
 * macOS app ships Chrome at /Applications/Google Chrome.app/...
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { isExecutable, pathExists, which } from "./util.mjs";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAC_CHROMIUM = "/Applications/Chromium.app/Contents/MacOS/Chromium";

export async function resolveChrome() {
  const named = [
    process.env.TABULECT_CHROME,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ].filter(Boolean);
  for (const candidate of named) {
    const resolved = candidate.includes("/") || candidate.includes("\\") ? candidate : await which(candidate);
    if (resolved && (await isExecutable(resolved))) return resolved;
  }
  for (const candidate of [MAC_CHROME, MAC_CHROMIUM]) {
    if (await isExecutable(candidate)) return candidate;
  }
  for (const name of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome"]) {
    const found = await which(name);
    if (found) return found;
  }
  return null;
}

function killTree(pid) {
  if (!pid) return;
  try {
    const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8", timeout: 800, stdio: ["ignore", "pipe", "ignore"] });
    for (const child of String(kids.stdout || "")
      .trim()
      .split(/\s+/)
      .filter((id) => /^\d+$/.test(id))) {
      killTree(Number(child));
    }
  } catch {
    /* ignore */
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function chromeArgs({ userDir, pdfPath, url, headerFlag }) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-component-update",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--user-data-dir=${userDir}`,
    `--crash-dumps-dir=${join(userDir, "crash")}`,
    `--print-to-pdf=${pdfPath}`,
    url,
  ];
  if (process.platform !== "win32") args.unshift("--no-sandbox");
  if (headerFlag) args.splice(-2, 0, headerFlag);
  return args;
}

export async function printHtmlToPdf(html, { chromePath, timeoutMs = 25_000 } = {}) {
  const bin = chromePath || (await resolveChrome());
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "tr-chrome-print-"));
  const htmlPath = join(dir, "preview.html");
  const pdfPath = join(dir, "preview.pdf");
  await writeFile(htmlPath, html, "utf8");
  const url = pathToFileURL(htmlPath).href;
  const headerFlags = ["--no-pdf-header-footer", "--print-to-pdf-no-header"];

  try {
    for (const headerFlag of headerFlags) {
      const args = chromeArgs({ userDir: dir, pdfPath, url, headerFlag });
      const buffer = await runChromePrint(bin, args, pdfPath, timeoutMs);
      if (buffer) return buffer;
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runChromePrint(bin, args, pdfPath, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CHROME_HEADLESS: "1" },
    });
    let stderr = "";
    let settled = false;
    const finish = async (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      killTree(child.pid);
      if (!ok) {
        resolve(null);
        return;
      }
      try {
        const buf = await readFile(pdfPath);
        resolve(buf.length > 20 && buf.subarray(0, 4).toString() === "%PDF" ? buf : null);
      } catch {
        resolve(null);
      }
    };
    const maybeDone = async () => {
      try {
        const info = await stat(pdfPath);
        if (info.size > 80) await finish(true);
      } catch {
        /* not yet */
      }
    };
    const timer = setTimeout(() => {
      void maybeDone().then(() => {
        if (!settled) void finish(false);
      });
    }, timeoutMs);
    const poll = setInterval(() => void maybeDone(), 150);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (/bytes written to file/i.test(stderr)) setTimeout(() => void maybeDone(), 80);
    });
    child.on("exit", () => void maybeDone().then(() => {
      if (!settled) void finish(false);
    }));
    child.on("error", () => void finish(false));
  });
}

function parseCmap(text) {
  const map = new Map();
  const hex = (value) => Number.parseInt(value, 16);
  const fromCmap = text.match(/begincmap[\s\S]*?endcmap/gi) || [];
  for (const cmap of fromCmap) {
    const charBlock = cmap.match(/beginbfchar([\s\S]*?)endbfchar/gi) || [];
    for (const block of charBlock) {
      for (const row of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(hex(row[1]), hex(row[2]));
      }
    }
    const rangeBlock = cmap.match(/beginbfrange([\s\S]*?)endbfrange/gi) || [];
    for (const block of rangeBlock) {
      for (const row of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const start = hex(row[1]);
        const end = hex(row[2]);
        let dest = hex(row[3]);
        for (let code = start; code <= end; code += 1) {
          map.set(code, dest);
          dest += 1;
        }
      }
    }
  }
  return map;
}

function inflatePdfStreams(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const src = data.toString("latin1");
  let match = re.exec(src);
  while (match) {
    const raw = Buffer.from(match[1], "latin1");
    try {
      out.push(inflateSync(raw).toString("latin1"));
    } catch {
      out.push(match[1]);
    }
    match = re.exec(src);
  }
  return out;
}

/** Best-effort Unicode from Chrome's tagged/ToUnicode PDFs. Fallback painter has no CMap. */
export function extractPdfUnicode(buffer) {
  const streams = inflatePdfStreams(buffer);
  const blob = streams.join("\n");
  const cmap = parseCmap(blob);
  const parts = [];
  for (const hex of blob.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)) {
    const raw = hex[1];
    let text = "";
    for (let i = 0; i < raw.length; i += 4) {
      const code = Number.parseInt(raw.slice(i, i + 4), 16);
      const mapped = cmap.has(code) ? cmap.get(code) : code;
      if (mapped) text += String.fromCodePoint(mapped);
    }
    if (text) parts.push(text);
  }
  return parts.join("");
}
