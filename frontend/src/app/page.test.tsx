import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("../test/navigation-mock"));

import { resetRefreshForTests } from "@/lib/http";
import { resetSessionForTests } from "@/lib/session";
import { clearAllDrafts } from "@/lib/drafts";
import { AuthProvider } from "@/components/auth-provider";
import { resetNavigationMock, routerMock } from "@/test/navigation-mock";

import Home from "./page";

/**
 * The landing page composes the workspace behind the login; the behaviour of
 * each part is covered by its own suite. These tests pin the composition and
 * the scope boundary — the workspace is reachable only with a session, the
 * demo-era copy is gone, and the readiness diagnostics are development-only.
 */

const USER_PAYLOAD = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

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

/**
 * Sign in, and leave `/readyz` pending so the readiness panel stays in its
 * loading state and no network behaviour leaks into these assertions.
 */
function routeAuthenticated() {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(tokenResponse());
    if (url.endsWith("/v1/auth/me")) return Promise.resolve(jsonResponse(USER_PAYLOAD, 200));
    return new Promise(() => {});
  });
}

async function renderSignedIn() {
  const view = render(
    <AuthProvider>
      <Home />
    </AuthProvider>,
  );
  await screen.findByRole("heading", { name: /multi-agent ai analyst/i });
  return view;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetSessionForTests();
  resetRefreshForTests();
  resetNavigationMock();
  clearAllDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetSessionForTests();
  resetRefreshForTests();
  clearAllDrafts();
});

describe("Home", () => {
  it("is not reachable without a session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "no cookie" }, 401));

    render(
      <AuthProvider>
        <Home />
      </AuthProvider>,
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a document/i)).not.toBeInTheDocument();
  });

  it("offers the document uploader", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(screen.getByLabelText(/choose a document/i)).toBeInTheDocument();
  });

  it("states the supported formats and limit next to the uploader", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(
      screen.getByText(
        /PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML file up to 10 MB/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/not supported:/i)).toHaveTextContent(
      /password-protected PDFs/i,
    );
  });

  it("offers the question form", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeInTheDocument();
  });

  it("shows who is signed in and how to leave", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(screen.getByText(/signed in as/i)).toHaveTextContent("analyst@example.invalid");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("no longer describes itself as a local, shared, or unauthenticated demo", async () => {
    routeAuthenticated();
    const { container } = await renderSignedIn();

    expect(container.textContent).not.toMatch(/unauthenticated demo/i);
    expect(container.textContent).not.toMatch(/one shared workspace/i);
    expect(container.textContent).not.toMatch(/no accounts/i);
    expect(container.textContent).not.toMatch(/local demo/i);
  });

  it("keeps the secrets-stay-on-the-backend promise", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(
      screen.getByText(/never holds provider, database, or model secrets/i),
    ).toBeInTheDocument();
  });

  it("mentions follow-up context without exposing a transcript", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(
      screen.getByText(/follow-up questions can build on earlier questions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /conversation|transcript|history/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the readiness diagnostics during development", async () => {
    routeAuthenticated();
    await renderSignedIn();

    expect(screen.getByRole("heading", { name: "Backend status" })).toBeInTheDocument();
    expect(screen.getByText(/Reading this panel/i)).toBeInTheDocument();
  });
});

describe("Home in production", () => {
  /**
   * `config.ts` resolves its constants once at module load, so the production
   * branch has to be reached with a fresh module graph rather than by toggling
   * a value at runtime.
   */
  async function renderProductionHome() {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.invalid");
    vi.resetModules();

    const [{ default: ProductionHome }, { AuthProvider: ProductionAuthProvider }] =
      await Promise.all([import("./page"), import("@/components/auth-provider")]);

    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(tokenResponse());
      if (url.endsWith("/v1/auth/me")) return Promise.resolve(jsonResponse(USER_PAYLOAD, 200));
      return new Promise(() => {});
    });

    const view = render(
      <ProductionAuthProvider>
        <ProductionHome />
      </ProductionAuthProvider>,
    );
    await screen.findByRole("heading", { name: /multi-agent ai analyst/i });
    return view;
  }

  it("omits the backend readiness diagnostics entirely", async () => {
    const { container } = await renderProductionHome();

    // Absent from the markup, not merely hidden: the panel names the backend's
    // dependencies and their reachability.
    expect(screen.queryByRole("heading", { name: "Backend status" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading this panel/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/PostgreSQL|Qdrant|Object storage/i);
    expect(container.textContent).not.toMatch(/not configured|unreachable/i);
  });

  it("still offers the workspace itself", async () => {
    await renderProductionHome();

    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a document/i)).toBeInTheDocument();
  });
});
