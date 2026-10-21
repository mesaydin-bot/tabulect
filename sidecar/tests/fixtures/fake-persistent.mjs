#!/usr/bin/env node
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function serve(legacy) {
  const args = process.argv.slice(2);
  const kind = args.includes("app-server") ? "codex" : args.includes("acp") ? "kimi" : "antigravity";
  const send = (data) => process.stdout.write(JSON.stringify(data) + "\n");
  let sessionId = args.includes("--conversation") ? args[args.indexOf("--conversation") + 1] : "";
  const read = () => JSON.parse(readFileSync(`${sessionId}.json`, "utf8"));
  const create = () => { sessionId = randomUUID(); writeFileSync(`${sessionId}.json`, "[]"); };
  if (kind === "antigravity") {
    if (!sessionId) create();
    send({ event: "init", conversation_id: sessionId });
  }
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    const { method, params: p = {}, id } = message;
    if (process.env.FAKE_PROTOCOL_LOG) appendFileSync(process.env.FAKE_PROTOCOL_LOG, JSON.stringify({ pid: process.pid, method, ...message }) + "\n");
    const reply = (result) => send({ id, result });
    try {
      if (method === "initialize") { reply({ protocolVersion: 1 }); continue; }
      if (method === "initialized") continue;
      if (method === "thread/start" || method === "session/new") {
        create();
        reply(kind === "codex" ? { thread: { id: sessionId }, model: "default" } : { sessionId });
        continue;
      }
      if (method === "thread/resume" || method === "session/load") {
        sessionId = p.threadId || p.sessionId;
        read();
        // Replayed history must never appear in the next answer.
        if (kind === "kimi") send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD HISTORY" } } } });
        reply(kind === "codex" ? { thread: { id: sessionId }, model: "default" } : {});
        continue;
      }
      if (method === "session/set_model") { reply({}); continue; }
      if (method === "ignore") continue;
      const prompt = p.input?.[0]?.text || p.prompt?.[0]?.text || message.message?.content;
      if (!prompt) continue;
      if (prompt === "CRASH") process.exit(9);
      const history = read();
      let text = prompt === "RECALL" ? history.join("|") : prompt;
      if (legacy) {
        const result = spawnSync(process.execPath, [fileURLToPath(legacy), "exec"], { input: prompt, encoding: "utf8", env: process.env });
        if (result.status) throw new Error(result.stderr || "fake failure");
        text = result.stdout;
      }
      if (prompt === "EMPTY") text = "";
      if (prompt === "SLOW") await new Promise((resolve) => setTimeout(resolve, 100));
      history.push(prompt);
      writeFileSync(`${sessionId}.json`, JSON.stringify(history));
      if (kind === "codex") {
        reply({ turn: { id: "turn-1" } });
        send({ method: "item/completed", params: { threadId: sessionId, turnId: "turn-1", item: { id: "message-1", type: "agentMessage", text } } });
        send({ method: "turn/completed", params: { threadId: sessionId, turn: { id: "turn-1", status: "completed" } } });
      } else if (kind === "kimi") {
        send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
        reply({ stopReason: "end_turn" });
      } else send({ event: "result", result: { conversation_id: sessionId, status: "SUCCESS", response: text } });
    } catch (error) {
      if (kind === "antigravity") send({ event: "result", result: { conversation_id: sessionId, status: "ERROR", error: `unknown session or failure: ${error.message}` } });
      else send({ id, error: { code: -32000, message: `unknown session or failure: ${error.message}` } });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await serve();
