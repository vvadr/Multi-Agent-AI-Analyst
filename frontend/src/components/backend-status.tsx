"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, getReadiness } from "@/lib/api";
import { API_BASE_URL, APP_ENV } from "@/lib/config";
import {
  COMPONENT_LABELS,
  COMPONENT_STATE_LABELS,
  READINESS_COMPONENTS,
  componentState,
  type ComponentState,
  type ReadinessReport,
} from "@/lib/readiness";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; report: ReadinessReport }
  | { kind: "error"; message: string; status: number; requestId?: string };

const STATE_STYLES: Record<ComponentState, { dot: string; text: string }> = {
  ready: {
    dot: "bg-green-500",
    text: "text-green-700 dark:text-green-400",
  },
  unreachable: {
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
  },
  not_configured: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
};

/**
 * Live view of the backend `/readyz` contract.
 *
 * A 503 carrying a valid readiness body is rendered as structured per-component
 * state, not as a connection failure — that distinction is the whole point of
 * the endpoint. Only transport failures and malformed bodies show the error
 * state.
 */
export function BackendStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const report = await getReadiness();
      setState({ kind: "loaded", report });
    } catch (error) {
      if (error instanceof ApiError) {
        setState({
          kind: "error",
          message: error.message,
          status: error.status,
          requestId: error.requestId,
        });
        return;
      }
      setState({ kind: "error", message: "Unexpected client error.", status: 0 });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isReady = state.kind === "loaded" && state.report.status === "ready";

  return (
    <section
      aria-labelledby="backend-status-heading"
      className="w-full max-w-md rounded-xl border border-black/[.08] p-5 text-left dark:border-white/[.145]"
    >
      <header className="flex items-center justify-between gap-4">
        <h2 id="backend-status-heading" className="text-sm font-semibold">
          Backend status
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={state.kind === "loading"}
          className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          {state.kind === "loading" ? "Checking…" : "Refresh"}
        </button>
      </header>

      <p className="mt-1 break-all font-mono text-xs text-black/60 dark:text-white/60">
        {APP_ENV} · {API_BASE_URL}
      </p>

      <div aria-live="polite" aria-busy={state.kind === "loading"} className="mt-4 text-sm">
        {state.kind === "loading" && <p>Checking backend readiness…</p>}

        {state.kind === "error" && (
          <div className="text-red-700 dark:text-red-400">
            <p className="font-medium">{state.message}</p>
            {state.requestId && (
              <p className="mt-2 break-all font-mono text-xs text-black/60 dark:text-white/60">
                Request ID: {state.requestId}
              </p>
            )}
            {/* Only suggest the server is down when the request never landed;
                a non-zero status means the backend answered. */}
            {state.status === 0 && (
              <p className="mt-2 text-black/60 dark:text-white/60">
                Is the backend running on {API_BASE_URL}?
              </p>
            )}
          </div>
        )}

        {state.kind === "loaded" && (
          <>
            <p className="font-medium">
              {isReady ? "All dependencies ready" : "Some dependencies are not ready"}
            </p>
            <ul className="mt-3 space-y-1.5">
              {READINESS_COMPONENTS.map((name) => {
                const component = state.report.components[name];
                const status = componentState(component);
                const styles = STATE_STYLES[status];
                return (
                  <li key={name} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`}
                    />
                    <span>{COMPONENT_LABELS[name]}</span>
                    <span className={`ml-auto font-mono text-xs ${styles.text}`}>
                      {COMPONENT_STATE_LABELS[status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
