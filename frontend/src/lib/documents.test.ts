import { describe, expect, it } from "vitest";

import {
  ACCEPTED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  MAX_DOCUMENT_BYTES,
  UNSUPPORTED_LEGACY_EXTENSIONS,
  extensionOf,
  formatFileSize,
  parseUploadedDocument,
  validateDocumentFile,
} from "./documents";

function fileOf(name: string, bytes: number, type = "text/plain"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("accepted formats", () => {
  it("matches the backend's extractable extensions exactly", () => {
    expect([...ACCEPTED_EXTENSIONS].sort()).toEqual(
      [
        ".csv",
        ".docx",
        ".htm",
        ".html",
        ".json",
        ".md",
        ".pdf",
        ".tsv",
        ".txt",
        ".xlsx",
      ].sort(),
    );
  });

  it("offers every accepted extension through the input's accept attribute", () => {
    const listed = ACCEPT_ATTRIBUTE.split(",");

    expect(listed).toEqual([...ACCEPTED_EXTENSIONS]);
    // Extensions only: platform MIME types for .csv/.md are unreliable and
    // would hide valid files from the picker.
    expect(ACCEPT_ATTRIBUTE).not.toContain("/");
  });

  it("never lists a legacy Office format as accepted", () => {
    // Compare entries, not substrings: ".doc" occurs inside ".docx".
    const listed = ACCEPT_ATTRIBUTE.split(",");

    for (const extension of UNSUPPORTED_LEGACY_EXTENSIONS) {
      expect(ACCEPTED_EXTENSIONS).not.toContain(extension);
      expect(listed).not.toContain(extension);
    }
  });
});

describe("extensionOf", () => {
  it("lower-cases the final suffix", () => {
    expect(extensionOf("Report.PDF")).toBe(".pdf");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
  });

  it("returns an empty extension for a name that has none", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("validateDocumentFile", () => {
  it.each(ACCEPTED_EXTENSIONS)("accepts a %s file", (extension) => {
    expect(validateDocumentFile(fileOf(`report${extension}`, 1024))).toBeNull();
  });

  it.each(ACCEPTED_EXTENSIONS)("accepts %s case-insensitively", (extension) => {
    expect(
      validateDocumentFile(fileOf(`REPORT${extension.toUpperCase()}`, 1024)),
    ).toBeNull();
  });

  it("accepts a file whose MIME type the platform left blank", () => {
    expect(validateDocumentFile(fileOf("notes.md", 1024, ""))).toBeNull();
  });

  it("accepts a file the platform mislabels, leaving the bytes to the backend", () => {
    // Windows reports .csv as application/vnd.ms-excel; rejecting on the
    // browser's MIME guess would refuse a valid upload.
    expect(
      validateDocumentFile(fileOf("rows.csv", 1024, "application/vnd.ms-excel")),
    ).toBeNull();
    expect(
      validateDocumentFile(fileOf("notes.txt", 1024, "application/pdf")),
    ).toBeNull();
  });

  it.each(UNSUPPORTED_LEGACY_EXTENSIONS)(
    "rejects the legacy %s format with conversion advice",
    (extension) => {
      const error = validateDocumentFile(fileOf(`old${extension}`, 1024));

      expect(error).toMatchObject({ reason: "legacy" });
      expect(error?.message).toContain(extension);
      expect(error?.message).toMatch(/\.docx, \.xlsx, or PDF/);
    },
  );

  it("rejects .pptx, which the backend cannot extract either", () => {
    expect(validateDocumentFile(fileOf("deck.pptx", 1024))).toMatchObject({
      reason: "type",
    });
  });

  it("rejects an unrelated binary type", () => {
    expect(validateDocumentFile(fileOf("photo.png", 1024, "image/png")))
      .toMatchObject({ reason: "type" });
  });

  it("rejects a file with no extension at all", () => {
    expect(validateDocumentFile(fileOf("report", 1024))).toMatchObject({
      reason: "type",
    });
  });

  it("names the supported formats in the type message", () => {
    const error = validateDocumentFile(fileOf("photo.png", 1024));

    expect(error?.message).toContain("PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML");
  });

  it("rejects an empty file of an accepted type", () => {
    expect(validateDocumentFile(fileOf("empty.pdf", 0))).toMatchObject({
      reason: "empty",
    });
  });

  it("checks the type before the size, so a legacy file is not called too large", () => {
    expect(validateDocumentFile(fileOf("old.doc", MAX_DOCUMENT_BYTES + 1)))
      .toMatchObject({ reason: "legacy" });
  });

  it("accepts a file exactly at the 10 MB limit", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10_000_000);
    expect(validateDocumentFile(fileOf("edge.pdf", MAX_DOCUMENT_BYTES))).toBeNull();
  });

  it("rejects a file one byte over the 10 MB limit", () => {
    expect(validateDocumentFile(fileOf("big.pdf", MAX_DOCUMENT_BYTES + 1)))
      .toMatchObject({ reason: "size" });
  });

  it("names the limit in the size message without leaking a path", () => {
    const error = validateDocumentFile(fileOf("big.pdf", MAX_DOCUMENT_BYTES + 1));

    expect(error?.message).toContain("10 MB");
  });
});

describe("parseUploadedDocument", () => {
  it("parses the 201 body", () => {
    expect(
      parseUploadedDocument({ id: "doc-1", filename: "q3.pdf", chunks: 12 }),
    ).toEqual({ id: "doc-1", filename: "q3.pdf", chunks: 12 });
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
    expect(formatFileSize(1_500_000)).toBe("1.5 MB");
  });

  it("agrees with the stated limit at the boundary", () => {
    // A file the validator accepts must not read as larger than the rule.
    expect(formatFileSize(MAX_DOCUMENT_BYTES)).toBe("10.0 MB");
  });
});
