import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("../test/navigation-mock"));
vi.mock("next/link", () => import("../test/link-mock"));

import { LOCAL_APP_URL, LOCAL_API_URL } from "@/lib/local-development";
import { resetRefreshForTests } from "@/lib/http";
import { getAccessToken, resetSessionForTests } from "@/lib/session";
import { resetNavigationMock, routerMock } from "@/test/navigation-mock";

import { AuthProvider } from "./auth-provider";
import { LoginForm } from "./login-form";

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
    { access_token: accessToken, token_type: "bearer", expires_in: 1800, user: USER_PAYLOAD },
    200,
  );
}

/**
 * The bootstrap refresh always runs, so it is routed to a 401 (no cookie) and
 * each case decides what `/v1/auth/login` answers.
 */
function routeLogin(loginResponse: () => Response) {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.endsWith("/v1/auth/login")) return Promise.resolve(loginResponse());
    if (url.endsWith("/v1/auth/me")) return Promise.resolve(jsonResponse(USER_PAYLOAD, 200));
    return Promise.resolve(jsonResponse({ detail: "no cookie" }, 401));
  });
}

async function renderLogin() {
  const view = render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
  // Let the bootstrap refresh settle so later assertions are not racing it.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return view;
}

async function signIn(email = "analyst@example.invalid", password = "correct horse battery") {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.type(screen.getByLabelText(/password/i), password);
  await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetSessionForTests();
  resetRefreshForTests();
  resetNavigationMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionForTests();
  resetRefreshForTests();
});

describe("sign-in screen", () => {
  it("offers the ways a reader can arrive", async () => {
    routeLogin(() => tokenResponse());
    await renderLogin();

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: /accept it here/i })).toHaveAttribute(
      "href",
      "/invite",
    );
  });

  it("hides password reset when the backend cannot deliver a link", async () => {
    // `NEXT_PUBLIC_ENABLE_ACCOUNT_RECOVERY` is unset in tests, matching a
    // deployment with no email provider. Offering the link would send the
    // reader to an endpoint that answers 503.
    routeLogin(() => tokenResponse());
    await renderLogin();

    expect(
      screen.queryByRole("link", { name: /forgot your password/i }),
    ).not.toBeInTheDocument();
  });

  it("signs in, keeps the token in memory, and moves to the workspace", async () => {
    routeLogin(() => tokenResponse("fresh-token"));
    await renderLogin();

    await signIn();

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(getAccessToken()).toBe("fresh-token");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("posts the credentials with the cookie jar attached", async () => {
    routeLogin(() => tokenResponse());
    await renderLogin();

    await signIn();

    const loginCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/auth/login"),
    );
    expect(loginCall?.[1].credentials).toBe("include");
  });

  it("shows fixed copy for a rejected sign-in and never the backend's reason", async () => {
    routeLogin(() =>
      jsonResponse({ detail: "no user row for analyst@example.invalid" }, 401),
    );
    await renderLogin();

    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/that email and password combination was not recognized/i);
    expect(alert).not.toHaveTextContent(/no user row/i);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("clears the password field after a failure", async () => {
    routeLogin(() => jsonResponse({ detail: "nope" }, 401));
    await renderLogin();

    await signIn();
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/password/i)).toHaveValue("");
  });

  it("does not reach the network for an empty form", async () => {
    routeLogin(() => tokenResponse());
    await renderLogin();
    const before = fetchMock.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter your email address/i);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("reports an unreachable backend without exposing the transport error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot reach the backend api/i);
    expect(alert).not.toHaveTextContent(/failed to fetch/i);
  });

  it("explains why the reader was sent here after an expiry", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(tokenResponse());
      if (url.endsWith("/v1/auth/me")) {
        return Promise.resolve(jsonResponse({ detail: "revoked" }, 401));
      }
      return Promise.resolve(jsonResponse({ detail: "revoked" }, 401));
    });

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /your session has ended\. sign in again to continue\./i,
    );
  });

  it("sends an already-authenticated reader back to the workspace", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse(USER_PAYLOAD, 200));
    });

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
  });
});

describe("sign-in accessibility", () => {
  it("labels both fields and names their autofill purpose", async () => {
    routeLogin(() => tokenResponse());
    await renderLogin();

    const email = screen.getByLabelText(/email/i);
    const password = screen.getByLabelText(/password/i);

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });

  it("announces a failure and ties it to the fields it concerns", async () => {
    routeLogin(() => jsonResponse({ detail: "nope" }, 401));
    await renderLogin();

    await signIn();
    const alert = await screen.findByRole("alert");

    const email = screen.getByLabelText(/email/i);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("keeps one focusable heading-to-submit path with no hidden controls", async () => {
    routeLogin(() => tokenResponse());
    await renderLogin();

    await userEvent.tab();
    expect(screen.getByLabelText(/email/i)).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText(/password/i)).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toHaveFocus();
  });

  it("disables the button while the request is in flight", async () => {
    let release: (value: Response) => void = () => {};
    routeLogin(() => {
      throw new Error("unused");
    });
    fetchMock.mockImplementation((input: unknown) => {
      if (String(input).endsWith("/v1/auth/login")) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ detail: "no cookie" }, 401));
    });

    await renderLogin();
    await signIn();

    const button = screen.getByRole("button", { name: /signing in/i });
    expect(button).toBeDisabled();

    release(tokenResponse());
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
  });
});

describe("local development guidance", () => {
  it("names the localhost origins and never the loopback IP literal", async () => {
    routeLogin(() => tokenResponse());
    const { container } = await renderLogin();

    const guidance = screen.getByText(new RegExp(LOCAL_APP_URL.replace(/\//g, "\\/"), "i"));
    expect(guidance).toHaveTextContent(LOCAL_APP_URL);
    expect(guidance).toHaveTextContent(LOCAL_API_URL);
    expect(container.textContent).not.toContain("127.0.0.1");
  });
});
