import type { Metadata } from "next";

import { SignupForm } from "@/components/signup-form";

export const metadata: Metadata = {
  title: "Create your account · Multi-Agent AI Analyst",
  description: "Create a Multi-Agent AI Analyst workspace.",
};

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 font-sans">
      <main className="flex w-full flex-col items-center">
        <SignupForm />
      </main>
    </div>
  );
}
