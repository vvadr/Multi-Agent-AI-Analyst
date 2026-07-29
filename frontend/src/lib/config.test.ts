import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEV_API_BASE_URL,
  normalizeApiBaseUrl,
  normalizeApiPrefix,
  parseAppEnv,
  resolvePublicConfig,
} from "./config";

describe("normalizeApiBaseUrl — production safety", () => {
  it("rejects a missing API base URL in production", () => {
    expect(() => normalizeApiBaseUrl(undefined, "production")).toThrow(ConfigError);
    expect(() => normalizeApiBaseUrl("", "production")).toThrow(
      /NEXT_PUBLIC_API_BASE_URL is required/,
    );
    expect(() => normalizeApiBaseUrl("   ", "production")).toThrow(ConfigError);
  });

  it.each([
    ["localhost", "https://localhost:8000"],
    ["loopback IP", "https://127.0.0.1:8000"],
    ["plain http", "http://api.real-backend.com"],
    ["not a URL", "api.example.com"],
    ["relative path", "/api"],
    ["unsupported scheme", "ftp://api.example.com"],
    ["placeholder host", "https://your-backend.onrender.com"],
    ["placeholder token", "https://api.changeme.com"],
    ["angle brackets", "https://<backend-host>"],
  ])("rejects %s in production", (_label, value) => {
    expect(() => normalizeApiBaseUrl(value, "production")).toThrow(ConfigError);
  });

  it("accepts a valid https production URL and strips the trailing slash", () => {
    expect(normalizeApiBaseUrl("https://api.example.invalid/", "production")).toBe(
      "https://api.example.invalid",
    );
    expect(normalizeApiBaseUrl("https://api.example.invalid///", "production")).toBe(
      "https://api.example.invalid",
    );
  });

  it("names the offending variable without echoing extra detail", () => {
    try {
      normalizeApiBaseUrl("https://localhost:8000", "production");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variable).toBe("NEXT_PUBLIC_API_BASE_URL");
      expect((error as ConfigError).message).toMatch(/localhost/);
    }
  });
});

describe("normalizeApiBaseUrl — development", () => {
  it("falls back to the localhost default when unset", () => {
    expect(normalizeApiBaseUrl(undefined, "development")).toBe(DEV_API_BASE_URL);
    expect(normalizeApiBaseUrl("", "development")).toBe(DEV_API_BASE_URL);
  });

  it("permits plain http and localhost", () => {
    expect(normalizeApiBaseUrl("http://localhost:9000", "development")).toBe(
      "http://localhost:9000",
    );
    expect(normalizeApiBaseUrl("http://127.0.0.1:8000/", "development")).toBe(
      "http://127.0.0.1:8000",
    );
  });

  it("still rejects a syntactically invalid URL", () => {
    expect(() => normalizeApiBaseUrl("not-a-url", "development")).toThrow(ConfigError);
  });
});

describe("normalizeApiPrefix", () => {
  it.each([
    [undefined, "/v1"],
    ["", "/v1"],
    ["v1", "/v1"],
    ["/v1", "/v1"],
    ["/v1/", "/v1"],
    ["///v1///", "/v1"],
    ["  /v1/  ", "/v1"],
  ])("normalizes %o to %o", (input, expected) => {
    expect(normalizeApiPrefix(input)).toBe(expected);
  });

  it("treats a bare slash as no prefix", () => {
    expect(normalizeApiPrefix("/")).toBe("");
  });
});

describe("parseAppEnv", () => {
  it("accepts known environments and defaults to development", () => {
    expect(parseAppEnv("development")).toBe("development");
    expect(parseAppEnv("production")).toBe("production");
    expect(parseAppEnv(undefined)).toBe("development");
    expect(parseAppEnv("")).toBe("development");
  });

  it("rejects arbitrary values instead of passing them through", () => {
    expect(() => parseAppEnv("staging")).toThrow(ConfigError);
    expect(() => parseAppEnv("PRODUCTION")).toThrow(ConfigError);
  });
});

describe("resolvePublicConfig", () => {
  it("builds a normalized production config", () => {
    expect(
      resolvePublicConfig({
        apiBaseUrl: "https://api.example.invalid/",
        apiV1Prefix: "v1/",
        appEnv: "production",
        passwordResetEnabled: "true",
      }),
    ).toEqual({
      apiBaseUrl: "https://api.example.invalid",
      apiV1Prefix: "/v1",
      appEnv: "production",
      isProduction: true,
      passwordResetEnabled: true,
    });
  });

  it("applies development defaults when nothing is set", () => {
    expect(resolvePublicConfig({})).toEqual({
      apiBaseUrl: DEV_API_BASE_URL,
      apiV1Prefix: "/v1",
      appEnv: "development",
      isProduction: false,
      // Off unless explicitly enabled: the failure mode should be a missing
      // link, not one that leads to an endpoint answering 503.
      passwordResetEnabled: false,
    });
  });

  it("treats any value other than the literal 'true' as disabled", () => {
    for (const raw of ["false", "1", "yes", "TRUE", " "]) {
      expect(resolvePublicConfig({ passwordResetEnabled: raw }).passwordResetEnabled).toBe(
        false,
      );
    }
  });
});
