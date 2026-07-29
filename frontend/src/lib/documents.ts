/**
 * Document-upload rules and response contract.
 *
 * Mirrors `backend/app/api/routes/documents.py` and its extraction rules.
 * Client-side validation is a convenience, never a control: the backend
 * re-checks extension, size, and readability, and its answer is authoritative.
 * The limit here tracks the backend's `demo_max_upload_bytes` default so the
 * two agree about what will be rejected.
 */

import { asRecord, readNumber, readString } from "./parse";

export const MAX_DOCUMENT_BYTES = 10_000_000;

/** Rendered in validation copy; kept next to the limit it describes. */
export const MAX_DOCUMENT_SIZE_LABEL = "10 MB";

/** Every extension the backend can extract text from, lower-case. */
export const ACCEPTED_EXTENSIONS: readonly string[] = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".html",
  ".htm",
];

/** Value for the file input's `accept`; extensions only — see below. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

/** Prose form of the same list, for labels and error copy. */
export const SUPPORTED_FORMATS_LABEL =
  "PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML";

/**
 * Pre-2007 binary Office formats. The backend has no extractor for them, so
 * they are named explicitly rather than folded into the generic type message —
 * "convert it" is a different fix from "pick a different file".
 */
export const UNSUPPORTED_LEGACY_EXTENSIONS: readonly string[] = [
  ".doc",
  ".xls",
  ".ppt",
];

export type DocumentRejectionReason = "type" | "legacy" | "empty" | "size";

export interface DocumentValidationError {
  reason: DocumentRejectionReason;
  message: string;
}

/** Lower-case extension including the dot, or `""` when the name has none. */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * Returns `null` when the file is acceptable.
 *
 * Only the extension, the byte length, and emptiness are checked. The browser's
 * reported MIME type is deliberately ignored: it is unreliable across platforms
 * (Windows reports `.csv` as `application/vnd.ms-excel`, `.md` is often blank)
 * and it is attacker-controlled anyway, so rejecting on it would refuse valid
 * files without adding a real control. The backend parses the actual bytes.
 */
export function validateDocumentFile(file: File): DocumentValidationError | null {
  const extension = extensionOf(file.name);

  if (UNSUPPORTED_LEGACY_EXTENSIONS.includes(extension)) {
    return {
      reason: "legacy",
      message:
        `Legacy ${UNSUPPORTED_LEGACY_EXTENSIONS.join(", ")} files are not ` +
        "supported. Save it as .docx, .xlsx, or PDF and upload that.",
    };
  }
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return {
      reason: "type",
      message: `Unsupported file type. Choose a ${SUPPORTED_FORMATS_LABEL} file.`,
    };
  }
  if (file.size === 0) {
    return { reason: "empty", message: "That file is empty." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      reason: "size",
      message: `That file is larger than the ${MAX_DOCUMENT_SIZE_LABEL} limit.`,
    };
  }
  return null;
}

/**
 * `POST /v1/documents` → 201.
 *
 * Indexing is synchronous: a 201 means the document is chunked, embedded, and
 * searchable, so there is no status field to poll.
 */
export interface UploadedDocument {
  id: string;
  filename: string;
  chunks: number;
}

export function parseUploadedDocument(value: unknown): UploadedDocument | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readString(record, "id");
  if (!id) return null;

  const chunks = readNumber(record, "chunks");

  return {
    id,
    filename: readString(record, "filename") ?? "",
    chunks: chunks !== undefined && chunks >= 0 ? Math.trunc(chunks) : 0,
  };
}

/**
 * Compact size for display next to a selected file.
 *
 * Decimal units, matching `MAX_DOCUMENT_SIZE_LABEL` and the backend's byte
 * limit: a file exactly at the limit has to read as "10.0 MB", not the 9.5 MB
 * a binary-megabyte formatter would print next to a "10 MB" rule.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
