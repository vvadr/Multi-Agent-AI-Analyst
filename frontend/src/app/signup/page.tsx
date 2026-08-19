import type { Metadata } from "next";

import { AuthLayout } from "@/components/auth-layout";
import { SignupForm } from "@/components/signup-form";

export const metadata: Metadata = {
  title: "Create your account · Multi-Agent AI Analyst",
  description: "Create a Multi-Agent AI Analyst workspace.",
};

export default function SignupPage() {
  return (
    <AuthLayout>
      <SignupForm />
    </AuthLayout>
  );
}
