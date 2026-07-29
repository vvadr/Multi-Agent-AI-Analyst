import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password · Multi-Agent AI Analyst",
  description: "Choose a new password for your account.",
};

/** Wrapped in Suspense for the same reason as the invite and verify screens. */
export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 font-sans">
      <main className="flex w-full flex-col items-center">
        <Suspense
          fallback={
            <p role="status" className="text-sm text-black/60 dark:text-white/60">
              Loading…
            </p>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </main>
    </div>
  );
}
