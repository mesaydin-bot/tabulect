/**
 * Conversation ids, separate from running CLI processes. The server persists these
 * so reconnecting never needs to invent a new chat. The three persistent providers
 * share one conversation across documents; legacy Cursor keeps its document scope.
 */
import { mkdir } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../store.mjs";

const sessions = new Map();
let storeFile;
export const PERSISTENT_PROVIDERS = new Set(["codex", "kimi", "antigravity"]);

// Enabled by the server, not by imports in tests or one-shot fill workers.
export function configureSessionStore(root = dataRoot()) {
  mkdirSync(root, { recursive: true });
  storeFile = join(root, "ai-sessions.json");
  try {
    const saved = JSON.parse(readFileSync(storeFile, "utf8"));
    if (!Array.isArray(saved)) throw new Error("Invalid AI session registry");
    sessions.clear();
    for (const { key, ...value } of saved) sessions.set(key, value);
  } catch (error) {
    if (error.code !== "ENOENT") throw error; // Never silently discard a conversation.
  }
}

function persist() {
  if (!storeFile) return;
  const temp = `${storeFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(listSessions()), { mode: 0o600 });
  renameSync(temp, storeFile);
}

export function sessionKey(providerId, documentId) {
  return `${String(providerId || "unknown")}:${PERSISTENT_PROVIDERS.has(providerId) ? "app" : String(documentId || "_")}`;
}

export function getSession(providerId, documentId) {
  return sessions.get(sessionKey(providerId, documentId)) || null;
}

export function setSession(providerId, documentId, session) {
  const key = sessionKey(providerId, documentId);
  if (!session) {
    sessions.delete(key);
    persist();
    return null;
  }
  const next = {
    id: String(session.id || "").trim(),
    continued: session.continued !== false,
    ...(session.cwd ? { cwd: session.cwd } : {}),
  };
  sessions.set(key, next);
  persist();
  return next;
}

export function clearSessions({ providerId, documentId } = {}) {
  if (providerId && documentId) {
    sessions.delete(sessionKey(providerId, documentId));
    persist();
    return;
  }
  if (providerId) {
    const prefix = `${providerId}:`;
    for (const key of [...sessions.keys()]) {
      if (key.startsWith(prefix)) sessions.delete(key);
    }
    persist();
    return;
  }
  sessions.clear();
  persist();
}

export function listSessions() {
  return [...sessions.entries()].map(([key, value]) => ({ key, ...value }));
}

export function extractSessionId(blob) {
  const text = String(blob || "");
  const patterns = [
    /"session_id"\s*:\s*"([^"]+)"/i,
    /"sessionId"\s*:\s*"([^"]+)"/i,
    /"chat_id"\s*:\s*"([^"]+)"/i,
    /"chatId"\s*:\s*"([^"]+)"/i,
    /"conversation_id"\s*:\s*"([^"]+)"/i,
    /"conversationId"\s*:\s*"([^"]+)"/i,
    /--resume(?:=|\s+)([A-Za-z0-9._:-]+)/,
    /kimi\s+-r\s+([A-Za-z0-9._:-]+)/,
    /session(?: id)?[:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1] && match[1] !== "-1") return match[1];
  }
  return "";
}

export function looksLikeResumeFailure(error) {
  const blob = String(error?.message || error || "").toLowerCase();
  return /resume|session|conversation|chat id|chatid|not found|unknown session|no such session|cannot find|invalid session/.test(
    blob,
  );
}

export async function sessionWorkspace(providerId, documentId) {
  const safeDoc = String(documentId || "app").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "app";
  const safeProv = String(providerId || "cli").replace(/[^A-Za-z0-9._-]+/g, "_") || "cli";
  const dir = join(dataRoot(), "sessions", safeProv, safeDoc);
  await mkdir(dir, { recursive: true });
  return dir;
}

function insertFlag(args, flag, value) {
  const next = Array.isArray(args) ? args.slice() : [];
  const existing = next.findIndex((part) => part === flag);
  if (existing >= 0) {
    if (value == null) return next;
    if (next[existing + 1] && !String(next[existing + 1]).startsWith("-")) {
      next[existing + 1] = value;
      return next;
    }
    next.splice(existing + 1, 0, value);
    return next;
  }
  let at = next.findIndex((part) => part === "-p" || part === "--print");
  at = at >= 0 ? at + 1 : 0;
  if (next[0] === "ask" || next[0] === "agent" || next[0] === "exec") {
    at = Math.max(at, 1);
  }
  if (value == null) next.splice(at, 0, flag);
  else next.splice(at, 0, flag, value);
  return next;
}

function applyOne(providerId, args, session) {
  const id = String(session?.id || "").trim();
  if (providerId === "cursor") {
    if (id) return insertFlag(args, "--resume", id);
    return insertFlag(args, "--continue");
  }
  if (providerId === "kimi") {
    // Never use -c here: Kimi treats -c as --command (the prompt).
    if (id) return ["--session", id, ...args];
    return ["--continue", ...args];
  }
  if (providerId === "codex") {
    const rest = args[0] === "exec" ? args.slice(1) : args;
    if (id) return ["exec", "resume", id, ...rest];
    return ["exec", "resume", "--last", ...rest];
  }
  if (providerId === "claude") {
    // Print mode continues a conversation with --resume <session_id> (or --continue in the same folder).
    if (id) return insertFlag(args, "--resume", id);
    return insertFlag(args, "--continue");
  }
  if (providerId === "antigravity") {
    if (id) return insertFlag(args, "--conversation", id);
    return insertFlag(args, "--continue");
  }
  return args;
}

export function applySessionFlags(providerId, patterns, session) {
  const list = Array.isArray(patterns) ? patterns : [];
  if (!session?.id && !session?.continued) {
    return list.map((pattern) => (Array.isArray(pattern) ? pattern.slice() : pattern));
  }
  return list.map((pattern) => applyOne(providerId, Array.isArray(pattern) ? pattern.slice() : [], session));
}
