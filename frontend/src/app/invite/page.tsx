import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
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
    <AuthLayout>
      <Suspense
        fallback={
          <p role="status" className="text-ink-dim text-sm">
            Loading your invitation…
          </p>
        }
      >
        <InviteAcceptForm />
      </Suspense>
    </AuthLayout>
  );
}
