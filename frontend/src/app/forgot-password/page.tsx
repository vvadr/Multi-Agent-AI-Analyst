import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password · Multi-Agent AI Analyst",
  description: "Request a password reset link.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 font-sans">
      <main className="flex w-full flex-col items-center">
        <ForgotPasswordForm />
      </main>
    </div>
  );
}
