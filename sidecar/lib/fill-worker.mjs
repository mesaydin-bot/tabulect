#!/usr/bin/env node
/**
 * Isolated schema-fill worker. Registers IPC first, then lazy-imports work.
 * kind=ingest|continue — one document job; fillDocument inlines parallel CLI.
 * kind=batch — leftover primitive; not used from inside a fill worker.
 */
process.env.TABULECT_FILL_WORKER = "1";

let heartbeatTimer = null;

function send(msg) {
  return new Promise((resolve) => {
    try {
      if (typeof process.send === "function") {
        process.send(msg, () => resolve());
        return;
      }
    } catch {
      /* parent gone */
    }
    resolve();
  });
}

process.on("uncaughtException", (error) => {
  void send({ type: "crash", error: error instanceof Error ? error.message : String(error) }).finally(
    () => process.exit(1),
  );
});
process.on("unhandledRejection", (error) => {
  void send({ type: "crash", error: error instanceof Error ? error.message : String(error) }).finally(
    () => process.exit(1),
  );
});

function attachIpc(job, snapshotJob) {
  job.listeners.add({
    write(chunk) {
      const line = String(chunk)
        .split("\n")
        .filter((row) => row.startsWith("data:"))
        .map((row) => row.slice(5).trim())
        .join("");
      if (!line) return;
      try {
        send({ type: "event", event: JSON.parse(line) });
      } catch {
        /* ignore malformed */
      }
    },
    end() {
      send({ type: "finished", snapshot: snapshotJob(job) });
    },
  });
}

async function startHeartbeats() {
  stopHeartbeats();
  const { FILL_HEARTBEAT_MS } = await import("./fill.mjs");
  const { inFlightCliCount, liveCliCount } = await import("./util.mjs");
  const beat = () => send({ type: "heartbeat", clis: inFlightCliCount(process.pid, liveCliCount()) });
  heartbeatTimer = setInterval(() => {
    void beat();
  }, FILL_HEARTBEAT_MS);
  await beat();
}

function stopHeartbeats() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

process.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;
  await startHeartbeats();
  if (process.env.TABULECT_WORKER_CRASH === "1") {
    stopHeartbeats();
    await send({ type: "crash", error: "forced worker crash" });
    process.exit(2);
    return;
  }
  try {
    if (msg.kind === "batch") {
      const { fillSchema } = await import("./providers/index.mjs");
      const { isHardProviderError } = await import("./fill.mjs");
      try {
        const rows = await fillSchema({
          providerId: msg.provider,
          chunks: Array.isArray(msg.chunks) ? msg.chunks : [],
          tableLocale: msg.tableLocale,
          startIndex: Number(msg.startIndex) || 0,
          model: msg.model,
        });
        await send({ type: "rows", rows: Array.isArray(rows) ? rows : [] });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (isHardProviderError(error)) {
          await send({ type: "crash", error: text });
          process.exit(1);
          return;
        }
        await send({ type: "rows", rows: [], error: text });
      }
      process.exit(0);
      return;
    }
    if (msg.kind === "continue") {
      const { runContinueJob } = await import("./continue.mjs");
      const { createFillJob, snapshotJob } = await import("./ingest.mjs");
      const job = createFillJob({
        documentId: msg.documentId,
        provider: msg.provider,
        tableLocale: msg.tableLocale,
        model: msg.model,
      });
      job.jobId = msg.jobId;
      attachIpc(job, snapshotJob);
      await runContinueJob(job, { dataRoot: msg.dataRoot || undefined });
      process.exit(0);
      return;
    }
    if (msg.kind === "ingest") {
      const { createIngestJob, runIngestJob, snapshotJob } = await import("./ingest.mjs");
      const { readFile } = await import("node:fs/promises");
      let buffer = Buffer.alloc(0);
      if (msg.uploadPath) buffer = await readFile(msg.uploadPath);
      else if (msg.text) buffer = Buffer.from(String(msg.text), "utf8");
      const job = createIngestJob({
        filename: msg.filename,
        mime: msg.mime,
        buffer,
        provider: msg.provider,
        tableLocale: msg.tableLocale,
        model: msg.model,
      });
      job.jobId = msg.jobId;
      attachIpc(job, snapshotJob);
      await runIngestJob(job, { dataRoot: msg.dataRoot || undefined });
      process.exit(0);
      return;
    }
    await send({ type: "crash", error: `unknown worker kind ${msg.kind}` });
    process.exit(1);
  } catch (error) {
    await send({ type: "crash", error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  } finally {
    stopHeartbeats();
  }
});
