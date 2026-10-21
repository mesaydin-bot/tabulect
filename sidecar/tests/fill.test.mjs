import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  claimFill,
  DEFAULT_FILL_STALL_MS,
  FILL_HEARTBEAT_MS,
  fillPct,
  fillProgressMessage,
  isAutofillPaused,
  isHardProviderError,
  isEmptyFillError,
  isUnrecoverableFillMiss,
  isPartialFill,
  isTransientProviderError,
  liveFillJobId,
  pidAlive,
  releaseFill,
  isFillKillReason,
  documentFillLimits,
  tightenFillLimits,
  clearFillLimits,
  stallMs,
  unfilledChunks,
} from "../lib/fill.mjs";
import { descendantCount, delay, inFlightCliCount } from "../lib/util.mjs";

test("unfilledChunks skips chunks that already have a row", () => {
  const doc = {
    chunks: [
      { id: "c-001", text: "a", page: 1, start: 0, end: 1 },
      { id: "c-002", text: "b", page: 1, start: 1, end: 2 },
      { id: "c-003", text: "c", page: 1, start: 2, end: 3 },
    ],
    rows: [{ id: "r-001", chunkId: "c-001" }],
  };
  assert.deepEqual(
    unfilledChunks(doc).map((c) => c.id),
    ["c-002", "c-003"],
  );
  assert.equal(isPartialFill(doc), true);
  doc.rows.push({ id: "r-002", chunkId: "c-002" }, { id: "r-003", chunkId: "c-003" });
  assert.equal(isPartialFill(doc), false);
});

test("hard vs transient provider errors", () => {
  assert.equal(isHardProviderError(new Error("Kimi is installed but not logged in.")), true);
  assert.equal(isHardProviderError(new Error("Codex was not found (codex).")), true);
  assert.equal(isTransientProviderError(new Error("timed out")), true);
  assert.equal(isTransientProviderError(new Error("rate limit")), true);
  assert.equal(isTransientProviderError(new Error("empty output")), true);
  assert.equal(isHardProviderError(new Error("empty output")), false);
  const emptyFill = new Error("provider returned no new rows (328/1139 leftover chunks remain)");
  emptyFill.code = "EMPTY_FILL";
  assert.equal(isEmptyFillError(emptyFill), true);
  assert.equal(isTransientProviderError(emptyFill), false);
  assert.equal(isHardProviderError(emptyFill), false);
  assert.equal(
    isHardProviderError(new Error("Kimi failed. empty output No table data was fabricated.")),
    false,
  );
  assert.equal(isTransientProviderError(new Error("Workspace Trust: pass --trust")), true);
  assert.equal(isTransientProviderError(new Error("Error: TERM=dumb / not a TTY")), true);
  assert.equal(
    isUnrecoverableFillMiss(new Error("provider produced no valid rows — refusing to invent data")),
    false,
  );
  assert.equal(isUnrecoverableFillMiss(new Error("Kimi failed. empty output No table data was fabricated.")), true);
  assert.equal(
    isUnrecoverableFillMiss(
      new Error("Codex did not return valid schema JSON after 3 attempts. Last error: provider output is not valid JSON"),
    ),
    true,
  );
  assert.equal(isUnrecoverableFillMiss(new Error("timed out")), true);
  assert.equal(isUnrecoverableFillMiss(new Error("rate limit")), false);
  assert.equal(isUnrecoverableFillMiss(new Error("Kimi is installed but not logged in.")), false);
  assert.equal(isUnrecoverableFillMiss(emptyFill), false);
});

test("fill progress uses chunk counts, not a bare batch index", () => {
  assert.equal(fillProgressMessage(328, 1139), "328/1139 chunks");
  assert.match(fillProgressMessage(19, 1139, "3/143 batch"), /19\/1139 chunks/);
  assert.ok(fillPct(328, 1139) >= 74);
  assert.ok(fillPct(1139, 1139) <= 99);
});

test("defaults leave room for a slow subscription CLI first row", () => {
  const prev = process.env.TABULECT_FILL_STALL_MS;
  delete process.env.TABULECT_FILL_STALL_MS;
  try {
    assert.ok(DEFAULT_FILL_STALL_MS >= 180_000);
    assert.equal(stallMs(), DEFAULT_FILL_STALL_MS);
    assert.ok(FILL_HEARTBEAT_MS * 30 < DEFAULT_FILL_STALL_MS);
  } finally {
    if (prev == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev;
  }
});

test("ghost fill locks from a dead worker pid do not block continue", () => {
  assert.equal(pidAlive(999999993), false);
  claimFill("how-to-read", "4b242e04-dead", { finished: false }, { pid: 999999993 });
  assert.equal(liveFillJobId("how-to-read"), null);
});

test("a fill lock with zero heartbeat is not busy forever", async () => {
  const { spawn } = await import("node:child_process");
  const prev = process.env.TABULECT_FILL_STALL_MS;
  process.env.TABULECT_FILL_STALL_MS = "25";
  const hung = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    assert.ok(hung.pid > 0);
    assert.equal(pidAlive(hung.pid), true);
    claimFill(
      "doc-stall-zero-progress",
      "job-stall",
      { finished: false },
      { pid: hung.pid, lastProgressAt: Date.now() - 5_000 },
    );
    assert.equal(liveFillJobId("doc-stall-zero-progress"), null);
    const start = Date.now();
    while (pidAlive(hung.pid) && Date.now() - start < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(pidAlive(hung.pid), false);
    assert.ok(stallMs() === 25);
  } finally {
    try {
      hung.kill("SIGKILL");
    } catch {
      /* gone */
    }
    if (prev == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev;
  }
});

test("heartbeats keep the lock even when rows have not grown yet", async () => {
  const { spawn } = await import("node:child_process");
  const prev = process.env.TABULECT_FILL_STALL_MS;
  process.env.TABULECT_FILL_STALL_MS = "25";
  const hung = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    claimFill(
      "doc-busy-zero-progress",
      "job-nested-hang",
      { finished: false },
      {
        pid: hung.pid,
        lastProgressAt: Date.now(),
        lastGrowthAt: Date.now() - 5_000,
        filled: 328,
        clis: 0,
      },
    );
    assert.equal(liveFillJobId("doc-busy-zero-progress"), "job-nested-hang");
    assert.equal(pidAlive(hung.pid), true);
  } finally {
    try {
      hung.kill("SIGKILL");
    } catch {
      /* gone */
    }
    releaseFill("doc-busy-zero-progress", "job-nested-hang");
    if (prev == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev;
  }
});

test("a live provider CLI keeps the lock while a batch has not yet grown rows", () => {
  const prev = process.env.TABULECT_FILL_STALL_MS;
  process.env.TABULECT_FILL_STALL_MS = "25";
  try {
    claimFill(
      "doc-slow-cli",
      "job-slow-cli",
      { finished: false },
      {
        pid: process.pid,
        lastProgressAt: Date.now(),
        lastGrowthAt: Date.now() - 5_000,
        filled: 328,
        clis: 2,
      },
    );
    assert.equal(liveFillJobId("doc-slow-cli"), "job-slow-cli");
  } finally {
    releaseFill("doc-slow-cli", "job-slow-cli");
    if (prev == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev;
  }
});

test("OS children of the fill-worker keep the lock when IPC clis is 0", async () => {
  const { spawn, spawnSync } = await import("node:child_process");
  const prev = process.env.TABULECT_FILL_STALL_MS;
  process.env.TABULECT_FILL_STALL_MS = "50";
  const worker = spawn(
    process.execPath,
    [
      "-e",
      `require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
setInterval(() => {}, 1000);`,
    ],
    { stdio: "ignore" },
  );
  try {
    const start = Date.now();
    while (descendantCount(worker.pid) < 1 && Date.now() - start < 2000) {
      await delay(20);
    }
    assert.ok(descendantCount(worker.pid) >= 1, "fill-worker must have a CLI child");
    assert.ok(inFlightCliCount(worker.pid, 0) >= 1);
    claimFill(
      "doc-desc-cli",
      "job-desc-cli",
      { finished: false },
      {
        pid: worker.pid,
        lastProgressAt: Date.now(),
        lastGrowthAt: Date.now() - 5_000,
        filled: 328,
        clis: 0,
      },
    );
    assert.equal(liveFillJobId("doc-desc-cli"), "job-desc-cli");
  } finally {
    try {
      spawnSync("pkill", ["-9", "-P", String(worker.pid)], { stdio: "ignore" });
    } catch {
      /* best effort */
    }
    try {
      worker.kill("SIGKILL");
    } catch {
      /* gone */
    }
    releaseFill("doc-desc-cli", "job-desc-cli");
    if (prev == null) delete process.env.TABULECT_FILL_STALL_MS;
    else process.env.TABULECT_FILL_STALL_MS = prev;
  }
});

test("SIGKILL is a kill reason and tightens the next fill wave", () => {
  assert.equal(isFillKillReason("fill worker killed (SIGKILL)"), true);
  assert.equal(isFillKillReason("forced worker crash"), false);
  clearFillLimits("doc-oom");
  assert.equal(documentFillLimits("doc-oom"), null);
  tightenFillLimits("doc-oom");
  assert.deepEqual(documentFillLimits("doc-oom"), { batch: 1, concurrency: 1 });
  clearFillLimits("doc-oom");
});

test("autofill.pause is honored and left in place", () => {
  const root = mkdtempSync(join(tmpdir(), "tabular-autofill-"));
  const pause = join(root, "autofill.pause");
  const prev = process.env.TABULECT_AUTOFILL;
  try {
    process.env.TABULECT_AUTOFILL = "1";
    assert.equal(isAutofillPaused(root), false);
    writeFileSync(pause, "paused\n");
    assert.equal(isAutofillPaused(root), true);
    assert.equal(existsSync(pause), true);
  } finally {
    if (prev == null) delete process.env.TABULECT_AUTOFILL;
    else process.env.TABULECT_AUTOFILL = prev;
  }
});
