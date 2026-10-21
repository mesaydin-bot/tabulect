import { initialUiLang } from "../locale/i18n";
import type {
  Bookmark,
  Document,
  OutputArtifact,
  PromptTemplate,
  SourceType,
  TableLocale,
} from "../types/document";
import { isHardFillError, migrateDocument } from "../types/document";

/** Local tabulect service on loopback. */
export const BASE_URL = (import.meta.env.DEV && import.meta.env.VITE_READER_BACKEND_URL) || "http://127.0.0.1:8755";

export type ProviderId = "codex" | "kimi" | "antigravity" | "cursor" | "claude";

export const PROVIDER_IDS: ProviderId[] = ["codex", "kimi", "antigravity", "cursor", "claude"];

type PhraseJob = { jobId: string; status: "pending" | "ready" | "error"; ranges?: Array<{ start: number; end: number }>; error?: string };

export async function prepareReadingPhrases(opts: { text: string; provider: ProviderId; model?: string; retry?: boolean }, signal: AbortSignal) {
  const read = async (path: string, init?: RequestInit): Promise<PhraseJob> => {
    signal.throwIfAborted();
    const res = await backendFetch(path, { ...init, signal });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || (initialUiLang() === "tr" ? `Öbek hazırlama: ${res.status}` : `Phrase preparation: ${res.status}`));
    return body;
  };
  let job = await read("/reading/phrases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  const deadline = Date.now() + 300_000;
  while (job.status === "pending") {
    if (Date.now() > deadline) throw new Error((initialUiLang() === "tr" ? "Öbek hazırlama zaman aşımına uğradı; tekrar deneyin." : "Phrase preparation timed out; try again."));
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 700);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
    job = await read(`/reading/phrases/${job.jobId}`);
  }
  signal.throwIfAborted();
  if (job.status !== "ready" || !job.ranges?.length) throw new Error(job.error || (initialUiLang() === "tr" ? "Öbek hazırlanamadı." : "Phrases could not be prepared."));
  return job.ranges;
}

export type HealthResponse = {
  ok: true;
  service: "tabulect";
  ocr?: {
    ocrmypdf: boolean;
    tesseract: boolean;
    poppler: boolean;
    languages: string;
  };
  features?: {
    instruct?: string;
    exportXlsx?: boolean;
    documentDelete?: boolean;
    continueFill?: boolean;
    schemaFill?: boolean;
    bookmarks?: boolean;
    tableAi?: boolean;
    richExport?: boolean;
    folders?: boolean;
    notes?: boolean;
    corpus?: boolean;
  };
};

export type SubscriptionState = "connected" | "login_required" | "api_key" | "unknown" | "missing";

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  available: boolean;
  loggedIn: boolean;
  error: string | null;
  status?: SubscriptionState;
  install?: string | null;
  docs?: string | null;
  loginCommand?: string | null;
};

export type IngestPhase =
  | "queued"
  | "extract"
  | "ocr"
  | "chunk"
  | "schema"
  | "done"
  | "error";

export type IngestEvent = {
  jobId: string;
  phase: IngestPhase;
  pct: number;
  message: string;
  documentId: string | null;
  error: string | null;
};

export type IngestJobStatus = IngestEvent & {
  finished: boolean;
  events: IngestEvent[];
};

export type BackendStartResult = {
  running: boolean;
  message: string;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function probeBackendFromShell(): Promise<{ online: boolean; message: string; body: string }> {
  if (!isTauriRuntime()) {
    const ok = await probeHealth(1500);
    return { online: ok, message: ok ? "backend online" : "backend offline", body: "" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("probe_backend");
}

export type BackendHttpResponse = {
  status: number;
  body: string;
};

export function stripCurlNoise(message: string): string {
  const raw = String(message || "").trim();
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return raw.replace(/^curl:\s*\(\d+\)\s*/i, "").trim() || raw;
}

export function readBackendError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) {
      return stripCurlNoise(rec.error);
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return stripCurlNoise(payload);
  }
  return fallback;
}

let sessionToken: Promise<string> | null = null;

/** Per-launch token issued by the local sidecar; required on every route except /health. */
export function getSessionToken(refresh = false): Promise<string> {
  if (!sessionToken || refresh) {
    sessionToken = fetch(`${BASE_URL}/session`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`session ${res.status}`))))
      .then((body: { token?: string }) => String(body.token || ""))
      .catch((error) => {
        sessionToken = null;
        throw error;
      });
  }
  return sessionToken;
}

/** fetch() against the sidecar with the session token attached; retries once on a stale token. */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (refresh: boolean) => {
    const headers = new Headers(init.headers || {});
    headers.set("X-Tabulect-Token", await getSessionToken(refresh));
    // Interface language for sidecar progress and error messages (never sent anywhere else).
    if (!headers.has("X-Tabulect-Lang")) headers.set("X-Tabulect-Lang", initialUiLang());
    return fetch(url, { ...init, headers });
  };
  const res = await send(false);
  return res.status === 401 ? send(true) : res;
}

async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isTauriRuntime()) {
    return authedFetch(`${BASE_URL}${path}`, init);
  }
  const method = (init.method || "GET").toUpperCase();
  const isMultipart = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (isMultipart) {
    return authedFetch(`${BASE_URL}${path}`, init);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const body = typeof init.body === "string" ? init.body : null;
  try {
    const langPath = `${path}${path.includes("?") ? "&" : "?"}lang=${initialUiLang()}`;
    const result = await invoke<BackendHttpResponse | string>("backend_request", {
      method,
      path: langPath,
      body,
    });
    if (typeof result === "string") {
      return new Response(result, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const status = Number(result?.status) || 200;
    const text = result?.body ?? "";
    const trimmed = text.trimStart();
    const contentType =
      trimmed.startsWith("{") || trimmed.startsWith("[") ? "application/json" : "text/plain";
    return new Response(text, { status, headers: { "Content-Type": contentType } });
  } catch (error) {
    const message = stripCurlNoise(error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export class JobLostError extends Error {
  constructor(message = "job-lost") {
    super(message);
    this.name = "JobLostError";
  }
}

export async function getIngestStatus(jobId: string): Promise<IngestJobStatus> {
  const res = await backendFetch(`/ingest/${encodeURIComponent(jobId)}`);
  if (res.status === 404) throw new JobLostError();
  if (!res.ok) {
    throw new Error(`ingest status ${res.status}`);
  }
  return (await res.json()) as IngestJobStatus;
}

async function emitEvent(
  event: IngestEvent,
  onEvent?: (event: IngestEvent) => void | Promise<void>,
) {
  await onEvent?.(event);
}

/** Empty output / trust / TTY are resume signals, not a stranded book. */
function finalizeJobEvent(event: IngestEvent): IngestEvent {
  if (event.phase === "error" && !isHardFillError(event.error || event.message)) {
    return { ...event, phase: "done", error: null };
  }
  return event;
}

export async function waitIngestFromShell(
  jobId: string,
  onEvent?: (event: IngestEvent) => void | Promise<void>,
): Promise<IngestEvent> {
  if (!isTauriRuntime()) {
    return watchIngestEvents(jobId, onEvent);
  }
  return pollIngestStatus(jobId, onEvent);
}

async function watchIngestEvents(
  jobId: string,
  onEvent?: (event: IngestEvent) => void | Promise<void>,
): Promise<IngestEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let chain = Promise.resolve();
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stop();
      fn();
    };
    const stop = subscribeIngestEvents(
      jobId,
      (event) => {
        chain = chain
          .then(async () => {
            await emitEvent(event, onEvent);
            if (event.phase === "done" || event.phase === "error") {
              finish(() => {
                const final = finalizeJobEvent(event);
                if (final.phase === "error") reject(new Error(final.error || final.message));
                else resolve(final);
              });
            }
          })
          .catch((error) => finish(() => reject(error)));
      },
      () => finish(() => reject(new JobLostError("ingest stream failed"))),
    );
  });
}

async function pollIngestStatus(
  jobId: string,
  onEvent?: (event: IngestEvent) => void | Promise<void>,
): Promise<IngestEvent> {
  let seen = 0;
  let last: IngestEvent | null = null;
  let misses = 0;
  while (true) {
    try {
      const status = await getIngestStatus(jobId);
      misses = 0;
      const fresh = status.events.slice(seen);
      seen = status.events.length;
      for (const event of fresh) {
        last = event;
        await emitEvent(event, onEvent);
      }
      if (status.finished) {
        if (!last) throw new Error("ingest produced no events");
        const final = finalizeJobEvent(last);
        if (final.phase === "error") throw new Error(final.error || final.message);
        return final;
      }
    } catch (error) {
      if (error instanceof JobLostError) throw error;
      misses += 1;
      if (misses >= 8) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await backendFetch("/health");
  if (!res.ok) {
    throw new Error(`health ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export async function probeHealth(timeoutMs = 800): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await backendFetch("/health");
    if (!res.ok) return false;
    const data = (await res.json()) as Partial<HealthResponse>;
    return data.ok === true && data.service === "tabulect";
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function openProviderLogin(id: ProviderId): Promise<{ opened: boolean; command: string }> {
  const res = await backendFetch(`/providers/${encodeURIComponent(id)}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await res.json().catch(() => ({}))) as { opened?: boolean; command?: string; error?: string };
  if (!res.ok) throw new Error(readBackendError(body, `login ${res.status}`));
  return { opened: Boolean(body.opened), command: String(body.command || "") };
}

export async function listProviders(refresh = false): Promise<ProviderStatus[]> {
  const res = await backendFetch(refresh ? "/providers?refresh=1" : "/providers");
  if (!res.ok) throw new Error(`providers ${res.status}`);
  const body = (await res.json()) as { providers: ProviderStatus[] };
  return body.providers;
}

export async function postIngest(opts: {
  file: File;
  provider: ProviderId;
  tableLocale: TableLocale;
  model?: string;
}): Promise<{ jobId: string }> {
  const form = new FormData();
  form.set("file", opts.file, opts.file.name);
  form.set("provider", opts.provider);
  form.set("tableLocale", opts.tableLocale);
  if (opts.model != null) form.set("model", opts.model);
  const res = await authedFetch(`${BASE_URL}/ingest`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json()) as { jobId?: string; error?: string };
  if (!res.ok || !body.jobId) {
    throw new Error(body.error || `ingest ${res.status}`);
  }
  return { jobId: body.jobId };
}

export function subscribeIngestEvents(
  jobId: string,
  onEvent: (event: IngestEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  let source: EventSource | null = null;
  let closed = false;
  void getSessionToken().then((token) => {
    if (closed) return;
    // EventSource cannot set headers; the token travels as a query parameter instead.
    source = new EventSource(
      `${BASE_URL}/ingest/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`,
    );
    attach(source);
  }, (error) => onError?.(new ErrorEvent("error", { error })));
  const attach = (source: EventSource) => {
  source.onmessage = (message) => {
    const data = JSON.parse(message.data) as IngestEvent;
    onEvent(data);
  };
  if (onError) {
    source.onerror = onError;
  }
  };
  return () => {
    closed = true;
    source?.close();
  };
}

export type LibraryFolder = {
  id: string;
  name: string;
  createdAt?: string;
};

export type LibraryDocument = {
  id: string;
  title: string;
  sourceType: SourceType;
  tableLocale: TableLocale;
  rowCount: number;
  chunkCount: number;
  bookmarkCount?: number;
  outputCount?: number;
  folderId?: string | null;
  partialFill?: boolean;
  lastProvider?: string | null;
  updatedAt: string | null;
};

export type DocumentListItem = LibraryDocument;

export type LibrarySnapshot = {
  documents: LibraryDocument[];
  folders: LibraryFolder[];
};

function mapLibraryDocument(d: LibraryDocument): LibraryDocument {
  return {
    ...d,
    rowCount: typeof d.rowCount === "number" ? d.rowCount : 0,
    chunkCount: typeof d.chunkCount === "number" ? d.chunkCount : 0,
    bookmarkCount: typeof d.bookmarkCount === "number" ? d.bookmarkCount : 0,
    outputCount: typeof d.outputCount === "number" ? d.outputCount : 0,
    folderId: d.folderId || null,
    partialFill: d.partialFill === true,
    updatedAt: d.updatedAt ?? null,
  };
}

export async function listDocuments(): Promise<LibraryDocument[]> {
  const snap = await listLibrary();
  return snap.documents;
}

export async function listLibrary(): Promise<LibrarySnapshot> {
  const res = await backendFetch("/documents");
  if (!res.ok) {
    throw new Error(`documents ${res.status}`);
  }
  const body = (await res.json()) as { documents?: LibraryDocument[]; folders?: LibraryFolder[] };
  return {
    documents: (Array.isArray(body.documents) ? body.documents : []).map(mapLibraryDocument),
    folders: Array.isArray(body.folders) ? body.folders : [],
  };
}

export async function createFolder(name: string): Promise<LibrarySnapshot> {
  const res = await backendFetch("/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `folder ${res.status}`));
  return listLibrary();
}

export async function renameFolder(id: string, name: string): Promise<LibrarySnapshot> {
  const res = await backendFetch(`/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `folder ${res.status}`));
  return listLibrary();
}

export async function deleteFolder(id: string): Promise<LibrarySnapshot> {
  const res = await backendFetch(`/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `folder ${res.status}`));
  return listLibrary();
}

export async function moveDocumentFolder(documentId: string, folderId: string | null): Promise<LibrarySnapshot> {
  const res = await backendFetch(`/documents/${encodeURIComponent(documentId)}/folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `folder ${res.status}`));
  return listLibrary();
}

export async function getDocument(id: string): Promise<Document> {
  const res = await backendFetch(`/documents/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(readBackendError(payload, `document ${res.status}`));
  }
  return migrateDocument((await res.json()) as Document);
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await backendFetch(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(readBackendError(payload, `delete ${res.status}`));
  }
}

export async function renameDocument(id: string, title: string): Promise<Document> {
  const res = await backendFetch(`/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const payload = (await res.json().catch(() => ({}))) as Document & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || `rename ${res.status}`);
  }
  return migrateDocument(payload);
}

export async function postIngestPath(opts: {
  filePath: string;
  filename?: string;
  provider: ProviderId;
  tableLocale: TableLocale;
  model?: string;
}): Promise<{ jobId: string }> {
  const res = await backendFetch("/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: opts.filePath,
      filename: opts.filename,
      provider: opts.provider,
      tableLocale: opts.tableLocale,
      model: opts.model,
    }),
  });
  const body = (await res.json()) as { jobId?: string; error?: string };
  if (!res.ok || !body.jobId) {
    throw new Error(body.error || `ingest ${res.status}`);
  }
  return { jobId: body.jobId };
}

export type ContinueFillResponse = {
  jobId: string | null;
  documentId: string;
  continued?: boolean;
  complete?: boolean;
  busy?: boolean;
  deferred?: boolean;
  error?: string;
};

export async function postContinue(opts: {
  documentId: string;
  provider?: ProviderId;
  tableLocale?: TableLocale;
  model?: string;
  force?: boolean;
}): Promise<ContinueFillResponse> {
  const res = await backendFetch(`/documents/${encodeURIComponent(opts.documentId)}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: opts.provider,
      tableLocale: opts.tableLocale,
      model: opts.model,
      force: opts.force === true,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as ContinueFillResponse & { error?: string };
  if (!res.ok && res.status !== 202) {
    throw new Error(readBackendError(payload, `continue ${res.status}`));
  }
  return payload;
}

export type InstructRequest = {
  documentId: string;
  instruction: string;
  tableLocale: "tr" | "en";
  provider?: ProviderId;
  model?: string;
};

export type InstructResponse = {
  ok: true;
  document: Document | null;
  applied: string[];
  jobId?: string;
  ui?: {
    columnVisibility?: Record<string, boolean>;
  };
};

/** POST /instruct — side-effect only. No conversation store. */
export async function postInstruct(
  body: InstructRequest,
  timeoutMs = 20_000,
): Promise<InstructResponse> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await backendFetch("/instruct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as InstructResponse & { error?: string };
    if (!res.ok || payload.ok !== true) {
      throw new Error(readBackendError(payload, `instruct ${res.status}`));
    }
    if (payload.document) {
      payload.document = migrateDocument(payload.document);
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

export type PickedDocument = {
  path: string;
  name: string;
};

export async function pickDocumentFromShell(): Promise<PickedDocument | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PickedDocument | null>("pick_document");
}

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function downloadDocumentXlsx(opts: {
  id?: string;
  document?: Document;
  columns?: string[];
  filename?: string;
}): Promise<void> {
  const columns = opts.columns?.filter(Boolean);
  let res: Response;
  if (opts.id) {
    const query = columns?.length ? `?columns=${encodeURIComponent(columns.join(","))}` : "";
    res = await authedFetch(`${BASE_URL}/documents/${encodeURIComponent(opts.id)}/export.xlsx${query}`);
  } else if (opts.document) {
    res = await authedFetch(`${BASE_URL}/export.xlsx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: opts.document, columns }),
    });
  } else {
    throw new Error("document id is required");
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(readBackendError(payload, `export ${res.status}`));
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const named = disposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  const fallback = opts.filename || `${opts.document?.title || opts.id || "tablo"}.xlsx`;
  triggerDownload(blob, named ? decodeURIComponent(named[1]) : fallback);
}

export async function saveLiveDocument(doc: Document): Promise<Document> {
  const res = await backendFetch("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document: doc }),
  });
  const payload = (await res.json().catch(() => ({}))) as Document & { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `save ${res.status}`));
  return migrateDocument(payload);
}

export async function addBookmark(
  documentId: string,
  body: { text: string; chunkId: string; start: number; end: number; page: number | null; spans?: Bookmark["spans"] },
): Promise<{ bookmark: Bookmark; document: Document }> {
  const res = await backendFetch(`/documents/${encodeURIComponent(documentId)}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    bookmark?: Bookmark;
    document?: Document;
    error?: string;
  };
  if (!res.ok || !payload.bookmark || !payload.document) {
    throw new Error(readBackendError(payload, `bookmark ${res.status}`));
  }
  return { bookmark: payload.bookmark, document: migrateDocument(payload.document) };
}

export async function reorderBookmarks(documentId: string, ids: string[]): Promise<Document> {
  const res = await backendFetch(`/documents/${encodeURIComponent(documentId)}/bookmarks/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const payload = (await res.json().catch(() => ({}))) as { document?: Document; error?: string };
  if (!res.ok || !payload.document) {
    throw new Error(readBackendError(payload, `bookmark reorder ${res.status}`));
  }
  return migrateDocument(payload.document);
}

export async function deleteBookmark(documentId: string, bookmarkId: string): Promise<Document> {
  const res = await backendFetch(
    `/documents/${encodeURIComponent(documentId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    { method: "DELETE" },
  );
  const payload = (await res.json().catch(() => ({}))) as { document?: Document; error?: string };
  if (!res.ok || !payload.document) {
    throw new Error(readBackendError(payload, `bookmark delete ${res.status}`));
  }
  return migrateDocument(payload.document);
}

/** Built-in prompts are returned in the interface language (English by default). */
function templateLangQuery(): string {
  return `lang=${initialUiLang()}`;
}

export async function resetTemplate(id: string) {
  const res = await backendFetch(`/templates/${encodeURIComponent(id)}/reset?${templateLangQuery()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = (await res.json().catch(() => ({}))) as { templates?: PromptTemplate[]; error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `template ${res.status}`));
  return payload.templates || [];
}

export async function listTemplates(): Promise<PromptTemplate[]> {
  const res = await backendFetch(`/templates?${templateLangQuery()}`);
  if (!res.ok) throw new Error(`templates ${res.status}`);
  const body = (await res.json()) as { templates?: PromptTemplate[] };
  return Array.isArray(body.templates) ? body.templates : [];
}

export async function upsertTemplate(template: Partial<PromptTemplate> & { name?: string; body?: string }) {
  const res = await backendFetch(
    template.id ? `/templates/${encodeURIComponent(template.id)}?${templateLangQuery()}` : `/templates?${templateLangQuery()}`,
    {
      method: template.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    },
  );
  const payload = (await res.json().catch(() => ({}))) as { templates?: PromptTemplate[]; error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `template ${res.status}`));
  return payload.templates || [];
}

export async function deleteTemplate(id: string) {
  const res = await backendFetch(`/templates/${encodeURIComponent(id)}?${templateLangQuery()}`, { method: "DELETE" });
  const payload = (await res.json().catch(() => ({}))) as { templates?: PromptTemplate[]; error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `template ${res.status}`));
  return payload.templates || [];
}

export type TableAiRequest = {
  documentId: string;
  provider: ProviderId;
  model?: string;
  tableLocale: TableLocale;
  templateId?: string;
  instruction?: string;
  selection?: { text: string };
  bookmarkIds?: string[];
  allBookmarks?: boolean;
  mentionIds?: string[];
  source?: "instruction";
  append?: boolean;
  baseContent?: string;
  /** Language of the built-in prompt templates (follows the interface language). */
  promptLang?: "tr" | "en";
};

export async function postTableAi(body: TableAiRequest): Promise<{ jobId: string; documentId: string }> {
  const res = await backendFetch("/table-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptLang: initialUiLang(), ...body }),
  });
  const payload = (await res.json().catch(() => ({}))) as { jobId?: string; documentId?: string; error?: string };
  if (!res.ok || !payload.jobId) {
    throw new Error(readBackendError(payload, `table-ai ${res.status}`));
  }
  return { jobId: payload.jobId, documentId: payload.documentId || body.documentId };
}

export async function getCliSessions(): Promise<Array<{ key: string; id: string }>> {
  const res = await backendFetch("/sessions");
  if (!res.ok) throw new Error(`session ${res.status}`);
  const payload = await res.json();
  return payload.sessions || [];
}

export async function resetCliSession(opts: { provider?: ProviderId; documentId?: string } = {}) {
  const res = await backendFetch("/sessions/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || payload.ok !== true) {
    throw new Error(readBackendError(payload, `session ${res.status}`));
  }
}

export async function exportOutput(opts: {
  format: "md" | "html" | "pdf" | "docx" | "xlsx";
  title: string;
  content: string;
  filename?: string;
}): Promise<void> {
  const res = await authedFetch(`${BASE_URL}/output/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(readBackendError(payload, `export ${res.status}`));
  }
  const blob = await res.blob();
  const fallback = opts.filename || `${opts.title || "cikti"}.${opts.format}`;
  triggerDownload(blob, fallback);
}

export async function saveOutputFile(opts: {
  format: "md" | "html" | "pdf" | "docx" | "xlsx";
  title: string;
  content: string;
  directory?: string;
}): Promise<{ path: string; filename: string }> {
  const res = await backendFetch("/output/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const payload = (await res.json().catch(() => ({}))) as { path?: string; filename?: string; error?: string };
  if (!res.ok || !payload.path) {
    throw new Error(readBackendError(payload, `save ${res.status}`));
  }
  return { path: payload.path, filename: payload.filename || "file" };
}

export type AppSettings = {
  exportDir: string;
  appearance?: {
    theme?: string;
    ink?: string;
    paper?: string;
    mark?: string;
    lineHeight?: number;
    paragraphGap?: number;
    fontSize?: number;
    fontFamily?: string;
  };
};

export async function getSettings(): Promise<AppSettings> {
  const res = await backendFetch("/settings");
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return (await res.json()) as AppSettings;
}

export async function patchSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const res = await backendFetch("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  });
  const payload = (await res.json().catch(() => ({}))) as AppSettings & { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, `settings ${res.status}`));
  return payload;
}

export function latestOutput(doc: Document | null | undefined): OutputArtifact | null {
  return doc?.outputs?.[0] ?? null;
}

export type NoteFolder = {
  id: string;
  name: string;
  createdAt?: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotesSnapshot = {
  notes: Note[];
  folders: NoteFolder[];
};

function mapNote(raw: Partial<Note> & { id: string }): Note {
  return {
    id: raw.id,
    title: raw.title || "",
    body: typeof raw.body === "string" ? raw.body : "",
    folderId: raw.folderId || null,
    createdAt: raw.createdAt || "",
    updatedAt: raw.updatedAt || "",
  };
}

async function readNotesSnapshot(res: Response, fallback: string): Promise<NotesSnapshot> {
  const payload = (await res.json().catch(() => ({}))) as NotesSnapshot & { error?: string };
  if (!res.ok) throw new Error(readBackendError(payload, fallback));
  return {
    notes: Array.isArray(payload.notes) ? payload.notes.map((item) => mapNote(item)) : [],
    folders: Array.isArray(payload.folders) ? payload.folders : [],
  };
}

export async function listNotes(): Promise<NotesSnapshot> {
  const res = await backendFetch("/notes");
  return readNotesSnapshot(res, `notes ${res.status}`);
}

export async function createNote(body: { title?: string; body?: string; folderId?: string | null }): Promise<{ note: Note } & NotesSnapshot> {
  const res = await backendFetch("/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { note?: Note; notes?: Note[]; folders?: NoteFolder[]; error?: string };
  if (!res.ok || !payload.note) throw new Error(readBackendError(payload, `note ${res.status}`));
  return {
    note: mapNote(payload.note),
    notes: Array.isArray(payload.notes) ? payload.notes.map((item) => mapNote(item)) : [],
    folders: Array.isArray(payload.folders) ? payload.folders : [],
  };
}

export async function getNote(id: string): Promise<Note> {
  const res = await backendFetch(`/notes/${encodeURIComponent(id)}`);
  const payload = (await res.json().catch(() => ({}))) as { note?: Note; error?: string };
  if (!res.ok || !payload.note) throw new Error(readBackendError(payload, `note ${res.status}`));
  return mapNote(payload.note);
}

export async function patchNote(
  id: string,
  body: { title?: string; body?: string; folderId?: string | null },
): Promise<{ note: Note } & NotesSnapshot> {
  const res = await backendFetch(`/notes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { note?: Note; notes?: Note[]; folders?: NoteFolder[]; error?: string };
  if (!res.ok || !payload.note) throw new Error(readBackendError(payload, `note ${res.status}`));
  return {
    note: mapNote(payload.note),
    notes: Array.isArray(payload.notes) ? payload.notes.map((item) => mapNote(item)) : [],
    folders: Array.isArray(payload.folders) ? payload.folders : [],
  };
}

export async function deleteNote(id: string): Promise<NotesSnapshot> {
  const res = await backendFetch(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readNotesSnapshot(res, `note ${res.status}`);
}

export async function createNoteFolder(name: string): Promise<NotesSnapshot> {
  const res = await backendFetch("/note-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readNotesSnapshot(res, `note-folder ${res.status}`);
}

export async function renameNoteFolder(id: string, name: string): Promise<NotesSnapshot> {
  const res = await backendFetch(`/note-folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readNotesSnapshot(res, `note-folder ${res.status}`);
}

export async function deleteNoteFolder(id: string): Promise<NotesSnapshot> {
  const res = await backendFetch(`/note-folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readNotesSnapshot(res, `note-folder ${res.status}`);
}

export async function moveNoteFolder(noteId: string, folderId: string | null): Promise<NotesSnapshot> {
  const res = await backendFetch(`/notes/${encodeURIComponent(noteId)}/folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  return readNotesSnapshot(res, `note-folder ${res.status}`);
}

export async function exportNoteFile(opts: {
  format: "md" | "html" | "pdf" | "docx" | "xlsx";
  title: string;
  content: string;
  filename?: string;
}): Promise<void> {
  return exportOutput(opts);
}

export async function startBackendFromShell(): Promise<BackendStartResult> {
  if (!isTauriRuntime()) {
    return { running: false, message: "browser preview — start sidecar separately" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BackendStartResult>("start_backend");
}
