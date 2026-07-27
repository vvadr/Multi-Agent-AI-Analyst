"use client";

import { useEffect, useState } from "react";

import { getReadiness, type ReadinessReport } from "@/lib/api";
import { API_BASE_URL, APP_ENV } from "@/lib/config";

type State =
  | { kind: "loading" }
  | { kind: "ok"; report: ReadinessReport }
  | { kind: "error"; message: string };

const COMPONENT_LABELS: Record<keyof ReadinessReport["components"], string> = {
  database: "PostgreSQL",
  gemini: "Gemini",
  qdrant: "Qdrant",
};

/**
 * Live view of the backend `/readyz` contract. Confirms the frontend can reach
 * the API and which server-owned integrations are configured — without ever
 * exposing a credential.
 */
export function BackendStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  async function refresh() {
    setState({ kind: "loading" });
    try {
      const report = await getReadiness();
      setState({ kind: "ok", report });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="w-full max-w-md rounded-xl border border-black/[.08] dark:border-white/[.145] p-5">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Backend status</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-full border border-black/[.08] dark:border-white/[.145] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] dark:hover:bg-white/[.06]"
        >
          Refresh
        </button>
      </header>

      <p className="mt-1 font-mono text-xs text-black/60 dark:text-white/60 break-all">
        {APP_ENV} · {API_BASE_URL}
      </p>

      <div className="mt-4 text-sm">
        {state.kind === "loading" && <span>Checking…</span>}

        {state.kind === "error" && (
          <div className="text-red-600 dark:text-red-400">
            <p className="font-medium">Cannot reach the API.</p>
            <p className="mt-1 font-mono text-xs break-all">{state.message}</p>
            <p className="mt-2 text-black/60 dark:text-white/60">
              Is the backend running on {API_BASE_URL}?
            </p>
          </div>
        )}

        {state.kind === "ok" && (
          <ul className="space-y-1.5">
            {(
              Object.keys(state.report.components) as Array<
                keyof ReadinessReport["components"]
              >
            ).map((key) => (
              <li key={key} className="flex items-center gap-2">
                <Dot ok={state.report.components[key]} />
                <span>{COMPONENT_LABELS[key]}</span>
                <span className="ml-auto font-mono text-xs text-black/60 dark:text-white/60">
                  {state.report.components[key] ? "configured" : "missing"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? "bg-green-500" : "bg-yellow-500"
      }`}
    />
  );
}
