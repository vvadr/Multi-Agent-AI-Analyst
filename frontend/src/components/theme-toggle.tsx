"use client";

import { motion, useReducedMotion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import {
  THEME_CHOICES,
  applyTheme,
  readStoredTheme,
  storeTheme,
  type ThemeChoice,
} from "@/lib/theme";

const ICONS: Record<ThemeChoice, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const LABELS: Record<ThemeChoice, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

/**
 * Light / dark / follow-the-system, as a segmented control.
 *
 * State is read in an effect rather than during render: the stored value lives
 * in `localStorage`, which the server cannot see, so reading it while
 * rendering would make the server and client markup disagree. The blocking
 * script in `layout.tsx` has already applied the right palette by this point —
 * this only has to catch the control up to it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [ready, setReady] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setChoice(readStoredTheme());
    setReady(true);
  }, []);

  const select = (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    storeTheme(next);
  };

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className={cn(
        "border-line bg-[var(--glass-tint)] relative inline-flex items-center gap-0.5 rounded-full border p-0.5 backdrop-blur-md",
        className,
      )}
    >
      {THEME_CHOICES.map((value) => {
        const Icon = ICONS[value];
        const active = ready && choice === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => select(value)}
            aria-pressed={active}
            title={LABELS[value]}
            className="relative rounded-full p-1.5 transition-colors"
          >
            {active && (
              <motion.span
                // One shared layoutId means the pill slides between options
                // rather than disappearing and reappearing.
                layoutId="theme-pill"
                className="bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] border-line absolute inset-0 rounded-full border"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
              />
            )}
            <Icon
              aria-hidden
              className={cn(
                "relative h-3.5 w-3.5 transition-colors",
                active ? "text-ink" : "text-ink-faint",
              )}
            />
            <span className="sr-only">{LABELS[value]}</span>
          </button>
        );
      })}
    </div>
  );
}
