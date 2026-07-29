import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in · Multi-Agent AI Analyst",
  description: "Sign in to the Multi-Agent AI Analyst workspace.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 font-sans">
      <main className="flex w-full flex-col items-center">
        <LoginForm />
      </main>
    </div>
  );
}
