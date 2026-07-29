"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, uploadDocument } from "@/lib/api";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCUMENT_SIZE_LABEL,
  SUPPORTED_FORMATS_LABEL,
  UNSUPPORTED_LEGACY_EXTENSIONS,
  formatFileSize,
  validateDocumentFile,
  type UploadedDocument,
} from "@/lib/documents";

type UploadState =
  | { kind: "idle" }
  | { kind: "selected"; file: File }
  /** `progress` is the fraction of bytes sent; 1 means the server is indexing. */
  | { kind: "uploading"; file: File; progress: number }
  | { kind: "indexed"; document: UploadedDocument }
  | { kind: "error"; message: string; requestId?: string };

/**
 * Upload one supported document into the local demo tenant.
 *
 * Indexing is synchronous on the backend: the 201 response already means the
 * file is chunked, embedded, and searchable, so there is nothing to poll. The
 * gap between "bytes sent" and "response received" is where indexing happens,
 * and it is reported as its own step.
 */
export function DocumentUpload() {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const handleSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setState({ kind: "idle" });
      return;
    }

    const invalid = validateDocumentFile(file);
    if (invalid) {
      // Clear the control so the same file can be re-picked after a fix.
      if (inputRef.current) inputRef.current.value = "";
      setState({ kind: "error", message: invalid.message });
      return;
    }
    setState({ kind: "selected", file });
  }, []);

  const handleUpload = useCallback(async () => {
    if (state.kind !== "selected") return;
    const { file } = state;

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "uploading", file, progress: 0 });

    try {
      const document = await uploadDocument(file, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!mountedRef.current) return;
          setState((current) =>
            current.kind === "uploading"
              ? { ...current, progress: fraction }
              : current,
          );
        },
      });
      if (!mountedRef.current) return;
      if (inputRef.current) inputRef.current.value = "";
      setState({ kind: "indexed", document });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError("The upload failed.", 0);
      setState({
        kind: "error",
        message: apiError.message,
        requestId: apiError.requestId,
      });
    } finally {
      abortRef.current = null;
    }
  }, [state]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setState({ kind: "idle" });
  }, []);

  const isUploading = state.kind === "uploading";
  const percent = isUploading ? Math.round(state.progress * 100) : 0;
  const isIndexing = isUploading && state.progress >= 1;

  return (
    <section
      aria-labelledby="document-upload-heading"
      className="w-full rounded-xl border border-black/[.08] p-5 text-left dark:border-white/[.145]"
    >
      <h2 id="document-upload-heading" className="text-sm font-semibold">
        1 · Add a document
      </h2>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Upload a {SUPPORTED_FORMATS_LABEL} file up to {MAX_DOCUMENT_SIZE_LABEL}.
        It is indexed on the backend so answers can cite it.
      </p>

      <div className="mt-4">
        <label
          htmlFor="document-file"
          className="block text-sm font-medium"
        >
          Choose a document
        </label>
        <input
          ref={inputRef}
          id="document-file"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleSelect}
          disabled={isUploading}
          aria-describedby="document-file-limits"
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-full file:border file:border-black/[.08] file:bg-transparent file:px-3 file:py-1 file:text-sm file:text-inherit hover:file:bg-black/[.04] disabled:opacity-50 dark:file:border-white/[.145] dark:hover:file:bg-white/[.06]"
        />
        <p
          id="document-file-limits"
          className="mt-2 text-xs text-black/60 dark:text-white/60"
        >
          Not supported: password-protected PDFs, and legacy{" "}
          {UNSUPPORTED_LEGACY_EXTENSIONS.join(", ")} files — save those as
          .docx, .xlsx, or PDF first. Scanned PDFs with no selectable text
          cannot be indexed either.
        </p>
      </div>

      {state.kind === "selected" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-xs break-all">
            {state.file.name} · {formatFileSize(state.file.size)}
          </span>
          <button
            type="button"
            onClick={() => void handleUpload()}
            className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            Upload
          </button>
        </div>
      )}

      {isUploading && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <progress
            max={100}
            value={percent}
            aria-label="Upload progress"
            className="h-2 w-40"
          />
          <span className="font-mono text-xs text-black/60 dark:text-white/60">
            {percent}%
          </span>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            Cancel
          </button>
        </div>
      )}

      <div aria-live="polite" className="mt-3 text-sm">
        {isUploading && !isIndexing && <p>Uploading {state.file.name}…</p>}
        {isIndexing && <p>Indexing {state.file.name}…</p>}
        {state.kind === "indexed" && (
          <p className="text-green-700 dark:text-green-400">
            Indexed {state.document.filename || "the document"} —{" "}
            {state.document.chunks} searchable{" "}
            {state.document.chunks === 1 ? "chunk" : "chunks"}.
          </p>
        )}
      </div>

      {state.kind === "error" && (
        <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          <p>{state.message}</p>
          {state.requestId && (
            <p className="mt-1 break-all font-mono text-xs text-black/60 dark:text-white/60">
              Request ID: {state.requestId}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
