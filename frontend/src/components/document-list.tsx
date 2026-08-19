"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, deleteDocument, listDocuments } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  DOCUMENT_STATUS_LABELS,
  type UploadedDocument,
} from "@/lib/documents";

import { Panel, PanelHeader } from "./ui/panel";

/** How often to re-check while anything is still being indexed. */
const POLL_INTERVAL_MS = 2_000;

/** Indexing state, as a colour. Ready borrows the answer stage's green. */
const STATUS_TONE: Record<string, string> = {
  ready: "var(--stage-answer)",
  pending: "var(--stage-review)",
  processing: "var(--stage-agent)",
  failed: "var(--bad)",
};

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
  const reduceMotion = useReducedMotion();

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
    <Panel aria-labelledby="documents-heading" delay={0.08}>
      <PanelHeader
        id="documents-heading"
        title="Your documents"
        action={
          documents && documents.length > 0 ? (
            <span className="font-data text-ink-faint text-xs tabular-nums">
              {documents.length} indexed
            </span>
          ) : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] text-bad mt-4 rounded-xl border p-3 text-sm"
        >
          {error}
        </p>
      )}

      {documents === null && !error && (
        <p role="status" className="text-ink-dim mt-4 text-sm">
          Loading…
        </p>
      )}

      {documents && documents.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          <AnimatePresence initial={false}>
            {documents.map((document) => {
              const tone = STATUS_TONE[document.status] ?? "var(--ink-faint)";
              const busy = document.status === "pending" || document.status === "processing";
              return (
                <motion.li
                  key={document.id}
                  layout={!reduceMotion}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="border-line hover:border-line-strong hover:bg-[var(--surface-raised)] group flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors"
                >
                  <FileText aria-hidden className="text-ink-faint h-4 w-4 shrink-0" />

                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-sm">
                      {document.filename}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          busy && "animate-breathe",
                        )}
                        style={{ background: tone, boxShadow: `0 0 7px ${tone}` }}
                      />
                      <span className="font-data text-ink-faint text-[11px]">
                        {DOCUMENT_STATUS_LABELS[document.status]}
                        {document.status === "ready" && document.chunks > 0 && (
                          <> · {document.chunks} sections indexed</>
                        )}
                      </span>
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() => void remove(document.id)}
                    disabled={removing === document.id}
                    className="text-ink-faint hover:text-bad hover:border-[color-mix(in_oklab,var(--bad)_40%,transparent)] border-line inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="h-3 w-3" />
                    {removing === document.id ? "Removing…" : "Remove"}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {pending && (
        <p role="status" className="text-ink-faint mt-3 text-xs">
          Indexing runs in the background. You can ask questions about documents
          that are already ready.
        </p>
      )}
    </Panel>
  );
}
