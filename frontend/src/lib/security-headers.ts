/**
 * Browser security headers, built as pure data so they can be asserted in tests
 * rather than only observed in a running server.
 *
 * `next.config.ts` imports this and serves the result on every route. Nothing
 * here may import `config.ts`: that module throws on an invalid production
 * environment at import time, and a config error should fail the build with its
 * own message, not as a mysterious failure inside header generation.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /** Backend origin the browser is allowed to call, e.g. `http://localhost:8000`. */
  apiBaseUrl?: string;
  isProduction: boolean;
}

/**
 * The API origin for `connect-src`.
 *
 * Only the origin is kept — a path in `connect-src` would be ignored by the
 * browser anyway, and including one invites the belief that CSP is doing path
 * filtering it does not do. An unparseable value yields nothing rather than a
 * broken directive.
 */
export function connectSrcOrigin(apiBaseUrl: string | undefined): string | null {
  const trimmed = apiBaseUrl?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Build the Content-Security-Policy.
 *
 * `script-src` includes `'unsafe-inline'` because the App Router serves its
 * hydration payload in inline `<script>` tags. Removing it requires a per-
 * request nonce from middleware, which forces every route to render
 * dynamically; that trade is a deliberate future step, not an oversight. The
 * directives that actually contain a cross-site injection — `object-src`,
 * `base-uri`, `frame-ancestors`, `form-action`, and a `connect-src` limited to
 * this app's own backend — are locked down here.
 *
 * Development additionally allows `'unsafe-eval'` and websocket connections,
 * which the dev server's hot reload needs and production must never have.
 */
export function buildContentSecurityPolicy({
  apiBaseUrl,
  isProduction,
}: SecurityHeaderOptions): string {
  const apiOrigin = connectSrcOrigin(apiBaseUrl);

  const connectSrc = ["'self'"];
  if (apiOrigin) connectSrc.push(apiOrigin);
  if (!isProduction) {
    // The dev server's HMR socket, and the local backend over ws if it is used.
    connectSrc.push("ws://localhost:*", "http://localhost:*");
  }

  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (!isProduction) scriptSrc.push("'unsafe-eval'");

  const directives: string[][] = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["script-src", ...scriptSrc],
    ["style-src", "'self'", "'unsafe-inline'"],
    // Self-hosted system fonts only; no third-party font origin is allowed.
    ["font-src", "'self'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["connect-src", ...connectSrc],
    ["manifest-src", "'self'"],
    ["worker-src", "'self'", "blob:"],
  ];

  if (isProduction) directives.push(["upgrade-insecure-requests"]);

  return directives.map((parts) => parts.join(" ")).join("; ");
}

/**
 * Every security header served with the app.
 *
 * HSTS is production-only on purpose: sending it from a local development
 * server would pin `localhost` to HTTPS in the developer's browser, and that
 * pin outlives the project.
 */
export function buildSecurityHeaders(options: SecurityHeaderOptions): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Kept alongside `frame-ancestors` for browsers that honour only this one.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];

  if (options.isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
