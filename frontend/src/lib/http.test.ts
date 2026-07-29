import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "./auth";
import {
  ApiError,
  SESSION_EXPIRED_MESSAGE,
  authorizedJson,
  refreshSession,
  resetRefreshForTests,
  withRefreshRetry,
} from "./http";
import {
  getAccessToken,
  getCurrentUser,
  resetSessionForTests,
  setSession,
} from "./session";

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

function tokenResponse(accessToken: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 1800,
      user: {
        id: USER.id,
        email: USER.email,
        organization_id: USER.organizationId,
        role: USER.role,
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

describe("refreshSession", () => {
  it("posts to /v1/auth/refresh with the cookie attached", async () => {
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    await expect(refreshSession()).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/refresh");
    expect(init.method).toBe("POST");
    // The HttpOnly refresh cookie only rides along because of this.
    expect(init.credentials).toBe("include");
  });

  it("keeps the rotated access token in memory", async () => {
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    await refreshSession();

    expect(getAccessToken()).toBe("rotated-token");
    expect(getCurrentUser()).toEqual(USER);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("replaces the previous token on every rotation", async () => {
    setSession("first-token", USER);
    fetchMock.mockResolvedValue(tokenResponse("second-token"));

    await refreshSession();

    expect(getAccessToken()).toBe("second-token");
  });

  it("resolves false and clears the session when the cookie is rejected", async () => {
    setSession("stale-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ detail: "expired" }, 401));

    await expect(refreshSession()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
  });

  it("treats a malformed token response as a failed refresh", async () => {
    setSession("stale-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "" }, 200));

    await expect(refreshSession()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    const [a, b, c] = await Promise.all([
      refreshSession(),
      refreshSession(),
      refreshSession(),
    ]);

    // Rotation invalidates the old cookie, so three parallel refreshes would
    // revoke the very session they were sent to save.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual([true, true, true]);
  });

  it("allows a later refresh after the shared one settles", async () => {
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    await refreshSession();
    await refreshSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("withRefreshRetry", () => {
  it("passes a successful attempt straight through", async () => {
    const attempt = vi.fn().mockResolvedValue("ok");

    await expect(withRefreshRetry(attempt)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes once and retries once after a 401", async () => {
    setSession("expired-token", USER);
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("Request failed (401).", 401))
      .mockResolvedValueOnce("ok");

    await expect(withRefreshRetry(attempt)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("rotated-token");
  });

  it("gives up after a second 401 rather than refreshing again", async () => {
    setSession("expired-token", USER);
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    const attempt = vi
      .fn()
      .mockRejectedValue(new ApiError("Request failed (401).", 401, "req-9"));

    await expect(withRefreshRetry(attempt)).rejects.toMatchObject({
      status: 401,
      message: SESSION_EXPIRED_MESSAGE,
      requestId: "req-9",
    });

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it("reports a failed refresh as an ended session, not as a backend error", async () => {
    setSession("expired-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ detail: "token reuse detected" }, 401));

    const attempt = vi.fn().mockRejectedValue(new ApiError("Request failed (401).", 401));

    await expect(withRefreshRetry(attempt)).rejects.toMatchObject({
      status: 401,
      message: SESSION_EXPIRED_MESSAGE,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it("never leaks the backend's 401 detail", async () => {
    setSession("expired-token", USER);
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "refresh token reuse for user 41 in org 7" }, 401),
    );

    const attempt = vi.fn().mockRejectedValue(new ApiError("Request failed (401).", 401));

    const caught = await withRefreshRetry(attempt).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe(SESSION_EXPIRED_MESSAGE);
    expect((caught as ApiError).message).not.toMatch(/user 41|org 7|reuse/);
  });

  it("does not refresh for any other failure", async () => {
    const attempt = vi.fn().mockRejectedValue(new ApiError("Request failed (500).", 500));

    await expect(withRefreshRetry(attempt)).rejects.toMatchObject({ status: 500 });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not refresh when the request never reached the backend", async () => {
    const attempt = vi.fn().mockRejectedValue(new ApiError("Cannot reach the backend API.", 0));

    await expect(withRefreshRetry(attempt)).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("authorizedJson", () => {
  it("sends the in-memory bearer token and no ambient credentials", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 200));

    await authorizedJson("http://localhost:8000/v1/runs/abc");

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer live-token");
    // Bearer-authenticated data requests must not carry the refresh cookie.
    expect(init.credentials).toBe("omit");
  });

  it("omits the header entirely when signed out", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 200));

    await authorizedJson("http://localhost:8000/v1/runs/abc");

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("retries with the rotated token after a 401", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(tokenResponse("rotated-token"))
      .mockResolvedValueOnce(jsonResponse({ id: "run-1" }, 200));

    await expect(authorizedJson("http://localhost:8000/v1/runs/abc")).resolves.toMatchObject({
      parsed: { id: "run-1" },
    });

    const [, retryInit] = fetchMock.mock.calls[2];
    expect(new Headers(retryInit.headers).get("Authorization")).toBe("Bearer rotated-token");
  });
});
