"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createRun,
  getRun,
  listRuns,
  streamRunEvents,
} from "@/lib/api";
import { cn } from "@/lib/cn";
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
import { Button } from "./ui/button";
import { Panel, PanelHeader } from "./ui/panel";
import { SignalPipeline } from "./ui/signal-pipeline";
import { useToast } from "./ui/toast";
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

/** How often the elapsed readout ticks while a run is in flight. */
const ELAPSED_TICK_MS = 100;

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
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const stopRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  /** Guards against a late close/error overwriting a resolved outcome. */
  const settledRef = useRef(false);
  const askedRef = useRef("");
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const reduceMotion = useReducedMotion();
  const toast = useToast();

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
      setCopied(false);
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

  /**
   * The elapsed readout.
   *
   * An instrument that shows stages but not how long they are taking leaves the
   * reader unable to tell "thinking" from "stuck". It ticks only while a run is
   * in flight, and the final duration stays on screen once one settles.
   */
  useEffect(() => {
    if (!busy) return;
    const startedAt = performance.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(performance.now() - startedAt),
      ELAPSED_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [busy]);

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

  const copyAnswer = async (answer: string) => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      toast("success", "Answer copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some contexts. Saying so beats a
      // button that silently does nothing.
      toast("error", "The answer could not be copied.");
    }
  };

  const remaining = MAX_QUESTION_LENGTH - question.length;

  return (
    <Panel aria-labelledby="analyst-heading" delay={0.1}>
      <PanelHeader
        id="analyst-heading"
        step="02"
        title="Ask a question"
        action={
          busy || elapsed > 0 ? (
            <span className="font-data text-ink-dim text-xs tabular-nums">
              {(elapsed / 1000).toFixed(1)}s
            </span>
          ) : undefined
        }
      />

      {/* The instrument readout. Decorative — the trace below carries the
          semantics — so it is hidden from assistive technology. */}
      <div className="mt-4 mb-1">
        <SignalPipeline steps={steps} phase={phase} />
      </div>

      <form onSubmit={handleSubmit} className="mt-4">
        <label htmlFor="question" className="text-ink block text-sm font-medium">
          Your question
        </label>
        <div className="relative mt-2">
          <textarea
            id="question"
            name="question"
            rows={3}
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              saveDraft("question", event.target.value);
            }}
            onKeyDown={(event) => {
              // ⌘/Ctrl + Enter submits, the convention for a multi-line field
              // whose Enter key has to stay a newline.
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void ask(question);
              }
            }}
            maxLength={MAX_QUESTION_LENGTH}
            disabled={busy}
            aria-describedby="question-hint"
            placeholder="What were the main risks flagged in this report?"
            className={cn(
              "border-line bg-[var(--field)] text-ink placeholder:text-ink-faint",
              "w-full resize-y rounded-xl border p-3.5 text-sm leading-relaxed transition-colors",
              "focus:border-[color-mix(in_oklab,var(--accent)_55%,transparent)] focus:outline-none",
              "disabled:opacity-50",
            )}
          />
          {/* Only appears as the limit gets close; a counter on an empty field
              is noise about a constraint nobody is near. */}
          {remaining < 120 && (
            <span className="font-data text-ink-faint absolute right-3 bottom-3 text-[10px] tabular-nums">
              {remaining}
            </span>
          )}
        </div>

        <p id="question-hint" className="text-ink-faint mt-2 text-xs leading-relaxed">
          Answers are grounded in your indexed documents and, when the backend
          enables it, web research. Follow-up questions can build on earlier
          questions and answers in your workspace, so you can ask one without
          repeating the context.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !question.trim()}
            className={cn(busy && "sheen")}
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            {busy ? "Working…" : "Ask"}
          </Button>
          {busy && (
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          <kbd className="font-data border-line text-ink-faint ml-auto hidden rounded border px-1.5 py-0.5 text-[10px] sm:inline">
            ⌘ ↵
          </kbd>
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
        className="text-ink mt-5 text-sm font-medium"
      >
        {announcementFor(state)}
      </p>

      {steps.length > 0 && (
        <ol
          aria-label="Progress updates"
          className="border-line mt-2 space-y-1.5 border-l pl-3.5 text-sm"
        >
          {steps.map((step, index) => {
            const current = state.kind === "running" && index === steps.length - 1;
            return (
              <motion.li
                key={`${step}-${index}`}
                initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "relative",
                  current ? "text-ink" : "text-ink-dim",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "bg-[var(--surface-void)] border-line absolute top-1.5 -left-[18px] h-1.5 w-1.5 rounded-full border",
                    current && "animate-breathe border-transparent bg-[var(--accent)]",
                  )}
                />
                {RUN_PROGRESS_LABELS[step]}
              </motion.li>
            );
          })}
        </ol>
      )}

      {phase && <WorkflowTrace steps={steps} phase={phase} />}

      <AnimatePresence>
        {state.kind === "complete" && (
          <motion.div
            key="answer"
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="mt-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-ink text-sm font-semibold">Answer</h3>
              {state.detail.answer && (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => void copyAnswer(state.detail.answer as string)}
                >
                  {copied ? (
                    <Check aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <Copy aria-hidden className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </div>

            {state.detail.answer ? (
              <div
                className="mt-2 rounded-xl border p-4"
                style={{
                  borderColor: "color-mix(in oklab, var(--stage-answer) 28%, transparent)",
                  background: "color-mix(in oklab, var(--stage-answer) 6%, transparent)",
                }}
              >
                <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
                  {state.detail.answer}
                </p>
              </div>
            ) : (
              <p className="text-ink-dim mt-2 text-sm">
                The run completed without an answer.
              </p>
            )}
            <CitationList citations={state.detail.citations} />
            <RunFeedback runId={state.runId} />
          </motion.div>
        )}
      </AnimatePresence>

      {state.kind === "failed" && (
        <div
          role="alert"
          className="border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] text-bad mt-4 rounded-xl border p-3 text-sm"
        >
          <p>{state.message}</p>
          {state.requestId && (
            <p className="font-data text-ink-faint mt-1.5 text-xs break-all">
              Request ID: {state.requestId}
            </p>
          )}
        </div>
      )}

      {stopped && askedRef.current && (
        <Button
          ref={retryRef}
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => void ask(askedRef.current)}
        >
          Try again
        </Button>
      )}
    </Panel>
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
