"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, createRun, getRun, streamRunEvents } from "@/lib/api";
import {
  MAX_QUESTION_LENGTH,
  RUN_PROGRESS_LABELS,
  isTerminalRunEvent,
  type RunDetail,
  type RunEventType,
} from "@/lib/runs";

import { CitationList } from "./citation-list";

type RunState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; steps: RunEventType[] }
  /** Terminal event seen; fetching the answer from `GET /v1/runs/{id}`. */
  | { kind: "resolving"; steps: RunEventType[] }
  /** `steps` is kept so the finished answer still shows how it was reached. */
  | { kind: "complete"; steps: RunEventType[]; detail: RunDetail }
  | { kind: "failed"; message: string; requestId?: string }
  | { kind: "cancelled" };

/**
 * Fixed local copy for a failed run.
 *
 * The backend also returns an `error` string, which the API client deliberately
 * does not parse: a failure message must never be able to carry provider or
 * graph detail into the page.
 */
const RUN_FAILED_MESSAGE =
  "The analyst run could not be completed. Please try again.";

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
 */
export function AnalystWorkspace() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const stopRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  /** Guards against a late close/error overwriting a resolved outcome. */
  const settledRef = useRef(false);
  const askedRef = useRef("");

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
        setState({ kind: "complete", steps, detail });
      } else if (detail.status === "failed") {
        setState({ kind: "failed", message: RUN_FAILED_MESSAGE });
      } else {
        setState({
          kind: "failed",
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
        message: apiError.message,
        requestId: apiError.requestId,
      });
    }
  }, []);

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
      } catch (error) {
        if (!mountedRef.current) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("The run could not be started.", 0);
        setState({
          kind: "failed",
          message: apiError.message,
          requestId: apiError.requestId,
        });
        return;
      }
      if (!mountedRef.current) return;

      const steps: RunEventType[] = [];
      setState({ kind: "running", steps });

      stopRef.current = streamRunEvents(runId, {
        onEvent: ({ type }) => {
          if (!mountedRef.current || settledRef.current) return;

          if (isTerminalRunEvent(type)) {
            settledRef.current = true;
            stopStream();
            if (type === "completed") void resolveResult(runId, steps);
            else setState({ kind: "failed", message: RUN_FAILED_MESSAGE });
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

  const cancel = useCallback(() => {
    settledRef.current = true;
    stopStream();
    setState({ kind: "cancelled" });
  }, [stopStream]);

  const busy =
    state.kind === "starting" ||
    state.kind === "running" ||
    state.kind === "resolving";

  /** The stage trail, kept on screen once the answer arrives. */
  const steps = "steps" in state ? state.steps : [];

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
          onChange={(event) => setQuestion(event.target.value)}
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
          questions and answers from this local demo, so you can ask one without
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

      <div aria-live="polite" aria-busy={busy} className="mt-4 text-sm">
        {state.kind === "starting" && <p>Starting the run…</p>}

        {state.kind === "running" && (
          <p className="font-medium">
            {currentLabel(state.steps) ?? "Waiting for the first update…"}
          </p>
        )}
        {state.kind === "resolving" && (
          <p className="font-medium">Collecting the answer…</p>
        )}
        {state.kind === "complete" && <p className="font-medium">Answer ready.</p>}

        {steps.length > 0 && (
          <ol className="mt-2 space-y-1 text-black/70 dark:text-white/70">
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

        {state.kind === "cancelled" && (
          <p>Stopped following this run. It may still be finishing on the server.</p>
        )}
      </div>

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

      {(state.kind === "failed" || state.kind === "cancelled") &&
        askedRef.current && (
          <button
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

function currentLabel(steps: readonly RunEventType[]): string | null {
  const latest = steps[steps.length - 1];
  return latest ? RUN_PROGRESS_LABELS[latest] : null;
}
