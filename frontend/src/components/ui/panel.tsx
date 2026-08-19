"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The glass surface every section of the workspace sits on.
 *
 * Panels float above the ambient field, so they carry a blur, a hairline
 * border, and a lit top edge that reads as light falling from above. That
 * treatment is defined once here; a change to the depth language lands
 * everywhere rather than on whichever section was edited last.
 */
export function Panel({
  children,
  className,
  /** Plays the entrance. Off for panels that appear mid-interaction. */
  reveal = true,
  delay = 0,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  reveal?: boolean;
  delay?: number;
} & React.ComponentProps<typeof motion.section>) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      /*
       * Animated on mount rather than with `whileInView`. Scroll-triggered
       * reveals need `IntersectionObserver`, which jsdom does not implement, so
       * they would throw in every component suite that renders a panel — and
       * the workspace is a short column where almost everything starts in view
       * anyway, so the scroll trigger bought little.
       */
      initial={reveal && !reduceMotion ? { opacity: 0, y: 22 } : false}
      animate={reveal && !reduceMotion ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "lit-edge glass relative w-full overflow-hidden rounded-2xl p-5 text-left sm:p-6",
        "shadow-[0_1px_0_0_rgb(255_255_255/0.04)_inset,0_18px_50px_-24px_rgb(0_0_0/0.5)]",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.section>
  );
}

/**
 * A panel's header.
 *
 * `step` is rendered only where the content genuinely is a sequence — adding a
 * document then asking a question — because a number that does not encode
 * order is decoration pretending to be structure.
 */
export function PanelHeader({
  id,
  title,
  step,
  hint,
  action,
}: {
  id: string;
  title: string;
  step?: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {step && (
            <span className="font-data text-ink-faint border-line rounded-md border px-1.5 py-0.5 text-[10px] tracking-[0.15em]">
              {step}
            </span>
          )}
          <h2 id={id} className="font-display text-ink text-base font-semibold sm:text-lg">
            {title}
          </h2>
        </div>
        {hint && <p className="text-ink-dim mt-1.5 text-sm leading-relaxed">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
