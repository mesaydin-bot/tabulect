import { t } from "../i18n.mjs";
import { JsonlProcess } from "./jsonl-process.mjs";
import { clearSessions, getSession, setSession, sessionWorkspace } from "./sessions.mjs";
import { normalizeModelId } from "./models.mjs";

const connections = new Map();
const queues = new Map();

function turnResult(wire, handler) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => wire.close(new Error(t('theAiReplyTimedOutThe'))), wire.timeoutMs);
    const onClosed = (error) => finish(error);
    const onMessage = (message) => {
      try { handler(message, finish); } catch (error) { finish(error); }
    };
    finish = (error, text) => {
      clearTimeout(timer);
      wire.off("closed", onClosed);
      wire.off("message", onMessage);
      if (error) reject(error); else resolve(text);
    };
    wire.on("closed", onClosed);
    wire.on("message", onMessage);
  });
  // Handlers may reject before the turn/start request finishes.
  promise.catch(() => {});
  return { promise, finish };
}

function answerServerRequest(wire, message, providerId) {
  if (message.id == null || !message.method) return;
  if (providerId === "kimi" && message.method === "session/request_permission") {
    wire.send({ id: message.id, result: { outcome: { outcome: "cancelled" } } });
  } else if (providerId === "codex" && /requestApproval$/.test(message.method)) {
    wire.send({ id: message.id, result: { decision: "decline" } });
  } else {
    wire.send({ id: message.id, error: { code: -32601, message: t('tabulectDoesNotSupportThisTool') } });
  }
}

async function connect(providerId, bin, model) {
  let entry = connections.get(providerId);
  // Antigravity selects its model at process startup. Reconnect to the SAME conversation.
  if (entry && (entry.wire.dead || entry.bin !== bin || (providerId === "antigravity" && entry.model !== model) || (providerId === "kimi" && entry.requestedModel && !model))) {
    entry.wire.close();
    connections.delete(providerId);
    entry = null;
  }
  if (entry) { entry.wire.ref(); return entry; }
  const saved = getSession(providerId);
  const cwd = saved?.cwd || await sessionWorkspace(providerId, "app");
  let args;
  if (providerId === "codex") args = ["app-server"];
  else if (providerId === "kimi") args = ["acp"];
  else args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mode", "plan",
    ...(saved?.id ? ["--conversation", saved.id] : []), ...(model ? ["--model", model] : [])];
  const wire = new JsonlProcess(bin, args, { cwd, rpc2: providerId === "kimi" });
  entry = { wire, bin, model: "", id: saved?.id || "", cwd, providerId };
  connections.set(providerId, entry);
  wire.on("message", (message) => answerServerRequest(wire, message, providerId));
  const remember = (id) => {
    if (!id) throw new Error(t('theCliDidNotReportA'));
    if (entry.id && entry.id !== id) throw new Error(t('theCliOpenedADifferentConversation'));
    entry.id = id;
    setSession(providerId, null, { id, cwd, continued: true });
  };
  entry.remember = remember;
  try {
    if (providerId === "codex") {
      await wire.request("initialize", { clientInfo: { name: "tabulect", title: "Tabulect", version: "0.1.0" } });
      wire.send({ method: "initialized" });
      const params = { cwd, approvalPolicy: "never", sandbox: "read-only" };
      const result = await wire.request(saved?.id ? "thread/resume" : "thread/start", saved?.id ? { ...params, threadId: saved.id } : params);
      remember(result.thread.id);
      entry.defaultModel = result.model;
    } else if (providerId === "kimi") {
      await wire.request("initialize", { protocolVersion: 1, clientInfo: { name: "tabulect", version: "0.1.0" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      const result = await wire.request(saved?.id ? "session/load" : "session/new", { cwd, mcpServers: [], ...(saved?.id ? { sessionId: saved.id } : {}) });
      remember(saved?.id || result.sessionId);
      entry.defaultModel = result?.models?.currentModelId;
    } else {
      entry.model = model;
      // init may arrive before the first turn. Persist its id immediately.
      wire.on("message", (message) => {
        if (message.event === "init") {
          try { remember(message.conversation_id); } catch (error) { wire.close(error); }
        }
      });
    }
    return entry;
  } catch (error) {
    wire.close();
    throw new Error(saved?.id ? t("theConversationCouldNotBeContinued", error.message) : t("theAiConnectionCouldNotBeEstablished", error.message));
  }
}

async function ask(entry, prompt, model) {
  const { wire, providerId, id } = entry;
  if (wire.dead) throw new Error(t('theAiConnectionIsClosedThe'));
  if (providerId === "kimi") {
    const selected = model || entry.defaultModel;
    if (selected && entry.model !== selected) {
      await wire.request("session/set_model", { sessionId: id, modelId: selected });
      entry.model = selected;
    }
    entry.requestedModel = model;
    let text = "";
    const onMessage = (message) => {
      const p = message.params;
      if (message.method === "session/update" && p?.sessionId === id && p.update?.sessionUpdate === "agent_message_chunk" && p.update.content?.type === "text") {
        text += p.update.content.text;
      }
    };
    wire.on("message", onMessage);
    try {
      const result = await wire.request("session/prompt", { sessionId: id, prompt: [{ type: "text", text: prompt }] });
      if (result.stopReason !== "end_turn") throw new Error(t('theKimiReplyDidNotComplete', result.stopReason));
      return text;
    } finally { wire.off("message", onMessage); }
  }
  if (providerId === "codex") {
    const messages = new Map();
    const turn = turnResult(wire, (event, finish) => {
      const p = event.params;
      if (p?.threadId !== id) return;
      if (event.method === "item/completed" && p.item?.type === "agentMessage") messages.set(p.item.id, p.item.text);
      if (event.method === "turn/completed") {
        if (p.turn.status !== "completed") finish(new Error(p.turn.error?.message || t('theCodexReplyDidNotComplete', p.turn.status)));
        else finish(null, [...messages.values()].join("\n\n"));
      }
    });
    try {
      await wire.request("turn/start", { threadId: id, input: [{ type: "text", text: prompt }], ...(model || entry.defaultModel ? { model: model || entry.defaultModel } : {}) });
      return await turn.promise;
    } catch (error) { turn.finish(error); throw error; }
  }
  const turn = turnResult(wire, (event, finish) => {
    if (event.event !== "result") return;
    const result = event.result;
    entry.remember(result.conversation_id);
    if (result.status !== "SUCCESS") finish(new Error(result.error || t('theAntigravityReplyDidNotComplete', result.status)));
    else finish(null, result.response);
  });
  try {
    wire.send({ event: "user", message: { content: prompt } });
    return await turn.promise;
  } catch (error) { turn.finish(error); throw error; }
}

export function completePersistent({ providerId, bin, prompt, model }) {
  const previous = queues.get(providerId) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    let entry;
    try {
      const normalized = normalizeModelId(model);
      entry = await connect(providerId, bin, normalized);
      const text = await ask(entry, prompt, normalized);
      if (!text?.trim()) throw new Error(t('theAiReturnedAnEmptyReply'));
      return text;
    } catch (error) {
      // Never automatically re-send an ambiguous turn or create a replacement chat.
      entry?.wire.close();
      throw error;
    } finally { entry?.wire.ref(false); }
  });
  queues.set(providerId, task);
  const cleanup = () => { if (queues.get(providerId) === task) queues.delete(providerId); };
  task.then(cleanup, cleanup);
  return task;
}

export function resetPersistentSessions({ providerId, documentId } = {}) {
  if (providerId ? queues.has(providerId) : queues.size) {
    const error = new Error(t('aNewConversationCannotBeOpened'));
    error.status = 409;
    throw error;
  }
  closePersistentSessions(providerId);
  clearSessions({ providerId, documentId });
}

export function closePersistentSessions(providerId) {
  for (const [key, entry] of connections) {
    if (providerId && providerId !== key) continue;
    entry.wire.close();
    connections.delete(key);
  }
}

export function connectionStatus() {
  return [...connections].map(([provider, entry]) => ({ provider, sessionId: entry.id, pid: entry.wire.dead ? null : entry.wire.pid, connected: !entry.wire.dead, busy: queues.has(provider) }));
}

process.once("exit", () => closePersistentSessions());
