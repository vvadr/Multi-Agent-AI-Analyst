import { AnalystWorkspace } from "@/components/analyst-workspace";
import { BackendStatus } from "@/components/backend-status";
import { RequireAuth } from "@/components/require-auth";
import { UserBar } from "@/components/user-bar";
import { WorkspaceDocuments } from "@/components/workspace-documents";
import { IS_PRODUCTION } from "@/lib/config";

/**
 * The workspace, behind the login.
 *
 * The readiness panel is a diagnostic: it names the backend's dependencies and
 * their reachability, which is useful while developing and is operator detail
 * that signed-in users should not be reading in production. It is excluded from
 * the production tree at build time rather than hidden with CSS, so the markup
 * is not merely invisible — it is absent.
 */
export default function Home() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col items-center p-8 font-sans sm:p-20">
        <main className="flex w-full max-w-2xl flex-col items-center gap-8">
          <UserBar />

          <div className="space-y-3 text-center">
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Multi-Agent AI Analyst
            </h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Upload a document, ask a question, and watch the specialist agents
              work. Retrieval, web research, and analytics all run on the
              backend; this client talks only to its API and never holds
              provider, database, or model secrets.
            </p>
          </div>

          <WorkspaceDocuments />

          <AnalystWorkspace />

          {!IS_PRODUCTION && (
            <>
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
                      configuration is present, but the backend could not reach
                      the service.
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
            </>
          )}
        </main>

        <footer className="mt-auto pt-16 text-xs text-black/50 dark:text-white/50">
          Consumes the backend OpenAPI contract · no secrets in the browser
        </footer>
      </div>
    </RequireAuth>
  );
}
