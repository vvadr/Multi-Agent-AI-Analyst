/**
 * Public runtime configuration.
 *
 * Only `NEXT_PUBLIC_*` variables exist in the browser, and Next.js inlines them
 * into the client bundle at build time. Everything here is therefore PUBLIC:
 * never read or store a provider, database, JWT, or model credential in this
 * file. The frontend only ever talks to the backend API, which owns every
 * secret server-side (see docs/IMPLEMENTATION_SCOPE.md).
 *
 * The exported constants are resolved once at module load so an invalid
 * production configuration fails the build instead of shipping a broken client.
 * The pure `normalize*` / `parse*` helpers are exported separately so this
 * behaviour can be tested without touching `process.env`.
 */

export type AppEnv = "development" | "production";

export const APP_ENVIRONMENTS: readonly AppEnv[] = ["development", "production"];

/** Fallback used only in development, where a local backend is the norm. */
export const DEV_API_BASE_URL = "http://localhost:8000";

const DEFAULT_API_V1_PREFIX = "/v1";

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/**
 * Obvious "fill this in later" values. Kept deliberately narrow so a legitimate
 * URL is never rejected — note that `example.invalid` is intentionally allowed,
 * because CI uses it as a safe non-secret build value.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /your[-_.]/i,
  /change[-_]?me/i,
  /replace[-_]?me/i,
  /placeholder/i,
  /\bexample\.com\b/i,
  /\btodo\b/i,
  /[<>{}]/,
];

/** Raw, unvalidated values as they arrive from the environment. */
export interface RawPublicConfig {
  apiBaseUrl?: string;
  apiV1Prefix?: string;
  appEnv?: string;
  passwordResetEnabled?: string;
}

export interface PublicConfig {
  apiBaseUrl: string;
  apiV1Prefix: string;
  appEnv: AppEnv;
  isProduction: boolean;
  /**
   * Whether the backend can deliver a reset link.
   *
   * Registration and sign-in need no email provider, so a deployment may
   * legitimately have none — in which case the reset endpoint answers 503 and
   * the UI must not offer the option. Off unless explicitly enabled, so the
   * failure mode is a missing link rather than a dead one.
   */
  passwordResetEnabled: boolean;
}

/**
 * Thrown when public configuration is unusable.
 *
 * The message names the offending variable but never echoes a secret — these
 * values are public by definition, yet the same discipline keeps accidental
 * leakage out of build logs.
 */
export class ConfigError extends Error {
  constructor(
    readonly variable: string,
    reason: string,
  ) {
    super(`${variable} ${reason}`);
    this.name = "ConfigError";
  }
}

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Validate and normalize the backend base URL.
 *
 * Development may fall back to localhost. Production requires an explicit,
 * absolute HTTPS URL that is neither local nor an obvious placeholder, so a
 * deployed build can never quietly point at a developer machine.
 */
export function normalizeApiBaseUrl(
  raw: string | undefined,
  appEnv: AppEnv,
): string {
  const variable = "NEXT_PUBLIC_API_BASE_URL";
  const trimmed = raw?.trim() ?? "";

  if (!trimmed) {
    if (appEnv === "development") return DEV_API_BASE_URL;
    throw new ConfigError(variable, "is required in production.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError(
      variable,
      "must be an absolute URL including the scheme, e.g. https://api.example.com",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(variable, "must use the http or https scheme.");
  }

  if (appEnv === "production") {
    if (url.protocol !== "https:") {
      throw new ConfigError(variable, "must use https in production.");
    }
    if (LOCAL_HOSTNAMES.has(url.hostname)) {
      throw new ConfigError(
        variable,
        "must not point at localhost in production.",
      );
    }
    if (looksLikePlaceholder(trimmed)) {
      throw new ConfigError(
        variable,
        "still contains a placeholder value; set the deployed backend URL.",
      );
    }
  }

  // Drop query, hash, and any trailing slash so path joining stays predictable.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Normalize to exactly one leading slash and no trailing slash. */
export function normalizeApiPrefix(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_API_V1_PREFIX;

  const inner = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return inner ? `/${inner}` : "";
}

/** Accept only known environment labels rather than any arbitrary string. */
export function parseAppEnv(raw: string | undefined): AppEnv {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "development";
  if ((APP_ENVIRONMENTS as readonly string[]).includes(trimmed)) {
    return trimmed as AppEnv;
  }
  throw new ConfigError(
    "NEXT_PUBLIC_APP_ENV",
    `must be one of: ${APP_ENVIRONMENTS.join(", ")}.`,
  );
}

/** Resolve a complete, validated configuration from raw environment values. */
export function resolvePublicConfig(raw: RawPublicConfig): PublicConfig {
  const appEnv = parseAppEnv(raw.appEnv);
  return {
    apiBaseUrl: normalizeApiBaseUrl(raw.apiBaseUrl, appEnv),
    apiV1Prefix: normalizeApiPrefix(raw.apiV1Prefix),
    appEnv,
    isProduction: appEnv === "production",
    passwordResetEnabled: raw.passwordResetEnabled?.trim() === "true",
  };
}

// Referenced as literal member expressions so Next.js can inline them at build.
const config = resolvePublicConfig({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  apiV1Prefix: process.env.NEXT_PUBLIC_API_V1_PREFIX,
  appEnv: process.env.NEXT_PUBLIC_APP_ENV,
  passwordResetEnabled: process.env.NEXT_PUBLIC_ENABLE_PASSWORD_RESET,
});

export const API_BASE_URL = config.apiBaseUrl;
export const API_V1_PREFIX = config.apiV1Prefix;
export const APP_ENV = config.appEnv;
export const IS_PRODUCTION = config.isProduction;
export const PASSWORD_RESET_ENABLED = config.passwordResetEnabled;

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
