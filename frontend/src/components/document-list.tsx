"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, deleteDocument, listDocuments } from "@/lib/api";
import {
  DOCUMENT_STATUS_LABELS,
  type UploadedDocument,
} from "@/lib/documents";

/** How often to re-check while anything is still being indexed. */
const POLL_INTERVAL_MS = 2_000;

/**
 * The workspace's documents and where each one is in the indexing pipeline.
 *
 * Ingestion runs in a background worker, so an upload is not immediately
 * searchable. Polling stops as soon as nothing is in flight — a workspace of
 * settled documents costs no requests at all.
 */
export function DocumentList({ refreshToken = 0 }: { refreshToken?: number }) {
  const [documents, setDocuments] = useState<UploadedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await listDocuments();
      if (!mountedRef.current) return;
      setDocuments(next);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Your documents could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  // Poll only while something is actually changing.
  const pending = (documents ?? []).some(
    (document) => document.status === "pending" || document.status === "processing",
  );

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await deleteDocument(id);
      if (mountedRef.current) await load();
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That document could not be removed.",
      );
    } finally {
      if (mountedRef.current) setRemoving(null);
    }
  };

  if (documents !== null && documents.length === 0 && !error) return null;

  return (
    <section
      aria-labelledby="documents-heading"
      className="w-full rounded-xl border border-black/[.08] p-5 text-left dark:border-white/[.145]"
    >
      <h2 id="documents-heading" className="text-sm font-semibold">
        Your documents
      </h2>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {documents === null && !error && (
        <p role="status" className="mt-3 text-sm text-black/60 dark:text-white/60">
          Loading…
        </p>
      )}

      {documents && documents.length > 0 && (
        <ul className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{document.filename}</span>
                <span className="text-xs text-black/60 dark:text-white/60">
                  {DOCUMENT_STATUS_LABELS[document.status]}
                  {document.status === "ready" && document.chunks > 0 && (
                    <> · {document.chunks} sections indexed</>
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(document.id)}
                disabled={removing === document.id}
                className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
              >
                {removing === document.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <p role="status" className="mt-3 text-xs text-black/60 dark:text-white/60">
          Indexing runs in the background. You can ask questions about documents
          that are already ready.
        </p>
      )}
    </section>
  );
}
