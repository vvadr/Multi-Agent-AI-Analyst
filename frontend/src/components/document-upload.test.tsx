import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentUpload } from "./document-upload";

/**
 * `userEvent.upload` filters by the input's `accept` attribute, which would
 * make the rejected-type cases unreachable. Assigning `files` directly drives
 * the same change handler with exactly the file under test.
 */
function selectFile(file: File) {
  const input = screen.getByLabelText(/choose a \.txt file/i) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

function txtFile(name: string, bytes: number, type = "text/plain"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

class FakeXhr {
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = "";
  timeout = 0;
  url = "";

  private responseHeaders: Record<string, string> = {};
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
  readonly upload = {
    listeners: [] as ((event: unknown) => void)[],
    addEventListener(_type: string, handler: (event: unknown) => void) {
      this.listeners.push(handler);
    },
    emitProgress(loaded: number, total: number) {
      for (const handler of this.listeners) {
        handler({ lengthComputable: true, loaded, total });
      }
    },
  };

  constructor() {
    FakeXhr.instances.push(this);
  }

  static get last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (!instance) throw new Error("no XMLHttpRequest was created");
    return instance;
  }

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }
  send() {}
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

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentUpload", () => {
  it("rejects a non-.txt file before any request is made", () => {
    render(<DocumentUpload />);

    selectFile(txtFile("report.pdf", 1024, "application/pdf"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only .txt files are supported.",
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("rejects a file over the size limit before any request is made", () => {
    render(<DocumentUpload />);

    selectFile(txtFile("big.txt", 1_000_001));

    expect(screen.getByRole("alert")).toHaveTextContent("larger than the 1 MB limit");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("rejects an empty file", () => {
    render(<DocumentUpload />);

    selectFile(txtFile("empty.txt", 0));

    expect(screen.getByRole("alert")).toHaveTextContent("That file is empty.");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("uploads a valid file and reports successful indexing", async () => {
    render(<DocumentUpload />);
    selectFile(txtFile("q3.txt", 2048));

    expect(screen.getByText(/q3\.txt · 2 KB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    expect(screen.getByText(/uploading q3\.txt/i)).toBeInTheDocument();

    await act(async () => {
      FakeXhr.last.upload.emitProgress(1024, 2048);
    });
    expect(screen.getByText("50%")).toBeInTheDocument();

    await act(async () => {
      FakeXhr.last.respond(
        201,
        JSON.stringify({ id: "doc-1", filename: "q3.txt", chunks: 12 }),
      );
    });

    expect(
      await screen.findByText(/indexed q3\.txt — 12 searchable chunks/i),
    ).toBeInTheDocument();
  });

  it("shows an indexing step once every byte has been sent", async () => {
    render(<DocumentUpload />);
    selectFile(txtFile("q3.txt", 2048));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await act(async () => {
      FakeXhr.last.upload.emitProgress(2048, 2048);
    });

    expect(screen.getByText(/indexing q3\.txt/i)).toBeInTheDocument();
  });

  it("shows safe copy and the request id when the backend rejects the file", async () => {
    render(<DocumentUpload />);
    selectFile(txtFile("q3.txt", 2048));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await act(async () => {
      FakeXhr.last.respond(
        415,
        JSON.stringify({ detail: "Only UTF-8 .txt files are supported" }),
        { "X-Request-ID": "req-7" },
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Only .txt files are supported.");
    expect(alert).toHaveTextContent("Request ID: req-7");
    expect(alert).not.toHaveTextContent(/UTF-8/);
  });

  it("returns to the idle state when the upload is cancelled", async () => {
    render(<DocumentUpload />);
    selectFile(txtFile("q3.txt", 2048));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces status changes in a live region", () => {
    const { container } = render(<DocumentUpload />);

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
