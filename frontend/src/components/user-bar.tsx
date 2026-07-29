"use client";

import { useState } from "react";

import { useAuth } from "./auth-provider";

/**
 * Who is signed in, and the way out.
 *
 * The email and role come from `GET /v1/auth/me` by way of the provider — a
 * server-verified identity, not a claim decoded from the token in the browser.
 */
export function UserBar() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // The component unmounts on success; this only matters when sign-out
      // failed locally and the reader is still here.
      setSigningOut(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-black/60 dark:text-white/60">
        Signed in as <span className="font-medium text-black dark:text-white">{user.email}</span>
        {user.role === "admin" && (
          <span className="ml-2 rounded-full border border-black/[.08] px-2 py-0.5 text-[11px] uppercase tracking-wide dark:border-white/[.145]">
            Admin
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
