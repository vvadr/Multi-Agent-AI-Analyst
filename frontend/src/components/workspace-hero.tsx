"use client";

import { motion, useReducedMotion } from "motion/react";

import { STAGE_TONES } from "@/lib/stages";

/**
 * The masthead of the workspace.
 *
 * The stage legend under the heading teaches the colour mapping once, up
 * front: from here on, violet means routing, cyan means gathering, amber means
 * verification, and green means a finished answer — in the pipeline, in the
 * trace, and on the citations. Without this the spectrum would just be
 * decoration the reader has to decode.
 */
export function WorkspaceHero() {
  const reduceMotion = useReducedMotion();

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <header className="w-full pt-10 pb-2 text-center sm:pt-16">
      <motion.p
        {...rise(0)}
        className="font-data text-ink-faint text-[10px] tracking-[0.32em] uppercase"
      >
        Grounded document analysis
      </motion.p>

      <motion.h1
        {...rise(0.08)}
        className="font-display text-ink mt-4 text-4xl leading-[1.05] font-semibold sm:text-6xl"
      >
        Multi-Agent <span className="spectrum-text">AI Analyst</span>
      </motion.h1>

      <motion.p
        {...rise(0.16)}
        className="text-ink-dim mx-auto mt-5 max-w-xl text-sm leading-relaxed sm:text-base"
      >
        Upload a document, ask a question, and watch the specialist agents work.
        Retrieval, web research, and analytics all run on the backend; this
        client talks only to its API and never holds provider, database, or
        model secrets.
      </motion.p>

      <motion.ul
        {...rise(0.24)}
        className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
      >
        {Object.entries(STAGE_TONES).map(([id, tone]) => (
          <li key={id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: tone.color, boxShadow: `0 0 10px ${tone.color}` }}
            />
            <span className="font-data text-ink-faint text-[10px] tracking-[0.16em]">
              {tone.short}
            </span>
          </li>
        ))}
      </motion.ul>
    </header>
  );
}
