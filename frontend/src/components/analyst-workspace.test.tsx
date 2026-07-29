import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalystWorkspace } from "./analyst-workspace";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function frame(type: string, data: unknown = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

const COMPLETED_RUN = {
  id: "run-1",
  status: "completed",
  answer: "Revenue grew 4% year on year.",
  citations: [],
  error: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Route the three endpoints the workspace touches. */
function routeBackend({
  events,
  run = COMPLETED_RUN,
}: {
  events: Response | (() => Response);
  run?: unknown;
}) {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/runs") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
    }
    if (url.includes("/events")) {
      return Promise.resolve(typeof events === "function" ? events() : events);
    }
    return Promise.resolve(jsonResponse(run, 200));
  });
}

async function ask(question = "What changed?") {
  await userEvent.type(screen.getByLabelText(/your question/i), question);
  await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnalystWorkspace", () => {
  it("disables submission until a question is typed", async () => {
    render(<AnalystWorkspace />);

    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/your question/i), "hi");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeEnabled();
  });

  it("creates a run and renders progress derived from the event types", async () => {
    routeBackend({
      events: sseResponse([
        frame("run_started", { run_id: "run-1" }),
        frame("routing", { next: "retriever" }),
        frame("retrieving"),
        frame("generating"),
        frame("completed", { citation_count: 0 }),
      ]),
    });
    render(<AnalystWorkspace />);

    await ask();

    expect(await screen.findByText("Answer ready.")).toBeInTheDocument();
    expect(screen.getByText("Run started")).toBeInTheDocument();
    expect(screen.getByText("Planning the next step")).toBeInTheDocument();
    expect(screen.getByText("Gathering source material")).toBeInTheDocument();
    expect(screen.getByText("Writing the answer")).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ question: "What changed?" });
  });

  it("never renders event payloads or raw event names", async () => {
    routeBackend({
      events: sseResponse([
        frame("routing", { next: "web", rationale: "SECRET_TRACE" }),
        frame("retrieving", { source: "web" }),
        frame("completed"),
      ]),
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByText("Answer ready.");

    expect(screen.queryByText(/SECRET_TRACE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rationale/i)).not.toBeInTheDocument();
    expect(screen.queryByText("routing")).not.toBeInTheDocument();
    expect(screen.queryByText("retrieving")).not.toBeInTheDocument();
  });

  it("collapses a stage the graph repeats on its way round the loop", async () => {
    routeBackend({
      events: sseResponse([
        frame("routing"),
        frame("routing"),
        frame("retrieving"),
        frame("completed"),
      ]),
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByText("Answer ready.");

    expect(screen.getAllByText("Planning the next step")).toHaveLength(1);
  });

  it("renders the answer with document and web citations", async () => {
    routeBackend({
      events: sseResponse([frame("completed")]),
      run: {
        ...COMPLETED_RUN,
        citations: [
          {
            id: "document:doc-1:3",
            kind: "document",
            title: "q3-report.txt",
            excerpt: "Revenue rose across every region.",
            document_id: "doc-1",
            chunk_index: 3,
          },
          {
            id: "web:1",
            kind: "web",
            title: "Quarterly market summary",
            excerpt: "Analysts expected growth.",
            url: "https://example.org/summary",
          },
        ],
      },
    });
    render(<AnalystWorkspace />);

    await ask();

    expect(
      await screen.findByText("Revenue grew 4% year on year."),
    ).toBeInTheDocument();

    const sources = screen.getByRole("list");
    expect(within(sources).getByText("q3-report.txt")).toBeInTheDocument();
    expect(within(sources).getByText(/chunk 3/)).toBeInTheDocument();
    expect(
      within(sources).getByText("Revenue rose across every region."),
    ).toBeInTheDocument();

    const link = within(sources).getByRole("link", {
      name: /quarterly market summary/i,
    });
    expect(link).toHaveAttribute("href", "https://example.org/summary");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(sources).getByText("External web")).toBeInTheDocument();
  });

  it("does not create a link for a citation with an unsafe URL", async () => {
    routeBackend({
      events: sseResponse([frame("completed")]),
      run: {
        ...COMPLETED_RUN,
        citations: [
          {
            id: "web:1",
            kind: "web",
            title: "Hostile source",
            excerpt: "",
            url: "javascript:alert(document.cookie)",
          },
        ],
      },
    });
    render(<AnalystWorkspace />);

    await ask();

    expect(await screen.findByText("Hostile source")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reports an empty answer rather than rendering a blank result", async () => {
    routeBackend({
      events: sseResponse([frame("completed")]),
      run: { ...COMPLETED_RUN, answer: "" },
    });
    render(<AnalystWorkspace />);

    await ask();

    expect(
      await screen.findByText(/completed without an answer/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no sources were cited/i)).toBeInTheDocument();
  });

  it("shows fixed copy on a failed run and never the backend error text", async () => {
    routeBackend({
      events: sseResponse([frame("failed", { message: "Gemini quota exceeded" })]),
      run: {
        id: "run-1",
        status: "failed",
        answer: null,
        citations: [],
        error: "Gemini quota exceeded",
      },
    });
    render(<AnalystWorkspace />);

    await ask();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The analyst run could not be completed. Please try again.",
    );
    expect(screen.queryByText(/gemini|quota/i)).not.toBeInTheDocument();
  });

  it("surfaces an unreachable backend when the run cannot be created", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AnalystWorkspace />);

    await ask();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot reach the backend API.",
    );
  });

  it("retries the same question after a failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByRole("alert");

    routeBackend({ events: sseResponse([frame("completed")]) });
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Answer ready.")).toBeInTheDocument();
  });

  it("cancels an in-flight run and aborts the stream", async () => {
    let streamSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/runs") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
      }
      streamSignal = init?.signal ?? undefined;
      // A stream that never closes, standing in for a long-running analysis.
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
      );
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByRole("button", { name: /cancel/i });
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(
      screen.getByText(/stopped following this run/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(streamSignal?.aborted).toBe(true));
  });

  it("aborts the stream when the component unmounts", async () => {
    let streamSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/runs") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
      }
      streamSignal = init?.signal ?? undefined;
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
      );
    });
    const { unmount } = render(<AnalystWorkspace />);

    await ask();
    await screen.findByRole("button", { name: /cancel/i });
    unmount();

    await waitFor(() => expect(streamSignal?.aborted).toBe(true));
  });

  it("announces progress in a live region", async () => {
    routeBackend({ events: sseResponse([frame("completed")]) });
    const { container } = render(<AnalystWorkspace />);

    await ask();
    await screen.findByText("Answer ready.");

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
