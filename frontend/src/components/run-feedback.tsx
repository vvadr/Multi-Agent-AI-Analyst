"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { submitRunFeedback } from "@/lib/api";
import { cn } from "@/lib/cn";

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
    <div className="border-line mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
      <span className="text-ink-faint text-xs">Was this answer useful?</span>

      {([1, -1] as const).map((value) => {
        const Icon = value === 1 ? ThumbsUp : ThumbsDown;
        const active = rating === value;
        const tone = value === 1 ? "var(--ok)" : "var(--bad)";
        return (
          <button
            key={value}
            type="button"
            onClick={() => void send(value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-all duration-200",
              active
                ? "text-ink"
                : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
            )}
            style={
              active
                ? {
                    borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
                    background: `color-mix(in oklab, ${tone} 12%, transparent)`,
                  }
                : undefined
            }
          >
            <Icon
              aria-hidden
              className="h-3 w-3"
              style={active ? { color: tone } : undefined}
            />
            {value === 1 ? "Yes" : "No"}
          </button>
        );
      })}

      {rating !== null && !failed && (
        <span role="status" className="text-ink-faint text-xs">
          Thanks.
        </span>
      )}
      {failed && (
        <span role="alert" className="text-bad text-xs">
          That could not be saved.
        </span>
      )}
    </div>
  );
}
