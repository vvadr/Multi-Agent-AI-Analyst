import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  parseAuthUser,
  parseIssuedSession,
  validateInviteInput,
  validateLoginInput,
} from "./auth";

const VALID_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

const VALID_TOKEN_RESPONSE = {
  access_token: "header.payload.signature",
  token_type: "bearer",
  expires_in: 1800,
  user: VALID_USER,
};

describe("parseAuthUser", () => {
  it("reads the documented user shape", () => {
    expect(parseAuthUser(VALID_USER)).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "analyst@example.invalid",
      organizationId: "22222222-2222-4222-8222-222222222222",
      role: "member",
    });
  });

  it("accepts the admin role", () => {
    expect(parseAuthUser({ ...VALID_USER, role: "admin" })?.role).toBe("admin");
  });

  it.each([
    ["a missing organization", { ...VALID_USER, organization_id: undefined }],
    ["an unknown role", { ...VALID_USER, role: "superuser" }],
    ["a numeric id", { ...VALID_USER, id: 7 }],
    ["an empty email", { ...VALID_USER, email: "  " }],
    ["a non-object", "user"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(parseAuthUser(value)).toBeNull();
  });
});

describe("parseIssuedSession", () => {
  it("reads the documented token response", () => {
    expect(parseIssuedSession(VALID_TOKEN_RESPONSE)).toEqual({
      accessToken: "header.payload.signature",
      expiresIn: 1800,
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "analyst@example.invalid",
        organizationId: "22222222-2222-4222-8222-222222222222",
        role: "member",
      },
    });
  });

  it("rejects a token type this client cannot send", () => {
    expect(
      parseIssuedSession({ ...VALID_TOKEN_RESPONSE, token_type: "mac" }),
    ).toBeNull();
  });

  it.each([
    ["a missing access token", { ...VALID_TOKEN_RESPONSE, access_token: "" }],
    ["a missing user", { ...VALID_TOKEN_RESPONSE, user: undefined }],
    ["a malformed user", { ...VALID_TOKEN_RESPONSE, user: { id: "x" } }],
    ["a zero lifetime", { ...VALID_TOKEN_RESPONSE, expires_in: 0 }],
    ["a negative lifetime", { ...VALID_TOKEN_RESPONSE, expires_in: -1 }],
    ["a missing lifetime", { ...VALID_TOKEN_RESPONSE, expires_in: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(parseIssuedSession(value)).toBeNull();
  });

  it("never surfaces a refresh token, even when the server sends one", () => {
    const parsed = parseIssuedSession({
      ...VALID_TOKEN_RESPONSE,
      refresh_token: "opaque-refresh-value",
    });

    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("opaque-refresh-value");
    expect(Object.keys(parsed!)).toEqual(["accessToken", "expiresIn", "user"]);
  });
});

describe("validateLoginInput", () => {
  it("accepts a filled-in form", () => {
    expect(validateLoginInput("analyst@example.invalid", "correct horse battery")).toBeNull();
  });

  it("names the empty field", () => {
    expect(validateLoginInput("", "password123456")).toMatchObject({ field: "email" });
    expect(validateLoginInput("analyst@example.invalid", "")).toMatchObject({
      field: "password",
    });
  });

  it("does not impose a minimum length on an existing password", () => {
    // Login must accept whatever the account already has; only the invite
    // screen sets a new password, and that is where the rule belongs.
    expect(validateLoginInput("analyst@example.invalid", "short")).toBeNull();
  });
});

describe("validateInviteInput", () => {
  const token = "t".repeat(32);

  it("accepts a complete invitation form", () => {
    expect(validateInviteInput(token, "a-long-enough-password", "Ada")).toBeNull();
  });

  it("rejects a truncated invitation code", () => {
    expect(validateInviteInput("too-short", "a-long-enough-password", "Ada")).toMatchObject({
      field: "token",
    });
  });

  it("requires a name", () => {
    expect(validateInviteInput(token, "a-long-enough-password", "  ")).toMatchObject({
      field: "displayName",
    });
  });

  it("enforces the backend's minimum password length", () => {
    const problem = validateInviteInput(token, "x".repeat(MIN_PASSWORD_LENGTH - 1), "Ada");
    expect(problem).toMatchObject({ field: "password" });
    expect(problem?.message).toContain(String(MIN_PASSWORD_LENGTH));

    expect(validateInviteInput(token, "x".repeat(MIN_PASSWORD_LENGTH), "Ada")).toBeNull();
  });
});
