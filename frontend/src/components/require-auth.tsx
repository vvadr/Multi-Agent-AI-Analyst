"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { SPECTRUM } from "@/lib/stages";

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8">
      {/* The four stage colours, cycling. The wait is short, so this reads as
          the instrument warming up rather than as a spinner. */}
      <span aria-hidden className="flex items-end gap-1.5">
        {SPECTRUM.map((color, index) => (
          <span
            key={color}
            className="animate-breathe w-1 rounded-full"
            style={{
              background: color,
              height: `${12 + index * 4}px`,
              boxShadow: `0 0 10px ${color}`,
              animationDelay: `${index * 0.14}s`,
            }}
          />
        ))}
      </span>

      <p
        role="status"
        aria-live="polite"
        aria-busy={status === "loading"}
        className="text-ink-dim text-sm"
      >
        {status === "loading" ? "Checking your session…" : "Taking you to sign in…"}
      </p>
    </div>
  );
}
