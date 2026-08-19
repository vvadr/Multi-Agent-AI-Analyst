"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "whitespace-nowrap transition-colors duration-200 select-none " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  /* The one filled control on a surface. Reserved for the primary action so
     that "what do I press" is answered by contrast rather than by position. */
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold " +
    "shadow-[0_6px_22px_-6px_color-mix(in_oklab,var(--accent)_70%,transparent)] " +
    "hover:brightness-110 disabled:shadow-none",
  ghost:
    "border border-line-strong text-ink bg-[var(--glass-tint)] backdrop-blur-md " +
    "hover:border-[color-mix(in_oklab,var(--accent)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent)_9%,transparent)]",
  quiet: "text-ink-dim hover:text-ink",
  danger:
    "border border-[color-mix(in_oklab,var(--bad)_40%,transparent)] text-bad " +
    "hover:bg-[color-mix(in_oklab,var(--bad)_12%,transparent)]",
};

export function buttonClass(
  variant: ButtonVariant = "ghost",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & React.ComponentProps<typeof motion.button>) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      // Press feedback is the cheapest way to make a control feel physical.
      // It is scale only, so it costs no layout and no repaint.
      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
      whileHover={reduceMotion ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
