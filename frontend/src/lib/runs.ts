/**
 * The analyst-run contract: types, defensive parsers, and progress copy.
 *
 * Mirrors `backend/app/api/routes/runs.py` and `backend/app/agents/state.py`.
 * Kept free of network code so every rule below is testable as a pure function.
 *
 * Two rules here are load-bearing for safety:
 *
 *  1. Progress text is derived from the event **type** only. Backend events
 *     carry payloads (`routing` sends the chosen route, `retrieving` sends the
 *     source) that describe the agent's internal reasoning. None of it is read
 *     for display — the UI looks up a fixed string from `RUN_PROGRESS_LABELS`,
 *     so no model-controlled text can reach the DOM through the progress feed.
 *  2. `GET /v1/runs/{id}` returns an `error` string on failure. It is
 *     deliberately **not** parsed: failures render fixed local copy, so neither
 *     provider nor graph error text is ever shown.
 */

import { asRecord, readNumber, readString } from "./parse";

export const RUN_EVENT_TYPES = [
  "run_started",
  "routing",
  "retrieving",
  "querying",
  "generating",
  "completed",
  "failed",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

const RUN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(RUN_EVENT_TYPES);

export function isRunEventType(value: unknown): value is RunEventType {
  return typeof value === "string" && RUN_EVENT_TYPE_SET.has(value);
}

/**
 * Human-readable progress copy, keyed by event type.
 *
 * The graph loops (supervisor → retriever → supervisor …), so a type can arrive
 * several times; the UI collapses repeats rather than restating them.
 */
export const RUN_PROGRESS_LABELS: Record<RunEventType, string> = {
  run_started: "Run started",
  routing: "Planning the next step",
  retrieving: "Gathering source material",
  querying: "Running an analytics query",
  generating: "Writing the answer",
  completed: "Answer ready",
  failed: "The run could not be completed",
};

export const TERMINAL_RUN_EVENT_TYPES: ReadonlySet<RunEventType> = new Set([
  "completed",
  "failed",
]);

export function isTerminalRunEvent(type: RunEventType): boolean {
  return TERMINAL_RUN_EVENT_TYPES.has(type);
}

export const RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

const RUN_STATUS_SET: ReadonlySet<string> = new Set(RUN_STATUSES);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUS_SET.has(value);
}

/** Matches the backend `question` field bounds, so the UI can reject early. */
export const MAX_QUESTION_LENGTH = 2000;

/** `POST /v1/runs` → 202. */
export interface RunCreated {
  id: string;
  status: RunStatus;
}

export const CITATION_KINDS = ["document", "web", "analytics"] as const;

export type CitationKind = (typeof CITATION_KINDS)[number];

const CITATION_KIND_SET: ReadonlySet<string> = new Set(CITATION_KINDS);

/**
 * Safe source metadata attached to a completed run.
 *
 * `url` survives parsing only when it is an `http(s)` URL, so a citation can
 * never introduce a `javascript:` or `data:` link into the rendered answer.
 */
export interface Citation {
  id: string;
  kind: CitationKind;
  title: string;
  excerpt: string;
  url?: string;
  documentId?: string;
  chunkIndex?: number;
}

/** `GET /v1/runs/{id}`, normalized so the UI always has one shape. */
export interface RunDetail {
  id: string;
  status: RunStatus;
  /** Empty string when the backend sent `null` or omitted it. */
  answer: string;
  citations: Citation[];
}

/** Only `http(s)` may be rendered as a link. */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Parse the run-creation response.
 *
 * `id` is required — without it nothing downstream can work. A missing or
 * unrecognized `status` falls back to `queued`, which is the only state a
 * freshly accepted run can be in.
 */
export function parseRunCreated(value: unknown): RunCreated | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readString(record, "id");
  if (!id) return null;

  return { id, status: isRunStatus(record.status) ? record.status : "queued" };
}

export function parseRunDetail(value: unknown): RunDetail | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readString(record, "id");
  // Unlike creation, status carries the whole meaning of this response, so an
  // unrecognized value is a contract mismatch rather than something to default.
  if (!id || !isRunStatus(record.status)) return null;

  return {
    id,
    status: record.status,
    answer: readString(record, "answer") ?? "",
    citations: parseCitations(record.citations),
  };
}

/** Parse a citation list, dropping entries that do not match the contract. */
export function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];

  const citations: Citation[] = [];
  value.forEach((entry, index) => {
    const citation = parseCitation(entry, index);
    if (citation) citations.push(citation);
  });
  return citations;
}

function parseCitation(value: unknown, index: number): Citation | null {
  const record = asRecord(value);
  if (!record) return null;

  const kind = record.kind;
  if (typeof kind !== "string" || !CITATION_KIND_SET.has(kind)) return null;

  const url = readString(record, "url");
  const chunkIndex = readNumber(record, "chunk_index");

  return {
    // The backend supplies stable ids; the index fallback only has to be
    // unique within one response, which is all React keys need.
    id: readString(record, "id") ?? `${kind}:${index}`,
    kind: kind as CitationKind,
    title: readString(record, "title") ?? "Untitled source",
    excerpt: readString(record, "excerpt") ?? "",
    ...(url && isSafeHttpUrl(url) ? { url } : {}),
    ...(readString(record, "document_id")
      ? { documentId: readString(record, "document_id") }
      : {}),
    ...(chunkIndex !== undefined && chunkIndex >= 0
      ? { chunkIndex: Math.trunc(chunkIndex) }
      : {}),
  };
}
