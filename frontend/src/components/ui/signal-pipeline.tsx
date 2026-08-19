"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/cn";
import { STAGE_TONES } from "@/lib/stages";
import type { RunEventType } from "@/lib/runs";
import {
  deriveTraceStages,
  type TraceStageStatus,
  type WorkflowTracePhase,
} from "@/components/workflow-trace";

/**
 * The signature element: the run drawn as a signal moving through a circuit.
 *
 * Supervisor → agent → review → answer is the product's actual architecture,
 * so it is drawn as one continuous path with a packet of light travelling it,
 * taking on each stage's hue as it arrives. It is the hero on the signed-out
 * screen and the live progress indicator inside the workspace — the same
 * object doing both jobs, rather than an ornament that happens to sit near a
 * status display.
 *
 * Stage state comes from `deriveTraceStages`, the same function the accessible
 * `WorkflowTrace` list uses, so the picture and the text can never disagree.
 *
 * Purely decorative: `WorkflowTrace` carries the semantics, and this is marked
 * `aria-hidden` so a screen reader is not read the same run twice.
 */

const NODE_X = [125, 375, 625, 875] as const;
const TRACK_Y = 70;

/** The scripted run the signed-out hero plays on a loop. */
const DEMO_FRAMES: ReadonlyArray<{
  steps: RunEventType[];
  phase: WorkflowTracePhase;
}> = [
  { steps: [], phase: "starting" },
  { steps: ["run_started"], phase: "running" },
  { steps: ["run_started", "routing"], phase: "running" },
  { steps: ["run_started", "routing", "retrieving"], phase: "running" },
  { steps: ["run_started", "routing", "retrieving", "generating"], phase: "running" },
  { steps: ["run_started", "routing", "retrieving", "generating"], phase: "resolving" },
  { steps: ["run_started", "routing", "retrieving", "generating"], phase: "complete" },
];

const DEMO_INTERVAL_MS = 1500;

export function SignalPipeline({
  steps,
  phase,
  demo = false,
  className,
}: {
  steps: readonly RunEventType[];
  /** `null` renders the dormant circuit — no run in flight. */
  phase: WorkflowTracePhase | null;
  /** Self-driving showcase for the signed-out screen. */
  demo?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [demoIndex, setDemoIndex] = useState(0);
  const gradientId = useId();
  const glowId = useId();

  useEffect(() => {
    // A looping animation is exactly what reduced motion is asking us not to
    // run, so the demo settles on its finished frame instead.
    if (!demo || reduceMotion) return;
    const timer = setInterval(
      () => setDemoIndex((index) => (index + 1) % DEMO_FRAMES.length),
      DEMO_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [demo, reduceMotion]);

  const frame = demo
    ? DEMO_FRAMES[reduceMotion ? DEMO_FRAMES.length - 1 : demoIndex]
    : null;
  const liveSteps = frame ? frame.steps : steps;
  const livePhase = frame ? frame.phase : phase;

  const stages = livePhase ? deriveTraceStages(liveSteps, livePhase) : null;

  // Where the packet sits. A dormant circuit holds it at the entry node.
  const activeIndex = stages
    ? stages.findIndex((stage) => stage.status === "active" || stage.status === "stopped")
    : -1;
  const settledCount = stages
    ? stages.filter((s) => s.status === "done" || s.status === "skipped").length
    : 0;
  const headIndex = activeIndex >= 0 ? activeIndex : Math.max(0, settledCount - 1);
  const isComplete = stages?.every((stage) => stage.status === "done" || stage.status === "skipped") ?? false;
  const isHalted = stages?.some((stage) => stage.status === "stopped") ?? false;

  const headX = NODE_X[Math.min(headIndex, NODE_X.length - 1)];
  const travelling = livePhase === "running" || livePhase === "starting" || livePhase === "resolving";

  const headColor = isHalted
    ? "var(--bad)"
    : Object.values(STAGE_TONES)[Math.min(headIndex, 3)].color;

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        aria-hidden
        viewBox="0 0 1000 140"
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={STAGE_TONES.supervisor.color} />
            <stop offset="36%" stopColor={STAGE_TONES.agent.color} />
            <stop offset="68%" stopColor={STAGE_TONES.review.color} />
            <stop offset="100%" stopColor={STAGE_TONES.answer.color} />
          </linearGradient>
          <filter id={glowId} x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Dormant track, plus instrument tick marks for texture. */}
        <line
          x1={NODE_X[0]}
          y1={TRACK_Y}
          x2={NODE_X[3]}
          y2={TRACK_Y}
          stroke="var(--line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {Array.from({ length: 31 }, (_, i) => {
          const x = NODE_X[0] + ((NODE_X[3] - NODE_X[0]) / 30) * i;
          return (
            <line
              key={i}
              x1={x}
              y1={TRACK_Y - 4}
              x2={x}
              y2={TRACK_Y + 4}
              stroke="var(--line)"
              strokeWidth={1}
            />
          );
        })}

        {/* The energised span, growing to wherever the signal has reached. */}
        <motion.line
          x1={NODE_X[0]}
          y1={TRACK_Y}
          y2={TRACK_Y}
          stroke={isHalted ? "var(--bad)" : `url(#${gradientId})`}
          strokeWidth={3}
          strokeLinecap="round"
          initial={false}
          animate={{ x2: livePhase ? headX : NODE_X[0] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 46, damping: 17 }
          }
        />

        {NODE_X.map((x, index) => {
          const status: TraceStageStatus = stages?.[index]?.status ?? "waiting";
          const tone = Object.values(STAGE_TONES)[index].color;
          const lit = status === "done" || status === "active";
          const stopped = status === "stopped";

          return (
            <g key={x}>
              {/* Halo, present only on the stage currently working. */}
              {status === "active" && !reduceMotion && (
                <motion.circle
                  cx={x}
                  cy={TRACK_Y}
                  r={20}
                  fill="none"
                  stroke={tone}
                  strokeWidth={1.5}
                  initial={{ scale: 0.7, opacity: 0.9 }}
                  animate={{ scale: [0.7, 1.8], opacity: [0.9, 0] }}
                  transition={{ duration: 1.9, repeat: Infinity, ease: "easeOut" }}
                  style={{ transformOrigin: `${x}px ${TRACK_Y}px` }}
                />
              )}

              <circle
                cx={x}
                cy={TRACK_Y}
                r={17}
                fill="var(--surface-void)"
                stroke={stopped ? "var(--bad)" : lit ? tone : "var(--line-strong)"}
                strokeWidth={2}
              />
              <motion.circle
                cx={x}
                cy={TRACK_Y}
                fill={stopped ? "var(--bad)" : lit ? tone : "var(--ink-faint)"}
                filter={lit ? `url(#${glowId})` : undefined}
                initial={false}
                animate={{ r: lit || stopped ? 7 : 4, opacity: lit || stopped ? 1 : 0.45 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.4 }}
              />
            </g>
          );
        })}

        {/* The packet itself, riding the head of the energised span. */}
        {livePhase && travelling && !reduceMotion && (
          <motion.circle
            cy={TRACK_Y}
            r={5}
            fill={headColor}
            filter={`url(#${glowId})`}
            initial={false}
            animate={{ cx: headX, opacity: [0.4, 1, 0.4] }}
            transition={{
              cx: { type: "spring", stiffness: 46, damping: 17 },
              opacity: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
            }}
          />
        )}

        {/* A single confirming pulse when the answer lands. */}
        {isComplete && !reduceMotion && (
          <motion.circle
            cx={NODE_X[3]}
            cy={TRACK_Y}
            fill="none"
            stroke={STAGE_TONES.answer.color}
            strokeWidth={2}
            initial={{ r: 8, opacity: 1 }}
            animate={{ r: 46, opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}
      </svg>

      {/* Labels live in HTML, not SVG, so they stay legible at every width
          instead of scaling with the viewBox. */}
      <div aria-hidden className="relative mt-1 h-4">
        {NODE_X.map((x, index) => {
          const status: TraceStageStatus = stages?.[index]?.status ?? "waiting";
          const lit = status === "done" || status === "active";
          const tone = Object.values(STAGE_TONES)[index];
          return (
            <span
              key={x}
              className={cn(
                "font-data absolute -translate-x-1/2 text-[9px] tracking-[0.18em] transition-colors duration-500 sm:text-[10px]",
                status === "stopped"
                  ? "text-bad"
                  : lit
                    ? "text-ink"
                    : "text-ink-faint",
              )}
              style={{
                left: `${(x / 1000) * 100}%`,
                color: lit ? tone.color : undefined,
              }}
            >
              {tone.short}
            </span>
          );
        })}
      </div>
    </div>
  );
}
