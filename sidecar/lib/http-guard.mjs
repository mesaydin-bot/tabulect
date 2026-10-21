/**
 * Loopback request guard for the Tabulect sidecar.
 *
 * - Host allow-list (blocks DNS rebinding).
 * - Origin allow-list: only the Tauri webview and loopback dev origins.
 * - Requests flagged `Sec-Fetch-Site: cross-site` without an allowed Origin are refused.
 * - Per-launch random session token, required on every route except /health and /session.
 * - JSON-only bodies (multipart allowed on /ingest).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-tabulect-token";

export function createSessionToken(env = process.env) {
  const fromEnv = String(env.TABULECT_TOKEN || "").trim();
  if (/^[A-Za-z0-9_-]{32,128}$/.test(fromEnv)) return fromEnv;
  return randomBytes(32).toString("hex");
}

export function allowedOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname === "[::1]" ? "::1" : url.hostname;
    const loopback =
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "tauri.localhost";
    if (!loopback) return null;
    const okProtocol = url.protocol === "http:" || url.protocol === "https:" || url.protocol === "tauri:";
    if (!okProtocol) return null;
    return origin;
  } catch {
    return null;
  }
}

export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function sameToken(expected, received) {
  if (typeof received !== "string" || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

const OPEN_ROUTES = new Set(["/health", "/session"]);

/**
 * Returns null when the request may proceed, or { status, error } when it must be refused.
 */
export function checkRequest(req, { port, token, pathname, query }) {
  const host = String(req.headers.host || "");
  if (!allowedHosts(port).has(host)) {
    return { status: 403, error: "Only local loopback connections are allowed." };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigin(origin)) {
    return { status: 403, error: "Origin refused." };
  }
  if (origin === undefined && req.headers["sec-fetch-site"] === "cross-site") {
    return { status: 403, error: "Cross-site request refused." };
  }
  if (req.method === "OPTIONS") return null;
  if (OPEN_ROUTES.has(pathname) && req.method === "GET") return null;
  const presented = req.headers[TOKEN_HEADER] || (query && query.get("token")) || "";
  if (!sameToken(token, String(presented))) {
    return { status: 401, error: "Local session token required. Reload the app." };
  }
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    const type = String(req.headers["content-type"] || "").toLowerCase();
    const length = Number.parseInt(String(req.headers["content-length"] || "0"), 10) || 0;
    const hasBody = length > 0 || req.headers["transfer-encoding"] !== undefined;
    const json = type.startsWith("application/json");
    const multipart = type.startsWith("multipart/form-data") && pathname === "/ingest";
    if ((type && !json && !multipart) || (!type && hasBody)) {
      return { status: 415, error: "application/json required." };
    }
  }
  return null;
}
