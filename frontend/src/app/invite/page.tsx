import type { Metadata } from "next";
import { Suspense } from "react";

import { InviteAcceptForm } from "@/components/invite-accept-form";

export const metadata: Metadata = {
  title: "Accept invitation · Multi-Agent AI Analyst",
  description: "Accept an invitation to the Multi-Agent AI Analyst workspace.",
};

/**
 * `useSearchParams` opts its subtree out of static prerendering, so the form is
 * wrapped in Suspense — without it the production build fails rather than
 * degrading.
 */
export default function InvitePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 font-sans">
      <main className="flex w-full flex-col items-center">
        <Suspense
          fallback={
            <p role="status" className="text-sm text-black/60 dark:text-white/60">
              Loading your invitation…
            </p>
          }
        >
          <InviteAcceptForm />
        </Suspense>
      </main>
    </div>
  );
}
