"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createRun,
  getRun,
  listRuns,
  streamRunEvents,
} from "@/lib/api";
import { clearDraft, readDraft, saveDraft } from "@/lib/drafts";
import {
  MAX_QUESTION_LENGTH,
  RUN_PROGRESS_LABELS,
  isTerminalRunEvent,
  type RunDetail,
  type RunEventType,
} from "@/lib/runs";

import { CitationList } from "./citation-list";
import { RunFeedback } from "./run-feedback";
import { WorkflowTrace, type WorkflowTracePhase } from "./workflow-trace";

type RunState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; steps: RunEventType[] }
  /** Terminal event seen; fetching the answer from `GET /v1/runs/{id}`. */
  | { kind: "resolving"; steps: RunEventType[] }
  /** `steps` is kept so the finished answer still shows how it was reached. */
  | { kind: "complete"; steps: RunEventType[]; detail: RunDetail; runId: string }
  /** `steps` is `null` when the run never started, so there is no trace yet. */
  | {
      kind: "failed";
      steps: RunEventType[] | null;
      message: string;
      requestId?: string;
    }
  | { kind: "cancelled"; steps: RunEventType[] };

/**
 * Fixed local copy for a failed run.
 *
 * The backend also returns an `error` string, which the API client deliberately
 * does not parse: a failure message must never be able to carry provider or
 * graph detail into the page.
 */
const RUN_FAILED_MESSAGE =
  "The analyst run could not be completed. Please try again.";

const CANCELLED_MESSAGE =
  "Stopped following this run. It may still be finishing on the server.";

/**
 * Ask a question, follow the run over SSE, and render the grounded answer.
 *
 * Progress copy comes from `RUN_PROGRESS_LABELS` keyed by event type alone —
 * event payloads are dropped by the API client, so nothing the model or the
 * router produced can appear here. The final answer arrives from a separate
 * `GET /v1/runs/{id}` once a terminal event is seen.
 *
 * The backend recalls earlier completed question/answer pairs on its own; that
 * is stated once in the form hint. There is deliberately no transcript, no
 * stored-memory view, and no endpoint here that would expose those records —
 * recall is backend behaviour the reader should know about, not a surface.
 *
 * Unsent question text is mirrored into the draft store, so a session that ends
 * mid-question does not cost the reader their typing.
 */
export function AnalystWorkspace() {
  // Seeded from the draft store so a question typed before a session expired
  // survives the trip through the login screen.
  const [question, setQuestion] = useState(() => readDraft("question"));
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const stopRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  /** Guards against a late close/error overwriting a resolved outcome. */
  const settledRef = useRef(false);
  const askedRef = useRef("");
  const retryRef = useRef<HTMLButtonElement | null>(null);

  const stopStream = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, []);

  const resolveResult = useCallback(async (runId: string, steps: RunEventType[]) => {
    setState({ kind: "resolving", steps });
    try {
      const detail = await getRun(runId);
      if (!mountedRef.current) return;

      if (detail.status === "completed") {
        setState({ kind: "complete", steps, detail, runId });
      } else if (detail.status === "failed") {
        setState({ kind: "failed", steps, message: RUN_FAILED_MESSAGE });
      } else {
        setState({
          kind: "failed",
          steps,
          message: "The run ended before it produced an answer.",
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError("The answer could not be loaded.", 0);
      setState({
        kind: "failed",
        steps,
        message: apiError.message,
        requestId: apiError.requestId,
      });
    }
  }, []);

  /**
   * Attach to a run's event stream and drive the UI from it.
   *
   * Shared by a freshly created run and by one picked up again on load, so a
   * resumed run behaves identically to one this tab started.
   */
  const follow = useCallback(
    (runId: string) => {
      settledRef.current = false;
      const steps: RunEventType[] = [];
      setState({ kind: "running", steps });

      stopRef.current = streamRunEvents(runId, {
        onEvent: ({ type }) => {
          if (!mountedRef.current || settledRef.current) return;

          if (isTerminalRunEvent(type)) {
            settledRef.current = true;
            stopStream();
            if (type === "completed") void resolveResult(runId, steps);
            else setState({ kind: "failed", steps, message: RUN_FAILED_MESSAGE });
            return;
          }

          // The graph loops through the supervisor, so the same stage can
          // arrive repeatedly; restating it adds nothing for the reader.
          if (steps[steps.length - 1] !== type) steps.push(type);
          setState({ kind: "running", steps: [...steps] });
        },
        onError: (error) => {
          if (!mountedRef.current || settledRef.current) return;
          settledRef.current = true;
          setState({
            kind: "failed",
            steps,
            message: error.message,
            requestId: error.requestId,
          });
        },
        onClose: () => {
          if (!mountedRef.current || settledRef.current) return;
          // Stream closed with no terminal event — ask for the final state.
          settledRef.current = true;
          void resolveResult(runId, steps);
        },
      });
    },
    [resolveResult, stopStream],
  );

  const ask = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      stopStream();
      settledRef.current = false;
      askedRef.current = trimmed;
      setState({ kind: "starting" });

      let runId: string;
      try {
        runId = (await createRun(trimmed)).id;
        // The question reached the backend, so it is no longer unsent. A
        // failure below leaves the draft in place on purpose.
        clearDraft("question");
      } catch (error) {
        if (!mountedRef.current) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("The run could not be started.", 0);
        setState({
          // No run exists, so there is no workflow to trace.
          kind: "failed",
          steps: null,
          message: apiError.message,
          requestId: apiError.requestId,
        });
        return;
      }
      if (!mountedRef.current) return;

      follow(runId);
    },
    [follow, stopStream],
  );

  /**
   * Pick up a run that was still going when this page was last open.
   *
   * Asks the backend rather than remembering locally: runs are durable server
   * side, so a reload, a new tab, or a different machine can all rejoin the
   * same work, and a crashed browser costs nothing.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const runs = await listRuns();
        if (cancelled || !mountedRef.current) return;
        const active = runs.find(
          (run) => run.status === "queued" || run.status === "running",
        );
        // Never interrupt a reader who has already started typing or asking.
        if (active && stopRef.current === null) follow(active.id);
      } catch {
        // Resuming is a convenience. Failing to means an empty workspace, not
        // an error worth putting in front of the reader.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [follow]);

  const cancel = useCallback(() => {
    settledRef.current = true;
    stopStream();
    setState((previous) => ({
      kind: "cancelled",
      steps: "steps" in previous ? (previous.steps ?? []) : [],
    }));
  }, [stopStream]);

  const busy =
    state.kind === "starting" ||
    state.kind === "running" ||
    state.kind === "resolving";

  /** The stage trail, kept on screen once the run settles. */
  const steps = "steps" in state ? (state.steps ?? []) : [];
  const phase = tracePhase(state);
  const stopped = state.kind === "failed" || state.kind === "cancelled";

  /**
   * Cancelling or failing removes the Cancel button that had keyboard focus.
   * Focus would otherwise fall back to the document body, so it is handed to
   * the control that replaces it — and only then, never stealing focus the
   * reader has deliberately put somewhere else.
   */
  useEffect(() => {
    if (!stopped) return;
    const active = document.activeElement;
    if (active === null || active === document.body) retryRef.current?.focus();
  }, [stopped]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <section
      aria-labelledby="analyst-heading"
      className="w-full rounded-xl border border-black/[.08] p-5 text-left dark:border-white/[.145]"
    >
      <h2 id="analyst-heading" className="text-sm font-semibold">
        2 · Ask a question
      </h2>

      <form onSubmit={handleSubmit} className="mt-4">
        <label htmlFor="question" className="block text-sm font-medium">
          Your question
        </label>
        <textarea
          id="question"
          name="question"
          rows={3}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
            saveDraft("question", event.target.value);
          }}
          maxLength={MAX_QUESTION_LENGTH}
          disabled={busy}
          aria-describedby="question-hint"
          className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-3 text-sm disabled:opacity-50 dark:border-white/[.145]"
        />
        <p
          id="question-hint"
          className="mt-1 text-xs text-black/60 dark:text-white/60"
        >
          Answers are grounded in your indexed documents and, when the backend
          enables it, web research. Follow-up questions can build on earlier
          questions and answers in your workspace, so you can ask one without
          repeating the context.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="rounded-full border border-black/[.08] px-4 py-1.5 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            {busy ? "Working…" : "Ask"}
          </button>
          {busy && (
            <button
              type="button"
              onClick={cancel}
              className="rounded-full border border-black/[.08] px-4 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/*
        One short sentence per state, so assistive technology announces the
        change rather than re-reading the whole stage list. The trail and the
        trace below sit outside the live region on purpose.
      */}
      <p
        role="status"
        aria-live="polite"
        aria-busy={busy}
        className="mt-4 text-sm font-medium"
      >
        {announcementFor(state)}
      </p>

      {steps.length > 0 && (
        <ol
          aria-label="Progress updates"
          className="mt-2 space-y-1 text-sm text-black/70 dark:text-white/70"
        >
          {steps.map((step, index) => (
            <li
              key={`${step}-${index}`}
              aria-current={
                state.kind === "running" && index === steps.length - 1
                  ? "step"
                  : undefined
              }
            >
              {RUN_PROGRESS_LABELS[step]}
            </li>
          ))}
        </ol>
      )}

      {phase && <WorkflowTrace steps={steps} phase={phase} />}

      {state.kind === "complete" && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Answer</h3>
          {state.detail.answer ? (
            <p className="mt-2 text-sm whitespace-pre-wrap">
              {state.detail.answer}
            </p>
          ) : (
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              The run completed without an answer.
            </p>
          )}
          <CitationList citations={state.detail.citations} />
          <RunFeedback runId={state.runId} />
        </div>
      )}

      {state.kind === "failed" && (
        <div role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          <p>{state.message}</p>
          {state.requestId && (
            <p className="mt-1 break-all font-mono text-xs text-black/60 dark:text-white/60">
              Request ID: {state.requestId}
            </p>
          )}
        </div>
      )}

      {stopped && askedRef.current && (
        <button
          ref={retryRef}
          type="button"
          onClick={() => void ask(askedRef.current)}
          className="mt-3 rounded-full border border-black/[.08] px-4 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          Try again
        </button>
      )}
    </section>
  );
}

/**
 * The single sentence the live region announces.
 *
 * Every branch is a local constant or a `RUN_PROGRESS_LABELS` lookup keyed by
 * event type. A failed run says only that it stopped; the reason — always fixed
 * local copy, never backend text — is in the alert below.
 */
function announcementFor(state: RunState): string | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "starting":
      return "Starting the run…";
    case "running": {
      const latest = state.steps[state.steps.length - 1];
      return latest
        ? RUN_PROGRESS_LABELS[latest]
        : "Waiting for the first update…";
    }
    case "resolving":
      return "Collecting the answer…";
    case "complete":
      return "Answer ready.";
    case "failed":
      return "The run did not finish.";
    case "cancelled":
      return CANCELLED_MESSAGE;
  }
}

/**
 * Map a run state onto a trace phase, or `null` when there is nothing to trace.
 *
 * Written as a narrowing check rather than a cast so that adding a run state
 * without a matching phase is a compile error instead of a blank stage.
 */
function tracePhase(state: RunState): WorkflowTracePhase | null {
  if (state.kind === "idle") return null;
  // A run that never started has no workflow to show.
  if (state.kind === "failed" && state.steps === null) return null;
  return state.kind;
}
