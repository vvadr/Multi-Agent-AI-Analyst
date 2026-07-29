import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_EXPIRED_MESSAGE,
  createRun,
  getHealth,
  getReadiness,
  getRun,
  streamRunEvents,
  uploadDocument,
  type RunEvent,
} from "./api";
import type { AuthUser } from "./auth";
import { resetRefreshForTests } from "./http";
import { getAccessToken, resetSessionForTests, setSession } from "./session";

/**
 * How the analyst endpoints carry the session.
 *
 * The rules being pinned here: every authenticated request sends the in-memory
 * bearer token and no ambient cookie; the operational probes send neither; and
 * a 401 costs exactly one refresh and one replay before the session is declared
 * over.
 */

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(accessToken: string): Response {
  return jsonResponse(
    {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 1800,
      user: {
        id: USER.id,
        email: USER.email,
        organization_id: USER.organizationId,
        role: USER.role,
      },
    },
    200,
  );
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

/** Minimal XHR double that records the headers the upload sets. */
class FakeXhr {
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = "";
  timeout = 0;
  readonly headers: Record<string, string> = {};
  readonly upload = { addEventListener() {} };

  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();

  constructor() {
    FakeXhr.instances.push(this);
  }

  static get last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (!instance) throw new Error("no XMLHttpRequest was created");
    return instance;
  }

  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(): string | null {
    return null;
  }
  send() {}
  abort() {}
  addEventListener(type: string, handler: (event?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }
  dispatch(type: string) {
    for (const handler of this.listeners.get(type) ?? []) handler();
  }
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.dispatch("load");
  }
}

function authHeaderOf(call: unknown[]): string | null {
  const init = call[1] as RequestInit;
  return new Headers(init.headers).get("Authorization");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  resetSessionForTests();
  resetRefreshForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionForTests();
  resetRefreshForTests();
});

describe("protected requests", () => {
  it("sends the bearer token when creating a run", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ id: "run-1", status: "queued" }, 202));

    await createRun("What changed?");

    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe("Bearer live-token");
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("omit");
  });

  it("sends the bearer token when reading a run", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "run-1", status: "completed", answer: "a", citations: [] }, 200),
    );

    await getRun("run-1");

    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe("Bearer live-token");
  });

  it("sends the bearer token on the SSE stream", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(sseResponse(['event: completed\ndata: {}\n\n']));

    await new Promise<void>((resolve) => {
      streamRunEvents("run-1", { onEvent: () => {}, onClose: resolve, onError: () => resolve() });
    });

    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe("Bearer live-token");
  });

  it("sends the bearer token on a document upload", async () => {
    setSession("live-token", USER);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const pending = uploadDocument(file);

    await vi.waitFor(() => expect(FakeXhr.instances.length).toBe(1));
    FakeXhr.last.respond(201, JSON.stringify({ id: "doc-1", filename: "notes.txt", chunks: 1 }));

    await expect(pending).resolves.toMatchObject({ id: "doc-1" });
    expect(FakeXhr.last.headers.Authorization).toBe("Bearer live-token");
  });

  it("keeps the operational probes unauthenticated", async () => {
    setSession("live-token", USER);
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }, 200));

    await getHealth();

    // /healthz and /readyz are public probes; attaching a session token to them
    // would put it in reach of anything that can read a monitoring log.
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBeNull();

    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          status: "ready",
          components: {
            database: { configured: true, reachable: true },
            model: { configured: true, reachable: true },
            qdrant: { configured: true, reachable: true },
            object_storage: { configured: true, reachable: true },
          },
        },
        200,
      ),
    );

    await getReadiness();

    const readinessInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(readinessInit.headers).has("Authorization")).toBe(false);
  });
});

describe("expiry during a protected request", () => {
  it("refreshes once and replays the run request", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(tokenResponse("rotated-token"))
      .mockResolvedValueOnce(jsonResponse({ id: "run-1", status: "queued" }, 202));

    await expect(createRun("What changed?")).resolves.toEqual({
      id: "run-1",
      status: "queued",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://localhost:8000/v1/auth/refresh");
    expect(authHeaderOf(fetchMock.mock.calls[2])).toBe("Bearer rotated-token");
  });

  it("ends the session with fixed copy when the refresh is refused", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "refresh reuse" }, 401));

    await expect(createRun("What changed?")).rejects.toMatchObject({
      status: 401,
      message: SESSION_EXPIRED_MESSAGE,
    });

    expect(getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a second time when the replay is also refused", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(tokenResponse("rotated-token"))
      .mockResolvedValueOnce(jsonResponse({ detail: "still no" }, 401));

    await expect(getRun("run-1")).rejects.toMatchObject({
      status: 401,
      message: SESSION_EXPIRED_MESSAGE,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBeNull();
  });

  it("reopens the SSE stream once with the rotated token", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(tokenResponse("rotated-token"))
      .mockResolvedValueOnce(sseResponse(["event: completed\ndata: {}\n\n"]));

    const events: RunEvent[] = [];
    await new Promise<void>((resolve) => {
      streamRunEvents("run-1", {
        onEvent: (event) => events.push(event),
        onClose: resolve,
        onError: () => resolve(),
      });
    });

    expect(events).toEqual([{ type: "completed" }]);
    expect(authHeaderOf(fetchMock.mock.calls[2])).toBe("Bearer rotated-token");
  });

  it("reports an ended session on the stream rather than a transport error", async () => {
    setSession("expired-token", USER);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "refresh reuse" }, 401));

    const error = await new Promise<Error>((resolve) => {
      streamRunEvents("run-1", {
        onEvent: () => {},
        onError: resolve,
        onClose: () => resolve(new Error("closed without an error")),
      });
    });

    expect(error.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("replays an upload once after a 401", async () => {
    setSession("expired-token", USER);
    fetchMock.mockResolvedValue(tokenResponse("rotated-token"));

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const pending = uploadDocument(file);

    await vi.waitFor(() => expect(FakeXhr.instances.length).toBe(1));
    FakeXhr.instances[0].respond(401, JSON.stringify({ detail: "expired" }));

    await vi.waitFor(() => expect(FakeXhr.instances.length).toBe(2));
    expect(FakeXhr.instances[1].headers.Authorization).toBe("Bearer rotated-token");

    FakeXhr.instances[1].respond(
      201,
      JSON.stringify({ id: "doc-1", filename: "notes.txt", chunks: 1 }),
    );

    await expect(pending).resolves.toMatchObject({ id: "doc-1" });
  });
});
