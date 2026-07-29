/**
 * Transport for every backend call, and the place the access token is attached.
 *
 * Split out of `api.ts` so the token lifecycle has exactly one home. Two rules
 * are enforced here rather than at each call site:
 *
 *  1. **Errors are opaque.** Backend `detail` text and provider error strings
 *     are never propagated. Each operation maps an HTTP status onto fixed local
 *     copy and keeps only `X-Request-ID` for log correlation.
 *  2. **A 401 buys exactly one refresh and one retry.** Anything more turns a
 *     revoked session into a refresh loop against the backend.
 */

import { apiV1Url } from "./config";
import { parseIssuedSession } from "./auth";
import { clearSession, getAccessToken, setSession } from "./session";

export const REQUEST_ID_HEADER = "X-Request-ID";

/** Default ceiling for a single request, so the UI can never hang forever. */
export const DEFAULT_TIMEOUT_MS = 8000;

/** Uploads index synchronously (chunk + embed + store), so they get longer. */
export const UPLOAD_TIMEOUT_MS = 60_000;

export const UNREACHABLE_MESSAGE = "Cannot reach the backend API.";

/**
 * The one sentence shown when a session ends unexpectedly.
 *
 * Fixed copy: whether the token expired, the refresh cookie was revoked, or the
 * account was disabled, the reader's next step is identical, and the difference
 * between those cases is exactly the kind of detail an attacker probes for.
 */
export const SESSION_EXPIRED_MESSAGE = "Your session has ended. Sign in again to continue.";

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

export function requestIdOf(response: Response): string | undefined {
  return response.headers.get(REQUEST_ID_HEADER) ?? undefined;
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface FetchOptions {
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
export async function readBody(response: Response): Promise<string> {
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
export async function fetchWithTimeout(
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

export interface RequestOptions extends FetchOptions {
  /** Short-lived bearer access token. Omitted for public endpoints. */
  token?: string;
  /** JSON request body; serialized automatically. */
  json?: unknown;
  method?: string;
  /**
   * `include` only for the `/v1/auth` endpoints that ride the refresh cookie.
   * Bearer-authenticated data requests use `omit` so no ambient credential is
   * ever attached to them.
   */
  credentials?: RequestCredentials;
}

export interface JsonResponse {
  parsed: unknown;
  status: number;
  requestId?: string;
}

/** Perform a JSON request and return the envelope, so callers keep the status. */
export async function sendJson(
  url: string,
  options: RequestOptions = {},
): Promise<JsonResponse> {
  const { token, json, method, signal, timeoutMs, credentials = "omit" } = options;

  const headers = new Headers({ Accept: "application/json" });
  if (json !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      credentials,
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
  // 204 carries no body by contract, so an empty one is not a parse failure.
  if (parsed === undefined && response.status !== 204) {
    throw new ApiError(
      "The backend returned an unreadable response.",
      response.status,
      requestId,
    );
  }

  return { parsed, status: response.status, requestId };
}

/* ------------------------------------------------------------------ */
/* Refresh                                                            */
/* ------------------------------------------------------------------ */

/**
 * In-flight refresh, shared by every caller.
 *
 * Without this, a page that fires several authenticated requests at once would
 * answer one expired token with N concurrent refreshes — and since the backend
 * rotates the refresh cookie on every call, all but one would present an
 * already-rotated token and revoke the session they were trying to save.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  try {
    const { parsed } = await sendJson(apiV1Url("/auth/refresh"), {
      method: "POST",
      // The refresh cookie is HttpOnly and scoped to `/v1/auth`; the browser
      // attaches it only because of this flag.
      credentials: "include",
    });
    const issued = parseIssuedSession(parsed);
    if (!issued) {
      clearSession("expired");
      return false;
    }
    setSession(issued.accessToken, issued.user);
    return true;
  } catch {
    clearSession("expired");
    return false;
  }
}

/**
 * Rotate the refresh cookie and replace the in-memory access token.
 *
 * Resolves `false` rather than throwing: every caller treats a failed refresh
 * as "signed out", never as an error to surface verbatim.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Test seam: drop any shared in-flight refresh between cases. */
export function resetRefreshForTests(): void {
  refreshInFlight = null;
}

/**
 * Run an authenticated attempt, and on a 401 refresh once and retry once.
 *
 * The attempt is a thunk rather than a prepared request so the retry picks up
 * the newly issued token — and so the same policy covers the `XMLHttpRequest`
 * upload path, which cannot share a `fetch` pipeline.
 */
export async function withRefreshRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    const refreshed = await refreshSession();
    if (!refreshed) {
      throw new ApiError(SESSION_EXPIRED_MESSAGE, 401, error.requestId);
    }

    try {
      return await attempt();
    } catch (retryError) {
      // A second 401 means the fresh token was rejected too: stop here rather
      // than refreshing again, and end the session.
      if (retryError instanceof ApiError && retryError.status === 401) {
        clearSession("expired");
        throw new ApiError(SESSION_EXPIRED_MESSAGE, 401, retryError.requestId);
      }
      throw retryError;
    }
  }
}

/**
 * A JSON request carrying the in-memory bearer token, with the 401 policy
 * applied. Used for every authenticated endpoint except the upload.
 */
export function authorizedJson(
  url: string,
  options: RequestOptions = {},
): Promise<JsonResponse> {
  return withRefreshRetry(() =>
    sendJson(url, { ...options, token: getAccessToken() ?? undefined }),
  );
}

/**
 * Re-throw an `ApiError` with copy chosen for this operation.
 *
 * Status 0 already carries a safe transport message, and 401 already carries
 * the fixed session copy, so both pass through; the request id is preserved.
 */
export function mapApiError(
  error: unknown,
  messages: Readonly<Record<number, string>>,
  fallback: string,
): never {
  if (!(error instanceof ApiError)) {
    throw new ApiError(fallback, 0);
  }
  if (error.status === 0 || error.status === 401) throw error;
  throw new ApiError(
    messages[error.status] ?? fallback,
    error.status,
    error.requestId,
  );
}
