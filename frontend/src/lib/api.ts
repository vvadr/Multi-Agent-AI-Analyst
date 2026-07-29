/**
 * Typed client for the Multi-Agent AI Analyst backend.
 *
 * This is the ONLY place the frontend should reach out over the network. The
 * backend publishes a versioned OpenAPI + SSE contract (see
 * docs/API_CONTRACT.md); the frontend never calls Postgres, Qdrant, Gemini, or
 * storage directly.
 *
 * Transport, the bearer token, and the single-refresh-single-retry policy for
 * 401s all live in `http.ts`; the authentication endpoints live in
 * `auth-api.ts`. What remains here is the analyst surface: health, readiness,
 * documents, and runs.
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
  parseDocumentList,
  parseUploadedDocument,
  type UploadedDocument,
} from "./documents";
import {
  ApiError,
  REQUEST_ID_HEADER,
  SESSION_EXPIRED_MESSAGE,
  UNREACHABLE_MESSAGE,
  UPLOAD_TIMEOUT_MS,
  authorizedJson,
  fetchWithTimeout,
  mapApiError,
  readBody,
  refreshSession,
  requestIdOf,
  safeJsonParse,
  sendJson,
  withRefreshRetry,
  type FetchOptions,
  type JsonResponse,
} from "./http";
import { parseReadinessReport, type ReadinessReport } from "./readiness";
import {
  isRunEventType,
  parseRunCreated,
  parseRunDetail,
  type RunCreated,
  type RunDetail,
  type RunEventType,
} from "./runs";
import { getAccessToken } from "./session";
import { parseSseBuffer } from "./sse";

export {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  SESSION_EXPIRED_MESSAGE,
  UPLOAD_TIMEOUT_MS,
} from "./http";
export type { FetchOptions } from "./http";
export type {
  ComponentReadiness,
  ReadinessComponent,
  ReadinessReport,
} from "./readiness";
export type { Citation, RunDetail, RunEventType, RunStatus } from "./runs";
export type { DocumentStatus, UploadedDocument } from "./documents";
export type { AuthUser, IssuedSession, UserRole } from "./auth";

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

/** Shown when the endpoint is not served, or the run is gone from the backend. */
const RUN_UNAVAILABLE_MESSAGE = "That analysis service is not available on this backend.";

/* ------------------------------------------------------------------ */
/* Public probes                                                      */
/* ------------------------------------------------------------------ */

/**
 * `GET /healthz` and `GET /readyz` are unauthenticated operational probes, so
 * they carry no token and are never subject to the refresh policy.
 */
export async function getHealth(options: FetchOptions = {}): Promise<HealthStatus> {
  const { parsed } = await sendJson(apiUrl("/healthz"), options);
  return parsed as HealthStatus;
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
    { headers: { Accept: "application/json" }, credentials: "omit" },
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

/* ------------------------------------------------------------------ */
/* Runs                                                               */
/* ------------------------------------------------------------------ */

const CREATE_RUN_MESSAGES: Readonly<Record<number, string>> = {
  403: "Your account does not have access to this workspace.",
  404: RUN_UNAVAILABLE_MESSAGE,
  422: "That question could not be accepted. Try rephrasing it.",
  429: "An analysis is already running. Try again in a moment.",
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
    envelope = await authorizedJson(apiV1Url("/runs"), {
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

/**
 * `GET /v1/runs` — the workspace's runs, newest first.
 *
 * This is what makes a run recoverable without any client-side storage: on
 * load the workspace asks the backend whether anything is still in flight,
 * rather than remembering across a reload it might not survive.
 */
export async function listRuns(options: FetchOptions = {}): Promise<RunCreated[]> {
  let envelope: JsonResponse;
  try {
    envelope = await authorizedJson(apiV1Url("/runs"), options);
  } catch (error) {
    return mapApiError(error, CREATE_RUN_MESSAGES, "Your runs could not be loaded.");
  }

  const source = envelope.parsed;
  if (typeof source !== "object" || source === null || !Array.isArray((source as { runs?: unknown }).runs)) {
    throw new ApiError(
      "The backend returned an unexpected run list.",
      envelope.status,
      envelope.requestId,
    );
  }

  const runs: RunCreated[] = [];
  for (const entry of (source as { runs: unknown[] }).runs) {
    const parsed = parseRunCreated(entry);
    // One malformed entry must not discard the rest of the history.
    if (parsed) runs.push(parsed);
  }
  return runs;
}

const GET_RUN_MESSAGES: Readonly<Record<number, string>> = {
  403: "Your account does not have access to that run.",
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
    envelope = await authorizedJson(
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

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fixed copy per upload status.
 *
 * 422 covers every extraction failure the backend can hit — a malformed PDF, a
 * broken Office archive, an undecodable text file, a password-protected PDF, a
 * document with no readable text. Its `detail` is never shown, so one message
 * has to name the plausible causes without claiming which one occurred.
 */
const UPLOAD_MESSAGES: Readonly<Record<number, string>> = {
  403: "Your account does not have access to this workspace.",
  404: RUN_UNAVAILABLE_MESSAGE,
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
 *
 * The whole attempt is wrapped in the shared refresh policy, so an access token
 * that expires during a long upload costs one refresh and one replay rather
 * than the reader's file.
 */
export function uploadDocument(
  file: File,
  { onProgress, signal, timeoutMs = UPLOAD_TIMEOUT_MS }: UploadOptions = {},
): Promise<UploadedDocument> {
  return withRefreshRetry(
    () =>
      new Promise<UploadedDocument>((resolve, reject) => {
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

        // Bearer only. The refresh cookie is scoped to `/v1/auth` and must not
        // ride along with a document body.
        const token = getAccessToken();
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        if (onProgress) {
          xhr.upload?.addEventListener("progress", (event: ProgressEvent) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(Math.min(1, event.loaded / event.total));
            }
          });
        }

        xhr.addEventListener("load", () => {
          cleanup();
          const requestId = xhr.getResponseHeader(REQUEST_ID_HEADER) ?? undefined;

          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new ApiError(
                // 401 keeps its status untouched so the refresh policy above
                // can see it; its copy is replaced only if the retry also fails.
                xhr.status === 401
                  ? SESSION_EXPIRED_MESSAGE
                  : (UPLOAD_MESSAGES[xhr.status] ?? "The upload failed."),
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
      }),
  );
}

const DOCUMENT_LIST_MESSAGES: Readonly<Record<number, string>> = {
  403: "Your account does not have access to this workspace.",
  404: RUN_UNAVAILABLE_MESSAGE,
};

/** `GET /v1/documents` — every document in the caller's workspace. */
export async function listDocuments(
  options: FetchOptions = {},
): Promise<UploadedDocument[]> {
  let envelope: JsonResponse;
  try {
    envelope = await authorizedJson(apiV1Url("/documents"), options);
  } catch (error) {
    return mapApiError(error, DOCUMENT_LIST_MESSAGES, "Your documents could not be loaded.");
  }

  const documents = parseDocumentList(envelope.parsed);
  if (!documents) {
    throw new ApiError(
      "The backend returned an unexpected document response.",
      envelope.status,
      envelope.requestId,
    );
  }
  return documents;
}

/** `GET /v1/documents/{id}` — used to poll one document until it is indexed. */
export async function getDocument(
  documentId: string,
  options: FetchOptions = {},
): Promise<UploadedDocument> {
  let envelope: JsonResponse;
  try {
    envelope = await authorizedJson(
      apiV1Url(`/documents/${encodeURIComponent(documentId)}`),
      options,
    );
  } catch (error) {
    return mapApiError(error, DOCUMENT_LIST_MESSAGES, "That document could not be loaded.");
  }

  const document = parseUploadedDocument(envelope.parsed);
  if (!document) {
    throw new ApiError(
      "The backend returned an unexpected document response.",
      envelope.status,
      envelope.requestId,
    );
  }
  return document;
}

/** `DELETE /v1/documents/{id}` — removes the record, the file, and its index. */
export async function deleteDocument(
  documentId: string,
  options: FetchOptions = {},
): Promise<void> {
  try {
    await authorizedJson(apiV1Url(`/documents/${encodeURIComponent(documentId)}`), {
      method: "DELETE",
      ...options,
    });
  } catch (error) {
    return mapApiError(
      error,
      { ...DOCUMENT_LIST_MESSAGES, 503: "That document could not be removed right now." },
      "That document could not be removed.",
    );
  }
}

/** `POST /v1/runs/{id}/feedback` — one verdict per reader, replacing any earlier one. */
export async function submitRunFeedback(
  runId: string,
  rating: 1 | -1,
  comment?: string,
  options: FetchOptions = {},
): Promise<void> {
  try {
    await authorizedJson(apiV1Url(`/runs/${encodeURIComponent(runId)}/feedback`), {
      method: "POST",
      json: { rating, ...(comment?.trim() ? { comment: comment.trim() } : {}) },
      ...options,
    });
  } catch (error) {
    return mapApiError(error, GET_RUN_MESSAGES, "Your feedback could not be saved.");
  }
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
 * Uses `fetch` + a stream reader rather than the native `EventSource` because
 * `EventSource` cannot send an `Authorization` header — the token would have to
 * go in the query string, where it would land in access logs. This is why the
 * stream is read manually.
 *
 * No timeout is applied: the stream is long-lived by design and ends when the
 * run reaches a terminal state. Unknown event names are ignored rather than
 * surfaced, so a new backend event type can never render as unlabelled
 * progress. Returns an abort function; calling it closes the stream silently.
 */
export function streamRunEvents(
  runId: string,
  handlers: StreamHandlers,
  { lastEventId }: { lastEventId?: string } = {},
): () => void {
  const controller = new AbortController();
  // Carried across reconnects so the server resumes exactly where this client
  // stopped, rather than replaying progress the reader has already seen.
  let cursor = lastEventId;
  let attempt = 0;

  const open = (): Promise<Response> =>
    fetch(apiV1Url(`/runs/${encodeURIComponent(runId)}/events`), {
      headers: authHeaders({
        Accept: "text/event-stream",
        ...(cursor ? { "Last-Event-ID": cursor } : {}),
      }),
      credentials: "omit",
      signal: controller.signal,
    });

  /** One connection. Resolves true when the server closed it normally. */
  const consume = async (): Promise<boolean> => {
    let response = await open();

    // The 401 policy is applied inline rather than through `withRefreshRetry`:
    // only the opening handshake can be replayed, never a stream already
    // delivering events.
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) throw new ApiError(SESSION_EXPIRED_MESSAGE, 401);
      response = await open();
      if (response.status === 401) {
        throw new ApiError(SESSION_EXPIRED_MESSAGE, 401);
      }
    }

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
      if (done) return true;

      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseBuffer(buffer);
      buffer = rest;

      for (const frame of frames) {
        if (frame.id) cursor = frame.id;
        if (isRunEventType(frame.event)) {
          handlers.onEvent({ type: frame.event });
        }
      }
    }
  };

  void (async () => {
    for (;;) {
      try {
        await consume();
        handlers.onClose?.();
        return;
      } catch (error) {
        // A caller abort (cancel or unmount) is not a failure.
        if (controller.signal.aborted) return;

        // Only transient failures are worth another attempt. A 4xx — an
        // expired session, a run that does not exist, one belonging to another
        // workspace — will answer exactly the same way next time, so retrying
        // it just delays telling the reader. Network errors (status 0) and 5xx
        // are the ones that can succeed on a second try.
        const fatal =
          error instanceof ApiError && error.status >= 400 && error.status < 500;
        attempt += 1;
        if (fatal || attempt > MAX_STREAM_RECONNECTS) {
          handlers.onError?.(
            error instanceof ApiError
              ? error
              : new ApiError("The run event stream ended unexpectedly.", 0),
          );
          return;
        }

        await delay(RECONNECT_DELAYS_MS[attempt - 1] ?? 4_000);
        if (controller.signal.aborted) return;
      }
    }
  })();

  return () => controller.abort();
}

/** Backoff between stream reconnects, in milliseconds. */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;
const MAX_STREAM_RECONNECTS = RECONNECT_DELAYS_MS.length;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attach the in-memory bearer token, when there is one. */
function authHeaders(base: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}
