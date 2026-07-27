import { BackendStatus } from "@/components/backend-status";

export default function Home() {
  return (
    <div className="font-sans min-h-screen p-8 sm:p-20 flex flex-col items-center">
      <main className="flex w-full max-w-2xl flex-col items-center gap-10 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Multi-Agent AI Analyst
          </h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Frontend workspace. This client talks only to the backend API — it
            never holds provider, database, or model secrets.
          </p>
        </div>

        <BackendStatus />

        <ol className="font-mono list-inside list-decimal text-left text-sm/6 text-black/70 dark:text-white/70">
          <li className="mb-2">
            Start the backend, then point{" "}
            <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/[.06]">
              NEXT_PUBLIC_API_BASE_URL
            </code>{" "}
            at it.
          </li>
          <li className="mb-2">
            Build UI in{" "}
            <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/[.06]">
              src/app
            </code>
            ; call the API through{" "}
            <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/[.06]">
              src/lib/api.ts
            </code>
            .
          </li>
          <li>Save and see your changes instantly.</li>
        </ol>
      </main>

      <footer className="mt-auto pt-16 text-xs text-black/50 dark:text-white/50">
        Owned by Claude · consumes the backend OpenAPI + SSE contract
      </footer>
    </div>
  );
}
