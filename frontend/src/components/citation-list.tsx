import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/cn";
import { isSafeHttpUrl, type Citation, type CitationKind } from "@/lib/runs";

const KIND_LABELS: Record<CitationKind, string> = {
  document: "Document",
  web: "External web",
  analytics: "Analytics",
};

/**
 * Each source kind borrows the hue of the stage that produced it, so a reader
 * who has learned the pipeline's colours can see at a glance which part of the
 * run a given citation came from.
 */
const KIND_TONES: Record<CitationKind, string> = {
  document: "var(--stage-agent)",
  web: "var(--stage-supervisor)",
  analytics: "var(--stage-review)",
};

/**
 * Sources backing a completed answer.
 *
 * Web citations are labelled and linked as external, and every link is checked
 * against `isSafeHttpUrl` again at render time — the parser already drops
 * non-http(s) URLs, but this component is the thing that actually creates an
 * anchor, so it does not rely on an upstream guarantee.
 */
export function CitationList({ citations }: { citations: readonly Citation[] }) {
  if (citations.length === 0) {
    return (
      <p className="text-ink-dim mt-4 text-sm">
        No sources were cited for this answer.
      </p>
    );
  }

  return (
    <div className="mt-5">
      <h3 id="citation-list-heading" className="font-display text-ink text-sm font-semibold">
        Sources supporting this answer
      </h3>
      {/* Named so it is distinguishable from the workflow lists above it. */}
      <ol aria-labelledby="citation-list-heading" className="mt-2.5 space-y-2.5">
        {citations.map((citation) => {
          const tone = KIND_TONES[citation.kind];
          return (
            <li
              key={citation.id}
              className="border-line bg-[var(--surface-raised)] relative overflow-hidden rounded-xl border p-3 pl-4 text-sm transition-colors hover:border-line-strong"
            >
              {/* The kind, as a spine down the card's edge. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: tone }}
              />

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="font-data rounded-full border px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase"
                  style={{
                    color: tone,
                    borderColor: `color-mix(in oklab, ${tone} 35%, transparent)`,
                    background: `color-mix(in oklab, ${tone} 9%, transparent)`,
                  }}
                >
                  {KIND_LABELS[citation.kind]}
                </span>
                <CitationTitle citation={citation} />
              </div>

              {citation.kind === "document" && citation.chunkIndex !== undefined && (
                <p className="font-data text-ink-faint mt-1.5 text-xs">
                  chunk {citation.chunkIndex}
                </p>
              )}

              {citation.excerpt && (
                <p
                  className="text-ink-dim mt-2 border-l-2 pl-3 leading-relaxed"
                  style={{ borderColor: `color-mix(in oklab, ${tone} 30%, transparent)` }}
                >
                  {citation.excerpt}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CitationTitle({ citation }: { citation: Citation }) {
  const shared = "text-ink min-w-0 font-medium break-all";

  if (citation.kind === "web" && citation.url && isSafeHttpUrl(citation.url)) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          shared,
          "inline-flex items-center gap-1 underline decoration-[color-mix(in_oklab,var(--ink)_35%,transparent)] underline-offset-4 transition-colors hover:decoration-[var(--accent)]",
        )}
      >
        {citation.title}
        <ExternalLink aria-hidden className="h-3 w-3 shrink-0 opacity-60" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return <span className={shared}>{citation.title}</span>;
}
