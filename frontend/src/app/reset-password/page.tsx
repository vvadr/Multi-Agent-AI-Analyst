import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password · Multi-Agent AI Analyst",
  description: "Choose a new password for your account.",
};

/** Wrapped in Suspense for the same reason as the invite and verify screens. */
export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense
        fallback={
          <p role="status" className="text-ink-dim text-sm">
            Loading…
          </p>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
