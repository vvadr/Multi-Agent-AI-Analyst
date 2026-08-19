/**
 * The stage spectrum, in one place.
 *
 * Each workflow stage owns a hue, and that hue means the same thing wherever it
 * appears — the signal pipeline, the trace cards, the run summary. Colour is
 * carrying information here, so the mapping cannot be allowed to drift between
 * the components that draw it; they all read it from here.
 *
 * The values are CSS custom properties rather than literals so that light and
 * dark each get a hue tuned for their background without this module knowing
 * which theme is active.
 */

import type { TraceStageId } from "@/components/workflow-trace";

export interface StageTone {
  /** CSS colour reference for the stage's hue. */
  color: string;
  /** Short mono label used under a pipeline node. */
  short: string;
}

export const STAGE_TONES: Record<TraceStageId, StageTone> = {
  supervisor: { color: "var(--stage-supervisor)", short: "ROUTE" },
  agent: { color: "var(--stage-agent)", short: "GATHER" },
  review: { color: "var(--stage-review)", short: "VERIFY" },
  answer: { color: "var(--stage-answer)", short: "ANSWER" },
};

/** The spectrum in pipeline order, for gradients and sweeps. */
export const SPECTRUM: readonly string[] = [
  STAGE_TONES.supervisor.color,
  STAGE_TONES.agent.color,
  STAGE_TONES.review.color,
  STAGE_TONES.answer.color,
];
