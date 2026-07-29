import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./http";
import type { AuthUser } from "./auth";
import { acceptInvite, createInvite, fetchCurrentUser, login, logout } from "./auth-api";
import { resetRefreshForTests } from "./http";
import { getAccessToken, getCurrentUser, resetSessionForTests, setSession } from "./session";

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

const USER_PAYLOAD = {
  id: USER.id,
  email: USER.email,
  organization_id: USER.organizationId,
  role: USER.role,
};

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenResponse(accessToken = "access-token"): Response {
  return jsonResponse(
    {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 1800,
      user: USER_PAYLOAD,
    },
    200,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetSessionForTests();
  resetRefreshForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionForTests();
  resetRefreshForTests();
});

describe("login", () => {
  it("posts credentials to /v1/auth/login with the cookie jar attached", async () => {
    fetchMock.mockResolvedValue(tokenResponse());

    await login("analyst@example.invalid", "correct horse battery");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/login");
    expect(init.method).toBe("POST");
    // Required so the browser accepts the HttpOnly refresh cookie.
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({
      email: "analyst@example.invalid",
      password: "correct horse battery",
    });
  });

  it("keeps the access token in memory only", async () => {
    fetchMock.mockResolvedValue(tokenResponse("fresh-token"));

    const issued = await login("analyst@example.invalid", "correct horse battery");

    expect(issued.accessToken).toBe("fresh-token");
    expect(getAccessToken()).toBe("fresh-token");
    expect(getCurrentUser()).toEqual(USER);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("renders one fixed message for every rejected credential", async () => {
    for (const status of [400, 401, 403, 404]) {
      fetchMock.mockResolvedValue(jsonResponse({ detail: `code ${status}` }, status));

      await expect(login("analyst@example.invalid", "wrong")).rejects.toThrow(
        "That email and password combination was not recognized.",
      );
    }
  });

  it("never leaks the backend's reason for refusing a sign-in", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "no user row for analyst@example.invalid" }, 401),
    );

    const caught = await login("analyst@example.invalid", "wrong").catch(
      (error: unknown) => error,
    );

    expect((caught as ApiError).message).not.toMatch(/no user row/);
    expect(getAccessToken()).toBeNull();
  });

  it("does not retry a rejected sign-in through the refresh path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 401));

    await expect(login("analyst@example.invalid", "wrong")).rejects.toThrow();

    // Exactly one call: a 401 here means bad credentials, and retrying it would
    // be a second credential attempt the reader did not make.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a rate limit distinctly from a bad password", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "slow down" }, 429));

    await expect(login("analyst@example.invalid", "pw")).rejects.toThrow(
      /too many sign-in attempts/i,
    );
  });

  it("rejects a token response that does not match the contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "t" }, 200));

    await expect(login("analyst@example.invalid", "pw")).rejects.toThrow(
      /unexpected sign-in response/i,
    );
    expect(getAccessToken()).toBeNull();
  });
});

describe("fetchCurrentUser", () => {
  it("sends the bearer token to /v1/auth/me", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));

    await expect(fetchCurrentUser()).resolves.toEqual(USER);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/me");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer live-token");
  });

  it("adopts the server's answer over the token's claim", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ ...USER_PAYLOAD, role: "admin" }, 200));

    await fetchCurrentUser();

    expect(getCurrentUser()?.role).toBe("admin");
  });

  it("rejects a malformed identity rather than rendering a partial one", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ id: USER.id }, 200));

    await expect(fetchCurrentUser()).rejects.toThrow(/unexpected account response/i);
  });
});

describe("logout", () => {
  it("posts to /v1/auth/logout with the cookie attached", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    await logout();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("clears the in-memory session", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    await logout();

    expect(getAccessToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
  });

  it("still signs the browser out when the request fails", async () => {
    setSession("live-token", USER);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(logout()).resolves.toBeUndefined();
    expect(getAccessToken()).toBeNull();
  });

  it("still signs the browser out when the backend errors", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ detail: "boom" }, 500));

    await logout();

    expect(getAccessToken()).toBeNull();
  });
});

describe("acceptInvite", () => {
  it("posts the invitation without any bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));

    await expect(acceptInvite("t".repeat(32), "a-long-password", "Ada")).resolves.toEqual(
      USER,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/invites/accept");
    expect(JSON.parse(init.body)).toEqual({
      token: "t".repeat(32),
      password: "a-long-password",
      display_name: "Ada",
    });
    // Acceptance is how an account first exists; there is no session yet.
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("does not sign the reader in", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));

    await acceptInvite("t".repeat(32), "a-long-password", "Ada");

    expect(getAccessToken()).toBeNull();
  });

  it("renders one fixed message for every unusable invitation", async () => {
    for (const status of [400, 404, 409, 410]) {
      fetchMock.mockResolvedValue(jsonResponse({ detail: `code ${status}` }, status));

      await expect(acceptInvite("t".repeat(32), "a-long-password", "Ada")).rejects.toThrow(
        /that invitation is not valid, has expired, or has already been used/i,
      );
    }
  });

  it("never reveals whether the invitation existed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "invitation 42 already consumed by user 7" }, 400),
    );

    const caught = await acceptInvite("t".repeat(32), "pw-long-enough", "Ada").catch(
      (error: unknown) => error,
    );

    expect((caught as ApiError).message).not.toMatch(/invitation 42|user 7/);
  });
});

describe("createInvite", () => {
  it("sends the admin's bearer token", async () => {
    setSession("admin-token", { ...USER, role: "admin" });
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "33333333-3333-4333-8333-333333333333",
          email: "new@example.invalid",
          expires_at: "2026-08-05T12:00:00Z",
          token: "i".repeat(48),
        },
        201,
      ),
    );

    const invite = await createInvite("new@example.invalid", "member");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/invites");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer admin-token");
    expect(JSON.parse(init.body)).toEqual({ email: "new@example.invalid", role: "member" });
    expect(invite.token).toBe("i".repeat(48));
  });

  it("explains a non-admin refusal without echoing the backend", async () => {
    setSession("member-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ detail: "principal lacks role admin" }, 403));

    await expect(createInvite("new@example.invalid")).rejects.toThrow(
      /only an organization administrator can create invitations/i,
    );
  });
});
