import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("../test/navigation-mock"));
vi.mock("next/link", () => import("../test/link-mock"));

import { resetRefreshForTests } from "@/lib/http";
import { getAccessToken, resetSessionForTests } from "@/lib/session";
import { resetNavigationMock, routerMock, setSearchParams } from "@/test/navigation-mock";

import { ResetPasswordForm } from "./reset-password-form";
import { SignupForm } from "./signup-form";

const VALID_PASSWORD = "correct horse battery staple";
const VALID_TOKEN = "t".repeat(43);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
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
  resetNavigationMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionForTests();
  resetRefreshForTests();
  resetNavigationMock();
});

async function fillSignup(email = "new@example.invalid") {
  await userEvent.type(screen.getByLabelText(/your name/i), "New Reader");
  await userEvent.type(screen.getByLabelText(/^email$/i), email);
  await userEvent.type(screen.getByLabelText(/^password$/i), VALID_PASSWORD);
  await userEvent.click(screen.getByRole("button", { name: /create account/i }));
}

const USER_PAYLOAD = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "new@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "admin",
};

function sessionResponse(accessToken = "signup-token"): Response {
  return jsonResponse(
    {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 1800,
      user: USER_PAYLOAD,
    },
    201,
  );
}

describe("registration", () => {
  it("signs the reader in and sends them to their workspace", async () => {
    fetchMock.mockResolvedValue(sessionResponse());
    render(<SignupForm />);

    await fillSignup();

    // No confirmation step: registering is the whole of it.
    await vi.waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(getAccessToken()).toBe("signup-token");
  });

  it("keeps the token in memory and out of persistent storage", async () => {
    fetchMock.mockResolvedValue(sessionResponse());
    render(<SignupForm />);

    await fillSignup();

    await vi.waitFor(() => expect(getAccessToken()).toBe("signup-token"));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("sends the registration to the signup endpoint", async () => {
    fetchMock.mockResolvedValue(sessionResponse());
    render(<SignupForm />);

    await fillSignup();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/auth\/signup$/);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      email: "new@example.invalid",
      display_name: "New Reader",
    });
    // The refresh cookie has to be accepted from a cross-origin backend.
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("rejects a short password without a round trip", async () => {
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText(/your name/i), "New Reader");
    await userEvent.type(screen.getByLabelText(/^email$/i), "new@example.invalid");
    await userEvent.type(screen.getByLabelText(/^password$/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 12 characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says plainly when the address is already registered", async () => {
    // The one disclosure the API makes on purpose: a signup form that silently
    // did nothing would be unusable.
    fetchMock.mockResolvedValue(jsonResponse({ detail: "taken" }, 409));
    render(<SignupForm />);

    await fillSignup("taken@example.invalid");

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("does not leave the chosen password in the DOM after a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "taken" }, 409));
    const { container } = render(<SignupForm />);

    await fillSignup();
    await screen.findByRole("alert");

    expect(container.innerHTML).not.toContain(VALID_PASSWORD);
  });
});

describe("password reset", () => {
  it("changes the password and sends the reader to sign in", async () => {
    setSearchParams(`token=${VALID_TOKEN}`);
    fetchMock.mockResolvedValue(jsonResponse({ status: "accepted" }, 200));
    render(<ResetPasswordForm />);

    await userEvent.type(screen.getByLabelText("New password"), VALID_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(
      await screen.findByRole("heading", { name: /password changed/i }),
    ).toBeInTheDocument();
    // Other sessions are revoked server side, so this must not sign anyone in.
    expect(screen.getByRole("link", { name: /go to sign in/i })).toBeInTheDocument();
  });

  it("explains an incomplete link rather than rendering a dead form", async () => {
    render(<ResetPasswordForm />);

    expect(
      await screen.findByRole("heading", { name: /link is incomplete/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("shows fixed copy for a rejected token and never the backend's reason", async () => {
    setSearchParams(`token=${VALID_TOKEN}`);
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "token_hash 9f2 not found in password_reset_tokens" }, 400),
    );
    render(<ResetPasswordForm />);

    await userEvent.type(screen.getByLabelText("New password"), VALID_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/invalid or has expired/i);
    expect(alert).not.toHaveTextContent(/token_hash|password_reset_tokens/i);
  });
});
