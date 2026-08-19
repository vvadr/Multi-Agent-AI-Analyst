"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getReadiness } from "@/lib/api";
import { API_BASE_URL, APP_ENV } from "@/lib/config";
import { cn } from "@/lib/cn";
import {
  COMPONENT_LABELS,
  COMPONENT_STATE_LABELS,
  READINESS_COMPONENTS,
  componentState,
  type ComponentState,
  type ReadinessReport,
} from "@/lib/readiness";

import { Button } from "./ui/button";
import { Panel, PanelHeader } from "./ui/panel";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; report: ReadinessReport }
  | { kind: "error"; message: string; status: number; requestId?: string };

const STATE_TONE: Record<ComponentState, string> = {
  ready: "var(--ok)",
  unreachable: "var(--bad)",
  not_configured: "var(--warn)",
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
    <Panel aria-labelledby="backend-status-heading" className="max-w-md" delay={0.14}>
      <PanelHeader
        id="backend-status-heading"
        title="Backend status"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={state.kind === "loading"}
          >
            <RefreshCw
              aria-hidden
              className={cn("h-3 w-3", state.kind === "loading" && "animate-spin")}
            />
            {state.kind === "loading" ? "Checking…" : "Refresh"}
          </Button>
        }
      />

      <p className="font-data text-ink-faint mt-2 text-[11px] break-all">
        {APP_ENV} · {API_BASE_URL}
      </p>

      <div aria-live="polite" aria-busy={state.kind === "loading"} className="mt-4 text-sm">
        {state.kind === "loading" && (
          <p className="text-ink-dim">Checking backend readiness…</p>
        )}

        {state.kind === "error" && (
          <div className="border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] rounded-xl border p-3">
            <p className="text-bad font-medium">{state.message}</p>
            {state.requestId && (
              <p className="font-data text-ink-faint mt-2 text-xs break-all">
                Request ID: {state.requestId}
              </p>
            )}
            {/* Only suggest the server is down when the request never landed;
                a non-zero status means the backend answered. */}
            {state.status === 0 && (
              <p className="text-ink-dim mt-2">
                Is the backend running on {API_BASE_URL}?
              </p>
            )}
          </div>
        )}

        {state.kind === "loaded" && (
          <>
            <p className="text-ink font-medium">
              {isReady ? "All dependencies ready" : "Some dependencies are not ready"}
            </p>
            <ul className="mt-3 space-y-1">
              {READINESS_COMPONENTS.map((name) => {
                const component = state.report.components[name];
                const status = componentState(component);
                const tone = STATE_TONE[status];
                return (
                  <li
                    key={name}
                    className="border-line/60 flex items-center gap-2.5 border-b py-1.5 last:border-0"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: tone, boxShadow: `0 0 8px ${tone}` }}
                    />
                    <span className="text-ink-dim">{COMPONENT_LABELS[name]}</span>
                    <span
                      className="font-data ml-auto text-[11px]"
                      style={{ color: tone }}
                    >
                      {COMPONENT_STATE_LABELS[status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
