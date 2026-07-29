import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RUN_EVENT_TYPES, type RunEventType } from "@/lib/runs";

import {
  WorkflowTrace,
  deriveTraceStages,
  type WorkflowTracePhase,
} from "./workflow-trace";

/** The four stage cards, in the order the workflow runs them. */
function stageItems(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Live workflow trace" })).getAllByRole(
    "listitem",
  );
}

function stageNamed(name: RegExp): HTMLElement {
  const item = stageItems().find((element) => name.test(element.textContent ?? ""));
  if (!item) throw new Error(`No stage matching ${name}`);
  return item;
}

function statuses(steps: RunEventType[], phase: WorkflowTracePhase) {
  return deriveTraceStages(steps, phase).map((stage) => stage.status);
}

describe("WorkflowTrace", () => {
  it("shows the four workflow stages as an ordered list of headings", () => {
    render(<WorkflowTrace steps={["routing", "retrieving"]} phase="running" />);

    const items = stageItems();
    expect(items).toHaveLength(4);

    const headings = screen
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Supervisor",
      "Selected agent",
      "Quality review",
      "Final answer",
    ]);
    expect(items[0]).toHaveTextContent("Step 1");
    expect(items[3]).toHaveTextContent("Step 4");
  });

  it("marks only the stage in progress as the current step", () => {
    render(<WorkflowTrace steps={["routing", "retrieving"]} phase="running" />);

    const current = stageItems().filter(
      (item) => item.getAttribute("aria-current") === "step",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Selected agent");
    expect(current[0]).toHaveTextContent("In progress");
  });

  it("advances the current stage as allow-listed events arrive", () => {
    expect(statuses([], "starting")).toEqual([
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses(["run_started", "routing"], "running")).toEqual([
      "active",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses(["routing", "retrieving"], "running")).toEqual([
      "done",
      "active",
      "waiting",
      "waiting",
    ]);
    expect(statuses(["routing", "retrieving", "generating"], "running")).toEqual([
      "done",
      "done",
      "active",
      "waiting",
    ]);
    expect(statuses(["routing", "retrieving", "generating"], "resolving")).toEqual([
      "done",
      "done",
      "done",
      "active",
    ]);
    expect(statuses(["routing", "retrieving", "generating"], "complete")).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("keeps the supervisor ahead of the agent when the graph loops back", () => {
    // supervisor → retriever → supervisor → generate: the agent stage already
    // ran, so revisiting the supervisor must not send it back to "waiting".
    expect(
      statuses(["routing", "retrieving", "routing", "generating"], "running"),
    ).toEqual(["done", "done", "active", "waiting"]);
  });

  it("names the agent from the event type, not from any payload", () => {
    const { unmount } = render(
      <WorkflowTrace steps={["routing", "retrieving"]} phase="running" />,
    );
    expect(stageNamed(/selected agent/i)).toHaveTextContent(
      "Gathering approved source material.",
    );
    unmount();

    render(<WorkflowTrace steps={["routing", "querying"]} phase="running" />);
    expect(stageNamed(/selected agent/i)).toHaveTextContent(
      "Running the approved analytics query.",
    );
  });

  it("marks the agent stage as not needed when no evidence event arrived", () => {
    render(<WorkflowTrace steps={["routing", "generating"]} phase="complete" />);

    const agent = stageNamed(/selected agent/i);
    expect(agent).toHaveTextContent("Not needed");
    expect(agent).toHaveTextContent("No evidence step was needed.");
  });

  it("distinguishes a cancellation from a failure in fixed local copy", () => {
    const { unmount } = render(
      <WorkflowTrace steps={["routing", "retrieving"]} phase="cancelled" />,
    );
    const cancelled = stageNamed(/selected agent/i);
    expect(cancelled).toHaveTextContent("Stopped");
    expect(cancelled).toHaveTextContent("Stopped when you cancelled this run.");
    expect(stageNamed(/final answer/i)).toHaveTextContent("Not reached");
    unmount();

    render(<WorkflowTrace steps={["routing", "retrieving"]} phase="failed" />);
    const failed = stageNamed(/selected agent/i);
    expect(failed).toHaveTextContent("Stopped");
    expect(failed).toHaveTextContent("Stopped when the run could not continue.");
    expect(stageNamed(/quality review/i)).toHaveTextContent("Not reached");
  });

  it("stops rather than claiming progress once a run halts", () => {
    expect(statuses(["routing", "retrieving", "generating"], "failed")).toEqual([
      "done",
      "done",
      "stopped",
      "unreached",
    ]);
    expect(statuses([], "cancelled")).toEqual([
      "stopped",
      "unreached",
      "unreached",
      "unreached",
    ]);
    // A halted run never leaves a stage reading as still in progress, and a run
    // that halts in the supervisor claims no finished work at all.
    for (const phase of ["failed", "cancelled"] as const) {
      const halted = deriveTraceStages(RUN_EVENT_TYPES, phase);
      expect(halted.some((stage) => stage.status === "active")).toBe(false);

      const haltedEarly = deriveTraceStages(["routing"], phase);
      expect(haltedEarly.some((stage) => stage.status === "done")).toBe(false);
    }
  });

  it("never claims a critic verdict, only that the stage ran", () => {
    render(<WorkflowTrace steps={["routing", "generating"]} phase="complete" />);

    const review = stageNamed(/quality review/i);
    expect(review).toHaveTextContent("Finished checking the draft answer.");
    expect(review).not.toHaveTextContent(/approved|rejected|passed|score|verdict/i);
  });

  it("renders fixed local copy only — never an event name or payload", () => {
    // Every allow-listed event at once, so no branch is left untested.
    const everyEvent = [...RUN_EVENT_TYPES];
    for (const phase of [
      "starting",
      "running",
      "resolving",
      "complete",
      "failed",
      "cancelled",
    ] as const) {
      const { unmount } = render(
        <WorkflowTrace steps={everyEvent} phase={phase} />,
      );
      const trace = screen.getByRole("list", { name: "Live workflow trace" });

      for (const eventName of RUN_EVENT_TYPES) {
        expect(trace).not.toHaveTextContent(eventName);
      }
      // Payload-shaped words the backend could plausibly introduce later.
      expect(trace).not.toHaveTextContent(
        /rationale|reasoning|prompt|token|secret|api[_ -]?key|traceback/i,
      );
      unmount();
    }
  });

  it("renders nothing derived from an unrecognised event name", () => {
    // The type system forbids this; the cast proves the runtime does too.
    const hostile = "SECRET_TRACE" as RunEventType;
    render(<WorkflowTrace steps={["routing", hostile]} phase="running" />);

    const trace = screen.getByRole("list", { name: "Live workflow trace" });
    expect(trace).not.toHaveTextContent(/SECRET_TRACE/);
    // An unknown name falls back to the supervisor stage rather than a blank.
    expect(stageNamed(/supervisor/i)).toHaveTextContent("In progress");
  });
});
