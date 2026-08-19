import { cn } from "@/lib/cn";
import type { RunEventType } from "@/lib/runs";
import { STAGE_TONES } from "@/lib/stages";

/**
 * The reader-facing view of the workflow: supervisor → selected agent →
 * quality review → final answer.
 *
 * Everything rendered here is a **fixed local string** chosen by comparing
 * allow-listed SSE event names (`run_started`, `routing`, `retrieving`,
 * `querying`, `generating`) against the run's lifecycle phase. The component
 * receives event *types* only — the API client discards SSE payloads — so a
 * router decision, critic verdict, chain-of-thought, provider error, or secret
 * has no path into this DOM even if the backend started sending one.
 *
 * The critic has no public event of its own. Its stage is therefore derived
 * from the draft/terminal lifecycle alone and never claims a verdict.
 */

/** Run phases that can be traced. `idle` has no run, so it is excluded. */
export type WorkflowTracePhase =
  | "starting"
  | "running"
  | "resolving"
  | "complete"
  | "failed"
  | "cancelled";

export type TraceStageId = "supervisor" | "agent" | "review" | "answer";

export type TraceStageStatus =
  | "waiting"
  | "active"
  | "done"
  | "skipped"
  | "stopped"
  | "unreached";

export interface TraceStage {
  id: TraceStageId;
  label: string;
  status: TraceStageStatus;
  detail: string;
}

const STAGE_ORDER: readonly TraceStageId[] = [
  "supervisor",
  "agent",
  "review",
  "answer",
];

const STAGE_LABELS: Record<TraceStageId, string> = {
  supervisor: "Supervisor",
  agent: "Selected agent",
  review: "Quality review",
  answer: "Final answer",
};

const STATUS_COPY: Record<TraceStageStatus, string> = {
  waiting: "Waiting",
  active: "In progress",
  done: "Done",
  skipped: "Not needed",
  stopped: "Stopped",
  unreached: "Not reached",
};

/**
 * Status text carries the meaning; colour is a redundant second signal.
 *
 * The active stage is set in plain ink rather than a colour of its own — the
 * card it sits in already carries that stage's hue on its border and dot, and
 * tinting the word as well would leave the row with no stable reading weight.
 */
const STATUS_CLASSES: Record<TraceStageStatus, string> = {
  waiting: "text-ink-faint",
  active: "text-ink",
  done: "text-ok",
  skipped: "text-ink-faint",
  stopped: "text-bad",
  unreached: "text-ink-faint",
};

/** Statuses a stage can hold while the run is still progressing normally. */
type ProgressStatus = "waiting" | "active" | "done";

const STAGE_DETAIL: Record<TraceStageId, Record<ProgressStatus, string>> = {
  supervisor: {
    waiting: "Waiting for the run to start.",
    active: "Choosing the next approved step.",
    done: "Finished choosing the workflow steps.",
  },
  agent: {
    waiting: "Waiting for the supervisor to choose one.",
    active: "Working on the approved evidence step.",
    done: "Finished the approved evidence step.",
  },
  review: {
    waiting: "Starts once a draft answer exists.",
    active: "Checking the draft answer against its sources.",
    done: "Finished checking the draft answer.",
  },
  answer: {
    waiting: "Waiting for a checked answer.",
    active: "Loading the grounded answer and its sources.",
    done: "Ready below, with its sources.",
  },
};

/**
 * Which agent the supervisor put to work, read from the event *name* only.
 *
 * `retrieving` and `querying` are part of the published event contract, so
 * distinguishing them is safe; the labels below are local constants, not
 * anything the backend sent.
 */
type AgentKind = "none" | "research" | "analytics";

const AGENT_DETAIL: Record<
  Exclude<AgentKind, "none">,
  Record<"active" | "done", string>
> = {
  research: {
    active: "Gathering approved source material.",
    done: "Gathered approved source material.",
  },
  analytics: {
    active: "Running the approved analytics query.",
    done: "Ran the approved analytics query.",
  },
};

const HALTED_DETAIL: Record<"failed" | "cancelled", string> = {
  failed: "Stopped when the run could not continue.",
  cancelled: "Stopped when you cancelled this run.",
};

export function WorkflowTrace({
  steps,
  phase,
}: {
  steps: readonly RunEventType[];
  phase: WorkflowTracePhase;
}) {
  const stages = deriveTraceStages(steps, phase);

  return (
    <section
      aria-labelledby="workflow-trace-heading"
      className="border-line bg-[var(--surface-raised)] mt-5 rounded-xl border p-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="workflow-trace-heading" className="font-display text-ink text-sm font-semibold">
          Live workflow
        </h3>
        <p className="text-ink-faint text-xs">
          Stage names only — no model, router, or backend text
        </p>
      </div>

      <ol
        aria-label="Live workflow trace"
        className="mt-3 grid gap-2 sm:grid-cols-4"
      >
        {stages.map((stage, index) => {
          const tone = STAGE_TONES[stage.id].color;
          const lit = stage.status === "active" || stage.status === "done";
          return (
            <li
              key={stage.id}
              aria-current={stage.status === "active" ? "step" : undefined}
              /* The active stage is raised out of the row: a tinted ground, its
                 own hue on the border, and a glow. Status text still carries the
                 meaning — colour is the second signal, never the only one. */
              className={cn(
                "border-line relative overflow-hidden rounded-lg border p-2.5 transition-all duration-500",
                stage.status === "active" && "bg-[color-mix(in_oklab,var(--surface-panel)_70%,transparent)]",
                stage.status === "stopped" && "border-[color-mix(in_oklab,var(--bad)_40%,transparent)]",
              )}
              style={
                stage.status === "active"
                  ? {
                      borderColor: `color-mix(in oklab, ${tone} 50%, transparent)`,
                      boxShadow: `0 0 26px -8px ${tone}`,
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500",
                    stage.status === "active" && "animate-breathe",
                  )}
                  style={{
                    background:
                      stage.status === "stopped"
                        ? "var(--bad)"
                        : lit
                          ? tone
                          : "var(--ink-faint)",
                    boxShadow: lit ? `0 0 8px ${tone}` : undefined,
                  }}
                />
                <p className="font-data text-ink-faint text-[10px] tracking-[0.14em] uppercase">
                  Step {index + 1}
                </p>
              </div>
              <h4 className="text-ink mt-1 text-sm font-medium">{stage.label}</h4>
              <p className={`mt-0.5 text-sm font-medium ${STATUS_CLASSES[stage.status]}`}>
                {STATUS_COPY[stage.status]}
              </p>
              <p className="text-ink-dim mt-1 text-xs leading-snug">{stage.detail}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Build the four stages from event names and the lifecycle phase alone. */
export function deriveTraceStages(
  steps: readonly RunEventType[],
  phase: WorkflowTracePhase,
): TraceStage[] {
  const agent = selectedAgent(steps);
  const current = currentStageIndex(steps, phase);
  const halted = phase === "failed" || phase === "cancelled" ? phase : null;

  return STAGE_ORDER.map((id, index) => {
    const status = stageStatus(index, current, agent, halted !== null);
    return {
      id,
      label: STAGE_LABELS[id],
      status,
      detail: stageDetail(id, status, agent, halted),
    };
  });
}

/**
 * Which stage the workflow is sitting in.
 *
 * `generating` maps onto the review stage: the draft and the critic pass that
 * checks it are one band from the outside, and folding them together keeps the
 * displayed order the same as the documented workflow.
 */
function currentStageIndex(
  steps: readonly RunEventType[],
  phase: WorkflowTracePhase,
): number {
  // The run has not been accepted yet, so no stage has begun.
  if (phase === "starting") return -1;
  // Every stage is behind us once the answer is on screen.
  if (phase === "complete") return STAGE_ORDER.length;
  // A terminal `completed` event arrived; only delivery is left.
  if (phase === "resolving") return STAGE_ORDER.indexOf("answer");

  switch (steps[steps.length - 1]) {
    case "retrieving":
    case "querying":
      return STAGE_ORDER.indexOf("agent");
    case "generating":
      return STAGE_ORDER.indexOf("review");
    default:
      return STAGE_ORDER.indexOf("supervisor");
  }
}

function stageStatus(
  index: number,
  current: number,
  agent: AgentKind,
  halted: boolean,
): TraceStageStatus {
  if (index === current) return halted ? "stopped" : "active";
  if (index > current) return halted ? "unreached" : "waiting";

  // Passed. The evidence stage is only "done" if an agent actually ran; with
  // no `retrieving`/`querying` event the supervisor went straight past it.
  if (STAGE_ORDER[index] === "agent" && agent === "none") return "skipped";
  return "done";
}

function stageDetail(
  id: TraceStageId,
  status: TraceStageStatus,
  agent: AgentKind,
  halted: "failed" | "cancelled" | null,
): string {
  // One clear sentence separates "you stopped this" from "it could not finish",
  // without borrowing a single character of backend or provider text.
  if (halted && (status === "stopped" || status === "unreached")) {
    return HALTED_DETAIL[halted];
  }
  if (status === "skipped") return "No evidence step was needed.";
  if (status === "stopped" || status === "unreached") {
    return STAGE_DETAIL[id].waiting;
  }
  if (id === "agent" && agent !== "none" && status !== "waiting") {
    return AGENT_DETAIL[agent][status];
  }
  return STAGE_DETAIL[id][status];
}

function selectedAgent(steps: readonly RunEventType[]): AgentKind {
  const retrieving = steps.lastIndexOf("retrieving");
  const querying = steps.lastIndexOf("querying");
  if (retrieving < 0 && querying < 0) return "none";
  return querying > retrieving ? "analytics" : "research";
}
