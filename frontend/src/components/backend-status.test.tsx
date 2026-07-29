import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendStatus } from "./backend-status";

const allReady = {
  status: "ready",
  components: {
    database: { configured: true, reachable: true },
    model: { configured: true, reachable: true },
    qdrant: { configured: true, reachable: true },
    object_storage: { configured: true, reachable: true },
  },
};

/** 503 with a valid body: expected application state, not a transport failure. */
const partiallyReady = {
  status: "not_ready",
  components: {
    database: { configured: true, reachable: true },
    model: { configured: true, reachable: false },
    qdrant: { configured: false, reachable: false },
    object_storage: { configured: true, reachable: true },
  },
};

/**
 * A Response body can only be read once, so every mocked call must build a
 * fresh instance — otherwise the second request (e.g. after Refresh) receives
 * an already-consumed stream.
 */
function jsonResponder(body: unknown, status: number, headers: Record<string, string> = {}) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendStatus", () => {
  it("shows a loading state before the first response resolves", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<BackendStatus />);

    expect(screen.getByText(/checking backend readiness/i)).toBeInTheDocument();
  });

  it("renders all four components from a 200 response", async () => {
    fetchMock.mockImplementation(
      jsonResponder(allReady, 200));
    render(<BackendStatus />);

    expect(await screen.findByText("All dependencies ready")).toBeInTheDocument();

    for (const label of ["PostgreSQL", "Model provider", "Qdrant", "Object storage"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Ready")).toHaveLength(4);
  });

  it("renders partial readiness from a 503 rather than a connection error", async () => {
    fetchMock.mockImplementation(
      jsonResponder(partiallyReady, 503));
    render(<BackendStatus />);

    expect(
      await screen.findByText("Some dependencies are not ready"),
    ).toBeInTheDocument();

    // The structured body must be shown, not swallowed as a failure.
    expect(screen.queryByText(/cannot reach the backend api/i)).not.toBeInTheDocument();
    for (const label of ["PostgreSQL", "Model provider", "Qdrant", "Object storage"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("distinguishes Not configured from Unreachable", async () => {
    fetchMock.mockImplementation(
      jsonResponder(partiallyReady, 503));
    render(<BackendStatus />);

    await screen.findByText("Some dependencies are not ready");

    // model: configured but probe failed -> Unreachable
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    // qdrant: configuration absent -> Not configured
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    // database + object_storage remain Ready
    expect(screen.getAllByText("Ready")).toHaveLength(2);
  });

  it("renders the connection error state on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<BackendStatus />);

    expect(
      await screen.findByText(/cannot reach the backend api/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
  });

  it("treats a malformed readiness body as an error, not partial state", async () => {
    fetchMock.mockImplementation(
      jsonResponder({ status: "ready" }, 200));
    render(<BackendStatus />);

    expect(
      await screen.findByText(/unexpected readiness response/i),
    ).toBeInTheDocument();
  });

  it("shows the request ID when an API error provides one", async () => {
    fetchMock.mockImplementation(
      jsonResponder({ detail: "boom" }, 500, { "X-Request-ID": "abc123def456" }),
    );
    render(<BackendStatus />);

    expect(await screen.findByText(/request id: abc123def456/i)).toBeInTheDocument();
  });

  it("does not leak backend error detail into the UI", async () => {
    fetchMock.mockImplementation(
      jsonResponder(
        { detail: "psycopg.OperationalError: password authentication failed" },
        500,
        { "X-Request-ID": "req-9" },
      ),
    );
    render(<BackendStatus />);

    await screen.findByText(/request id: req-9/i);
    expect(screen.queryByText(/psycopg/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });

  it("performs another readiness request when refresh is clicked", async () => {
    fetchMock.mockImplementation(
      jsonResponder(allReady, 200));
    render(<BackendStatus />);

    await screen.findByText("All dependencies ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("All dependencies ready")).toBeInTheDocument();
  });

  it("requests /readyz on the configured base URL", async () => {
    fetchMock.mockImplementation(
      jsonResponder(allReady, 200));
    render(<BackendStatus />);

    await screen.findByText("All dependencies ready");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:8000/readyz");
  });

  it("exposes an aria-live region so status changes are announced", async () => {
    fetchMock.mockImplementation(
      jsonResponder(allReady, 200));
    const { container } = render(<BackendStatus />);

    await screen.findByText("All dependencies ready");
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
