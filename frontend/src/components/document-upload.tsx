"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, FileText, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, uploadDocument } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCUMENT_SIZE_LABEL,
  SUPPORTED_FORMATS_LABEL,
  UNSUPPORTED_LEGACY_EXTENSIONS,
  formatFileSize,
  validateDocumentFile,
  type UploadedDocument,
} from "@/lib/documents";

import { Button } from "./ui/button";
import { Panel, PanelHeader } from "./ui/panel";
import { useToast } from "./ui/toast";

type UploadState =
  | { kind: "idle" }
  | { kind: "selected"; file: File }
  /** `progress` is the fraction of bytes sent; 1 means the server is indexing. */
  | { kind: "uploading"; file: File; progress: number }
  | { kind: "indexed"; document: UploadedDocument }
  | { kind: "error"; message: string; requestId?: string };

/**
 * Upload one supported document into the signed-in user's workspace.
 *
 * The drop target is the file input itself, stretched over the panel at zero
 * opacity: the browser then handles both the click-to-browse and the drop
 * natively, and the drag listeners exist only to light the target up. Doing it
 * the other way — a styled div plus a `DataTransfer` handler — reimplements
 * behaviour the platform already has, and loses keyboard access with it.
 *
 * The gap between "bytes sent" and "response received" is where indexing
 * happens, and it is reported as its own step.
 */
export function DocumentUpload({
  onUploaded,
}: {
  /** Called once an upload is accepted, so the list can pick it up. */
  onUploaded?: () => void;
} = {}) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const reduceMotion = useReducedMotion();
  const toast = useToast();
  // Held in a ref so an inline callback from the parent does not rebuild the
  // upload handler on every render.
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

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
      toast("success", `${document.filename || "Document"} is indexed.`);
      onUploadedRef.current?.();
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
  }, [state, toast]);

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
    <Panel aria-labelledby="document-upload-heading" delay={0.05}>
      <PanelHeader
        id="document-upload-heading"
        step="01"
        title="Add a document"
        hint={
          <>
            Upload a {SUPPORTED_FORMATS_LABEL} file up to{" "}
            {MAX_DOCUMENT_SIZE_LABEL}. It is indexed on the backend so answers
            can cite it.
          </>
        }
      />

      <div
        onDragEnter={() => setDragging(true)}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          // `dragleave` also fires when the pointer crosses onto a child, so
          // the target is only released once the pointer truly exits.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDrop={() => setDragging(false)}
        className={cn(
          "relative mt-5 rounded-xl border border-dashed p-6 text-center transition-all duration-300 sm:p-8",
          dragging
            ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] scale-[1.01]"
            : "border-line-strong hover:border-[color-mix(in_oklab,var(--accent)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]",
          isUploading && "pointer-events-none opacity-60",
        )}
      >
        <motion.div
          aria-hidden
          animate={dragging && !reduceMotion ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-[var(--glass-tint)]"
        >
          <UploadCloud
            className={cn(
              "h-5 w-5 transition-colors",
              dragging ? "text-[var(--accent)]" : "text-ink-dim",
            )}
          />
        </motion.div>

        <label
          htmlFor="document-file"
          className="text-ink mt-3 block cursor-pointer text-sm font-medium"
        >
          Choose a document
        </label>
        <p className="text-ink-faint mt-1 text-xs">
          {dragging ? "Release to attach it" : "or drag it onto this panel"}
        </p>

        <input
          ref={inputRef}
          id="document-file"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleSelect}
          disabled={isUploading}
          aria-describedby="document-file-limits"
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      <p id="document-file-limits" className="text-ink-faint mt-3 text-xs leading-relaxed">
        Not supported: password-protected PDFs, and legacy{" "}
        {UNSUPPORTED_LEGACY_EXTENSIONS.join(", ")} files — save those as .docx,
        .xlsx, or PDF first. Scanned PDFs with no selectable text cannot be
        indexed either.
      </p>

      <AnimatePresence mode="popLayout">
        {state.kind === "selected" && (
          <motion.div
            key="selected"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="border-line bg-[var(--surface-raised)] mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-3"
          >
            <FileText aria-hidden className="text-ink-dim h-4 w-4 shrink-0" />
            <span className="font-data text-ink min-w-0 flex-1 truncate text-xs">
              {state.file.name} · {formatFileSize(state.file.size)}
            </span>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleUpload()}
            >
              Upload
            </Button>
          </motion.div>
        )}

        {isUploading && (
          <motion.div
            key="uploading"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4"
          >
            <div className="flex items-center gap-3">
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className={cn(
                  "bg-[var(--surface-sunken)] relative h-1.5 flex-1 overflow-hidden rounded-full",
                  // Bytes are all sent; the wait is now the server's, and an
                  // indeterminate sheen says that better than a bar stuck at 100.
                  isIndexing && "sheen",
                )}
              >
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--stage-supervisor), var(--stage-agent))",
                  }}
                  initial={false}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
                />
              </div>
              <span className="font-data text-ink-dim w-10 text-right text-xs">
                {percent}%
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div aria-live="polite" className="mt-3 text-sm">
        {isUploading && !isIndexing && (
          <p className="text-ink-dim">Uploading {state.file.name}…</p>
        )}
        {isIndexing && <p className="text-ink-dim">Indexing {state.file.name}…</p>}
        {state.kind === "indexed" && (
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-ok flex items-center gap-2"
          >
            <Check aria-hidden className="h-4 w-4 shrink-0" />
            <span>
              Indexed {state.document.filename || "the document"} —{" "}
              {state.document.chunks} searchable{" "}
              {state.document.chunks === 1 ? "chunk" : "chunks"}.
            </span>
          </motion.p>
        )}
      </div>

      {state.kind === "error" && (
        <div
          role="alert"
          className="border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] text-bad mt-3 rounded-xl border p-3 text-sm"
        >
          <p>{state.message}</p>
          {state.requestId && (
            <p className="font-data text-ink-faint mt-1.5 text-xs break-all">
              Request ID: {state.requestId}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
