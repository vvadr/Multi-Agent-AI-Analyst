"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Inertial scrolling for the whole document.
 *
 * This is the single change that does most of the work in making the app feel
 * considered rather than utilitarian — the weight and settle of the page under
 * a trackpad is felt on every interaction, not just the animated ones.
 *
 * It is switched off entirely for a reader who has asked for reduced motion:
 * smoothing hijacks the scroll they asked to keep native, and it is a common
 * trigger for motion sickness.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;
    let frame = 0;

    const start = () => {
      if (lenis || reduceMotion.matches) return;
      lenis = new Lenis({
        duration: 1.05,
        // Exponential ease-out: quick to respond, long and quiet to settle.
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        // Touch devices already have excellent native inertia; overriding it
        // fights the platform and feels laggy.
        smoothWheel: true,
        touchMultiplier: 1.6,
      });

      const raf = (time: number) => {
        lenis?.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      lenis?.destroy();
      lenis = null;
    };

    const sync = () => (reduceMotion.matches ? stop() : start());

    sync();
    reduceMotion.addEventListener("change", sync);

    return () => {
      stop();
      reduceMotion.removeEventListener("change", sync);
    };
  }, []);

  return null;
}
