/**
 * Typed client for the Multi-Agent AI Analyst backend.
 *
 * This is the ONLY place the frontend should reach out over the network. The
 * backend publishes a versioned OpenAPI + SSE contract (see
 * docs/IMPLEMENTATION_SCOPE.md → "API Contract for the Frontend Team"); the
 * frontend never calls Postgres, Qdrant, Gemini, or storage directly.
 */

import { apiUrl, apiV1Url } from "./config";

/** Shape returned by `GET /healthz`. */
export interface HealthStatus {
  status: "ok";
}

/** Shape returned by `GET /readyz`. */
export interface ReadinessReport {
  status: "ready" | "not_ready";
  components: {
    database: boolean;
    gemini: boolean;
    qdrant: boolean;
  };
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Short-lived bearer access token from `POST /v1/auth/login`. */
  token?: string;
  /** JSON request body; serialized automatically. */
  json?: unknown;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { token, json, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (json !== undefined) finalHeaders.set("Content-Type", "application/json");
  if (token) finalHeaders.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  const raw = await response.text();
  const parsed = raw ? safeJsonParse(raw) : undefined;

  if (!response.ok) {
    const detail =
      (parsed as { detail?: string } | undefined)?.detail ?? response.statusText;
    throw new ApiError(`${response.status} ${detail}`, response.status, parsed);
  }

  return parsed as T;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* ------------------------------------------------------------------ */
/* Operations                                                         */
/* ------------------------------------------------------------------ */

export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>(apiUrl("/healthz"));
}

/**
 * `GET /readyz` returns 503 when a dependency is unconfigured, but still sends
 * a JSON body describing which components are ready. We surface that body
 * rather than throwing so a status UI can render partial readiness.
 */
export async function getReadiness(): Promise<ReadinessReport> {
  const response = await fetch(apiUrl("/readyz"), {
    headers: { Accept: "application/json" },
  });
  return (await response.json()) as ReadinessReport;
}

/* ------------------------------------------------------------------ */
/* Streaming run events (Server-Sent Events)                          */
/* ------------------------------------------------------------------ */

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
          `Failed to open event stream (${response.status})`,
          response.status,
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
