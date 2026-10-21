import assert from "node:assert/strict";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { beforeEach, afterEach } from "node:test";
import { completePersistent, connectionStatus, closePersistentSessions, resetPersistentSessions } from "../lib/providers/persistent.mjs";
import { clearSessions, getSession, setSession, configureSessionStore } from "../lib/providers/sessions.mjs";
import { JsonlProcess } from "../lib/providers/jsonl-process.mjs";

const bin = fileURLToPath(new URL("./fixtures/fake-persistent.mjs", import.meta.url));
let root;
beforeEach(async () => {
  closePersistentSessions(); clearSessions();
  root = await mkdtemp(join(tmpdir(), "tr-persistent-"));
  process.env.TABULECT_DATA = root;
  await chmod(bin, 0o755);
});
afterEach(() => { closePersistentSessions(); clearSessions(); delete process.env.TABULECT_DATA; });

for (const providerId of ["codex", "kimi", "antigravity"]) {
  const ask = (prompt, model) => completePersistent({ providerId, bin, prompt, model });
  const status = () => connectionStatus().find((x) => x.provider === providerId);
  test(`${providerId}: same process and conversation; reconnect and explicit reset`, async () => {
    assert.equal(await ask("remember-742"), "remember-742");
    const first = status();
    assert.equal(await ask("RECALL"), "remember-742");
    assert.equal(status().pid, first.pid);
    assert.equal(getSession(providerId, "different-document").id, first.sessionId);
    closePersistentSessions();
    assert.match(await ask("RECALL"), /^remember-742\|RECALL$/);
    assert.notEqual(status().pid, first.pid);
    assert.equal(status().sessionId, first.sessionId);
    resetPersistentSessions({ providerId, documentId: "different-document" });
    assert.equal(getSession(providerId), null);
    assert.equal(await ask("fresh"), "fresh");
    assert.notEqual(status().sessionId, first.sessionId);
  });
  test(`${providerId}: serialize prompts; disallow reset while busy`, async () => {
    const one = ask("SLOW");
    const two = ask("RECALL");
    assert.throws(() => resetPersistentSessions({ providerId }), /while a reply is running/);
    assert.deepEqual(await Promise.all([one, two]), ["SLOW", "SLOW"]);
  });
  test(`${providerId}: crash keeps session; no automatic retry`, async () => {
    await ask("before-crash");
    const first = status();
    await assert.rejects(ask("CRASH"), /connection closed/);
    assert.equal(getSession(providerId).id, first.sessionId);
    assert.equal(await ask("RECALL"), "before-crash");
    assert.equal(status().sessionId, first.sessionId);
  });
  test(`${providerId}: unknown session never becomes a fresh conversation`, async () => {
    setSession(providerId, null, { id: "missing", cwd: root });
    await assert.rejects(ask("hello"), /unknown session/);
    assert.equal(getSession(providerId).id, "missing");
  });
  test(`${providerId}: empty output errors without forgetting context`, async () => {
    await assert.rejects(ask("EMPTY"), /empty reply/);
    const id = getSession(providerId).id;
    assert.equal(await ask("RECALL"), "EMPTY");
    assert.equal(getSession(providerId).id, id);
  });
}

test("Antigravity model switch reconnects to the same conversation", async () => {
  await completePersistent({ providerId: "antigravity", bin, prompt: "remember", model: "first" });
  const first = connectionStatus()[0];
  const text = await completePersistent({ providerId: "antigravity", bin, prompt: "RECALL", model: "second" });
  assert.equal(text, "remember");
  assert.equal(connectionStatus()[0].sessionId, first.sessionId);
  assert.notEqual(connectionStatus()[0].pid, first.pid);
});

test("timeout closes process and rejects all pending requests", async () => {
  const wire = new JsonlProcess(bin, ["app-server"], { cwd: root, timeoutMs: 40 });
  await assert.rejects(wire.request("ignore", {}), /timed out/);
  assert.equal(wire.dead, true);
  await assert.rejects(wire.request("initialize", {}), /connection is closed/);
});

test("session ids survive a registry reload", async () => {
  configureSessionStore(root);
  setSession("kimi", null, { id: "durable-id", cwd: root });
  configureSessionStore(root);
  assert.equal(getSession("kimi", "other-document").id, "durable-id");
});
