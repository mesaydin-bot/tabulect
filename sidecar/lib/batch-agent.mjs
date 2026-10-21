/**
 * Isolated per-batch fill agent. The document engine forks this so several
 * subscription CLIs can run at once without sharing the HTTP process.
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isHardProviderError } from "./fill.mjs";

const WORKER = fileURLToPath(new URL("./fill-worker.mjs", import.meta.url));

let batchAgentSpawnCount = 0;

export function getBatchAgentSpawnCount() {
  return batchAgentSpawnCount;
}

export function resetBatchAgentSpawnCount() {
  batchAgentSpawnCount = 0;
}

/**
 * Nested fill-worker forks hang on macOS before they invoke the provider
 * (busy:true, 0 CPU children, no kimi). Parallelism is mapPool(fillSchema)
 * inside the already-isolated continue/ingest worker.
 */
export function batchAgentsEnabled() {
  return false;
}

function drain(stream) {
  stream?.on("data", () => {});
  stream?.on("error", () => {});
}

/**
 * Run one schema batch in a child fill-worker. Resolves to rows (possibly
 * empty on a transient miss). Hard provider errors reject.
 */
export function spawnBatchAgent({
  provider,
  chunks,
  tableLocale,
  dataRoot,
  startIndex = 0,
  timeoutMs = 200_000,
  model,
} = {}) {
  if (!chunks?.length) return Promise.resolve([]);
  if (String(process.env.TABULECT_FILL_WORKER || "") === "1") {
    return Promise.reject(
      new Error("nested batch fill-worker is forbidden; inline fillSchema in the isolated worker"),
    );
  }
  batchAgentSpawnCount += 1;
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], {
      env: { ...process.env, TABULECT_FILL_WORKER: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let settled = false;
    const finish = (rows, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && isHardProviderError(error)) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve(Array.isArray(rows) ? rows : []);
      }
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
      }, 250);
    };
    const timer = setTimeout(() => finish([], new Error("batch agent timed out")), timeoutMs);
    child.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "rows") {
        finish(msg.rows, msg.error || null);
        return;
      }
      if (msg.type === "crash") {
        finish([], new Error(String(msg.error || "batch worker crash")));
      }
    });
    child.on("exit", () => {
      setTimeout(() => finish([]), 80);
    });
    child.on("error", () => finish([]));
    drain(child.stdout);
    drain(child.stderr);
    const payload = {
      kind: "batch",
      provider,
      tableLocale,
      dataRoot: dataRoot || null,
      startIndex,
      chunks,
      model: model || "",
    };
    let sent = false;
    const sendOnce = () => {
      if (sent || !child.connected) return;
      sent = true;
      const ok = child.send(payload);
      if (ok === false) finish([], new Error("batch agent ipc backpressured"));
    };
    child.on("spawn", sendOnce);
    sendOnce();
  });
}
