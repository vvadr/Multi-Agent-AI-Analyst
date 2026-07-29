import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { API_BASE_URL } from "./config";
import {
  LOCAL_API_URL,
  LOCAL_APP_URL,
  LOCAL_DEVELOPMENT_GUIDANCE,
} from "./local-development";

/**
 * The loopback IP literal and `localhost` are different origins to a browser:
 * cookies set for one are not sent to the other, and the backend's CORS
 * allowlist names `localhost` alone. These tests pin the rule in the one place
 * it is easy to break — the committed defaults and the copy that tells a
 * developer where to go.
 */
const LOOPBACK_LITERAL = "127.0.0.1";

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.resolve(process.cwd(), ...segments), "utf8");
}

describe("local development guidance", () => {
  it("names the two localhost origins the project uses", () => {
    expect(LOCAL_APP_URL).toBe("http://localhost:3000");
    expect(LOCAL_API_URL).toBe("http://localhost:8000");
  });

  it("tells the developer where to open the app and what it talks to", () => {
    expect(LOCAL_DEVELOPMENT_GUIDANCE).toContain(LOCAL_APP_URL);
    expect(LOCAL_DEVELOPMENT_GUIDANCE).toContain(LOCAL_API_URL);
  });

  it("never mentions the loopback IP literal", () => {
    expect(LOCAL_DEVELOPMENT_GUIDANCE).not.toContain(LOOPBACK_LITERAL);
    expect(LOCAL_APP_URL).not.toContain(LOOPBACK_LITERAL);
    expect(LOCAL_API_URL).not.toContain(LOOPBACK_LITERAL);
  });
});

describe("committed development defaults", () => {
  const envDevelopment = readRepoFile(".env.development");

  it("points the client at the localhost backend", () => {
    expect(envDevelopment).toContain(`NEXT_PUBLIC_API_BASE_URL=${LOCAL_API_URL}`);
  });

  it("resolves to that same origin at runtime", () => {
    expect(API_BASE_URL).toBe(LOCAL_API_URL);
  });

  it("does not offer the loopback IP literal as an option", () => {
    expect(envDevelopment).not.toContain(LOOPBACK_LITERAL);
  });

  it("keeps no secret-shaped values in the public client config", () => {
    // Everything NEXT_PUBLIC_ is inlined into the browser bundle.
    for (const line of envDevelopment.split(/\r?\n/)) {
      if (!line.startsWith("NEXT_PUBLIC_")) continue;
      expect(line).not.toMatch(/(SECRET|PASSWORD|API_KEY|TOKEN|PRIVATE)/i);
    }
  });
});
