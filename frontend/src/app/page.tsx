import { AnalystWorkspace } from "@/components/analyst-workspace";
import { BackendStatus } from "@/components/backend-status";
import { RequireAuth } from "@/components/require-auth";
import { UserBar } from "@/components/user-bar";
import { WorkspaceDocuments } from "@/components/workspace-documents";
import { WorkspaceHero } from "@/components/workspace-hero";
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
      <div className="relative flex min-h-screen flex-col">
        <UserBar />

        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 px-5 pb-24 sm:gap-8 sm:px-8">
          <WorkspaceHero />

          <WorkspaceDocuments />

          <AnalystWorkspace />

          {!IS_PRODUCTION && (
            <>
              <BackendStatus />

              <section className="text-ink-dim w-full max-w-md text-left text-sm">
                <h2 className="text-ink font-display text-sm font-semibold">
                  Reading this panel
                </h2>
                <dl className="mt-3 space-y-2">
                  <div>
                    <dt className="text-ink inline font-medium">Ready — </dt>
                    <dd className="inline">
                      the dependency is configured and its probe succeeded.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink inline font-medium">Unreachable — </dt>
                    <dd className="inline">
                      configuration is present, but the backend could not reach
                      the service.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink inline font-medium">Not configured — </dt>
                    <dd className="inline">
                      the required settings are missing on the backend.
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          )}
        </main>

        <footer className="border-line text-ink-faint mt-auto border-t px-5 py-6 sm:px-8">
          <p className="font-data mx-auto max-w-3xl text-center text-[11px] tracking-wide">
            Consumes the backend OpenAPI contract · no secrets in the browser
          </p>
        </footer>
      </div>
    </RequireAuth>
  );
}
