import { isSafeHttpUrl, type Citation, type CitationKind } from "@/lib/runs";

const KIND_LABELS: Record<CitationKind, string> = {
  document: "Document",
  web: "External web",
  analytics: "Analytics",
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
      <p className="mt-4 text-sm text-black/60 dark:text-white/60">
        No sources were cited for this answer.
      </p>
    );
  }

  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">Sources</h3>
      <ol className="mt-2 space-y-3">
        {citations.map((citation) => (
          <li
            key={citation.id}
            className="rounded-lg border border-black/[.08] p-3 text-sm dark:border-white/[.145]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-black/[.08] px-2 py-0.5 text-[11px] uppercase tracking-wide text-black/60 dark:border-white/[.145] dark:text-white/60">
                {KIND_LABELS[citation.kind]}
              </span>
              <CitationTitle citation={citation} />
            </div>

            {citation.kind === "document" && citation.chunkIndex !== undefined && (
              <p className="mt-1 font-mono text-xs text-black/60 dark:text-white/60">
                chunk {citation.chunkIndex}
              </p>
            )}

            {citation.excerpt && (
              <p className="mt-2 border-l-2 border-black/[.08] pl-3 text-black/70 dark:border-white/[.145] dark:text-white/70">
                {citation.excerpt}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CitationTitle({ citation }: { citation: Citation }) {
  if (citation.kind === "web" && citation.url && isSafeHttpUrl(citation.url)) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2 break-all"
      >
        {citation.title}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return <span className="font-medium break-all">{citation.title}</span>;
}
