/**
 * Public runtime configuration.
 *
 * Only `NEXT_PUBLIC_*` variables are available in the browser. Never read a
 * secret here — the frontend must not hold provider, database, or model
 * credentials (see docs/IMPLEMENTATION_SCOPE.md). The frontend only ever talks
 * to the backend API, which owns every secret server-side.
 */

/** Base URL of the backend API, e.g. `http://localhost:8000`. */
export const API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/** Versioned API prefix, matching the backend `API_V1_PREFIX`. */
export const API_V1_PREFIX: string = process.env.NEXT_PUBLIC_API_V1_PREFIX ?? "/v1";

/** Deployment environment label: `development` | `production`. */
export const APP_ENV: string = process.env.NEXT_PUBLIC_APP_ENV ?? "development";

export const IS_PRODUCTION = APP_ENV === "production";

/** Absolute URL for a versioned (`/v1/...`) endpoint. */
export function apiV1Url(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${API_V1_PREFIX}${suffix}`;
}

/** Absolute URL for an unversioned endpoint such as `/healthz`. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}
