import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCEPTED_EXTENSIONS, MAX_DOCUMENT_BYTES } from "@/lib/documents";

import { DocumentUpload } from "./document-upload";

/**
 * `userEvent.upload` filters by the input's `accept` attribute, which would
 * make the rejected-type cases unreachable. Assigning `files` directly drives
 * the same change handler with exactly the file under test.
 */
function selectFile(file: File) {
  const input = screen.getByLabelText(/choose a document/i) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

function fileOf(name: string, bytes: number, type = "text/plain"): File {
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

describe("DocumentUpload — accepted formats", () => {
  it("states the supported formats and the size limit", () => {
    render(<DocumentUpload />);

    expect(
      screen.getByText(
        /Upload a PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML file up to 10 MB/i,
      ),
    ).toBeInTheDocument();
  });

  it("offers every accepted extension to the file picker", () => {
    render(<DocumentUpload />);

    const input = screen.getByLabelText(/choose a document/i);
    const accepted = input.getAttribute("accept")?.split(",") ?? [];

    for (const extension of ACCEPTED_EXTENSIONS) {
      expect(accepted).toContain(extension);
    }
  });

  it.each(ACCEPTED_EXTENSIONS)("accepts a %s file for upload", (extension) => {
    render(<DocumentUpload />);

    selectFile(fileOf(`report${extension}`, 2048));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload/i }),
    ).toBeInTheDocument();
  });

  it("names password-protected PDFs and legacy formats as unsupported", () => {
    render(<DocumentUpload />);

    const note = screen.getByText(/not supported:/i);
    expect(note).toHaveTextContent(/password-protected PDFs/i);
    expect(note).toHaveTextContent(".doc, .xls, .ppt");
    expect(note).toHaveTextContent(/\.docx, \.xlsx, or PDF first/i);
  });
});

describe("DocumentUpload — client-side rejection", () => {
  it.each([".doc", ".xls", ".ppt"])(
    "rejects the legacy %s format before any request is made",
    (extension) => {
      render(<DocumentUpload />);

      selectFile(fileOf(`old${extension}`, 2048));

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/legacy .* files are not supported/i);
      expect(alert).toHaveTextContent(/\.docx, \.xlsx, or PDF/);
      expect(FakeXhr.instances).toHaveLength(0);
    },
  );

  it("rejects an unsupported type before any request is made", () => {
    render(<DocumentUpload />);

    selectFile(fileOf("photo.png", 1024, "image/png"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Unsupported file type\. Choose a PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML file\./i,
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("rejects a file one byte over the 10 MB limit", () => {
    render(<DocumentUpload />);

    selectFile(fileOf("big.pdf", MAX_DOCUMENT_BYTES + 1));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "larger than the 10 MB limit",
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("accepts a file exactly at the 10 MB limit and uploads it", async () => {
    render(<DocumentUpload />);

    selectFile(fileOf("edge.pdf", MAX_DOCUMENT_BYTES));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/edge\.pdf · 10\.0 MB/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("rejects an empty file", () => {
    render(<DocumentUpload />);

    selectFile(fileOf("empty.txt", 0));

    expect(screen.getByRole("alert")).toHaveTextContent("That file is empty.");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("lets the backend judge a file the platform mislabels", () => {
    render(<DocumentUpload />);

    // The MIME type is the browser's guess, not evidence about the bytes.
    selectFile(fileOf("rows.csv", 2048, "application/vnd.ms-excel"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/rows\.csv/)).toBeInTheDocument();
  });
});

describe("DocumentUpload — upload lifecycle", () => {
  it("uploads a valid file and reports successful indexing", async () => {
    render(<DocumentUpload />);
    selectFile(fileOf("q3.pdf", 2048, "application/pdf"));

    expect(screen.getByText(/q3\.pdf · 2 KB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    expect(screen.getByText(/uploading q3\.pdf/i)).toBeInTheDocument();

    await act(async () => {
      FakeXhr.last.upload.emitProgress(1024, 2048);
    });
    expect(screen.getByText("50%")).toBeInTheDocument();

    await act(async () => {
      FakeXhr.last.respond(
        201,
        JSON.stringify({ id: "doc-1", filename: "q3.pdf", chunks: 12 }),
      );
    });

    expect(
      await screen.findByText(/indexed q3\.pdf — 12 searchable chunks/i),
    ).toBeInTheDocument();
  });

  it("shows an indexing step once every byte has been sent", async () => {
    render(<DocumentUpload />);
    selectFile(fileOf("q3.docx", 2048));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await act(async () => {
      FakeXhr.last.upload.emitProgress(2048, 2048);
    });

    expect(screen.getByText(/indexing q3\.docx/i)).toBeInTheDocument();
  });

  it("returns to the idle state when the upload is cancelled", async () => {
    render(<DocumentUpload />);
    selectFile(fileOf("q3.txt", 2048));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces status changes in a live region", () => {
    const { container } = render(<DocumentUpload />);

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("describes the file input with the format limits", () => {
    render(<DocumentUpload />);

    const input = screen.getByLabelText(/choose a document/i);
    const describedBy = input.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      /not supported/i,
    );
  });
});

describe("DocumentUpload — safe backend errors", () => {
  async function uploadAndRespond(
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) {
    render(<DocumentUpload />);
    selectFile(fileOf("q3.pdf", 2048, "application/pdf"));
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));

    await act(async () => {
      FakeXhr.last.respond(status, body, headers);
    });
    return screen.findByRole("alert");
  }

  it("shows safe copy and the request id when the type is rejected (415)", async () => {
    const alert = await uploadAndRespond(
      415,
      JSON.stringify({
        detail: "Supported formats: PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, and HTML",
      }),
      { "X-Request-ID": "req-7" },
    );

    expect(alert).toHaveTextContent("Unsupported file type.");
    expect(alert).toHaveTextContent("Request ID: req-7");
  });

  it("reports an encrypted PDF without echoing the backend detail (422)", async () => {
    const alert = await uploadAndRespond(
      422,
      JSON.stringify({ detail: "Password-protected PDFs are not supported" }),
      { "X-Request-ID": "req-8" },
    );

    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).toHaveTextContent(/password-protected PDFs are not supported/i);
    expect(alert).toHaveTextContent("Request ID: req-8");
  });

  it("reports a malformed PDF with the same safe copy (422)", async () => {
    const alert = await uploadAndRespond(
      422,
      JSON.stringify({
        detail: "The document could not be read as valid content",
        trace: "pypdf.errors.PdfReadError: EOF marker not found",
      }),
    );

    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).not.toHaveTextContent(/pypdf|PdfReadError|EOF/i);
    expect(alert).not.toHaveTextContent(/valid content/i);
  });

  it("attributes a 503 to service availability, not to the document", async () => {
    const alert = await uploadAndRespond(
      503,
      JSON.stringify({ detail: "Document services are temporarily unavailable" }),
      { "X-Request-ID": "req-9" },
    );

    expect(alert).toHaveTextContent(/unavailable right now/i);
    expect(alert).toHaveTextContent(/not a problem with your file/i);
    expect(alert).toHaveTextContent("Request ID: req-9");
  });

  it("maps an oversized upload the backend caught to the stated limit (413)", async () => {
    const alert = await uploadAndRespond(
      413,
      JSON.stringify({ detail: "The document exceeds the upload limit" }),
    );

    expect(alert).toHaveTextContent("larger than the 10 MB limit");
  });

  it("never renders provider or internal detail from an error body", async () => {
    const alert = await uploadAndRespond(
      503,
      JSON.stringify({
        detail: "qdrant upsert failed at http://qdrant:6333 (api_key=abc123)",
      }),
    );

    expect(alert).not.toHaveTextContent(/qdrant|api_key|6333/i);
  });
});
