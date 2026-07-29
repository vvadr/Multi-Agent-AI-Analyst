import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  connectSrcOrigin,
} from "./security-headers";

const PRODUCTION = { apiBaseUrl: "https://api.example.invalid", isProduction: true };
const DEVELOPMENT = { apiBaseUrl: "http://localhost:8000", isProduction: false };

function headerMap(options: Parameters<typeof buildSecurityHeaders>[0]) {
  return new Map(buildSecurityHeaders(options).map(({ key, value }) => [key, value]));
}

/** Read one directive out of a policy string. */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("connectSrcOrigin", () => {
  it("keeps only the origin", () => {
    expect(connectSrcOrigin("https://api.example.invalid/v1/")).toBe(
      "https://api.example.invalid",
    );
    expect(connectSrcOrigin("http://localhost:8000")).toBe("http://localhost:8000");
  });

  it.each([undefined, "", "   ", "not a url", "ftp://api.example.invalid", "/v1"])(
    "yields nothing for %o rather than a broken directive",
    (value) => {
      expect(connectSrcOrigin(value)).toBeNull();
    },
  );
});

describe("Content-Security-Policy", () => {
  it("allows the backend origin to be called, and no other", () => {
    const policy = buildContentSecurityPolicy(PRODUCTION);

    expect(directive(policy, "connect-src")).toBe(
      "connect-src 'self' https://api.example.invalid",
    );
  });

  it("shuts the classic injection sinks", () => {
    const policy = buildContentSecurityPolicy(PRODUCTION);

    expect(directive(policy, "default-src")).toBe("default-src 'self'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
  });

  it("never contains a wildcard or bare-scheme source", () => {
    const policy = buildContentSecurityPolicy(PRODUCTION);

    // Every source token, with the directive name dropped. `https:` as a whole
    // source allows any HTTPS origin; `https://api.example.invalid` does not,
    // so the check has to be per token rather than a substring search.
    const sources = policy
      .split(";")
      .flatMap((part) => part.trim().split(/\s+/).slice(1));

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toBe("*");
      expect(source).not.toBe("https:");
      expect(source).not.toBe("http:");
      expect(source).not.toMatch(/^\*\./);
    }
  });

  it("allows no third-party font or script origin", () => {
    const policy = buildContentSecurityPolicy(PRODUCTION);

    expect(directive(policy, "font-src")).toBe("font-src 'self'");
    expect(policy).not.toContain("fonts.googleapis.com");
    expect(policy).not.toContain("fonts.gstatic.com");
  });

  it("keeps eval and dev sockets out of production", () => {
    const policy = buildContentSecurityPolicy(PRODUCTION);

    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("ws://");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows the dev server's hot reload only outside production", () => {
    const policy = buildContentSecurityPolicy(DEVELOPMENT);

    expect(policy).toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toContain("http://localhost:8000");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("recommends localhost, never the loopback IP literal", () => {
    expect(buildContentSecurityPolicy(DEVELOPMENT)).not.toContain("127.0.0.1");
  });
});

describe("security headers", () => {
  it("serves the standard browser protections", () => {
    const headers = headerMap(PRODUCTION);

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("X-DNS-Prefetch-Control")).toBe("off");
    expect(headers.get("Content-Security-Policy")).toBeDefined();
  });

  it("denies the powerful device permissions the app never uses", () => {
    const permissions = headerMap(PRODUCTION).get("Permissions-Policy") ?? "";

    for (const feature of ["camera", "geolocation", "microphone", "payment", "usb"]) {
      expect(permissions).toContain(`${feature}=()`);
    }
  });

  it("sends HSTS in production only", () => {
    expect(headerMap(PRODUCTION).get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );

    // Sending it locally would pin localhost to HTTPS in the developer's
    // browser long after the project is gone.
    expect(headerMap(DEVELOPMENT).has("Strict-Transport-Security")).toBe(false);
  });

  it("still produces a usable policy when the API URL is unset", () => {
    const headers = headerMap({ apiBaseUrl: undefined, isProduction: true });
    const policy = headers.get("Content-Security-Policy") ?? "";

    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });
});
