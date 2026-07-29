"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "./auth-provider";

/**
 * Gate for everything behind the login.
 *
 * Renders children only while the session is established. There is no
 * "optimistic" branch: an unauthenticated reader never sees the workspace
 * shell, so a revoked session cannot leave a page of authenticated-looking
 * chrome on screen while its requests fail one by one.
 *
 * The redirect uses `replace` so the protected URL does not stay in history
 * behind the login screen.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "authenticated") return <>{children}</>;

  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy={status === "loading"}
      className="p-8 text-sm text-black/60 dark:text-white/60"
    >
      {status === "loading" ? "Checking your session…" : "Taking you to sign in…"}
    </p>
  );
}
