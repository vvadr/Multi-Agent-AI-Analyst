/**
 * Typed client for the Multi-Agent AI Analyst backend.
 *
 * This is the ONLY place the frontend should reach out over the network. The
 * backend publishes a versioned OpenAPI + SSE contract (see
 * docs/IMPLEMENTATION_SCOPE.md); the frontend never calls Postgres, Qdrant,
 * Gemini, or storage directly.
 *
 * Errors surfaced from here are deliberately generic. Backend `detail` text and
 * provider error strings are never propagated — each operation maps the HTTP
 * status onto fixed local copy and keeps the `X-Request-ID` for log
 * correlation. Response bodies are validated by the parsers in `runs.ts` and
 * `documents.ts` before any caller sees them.
 */

import { apiUrl, apiV1Url } from "./config";
import {
  MAX_DOCUMENT_SIZE_LABEL,
  SUPPORTED_FORMATS_LABEL,
  parseUploadedDocument,
  type UploadedDocument,
} from "./documents";
import { parseReadinessReport, type ReadinessReport } from "./readiness";
import {
  isRunEventType,
  parseRunCreated,
  parseRunDetail,
  type RunCreated,
  type RunDetail,
  type RunEventType,
} from "./runs";
import { parseSseBuffer } from "./sse";

export type {
  ComponentReadiness,
  ReadinessComponent,
  ReadinessReport,
} from "./readiness";
export type { Citation, RunDetail, RunEventType, RunStatus } from "./runs";
export type { UploadedDocument } from "./documents";

/** Shape returned by `GET /healthz`. */
export interface HealthStatus {
  status: "ok";
}

/**
 * A progress event from `GET /v1/runs/{id}/events`.
 *
 * The payload is intentionally dropped at this boundary. Backend events carry
 * internal routing decisions and source hints; discarding them here makes it
 * structurally impossible for that text to reach the UI.
 */
export interface RunEvent {
  type: RunEventType;
}

const REQUEST_ID_HEADER = "X-Request-ID";

/** Default ceiling for a single request, so the UI can never hang forever. */
export const DEFAULT_TIMEOUT_MS = 8000;

/** Uploads index synchronously (chunk + embed + store), so they get longer. */
export const UPLOAD_TIMEOUT_MS = 60_000;

const UNREACHABLE_MESSAGE = "Cannot reach the backend API.";

/** Shown when the demo API is disabled or the run has expired from memory. */
const DEMO_DISABLED_MESSAGE =
  "This backend is not serving the local demo API.";

export class ApiError extends Error {
  /**
   * @param status HTTP status, or 0 when the request never completed
   *   (network failure, timeout, DNS, CORS).
   * @param requestId `X-Request-ID` from the response, when one was received.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function requestIdOf(response: Response): string | undefined {
  return response.headers.get(REQUEST_ID_HEADER) ?? undefined;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Re-throw an `ApiError` with copy chosen for this operation.
 *
 * Status 0 already carries a safe transport message, so it passes through; the
 * request id is always preserved.
 */
function mapApiError(
  error: unknown,
  messages: Readonly<Record<number, string>>,
  fallback: string,
): never {
  if (!(error instanceof ApiError)) {
    throw new ApiError(fallback, 0);
  }
  if (error.status === 0) throw error;
  throw new ApiError(
    messages[error.status] ?? fallback,
    error.status,
    error.requestId,
  );
}

interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Read a response body defensively.
 *
 * `text()` rejects when the body stream fails part-way through — a dropped
 * connection mid-read. Without this the rejection would escape as a raw
 * TypeError instead of an `ApiError`, and the UI would fall through to its
 * generic "unexpected" branch.
 */
async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new ApiError(
      "The connection dropped before the response finished.",
      response.status,
      requestIdOf(response),
    );
  }
}

/**
 * `fetch` with a timeout, normalizing every transport failure into an
 * `ApiError` with status 0 so callers handle one error type.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: FetchOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    // Deliberately opaque: DNS, CORS, and TLS failures must not leak detail.
    throw new ApiError(UNREACHABLE_MESSAGE, 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

interface RequestOptions extends FetchOptions {
  /** Short-lived bearer access token, once the API requires one. */
  token?: string;
  /** JSON request body; serialized automatically. */
  json?: unknown;
  method?: string;
}

interface JsonResponse {
  parsed: unknown;
  status: number;
  requestId?: string;
}

/** Perform a JSON request and return the envelope, so callers keep the status. */
async function sendJson(
  url: string,
  options: RequestOptions = {},
): Promise<JsonResponse> {
  const { token, json, method, signal, timeoutMs } = options;

  const headers = new Headers({ Accept: "application/json" });
  if (json !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    },
    { signal, timeoutMs },
  );

  const raw = await readBody(response);
  const parsed = raw ? safeJsonParse(raw) : undefined;
  const requestId = requestIdOf(response);

  if (!response.ok) {
    throw new ApiError(
      `Request failed (${response.status}).`,
      response.status,
      requestId,
    );
  }
  if (parsed === undefined) {
    throw new ApiError(
      "The backend returned an unreadable response.",
      response.status,
      requestId,
    );
  }

  return { parsed, status: response.status, requestId };
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { parsed } = await sendJson(url, options);
  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* Operations                                                         */
/* ------------------------------------------------------------------ */

export function getHealth(options: FetchOptions = {}): Promise<HealthStatus> {
  return request<HealthStatus>(apiUrl("/healthz"), options);
}

/**
 * Fetch `GET /readyz`.
 *
 * The backend answers 503 when any dependency is unavailable, but still sends a
 * complete readiness body. That is expected application state, not a transport
 * failure, so 200 and 503 are both parsed and returned. Any other status, a
 * malformed body, or a structure that does not match the contract becomes an
 * `ApiError`.
 */
export async function getReadiness(
  options: FetchOptions = {},
): Promise<ReadinessReport> {
  const response = await fetchWithTimeout(
    apiUrl("/readyz"),
    { headers: { Accept: "application/json" } },
    options,
  );

  const requestId = requestIdOf(response);

  if (response.status !== 200 && response.status !== 503) {
    throw new ApiError(
      `Readiness check failed (${response.status}).`,
      response.status,
      requestId,
    );
  }

  const raw = await readBody(response);
  const report = parseReadinessReport(safeJsonParse(raw));
  if (!report) {
    throw new ApiError(
      "The backend returned an unexpected readiness response.",
      response.status,
      requestId,
    );
  }

  return report;
}

const CREATE_RUN_MESSAGES: Readonly<Record<number, string>> = {
  404: DEMO_DISABLED_MESSAGE,
  422: "That question could not be accepted. Try rephrasing it.",
  429: "The demo is already running an analysis. Try again in a moment.",
  503:
    "The analyst services are unavailable right now. This is a backend or " +
    "provider availability problem, not a problem with your documents.",
};

/** `POST /v1/runs` — accepted with 202 while the run executes in the background. */
export async function createRun(
  question: string,
  options: FetchOptions = {},
): Promise<RunCreated> {
  let envelope: JsonResponse;
  try {
    envelope = await sendJson(apiV1Url("/runs"), {
      method: "POST",
      json: { question },
      ...options,
    });
  } catch (error) {
    return mapApiError(error, CREATE_RUN_MESSAGES, "The run could not be started.");
  }

  const run = parseRunCreated(envelope.parsed);
  if (!run) {
    throw new ApiError(
      "The backend returned an unexpected run response.",
      envelope.status,
      envelope.requestId,
    );
  }
  return run;
}

const GET_RUN_MESSAGES: Readonly<Record<number, string>> = {
  404: "That run is no longer available.",
  422: "That run reference is not valid.",
};

/** `GET /v1/runs/{id}` — status, and the answer plus citations once complete. */
export async function getRun(
  runId: string,
  options: FetchOptions = {},
): Promise<RunDetail> {
  let envelope: JsonResponse;
  try {
    envelope = await sendJson(
      apiV1Url(`/runs/${encodeURIComponent(runId)}`),
      options,
    );
  } catch (error) {
    return mapApiError(error, GET_RUN_MESSAGES, "The run could not be loaded.");
  }

  const detail = parseRunDetail(envelope.parsed);
  if (!detail) {
    throw new ApiError(
      "The backend returned an unexpected run response.",
      envelope.status,
      envelope.requestId,
    );
  }
  return detail;
}

/**
 * Fixed copy per upload status.
 *
 * 422 covers every extraction failure the backend can hit — a malformed PDF, a
 * broken Office archive, an undecodable text file, a password-protected PDF, a
 * document with no readable text. Its `detail` is never shown, so one message
 * has to name the plausible causes without claiming which one occurred.
 */
const UPLOAD_MESSAGES: Readonly<Record<number, string>> = {
  404: DEMO_DISABLED_MESSAGE,
  413: `That file is larger than the ${MAX_DOCUMENT_SIZE_LABEL} limit.`,
  415: `Unsupported file type. Choose a ${SUPPORTED_FORMATS_LABEL} file.`,
  422:
    "That file could not be read. It may be corrupted, password-protected, " +
    "or contain no extractable text — password-protected PDFs are not supported.",
  503:
    "Document services are unavailable right now. This is a backend or " +
    "provider availability problem, not a problem with your file.",
};

export interface UploadOptions {
  /** Fraction of bytes sent, 0–1. Only fires while the request body uploads. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * `POST /v1/documents` — multipart upload of one supported document.
 *
 * Uses `XMLHttpRequest` rather than `fetch`: only XHR reports request-body
 * upload progress, which the UI needs. A 201 means indexing already finished,
 * so there is no status to poll afterwards.
 */
export function uploadDocument(
  file: File,
  { onProgress, signal, timeoutMs = UPLOAD_TIMEOUT_MS }: UploadOptions = {},
): Promise<UploadedDocument> {
  return new Promise<UploadedDocument>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("The upload was cancelled.", 0));
      return;
    }

    const body = new FormData();
    body.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.open("POST", apiV1Url("/documents"));
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Accept", "application/json");

    if (onProgress) {
      xhr.upload?.addEventListener("progress", (event: ProgressEvent) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      });
    }

    xhr.addEventListener("load", () => {
      cleanup();
      const requestId =
        xhr.getResponseHeader(REQUEST_ID_HEADER) ?? undefined;

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            UPLOAD_MESSAGES[xhr.status] ?? "The upload failed.",
            xhr.status,
            requestId,
          ),
        );
        return;
      }

      const document = parseUploadedDocument(safeJsonParse(xhr.responseText));
      if (!document) {
        reject(
          new ApiError(
            "The backend returned an unexpected upload response.",
            xhr.status,
            requestId,
          ),
        );
        return;
      }
      resolve(document);
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new ApiError(UNREACHABLE_MESSAGE, 0));
    });
    xhr.addEventListener("timeout", () => {
      cleanup();
      reject(new ApiError("The upload timed out.", 0));
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new ApiError("The upload was cancelled.", 0));
    });

    signal?.addEventListener("abort", onAbort);
    xhr.send(body);
  });
}

/* ------------------------------------------------------------------ */
/* Streaming run events (Server-Sent Events)                          */
/* ------------------------------------------------------------------ */

export interface StreamHandlers {
  onEvent: (event: RunEvent) => void;
  /** Called for transport and protocol failures, never for a caller abort. */
  onError?: (error: ApiError) => void;
  /** Called when the server closes the stream normally. */
  onClose?: () => void;
}

/**
 * Consume `GET /v1/runs/{id}/events` as an SSE stream.
 *
 * Uses `fetch` + a stream reader rather than the native `EventSource` so
 * headers can be attached later if the endpoint becomes authenticated. No
 * timeout is applied: the stream is long-lived by design and ends when the run
 * reaches a terminal state.
 *
 * Unknown event names are ignored rather than surfaced, so a new backend event
 * type can never render as unlabelled progress. Returns an abort function;
 * calling it closes the stream silently.
 */
export function streamRunEvents(
  runId: string,
  handlers: StreamHandlers,
): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(
        apiV1Url(`/runs/${encodeURIComponent(runId)}/events`),
        {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        },
      );

      if (!response.ok || !response.body) {
        throw new ApiError(
          "The run event stream could not be opened.",
          response.status,
          response.headers.get(REQUEST_ID_HEADER) ?? undefined,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseBuffer(buffer);
        buffer = rest;

        for (const frame of frames) {
          if (isRunEventType(frame.event)) {
            handlers.onEvent({ type: frame.event });
          }
        }
      }
      handlers.onClose?.();
    } catch (error) {
      // A caller abort (cancel or unmount) is not a failure.
      if (controller.signal.aborted) return;
      handlers.onError?.(
        error instanceof ApiError
          ? error
          : new ApiError("The run event stream ended unexpectedly.", 0),
      );
    }
  })();

  return () => controller.abort();
}
