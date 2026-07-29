import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_BYTES,
  formatFileSize,
  parseUploadedDocument,
  validateDocumentFile,
} from "./documents";

function fileOf(name: string, bytes: number, type = "text/plain"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("validateDocumentFile", () => {
  it("accepts a normal .txt file", () => {
    expect(validateDocumentFile(fileOf("notes.txt", 1024))).toBeNull();
  });

  it("accepts a .txt file whose MIME type the platform left blank", () => {
    expect(validateDocumentFile(fileOf("notes.txt", 1024, ""))).toBeNull();
  });

  it("accepts the extension case-insensitively", () => {
    expect(validateDocumentFile(fileOf("NOTES.TXT", 1024))).toBeNull();
  });

  it("rejects a non-.txt extension", () => {
    expect(validateDocumentFile(fileOf("report.pdf", 1024, "application/pdf")))
      .toMatchObject({ reason: "type" });
  });

  it("rejects a .txt name carrying a non-text MIME type", () => {
    expect(validateDocumentFile(fileOf("sneaky.txt", 1024, "application/pdf")))
      .toMatchObject({ reason: "type" });
  });

  it("rejects an empty file", () => {
    expect(validateDocumentFile(fileOf("empty.txt", 0))).toMatchObject({
      reason: "empty",
    });
  });

  it("rejects a file over the limit but accepts one exactly at it", () => {
    expect(validateDocumentFile(fileOf("big.txt", MAX_DOCUMENT_BYTES + 1)))
      .toMatchObject({ reason: "size" });
    expect(validateDocumentFile(fileOf("edge.txt", MAX_DOCUMENT_BYTES))).toBeNull();
  });

  it("names the limit in the size message without leaking a path", () => {
    const error = validateDocumentFile(fileOf("big.txt", MAX_DOCUMENT_BYTES + 1));

    expect(error?.message).toContain("1 MB");
  });
});

describe("parseUploadedDocument", () => {
  it("parses the 201 body", () => {
    expect(
      parseUploadedDocument({ id: "doc-1", filename: "q3.txt", chunks: 12 }),
    ).toEqual({ id: "doc-1", filename: "q3.txt", chunks: 12 });
  });

  it("rejects a body with no id", () => {
    expect(parseUploadedDocument({ filename: "q3.txt", chunks: 1 })).toBeNull();
  });

  it("rejects non-object bodies", () => {
    expect(parseUploadedDocument(null)).toBeNull();
    expect(parseUploadedDocument("ok")).toBeNull();
    expect(parseUploadedDocument([])).toBeNull();
  });

  it("defaults a missing or invalid chunk count to zero", () => {
    expect(parseUploadedDocument({ id: "d", chunks: "many" })?.chunks).toBe(0);
    expect(parseUploadedDocument({ id: "d" })?.chunks).toBe(0);
  });
});

describe("formatFileSize", () => {
  it("scales the unit to the size", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
  });
});
