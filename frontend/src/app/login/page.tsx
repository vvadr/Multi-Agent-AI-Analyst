import type { Metadata } from "next";

import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in · Multi-Agent AI Analyst",
  description: "Sign in to the Multi-Agent AI Analyst workspace.",
};

export default function LoginPage() {
  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
