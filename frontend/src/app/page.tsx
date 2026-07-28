import { BackendStatus } from "@/components/backend-status";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center p-8 font-sans sm:p-20">
      <main className="flex w-full max-w-2xl flex-col items-center gap-10 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Multi-Agent AI Analyst
          </h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Phase 1 system foundation. This client talks only to the backend API
            — it never holds provider, database, or model secrets.
          </p>
        </div>

        <BackendStatus />

        <section className="w-full max-w-md text-left text-sm text-black/70 dark:text-white/70">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            Reading this panel
          </h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="inline font-medium">Ready — </dt>
              <dd className="inline">
                the dependency is configured and its probe succeeded.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Unreachable — </dt>
              <dd className="inline">
                configuration is present, but the backend could not reach the
                service.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Not configured — </dt>
              <dd className="inline">
                the required settings are missing on the backend.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="mt-auto pt-16 text-xs text-black/50 dark:text-white/50">
        Consumes the backend OpenAPI contract · no secrets in the browser
      </footer>
    </div>
  );
}
