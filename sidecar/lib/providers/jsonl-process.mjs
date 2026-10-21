import { t } from "../i18n.mjs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { searchPath, subscriptionEnv } from "../util.mjs";

/** One process, many turns. No shell, terminal scraping, or EOF per prompt. */
export class JsonlProcess extends EventEmitter {
  constructor(bin, args, { cwd, timeoutMs = 240_000, rpc2 = false } = {}) {
    super();
    this.timeoutMs = timeoutMs;
    this.rpc2 = rpc2;
    this.pending = new Map();
    this.sequence = 0;
    this.stderr = "";
    this.buffer = "";
    this.dead = false;
    this.child = spawn(bin, args, {
      cwd, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      env: subscriptionEnv({ TERM: "xterm-256color", NO_COLOR: "1" }),
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-2000); });
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code, signal) => {
      this.fail(new Error(t('theAiConnectionClosed01', signal || code, this.stderr.trim())));
    });
  }

  get pid() { return this.child.pid; }
  ref(active = true) {
    for (const handle of [this.child, this.child.stdin, this.child.stdout, this.child.stderr]) {
      handle[active ? "ref" : "unref"]?.();
    }
  }

  read(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 12 * 1024 * 1024) {
      this.close(new Error(t('theAiProtocolReplyExceededThe')));
      return;
    }
    let at;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { this.close(new Error(t('theAiCliSentAnInvalid'))); return; }
      if (message.id != null && !message.method) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
      } else this.emit("message", message);
    }
  }

  send(message) {
    if (this.dead) throw new Error(t('theAiConnectionIsClosed'));
    this.child.stdin.write(`${JSON.stringify(this.rpc2 ? { jsonrpc: "2.0", ...message } : message)}\n`);
  }

  request(method, params) {
    if (this.dead) return Promise.reject(new Error(t('theAiConnectionIsClosed')));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error(t('theAiReplyTimedOut0', method))), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { this.close(error); }
    });
  }

  fail(error) {
    if (this.dead) return;
    this.dead = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit("closed", error);
  }

  close(error = new Error(t('theAiConnectionWasClosed'))) {
    this.fail(error);
    this.child.stdin.destroy();
    const kill = (signal) => {
      try {
        if (process.platform !== "win32" && this.pid) process.kill(-this.pid, signal);
        else this.child.kill(signal);
      } catch { /* already exited */ }
    };
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 1500);
    timer.unref();
    this.child.once("exit", () => clearTimeout(timer));
    this.ref(false);
  }
}
