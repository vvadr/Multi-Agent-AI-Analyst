/**
 * Document-upload rules and response contract.
 *
 * Mirrors `backend/app/api/routes/documents.py`. Client-side validation is a
 * convenience, never a control: the backend re-checks extension, size, encoding
 * and emptiness. The limit here tracks the backend's `demo_max_upload_bytes`
 * default so the two agree about what will be rejected.
 */

import { asRecord, readNumber, readString } from "./parse";

export const MAX_DOCUMENT_BYTES = 1_000_000;

/** Rendered in validation copy; kept next to the limit it describes. */
export const MAX_DOCUMENT_SIZE_LABEL = "1 MB";

export const ACCEPTED_EXTENSION = ".txt";

/**
 * Some platforms report an empty `type` for `.txt`, so an absent MIME type is
 * accepted and the extension is the real gate.
 */
export const ACCEPTED_MIME_TYPES: readonly string[] = ["text/plain"];

export type DocumentRejectionReason = "type" | "empty" | "size";

export interface DocumentValidationError {
  reason: DocumentRejectionReason;
  message: string;
}

/** Returns `null` when the file is acceptable. */
export function validateDocumentFile(file: File): DocumentValidationError | null {
  const name = file.name.toLowerCase();

  if (!name.endsWith(ACCEPTED_EXTENSION)) {
    return { reason: "type", message: "Only .txt files are supported." };
  }
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    return { reason: "type", message: "Only plain-text .txt files are supported." };
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

/** Compact size for display next to a selected file. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
