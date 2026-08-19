"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const DISMISS_AFTER_MS = 4200;

const TONE_ICON: Record<ToastTone, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

const TONE_COLOR: Record<ToastTone, string> = {
  success: "var(--ok)",
  error: "var(--bad)",
  info: "var(--accent)",
};

/**
 * Defaults to a no-op rather than throwing when no provider is mounted.
 *
 * Components that raise toasts are unit-tested in isolation, and a context that
 * throws would force every one of those suites to wrap in a provider it does
 * not otherwise care about. A dropped toast in a test is harmless; a component
 * that cannot be rendered without ceremony is not.
 */
const ToastContext = createContext<(tone: ToastTone, message: string) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const reduceMotion = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = (nextId.current += 1);
      // Capped at three: a stack taller than that stops being a notification
      // and starts being a wall the reader has to dismiss.
      setToasts((current) => [...current.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = TONE_ICON[toast.tone];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 30, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                className="glass lit-edge pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl p-3 shadow-[0_18px_50px_-20px_rgb(0_0_0/0.6)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-0.5"
                  style={{ background: TONE_COLOR[toast.tone] }}
                />
                <Icon
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ color: TONE_COLOR[toast.tone] }}
                />
                <p className="text-ink min-w-0 flex-1 text-sm">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="text-ink-faint hover:text-ink -m-1 shrink-0 rounded p-1 transition-colors"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                  <span className="sr-only">Dismiss</span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** Shared by inline status text so tone colours stay in one place. */
export function toneClass(tone: ToastTone): string {
  return cn(
    tone === "success" && "text-ok",
    tone === "error" && "text-bad",
    tone === "info" && "text-ink-dim",
  );
}
