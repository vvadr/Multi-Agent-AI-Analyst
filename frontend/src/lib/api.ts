/**
 * Typed client for the Multi-Agent AI Analyst backend.
 *
 * This is the ONLY place the frontend should reach out over the network. The
 * backend publishes a versioned OpenAPI + SSE contract (see
 * docs/IMPLEMENTATION_SCOPE.md); the frontend never calls Postgres, Qdrant,
 * Gemini, or storage directly.
 *
 * Errors surfaced from here are deliberately generic. Backend exception text
 * and provider error details never reach the UI — only a short, safe message
 * plus the `X-Request-ID` for log correlation.
 */

import { apiUrl, apiV1Url } from "./config";
import { parseReadinessReport, type ReadinessReport } from "./readiness";

export type {
  ComponentReadiness,
  ReadinessComponent,
  ReadinessReport,
} from "./readiness";

/** Shape returned by `GET /healthz`. */
export interface HealthStatus {
  status: "ok";
}

/** Typed SSE progress events emitted by `GET /v1/runs/{id}/events`. */
export type RunEventType =
  | "run_started"
  | "routing"
  | "retrieving"
  | "querying"
  | "generating"
  | "completed"
  | "failed";

export interface RunEvent {
  type: RunEventType;
  data?: unknown;
}

const REQUEST_ID_HEADER = "X-Request-ID";

/** Default ceiling for a single request, so the UI can never hang forever. */
export const DEFAULT_TIMEOUT_MS = 8000;

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
    throw new ApiError("Cannot reach the backend API.", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

interface RequestOptions extends FetchOptions {
  /** Short-lived bearer access token from `POST /v1/auth/login`. */
  token?: string;
  /** JSON request body; serialized automatically. */
  json?: unknown;
  method?: string;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
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

  if (!response.ok) {
    throw new ApiError(
      `Request failed (${response.status}).`,
      response.status,
      requestIdOf(response),
    );
  }
  if (parsed === undefined) {
    throw new ApiError(
      "The backend returned an unreadable response.",
      response.status,
      requestIdOf(response),
    );
  }

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

/* ------------------------------------------------------------------ */
/* Streaming run events (Server-Sent Events)                          */
/* ------------------------------------------------------------------ */
/* Retained for a later phase. The Phase 1 backend exposes no run API, so       */
/* nothing in the UI calls this yet.                                           */

export interface StreamHandlers {
  onEvent: (event: RunEvent) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

/**
 * Consume `GET /v1/runs/{id}/events` as an SSE stream.
 *
 * Uses `fetch` + a stream reader rather than the native `EventSource` so an
 * `Authorization: Bearer` header can be attached (EventSource cannot set
 * headers). Returns an abort function that closes the stream.
 */
export function streamRunEvents(
  runId: string,
  handlers: StreamHandlers,
  options: { token?: string } = {},
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const headers = new Headers({ Accept: "text/event-stream" });
      if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

      const response = await fetch(apiV1Url(`/runs/${runId}/events`), {
        headers,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new ApiError(
          `Failed to open event stream (${response.status}).`,
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

        // SSE frames are separated by a blank line.
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseSseFrame(frame);
          if (event) handlers.onEvent(event);
          boundary = buffer.indexOf("\n\n");
        }
      }
      handlers.onClose?.();
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      handlers.onError?.(error);
    }
  })();

  return () => controller.abort();
}

function parseSseFrame(frame: string): RunEvent | null {
  let type: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (!type && dataLines.length === 0) return null;

  const rawData = dataLines.join("\n");
  return {
    type: (type ?? "generating") as RunEventType,
    data: rawData ? safeJsonParse(rawData) : undefined,
  };
}
