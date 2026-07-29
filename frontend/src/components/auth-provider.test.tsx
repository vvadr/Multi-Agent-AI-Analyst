import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_EXPIRED_MESSAGE } from "@/lib/http";
import { resetRefreshForTests } from "@/lib/http";
import { clearSession, getAccessToken, resetSessionForTests } from "@/lib/session";
import { readDraft, saveDraft } from "@/lib/drafts";

import { AuthProvider, SIGNED_OUT_MESSAGE, useAuth } from "./auth-provider";

const USER_PAYLOAD = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

/** Renders the context so its state can be asserted from the DOM. */
function SessionProbe() {
  const { status, user, notice, signOut } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.email ?? "none"}</p>
      <p data-testid="notice">{notice ?? "none"}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <SessionProbe />
    </AuthProvider>,
  );
}

/** Route a request by URL, so the bootstrap's two calls can differ. */
function routeAuth(handlers: Record<string, () => Response | Promise<Response>>) {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    for (const [suffix, handler] of Object.entries(handlers)) {
      if (url.endsWith(suffix)) return Promise.resolve(handler());
    }
    return Promise.reject(new TypeError(`unrouted request: ${url}`));
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

describe("startup", () => {
  it("refreshes, keeps the token in memory, then confirms with /auth/me", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse("bootstrap-token"),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
    });

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    const called = fetchMock.mock.calls.map(([url]) => String(url));
    expect(called[0]).toBe("http://localhost:8000/v1/auth/refresh");
    expect(called[1]).toBe("http://localhost:8000/v1/auth/me");

    expect(getAccessToken()).toBe("bootstrap-token");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("sends the refresh with credentials and the me call with the bearer token", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse("bootstrap-token"),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
    });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    const [, refreshInit] = fetchMock.mock.calls[0];
    expect(refreshInit.credentials).toBe("include");

    const [, meInit] = fetchMock.mock.calls[1];
    expect(new Headers(meInit.headers).get("Authorization")).toBe("Bearer bootstrap-token");
  });

  it("renders the identity the server returned, not the one in the token response", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () =>
        jsonResponse({ ...USER_PAYLOAD, email: "renamed@example.invalid" }, 200),
    });

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("renamed@example.invalid"),
    );
  });

  it("lands on unauthenticated with no notice when there is no cookie", async () => {
    routeAuth({ "/v1/auth/refresh": () => jsonResponse({ detail: "missing" }, 401) });

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    // A first visit is not an expiry, and must not be announced as one.
    expect(screen.getByTestId("notice")).toHaveTextContent("none");
  });

  it("explains an expiry when the refresh works but /auth/me refuses", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () => jsonResponse({ detail: "revoked" }, 401),
    });

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(screen.getByTestId("notice")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
    expect(getAccessToken()).toBeNull();
  });

  it("treats an unreachable backend as signed out rather than crashing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
  });
});

describe("session ended elsewhere", () => {
  it("turns a cleared session into a visible, explained sign-out", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
    });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    // What the 401 policy does when a refresh fails mid-session.
    act(() => clearSession("expired"));

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent(SESSION_EXPIRED_MESSAGE),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });
});

describe("sign out", () => {
  it("revokes the refresh session and clears in-memory state", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
      "/v1/auth/logout": () => jsonResponse(undefined, 204),
    });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(screen.getByTestId("notice")).toHaveTextContent(SIGNED_OUT_MESSAGE);
    expect(getAccessToken()).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/auth/logout")),
    ).toBe(true);
  });

  it("drops unsent drafts so they do not greet the next person", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
      "/v1/auth/logout": () => jsonResponse(undefined, 204),
    });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    saveDraft("question", "What is our Q3 exposure?");
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(readDraft("question")).toBe(""));
  });

  it("signs the browser out even when the logout request fails", async () => {
    routeAuth({
      "/v1/auth/refresh": () => tokenResponse(),
      "/v1/auth/me": () => jsonResponse(USER_PAYLOAD, 200),
      "/v1/auth/logout": () => {
        throw new TypeError("Failed to fetch");
      },
    });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(getAccessToken()).toBeNull();
  });
});

describe("useAuth", () => {
  it("fails loudly when used outside the provider", () => {
    // React logs the thrown error; silence it so the run stays readable.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<SessionProbe />)).toThrow(/useAuth must be used inside/);

    consoleError.mockRestore();
  });
});
