import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("../test/navigation-mock"));

import { resetRefreshForTests } from "@/lib/http";
import { resetSessionForTests } from "@/lib/session";
import { resetNavigationMock, routerMock } from "@/test/navigation-mock";

import { AuthProvider } from "./auth-provider";
import { RequireAuth } from "./require-auth";

const USER_PAYLOAD = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

const SECRET_CONTENT = "Indexed documents and answers";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse(
    { access_token: "access-token", token_type: "bearer", expires_in: 1800, user: USER_PAYLOAD },
    200,
  );
}

function renderGate() {
  return render(
    <AuthProvider>
      <RequireAuth>
        <p>{SECRET_CONTENT}</p>
      </RequireAuth>
    </AuthProvider>,
  );
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

describe("RequireAuth", () => {
  it("shows nothing of the workspace while the session is being checked", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderGate();

    expect(screen.queryByText(SECRET_CONTENT)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i);
  });

  it("renders the workspace once the session is established", async () => {
    fetchMock.mockImplementation((input: unknown) =>
      Promise.resolve(
        String(input).endsWith("/v1/auth/refresh")
          ? tokenResponse()
          : jsonResponse(USER_PAYLOAD, 200),
      ),
    );

    renderGate();

    expect(await screen.findByText(SECRET_CONTENT)).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("redirects to the login screen when there is no session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "no cookie" }, 401));

    renderGate();

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText(SECRET_CONTENT)).not.toBeInTheDocument();
  });

  it("replaces rather than pushes, so the protected URL leaves no history entry", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "no cookie" }, 401));

    renderGate();

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/login"));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("keeps the reader informed while the redirect is happening", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "no cookie" }, 401));

    renderGate();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/taking you to sign in/i),
    );
  });

  it("announces the check in a live region rather than silently blocking", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderGate();

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
