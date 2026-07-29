import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAllDrafts } from "@/lib/drafts";

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

/** Sends the chunks, then never closes — the run is still going server-side. */
function openSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
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
  /** Answer for the mount-time `GET /v1/runs`. Empty means nothing to rejoin. */
  runList = { runs: [] },
}: {
  events: Response | (() => Response);
  run?: unknown;
  runList?: unknown;
}) {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/runs") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
    }
    if (url.endsWith("/v1/runs")) {
      return Promise.resolve(jsonResponse(runList, 200));
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
  // The draft store is module state that deliberately outlives a remount, so
  // each case starts from an empty one rather than inheriting typing from the
  // case before it.
  clearAllDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAllDrafts();
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

    // Located by method rather than by index: the workspace also asks for the
    // run list on mount, to rejoin anything still in flight.
    const created = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((created?.[1] as RequestInit).body as string)).toEqual({
      question: "What changed?",
    });
  });

  it("rejoins a run that was still going when the page loaded", async () => {
    // Durability made visible: nothing is remembered in the browser, the
    // backend is asked what is still running.
    routeBackend({
      runList: { runs: [{ id: "run-9", status: "running" }] },
      events: sseResponse([
        frame("retrieving"),
        frame("completed", { citation_count: 0 }),
      ]),
    });

    render(<AnalystWorkspace />);

    expect(await screen.findByText("Answer ready.")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/runs/run-9/events")),
    ).toBe(true);
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

    const sources = screen.getByRole("list", { name: /sources supporting/i });
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

  it("reads a 503 as service availability rather than a bad document", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "gemini: 429 RESOURCE_EXHAUSTED" }, 503),
    );
    render(<AnalystWorkspace />);

    await ask();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unavailable right now/i);
    expect(alert).toHaveTextContent(/not a problem with your documents/i);
    expect(alert).not.toHaveTextContent(/gemini|RESOURCE_EXHAUSTED/i);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("tells the reader follow-ups can use earlier context, without a transcript", async () => {
    routeBackend({ events: sseResponse([frame("completed")]) });
    render(<AnalystWorkspace />);

    const hint = screen.getByText(/follow-up questions can build on earlier/i);
    expect(hint).toBeInTheDocument();
    expect(screen.getByLabelText(/your question/i)).toHaveAttribute(
      "aria-describedby",
      hint.id,
    );

    await ask("And what about margin?");
    await screen.findByText("Answer ready.");

    // Recall is backend behaviour. The stored records are formatted
    // "Earlier question: … / Earlier answer: …" — none of that may render,
    // and there is no transcript surface to hold it.
    expect(screen.queryByText(/earlier question:|earlier answer:/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /history|transcript/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /history|previous/i }))
      .not.toBeInTheDocument();
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

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    // One sentence, not a re-read of the whole stage list on every update.
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("Answer ready.");
    expect(live?.querySelector("ol")).toBeNull();
  });
});

describe("AnalystWorkspace workflow trace", () => {
  function trace(): HTMLElement {
    return screen.getByRole("list", { name: "Live workflow trace" });
  }

  function stage(name: RegExp): HTMLElement {
    const item = within(trace())
      .getAllByRole("listitem")
      .find((element) => name.test(element.textContent ?? ""));
    if (!item) throw new Error(`No stage matching ${name}`);
    return item;
  }

  it("walks supervisor → agent → review → answer over one SSE run", async () => {
    routeBackend({
      events: sseResponse([
        frame("run_started", { run_id: "run-1" }),
        frame("routing", { next: "retriever" }),
        frame("retrieving", { source: "documents" }),
        frame("generating"),
        frame("completed", { citation_count: 1 }),
      ]),
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByText("Answer ready.");

    expect(within(trace()).getAllByRole("listitem")).toHaveLength(4);
    expect(stage(/supervisor/i)).toHaveTextContent("Done");
    expect(stage(/selected agent/i)).toHaveTextContent(
      "Gathered approved source material.",
    );
    expect(stage(/quality review/i)).toHaveTextContent("Done");
    expect(stage(/final answer/i)).toHaveTextContent("Ready below, with its sources.");
  });

  it("keeps every payload, route, and reasoning field out of the trace", async () => {
    routeBackend({
      events: sseResponse([
        frame("routing", { next: "web", rationale: "SECRET_TRACE" }),
        frame("retrieving", { source: "web", query: "SECRET_QUERY" }),
        frame("generating", { critic: "REJECTED: hallucinated" }),
        frame("completed", { trace_id: "SECRET_TRACE_ID" }),
      ]),
      run: { ...COMPLETED_RUN, error: "gemini: 429 RESOURCE_EXHAUSTED" },
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByText("Answer ready.");

    expect(trace()).not.toHaveTextContent(
      /SECRET_TRACE|SECRET_QUERY|SECRET_TRACE_ID|rationale|REJECTED|gemini/i,
    );
    // Raw event names are internal contract, not reader-facing labels.
    for (const name of ["run_started", "routing", "retrieving", "generating"]) {
      expect(trace()).not.toHaveTextContent(name);
    }
  });

  it("marks the trace as failed without borrowing the backend's error text", async () => {
    routeBackend({
      events: sseResponse([
        frame("routing"),
        frame("retrieving"),
        frame("failed", { message: "Gemini quota exceeded" }),
      ]),
    });
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByRole("alert");

    expect(stage(/selected agent/i)).toHaveTextContent(
      "Stopped when the run could not continue.",
    );
    expect(stage(/final answer/i)).toHaveTextContent("Not reached");
    expect(trace()).not.toHaveTextContent(/gemini|quota/i);
  });

  it("shows a cancelled run as stopped by the reader, not as a failure", async () => {
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/runs") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
      }
      // Emits one stage, then stays open like a long-running analysis.
      return Promise.resolve(openSseResponse([frame("routing")]));
    });
    render(<AnalystWorkspace />);

    await ask();
    // Both the live region and the trail carry the label once routing arrives.
    await screen.findAllByText("Planning the next step");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(stage(/supervisor/i)).toHaveTextContent(
      "Stopped when you cancelled this run.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /stopped following this run/i,
    );
  });

  it("hides the trace when the run never started", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AnalystWorkspace />);

    await ask();
    await screen.findByRole("alert");

    expect(
      screen.queryByRole("list", { name: "Live workflow trace" }),
    ).not.toBeInTheDocument();
  });

  it("moves focus to Try again when cancelling removes the focused control", async () => {
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/runs") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: "run-1", status: "queued" }, 202));
      }
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
      );
    });
    render(<AnalystWorkspace />);

    await ask();
    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    cancelButton.focus();
    await userEvent.click(cancelButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try again/i })).toHaveFocus(),
    );
  });
});
