import type { ReactNode } from "react";

import { ThemeToggle } from "./theme-toggle";
import { SignalPipeline } from "./ui/signal-pipeline";
import { Wordmark } from "./ui/wordmark";

/**
 * The signed-out screens: a showcase beside the form.
 *
 * The left column runs the pipeline on a loop, so the first thing someone sees
 * before they have an account is the thing that makes this product different —
 * a run whose every stage is visible. On a narrow viewport the showcase is
 * dropped rather than stacked: someone on a phone came here to sign in, and a
 * screen of marketing above the form is an obstacle, not an introduction.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="flex items-center justify-between px-5 py-4 sm:px-8 lg:hidden">
        <Wordmark />
        <ThemeToggle />
      </div>

      <div className="grid flex-1 lg:grid-cols-2">
        <aside className="border-line relative hidden flex-col justify-between border-r p-10 lg:flex xl:p-14">
          <Wordmark />

          <div className="max-w-md">
            <h2 className="font-display text-ink animate-rise text-4xl leading-[1.08] font-semibold xl:text-5xl">
              Answers you can trace back to{" "}
              <span className="spectrum-text">the source</span>.
            </h2>
            <p
              className="text-ink-dim animate-rise mt-5 text-sm leading-relaxed"
              style={{ animationDelay: "0.1s" }}
            >
              A supervisor routes each question to the specialist that can
              answer it, a critic checks the draft against its evidence, and you
              get the citations alongside the answer.
            </p>

            <div className="animate-rise mt-10" style={{ animationDelay: "0.2s" }}>
              <SignalPipeline steps={[]} phase={null} demo />
            </div>
          </div>

          <ul
            className="text-ink-faint animate-rise space-y-2 text-xs"
            style={{ animationDelay: "0.3s" }}
          >
            {[
              "Grounded in the documents you upload",
              "Every stage of the run is visible while it works",
              "Provider, database, and model secrets stay on the backend",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="bg-[var(--accent)] mt-1.5 h-1 w-1 shrink-0 rounded-full"
                />
                {line}
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex flex-col items-center justify-center px-5 py-10 sm:px-8">
          <div className="absolute top-5 right-6 hidden lg:block">
            <ThemeToggle />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
