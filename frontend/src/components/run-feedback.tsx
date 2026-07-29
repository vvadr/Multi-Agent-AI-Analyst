"use client";

import { useState } from "react";

import { submitRunFeedback } from "@/lib/api";

/**
 * A verdict on one answer.
 *
 * Deliberately two buttons and nothing else. The value of this signal is that
 * it is cheap enough to give honestly; a form asking why would collect better
 * prose from far fewer readers. A second click replaces the first, because the
 * backend stores one verdict per reader per run.
 */
export function RunFeedback({ runId }: { runId: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [failed, setFailed] = useState(false);

  const send = async (value: 1 | -1) => {
    const previous = rating;
    // Optimistic: the click should feel immediate, and the only cost of being
    // wrong is a rating that silently did not stick.
    setRating(value);
    setFailed(false);
    try {
      await submitRunFeedback(runId, value);
    } catch {
      setRating(previous);
      setFailed(true);
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-black/60 dark:text-white/60">
        Was this answer useful?
      </span>
      {([1, -1] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => void send(value)}
          aria-pressed={rating === value}
          className={
            "rounded-full border px-3 py-1 text-xs transition-colors " +
            (rating === value
              ? "border-black/40 bg-black/[.06] dark:border-white/40 dark:bg-white/[.10]"
              : "border-black/[.08] hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]")
          }
        >
          {value === 1 ? "Yes" : "No"}
        </button>
      ))}
      {rating !== null && !failed && (
        <span role="status" className="text-xs text-black/60 dark:text-white/60">
          Thanks.
        </span>
      )}
      {failed && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          That could not be saved.
        </span>
      )}
    </div>
  );
}
