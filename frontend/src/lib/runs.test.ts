import { describe, expect, it } from "vitest";

import {
  RUN_EVENT_TYPES,
  RUN_PROGRESS_LABELS,
  isRunEventType,
  isSafeHttpUrl,
  isTerminalRunEvent,
  parseCitations,
  parseRunCreated,
  parseRunDetail,
} from "./runs";

describe("run event types", () => {
  it("accepts every documented type and nothing else", () => {
    for (const type of RUN_EVENT_TYPES) {
      expect(isRunEventType(type)).toBe(true);
    }
    expect(isRunEventType("thinking")).toBe(false);
    expect(isRunEventType(undefined)).toBe(false);
  });

  it("labels every type, so progress can never render a raw event name", () => {
    for (const type of RUN_EVENT_TYPES) {
      expect(RUN_PROGRESS_LABELS[type]).toBeTruthy();
      expect(RUN_PROGRESS_LABELS[type]).not.toBe(type);
    }
  });

  it("treats only completed and failed as terminal", () => {
    expect(isTerminalRunEvent("completed")).toBe(true);
    expect(isTerminalRunEvent("failed")).toBe(true);
    expect(isTerminalRunEvent("retrieving")).toBe(false);
  });
});

describe("parseRunCreated", () => {
  it("parses the 202 body", () => {
    expect(parseRunCreated({ id: "run-1", status: "queued" })).toEqual({
      id: "run-1",
      status: "queued",
    });
  });

  it("requires an id", () => {
    expect(parseRunCreated({ status: "queued" })).toBeNull();
    expect(parseRunCreated({ id: "   ", status: "queued" })).toBeNull();
  });

  it("falls back to queued for an unknown status", () => {
    expect(parseRunCreated({ id: "run-1", status: "pending" })?.status).toBe(
      "queued",
    );
  });

  it("rejects non-object bodies", () => {
    expect(parseRunCreated(null)).toBeNull();
    expect(parseRunCreated(["run-1"])).toBeNull();
  });
});

describe("parseRunDetail", () => {
  it("parses a completed run", () => {
    const detail = parseRunDetail({
      id: "run-1",
      status: "completed",
      answer: "Revenue grew 4%.",
      citations: [],
      error: null,
    });

    expect(detail).toEqual({
      id: "run-1",
      status: "completed",
      answer: "Revenue grew 4%.",
      citations: [],
    });
  });

  it("normalizes a null answer to an empty string", () => {
    expect(parseRunDetail({ id: "r", status: "running", answer: null })?.answer)
      .toBe("");
  });

  it("rejects an unrecognized status rather than guessing", () => {
    expect(parseRunDetail({ id: "r", status: "cancelled" })).toBeNull();
    expect(parseRunDetail({ id: "r" })).toBeNull();
  });

  it("never exposes the backend error string", () => {
    const detail = parseRunDetail({
      id: "r",
      status: "failed",
      error: "google.api_core.exceptions.PermissionDenied: key invalid",
    });

    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain("PermissionDenied");
  });
});

describe("parseCitations", () => {
  it("parses a document citation with its chunk", () => {
    expect(
      parseCitations([
        {
          id: "document:doc-1:2",
          kind: "document",
          title: "q3.txt",
          excerpt: "Revenue rose.",
          document_id: "doc-1",
          chunk_index: 2,
        },
      ]),
    ).toEqual([
      {
        id: "document:doc-1:2",
        kind: "document",
        title: "q3.txt",
        excerpt: "Revenue rose.",
        documentId: "doc-1",
        chunkIndex: 2,
      },
    ]);
  });

  it("keeps http(s) URLs on web citations", () => {
    const [citation] = parseCitations([
      { id: "web:1", kind: "web", title: "Report", excerpt: "", url: "https://example.org/a" },
    ]);

    expect(citation.url).toBe("https://example.org/a");
  });

  it("strips a dangerous URL but keeps the citation", () => {
    const [citation] = parseCitations([
      { id: "web:1", kind: "web", title: "Bad", excerpt: "", url: "javascript:alert(1)" },
    ]);

    expect(citation.kind).toBe("web");
    expect(citation.url).toBeUndefined();
  });

  it("drops entries with an unknown kind", () => {
    expect(
      parseCitations([
        { id: "1", kind: "internal_trace", title: "t", excerpt: "" },
        { id: "2", kind: "analytics", title: "monthly_metrics", excerpt: "" },
      ]),
    ).toHaveLength(1);
  });

  it("returns an empty list for a non-array", () => {
    expect(parseCitations(undefined)).toEqual([]);
    expect(parseCitations({ kind: "document" })).toEqual([]);
  });

  it("supplies a fallback id so repeated citations stay keyable", () => {
    const citations = parseCitations([
      { kind: "web", title: "A", excerpt: "" },
      { kind: "web", title: "B", excerpt: "" },
    ]);

    expect(citations[0].id).not.toBe(citations[1].id);
  });
});

describe("isSafeHttpUrl", () => {
  it("allows http and https only", () => {
    expect(isSafeHttpUrl("https://example.org")).toBe(true);
    expect(isSafeHttpUrl("http://example.org")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeHttpUrl("/relative/path")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});
