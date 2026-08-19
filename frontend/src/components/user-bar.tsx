"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { useAuth } from "./auth-provider";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Wordmark } from "./ui/wordmark";

/**
 * The workspace's top bar: who is signed in, and the way out.
 *
 * The email and role come from `GET /v1/auth/me` by way of the provider — a
 * server-verified identity, not a claim decoded from the token in the browser.
 *
 * The bar is transparent over the hero and gains its border and blur once the
 * page scrolls under it, so the masthead reads as one uninterrupted surface at
 * rest but the bar stays legible over content.
 */
export function UserBar() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-all duration-300",
        lifted
          ? "border-line bg-[var(--glass-tint)] border-b backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 sm:flex-nowrap sm:px-8">
        <Wordmark />

        {/*
          One element, not a desktop copy plus a mobile copy: the identity is
          announced once. It drops to its own full-width line on a narrow
          viewport and sits inline from `sm` up.
        */}
        <span className="text-ink-dim order-3 w-full min-w-0 truncate text-[11px] sm:order-none sm:ml-auto sm:w-auto sm:text-xs">
          Signed in as <span className="text-ink font-medium">{user.email}</span>
        </span>

        {user.role === "admin" && (
          <span className="font-data border-line text-ink-faint order-2 rounded-full border px-2 py-0.5 text-[10px] tracking-[0.14em] sm:order-none">
            ADMIN
          </span>
        )}

        <div className="order-2 ml-auto flex items-center gap-2 sm:order-none sm:ml-0">
          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </div>
    </header>
  );
}
