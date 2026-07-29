import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createRun,
  getReadiness,
  getRun,
  streamRunEvents,
  uploadDocument,
  type RunEvent,
} from "./api";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Minimal XHR double — `uploadDocument` uses XHR for upload progress. */
class FakeXhr {
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = "";
  timeout = 0;
  method = "";
  url = "";
  body: unknown = null;

  private responseHeaders: Record<string, string> = {};
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
  readonly upload = new FakeUploadTarget();

  constructor() {
    FakeXhr.instances.push(this);
  }

  static get last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (!instance) throw new Error("no XMLHttpRequest was created");
    return instance;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.dispatch("abort");
  }
  addEventListener(type: string, handler: (event?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }
  dispatch(type: string, event?: unknown) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  respond(status: number, body: string, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseText = body;
    this.responseHeaders = headers;
    this.dispatch("load");
  }
}

class FakeUploadTarget {
  private readonly listeners: ((event: unknown) => void)[] = [];

  addEventListener(_type: string, handler: (event: unknown) => void) {
    this.listeners.push(handler);
  }
  emitProgress(loaded: number, total: number) {
    for (const handler of this.listeners) {
      handler({ lengthComputable: true, loaded, total });
    }
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* createRun                                                          */
/* ------------------------------------------------------------------ */

describe("createRun", () => {
  it("posts the question and returns the accepted run", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "run-1", status: "queued" }, 202));

    await expect(createRun("What changed?")).resolves.toEqual({
      id: "run-1",
      status: "queued",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ question: "What changed?" });
  });

  it("maps a busy backend (429) to safe copy", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "the local demo is busy" }, 429, {
        "X-Request-ID": "req-1",
      }),
    );

    await expect(createRun("q")).rejects.toMatchObject({
      status: 429,
      requestId: "req-1",
      message: "The demo is already running an analysis. Try again in a moment.",
    });
  });

  it("maps a disabled demo API (404) to safe copy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Not found" }, 404));

    await expect(createRun("q")).rejects.toMatchObject({
      status: 404,
      message: "This backend is not serving the local demo API.",
    });
  });

  it("reads a 503 as service availability, not as a bad document", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "gemini: 429 RESOURCE_EXHAUSTED" }, 503, {
        "X-Request-ID": "req-3",
      }),
    );

    const error = await createRun("q").catch((caught: ApiError) => caught);

    expect(error).toMatchObject({ status: 503, requestId: "req-3" });
    expect((error as ApiError).message).toContain("unavailable right now");
    expect((error as ApiError).message).toContain(
      "not a problem with your documents",
    );
    expect((error as ApiError).message).not.toMatch(/gemini|RESOURCE_EXHAUSTED/i);
  });

  it("never surfaces the backend detail string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "psycopg.OperationalError: password failed" }, 500),
    );

    const error = await createRun("q").catch((caught: ApiError) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).not.toMatch(/psycopg|password/i);
  });

  it("rejects a body that does not match the contract", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "queued" }, 202, { "X-Request-ID": "req-2" }),
    );

    await expect(createRun("q")).rejects.toMatchObject({
      message: "The backend returned an unexpected run response.",
      requestId: "req-2",
    });
  });

  it("reports an unreachable backend as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(createRun("q")).rejects.toMatchObject({
      status: 0,
      message: "Cannot reach the backend API.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* getRun                                                             */
/* ------------------------------------------------------------------ */

describe("getRun", () => {
  it("parses a completed run with its citations", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "run-1",
          status: "completed",
          answer: "Revenue grew 4%.",
          citations: [
            {
              id: "document:doc-1:0",
              kind: "document",
              title: "q3.txt",
              excerpt: "Revenue rose.",
              document_id: "doc-1",
              chunk_index: 0,
            },
          ],
          error: null,
        },
        200,
      ),
    );

    const detail = await getRun("run-1");

    expect(detail.answer).toBe("Revenue grew 4%.");
    expect(detail.citations[0]).toMatchObject({
      kind: "document",
      title: "q3.txt",
      chunkIndex: 0,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:8000/v1/runs/run-1",
    );
  });

  it("maps a missing run to safe copy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Run not found" }, 404));

    await expect(getRun("run-1")).rejects.toMatchObject({
      status: 404,
      message: "That run is no longer available.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* getReadiness                                                       */
/* ------------------------------------------------------------------ */

describe("getReadiness", () => {
  const report = {
    status: "not_ready",
    components: {
      database: { configured: true, reachable: true },
      model: { configured: true, reachable: false },
      qdrant: { configured: false, reachable: false },
      object_storage: { configured: true, reachable: true },
    },
  };

  it("treats a 503 carrying a valid body as application state", async () => {
    fetchMock.mockResolvedValue(jsonResponse(report, 503));

    await expect(getReadiness()).resolves.toEqual(report);
  });

  it("still rejects a 503 whose body breaks the contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "not_ready" }, 503));

    await expect(getReadiness()).rejects.toMatchObject({
      status: 503,
      message: "The backend returned an unexpected readiness response.",
    });
  });

  it("rejects a status outside the readiness contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse(report, 500));

    await expect(getReadiness()).rejects.toMatchObject({ status: 500 });
  });
});

/* ------------------------------------------------------------------ */
/* uploadDocument                                                     */
/* ------------------------------------------------------------------ */

describe("uploadDocument", () => {
  const file = () => new File(["hello"], "q3.txt", { type: "text/plain" });

  /** Await the rejection of an upload, typed, so its copy can be inspected. */
  async function rejectionOf(pending: Promise<unknown>): Promise<ApiError> {
    const error = await pending.then(
      () => null,
      (reason: unknown) => reason as ApiError,
    );
    if (!error) throw new Error("expected the upload to reject");
    return error;
  }

  it("posts multipart form data and parses the 201 body", async () => {
    const pending = uploadDocument(file());

    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://localhost:8000/v1/documents");
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("file")).toBeInstanceOf(File);

    xhr.respond(201, JSON.stringify({ id: "doc-1", filename: "q3.txt", chunks: 12 }));

    await expect(pending).resolves.toEqual({
      id: "doc-1",
      filename: "q3.txt",
      chunks: 12,
    });
  });

  it("reports upload progress as a fraction", async () => {
    const onProgress = vi.fn();
    const pending = uploadDocument(file(), { onProgress });

    const xhr = FakeXhr.last;
    xhr.upload.emitProgress(50, 200);
    xhr.respond(201, JSON.stringify({ id: "d", filename: "q3.txt", chunks: 1 }));
    await pending;

    expect(onProgress).toHaveBeenCalledWith(0.25);
  });

  it("maps an unsupported type (415) to safe copy and keeps the request id", async () => {
    const pending = uploadDocument(file());

    FakeXhr.last.respond(
      415,
      JSON.stringify({ detail: "Supported formats: PDF, DOCX, XLSX, ..." }),
      { "X-Request-ID": "req-9" },
    );

    await expect(pending).rejects.toMatchObject({
      status: 415,
      requestId: "req-9",
      message:
        "Unsupported file type. Choose a PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML file.",
    });
  });

  it("maps an oversized upload (413) to the limit the UI states", async () => {
    const pending = uploadDocument(file());
    FakeXhr.last.respond(413, "{}");

    await expect(pending).rejects.toMatchObject({
      status: 413,
      message: "That file is larger than the 10 MB limit.",
    });
  });

  it("maps an unreadable document (422) to copy that never echoes the detail", async () => {
    const pending = uploadDocument(file());
    FakeXhr.last.respond(
      422,
      JSON.stringify({ detail: "Password-protected PDFs are not supported" }),
    );

    const error = await rejectionOf(pending);
    expect(error.message).toContain("could not be read");
    expect(error.message).toContain("password-protected PDFs are not supported");
  });

  it("maps 422 from a malformed PDF onto the same fixed copy", async () => {
    const unreadable = uploadDocument(file());
    FakeXhr.last.respond(
      422,
      JSON.stringify({ detail: "The document could not be read as valid content" }),
    );
    const first = await rejectionOf(unreadable);

    const encrypted = uploadDocument(file());
    FakeXhr.last.respond(
      422,
      JSON.stringify({ detail: "Password-protected PDFs are not supported" }),
    );
    const second = await rejectionOf(encrypted);

    // One message for every extraction failure: the client must not imply
    // which one occurred, and the backend detail is never read.
    expect(first.message).toBe(second.message);
  });

  it("attributes a 503 to service availability rather than the file", async () => {
    const pending = uploadDocument(file());
    FakeXhr.last.respond(
      503,
      JSON.stringify({ detail: "Document services are temporarily unavailable" }),
      { "X-Request-ID": "req-11" },
    );

    const error = await rejectionOf(pending);
    expect(error.message).toContain("unavailable right now");
    expect(error.message).toContain("not a problem with your file");
    expect(error.message).not.toContain("temporarily");
  });

  it("rejects a success body that does not match the contract", async () => {
    const pending = uploadDocument(file());
    FakeXhr.last.respond(201, JSON.stringify({ filename: "q3.txt" }));

    await expect(pending).rejects.toMatchObject({
      message: "The backend returned an unexpected upload response.",
    });
  });

  it("reports a transport failure as status 0", async () => {
    const pending = uploadDocument(file());
    FakeXhr.last.dispatch("error");

    await expect(pending).rejects.toMatchObject({
      status: 0,
      message: "Cannot reach the backend API.",
    });
  });

  it("rejects when the caller aborts mid-flight", async () => {
    const controller = new AbortController();
    const pending = uploadDocument(file(), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      message: "The upload was cancelled.",
    });
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadDocument(file(), { signal: controller.signal }),
    ).rejects.toMatchObject({ message: "The upload was cancelled." });
  });
});

/* ------------------------------------------------------------------ */
/* streamRunEvents                                                    */
/* ------------------------------------------------------------------ */

describe("streamRunEvents", () => {
  function collect(response: Response): Promise<{
    events: RunEvent[];
    error?: ApiError;
    closed: boolean;
  }> {
    fetchMock.mockResolvedValue(response);

    return new Promise((resolve) => {
      const events: RunEvent[] = [];
      streamRunEvents("run-1", {
        onEvent: (event) => events.push(event),
        onError: (error) => resolve({ events, error, closed: false }),
        onClose: () => resolve({ events, closed: true }),
      });
    });
  }

  it("emits the documented events in order", async () => {
    const { events, closed } = await collect(
      sseResponse([
        'event: run_started\ndata: {"run_id":"run-1"}\n\n',
        "event: retrieving\ndata: {}\n\n",
        'event: completed\ndata: {"citation_count":2}\n\n',
      ]),
    );

    expect(closed).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "retrieving",
      "completed",
    ]);
  });

  it("discards event payloads entirely", async () => {
    const { events } = await collect(
      sseResponse([
        'event: routing\ndata: {"next":"web","rationale":"SECRET_TRACE"}\n\n',
      ]),
    );

    expect(events).toEqual([{ type: "routing" }]);
    expect(JSON.stringify(events)).not.toContain("SECRET_TRACE");
  });

  it("ignores event names outside the contract", async () => {
    const { events } = await collect(
      sseResponse([
        "event: thinking\ndata: {}\n\n",
        "event: generating\ndata: {}\n\n",
      ]),
    );

    expect(events.map((event) => event.type)).toEqual(["generating"]);
  });

  it("reassembles frames split across chunks", async () => {
    const { events } = await collect(
      sseResponse(["event: gene", "rating\ndata: {}", "\n\n"]),
    );

    expect(events.map((event) => event.type)).toEqual(["generating"]);
  });

  it("reports a stream that cannot be opened", async () => {
    const { error } = await collect(
      new Response("", { status: 404, headers: { "X-Request-ID": "req-4" } }),
    );

    expect(error).toMatchObject({
      status: 404,
      requestId: "req-4",
      message: "The run event stream could not be opened.",
    });
  });

  it("stays silent when the caller aborts", async () => {
    const never = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    fetchMock.mockResolvedValue(never);

    const onError = vi.fn();
    const onClose = vi.fn();
    const stop = streamRunEvents("run-1", { onEvent: vi.fn(), onError, onClose });

    stop();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
