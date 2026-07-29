"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { validateLoginInput } from "@/lib/auth";
import { IS_PRODUCTION, PASSWORD_RESET_ENABLED } from "@/lib/config";
import { LOCAL_DEVELOPMENT_GUIDANCE } from "@/lib/local-development";

import { useAuth } from "./auth-provider";

const GENERIC_FAILURE = "Sign-in could not be completed. Try again.";

/**
 * The way into the application.
 *
 * Every credential failure renders the same fixed sentence the API client
 * produced, so the form cannot be used to learn which addresses exist.
 */
export function LoginForm() {
  const { status, notice, signIn, dismissNotice } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // An already-authenticated reader has no business on this screen — for
  // example after signing in on another tab, or on a back-navigation.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    dismissNotice();
    const problem = validateLoginInput(email, password);
    if (problem) {
      setError(problem.message);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      if (!mountedRef.current) return;
      router.replace("/");
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof ApiError ? caught.message : GENERIC_FAILURE);
      setPassword("");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="login-heading"
      className="w-full max-w-sm rounded-xl border border-black/[.08] p-6 text-left dark:border-white/[.145]"
    >
      <h1 id="login-heading" className="text-lg font-semibold">
        Sign in
      </h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Sign in to your analyst workspace.
      </p>

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-black/[.08] p-3 text-sm dark:border-white/[.145]"
        >
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div>
          <label htmlFor={emailId} className="block text-sm font-medium">
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 text-sm disabled:opacity-50 dark:border-white/[.145]"
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium">
            Password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 text-sm disabled:opacity-50 dark:border-white/[.145]"
          />
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full border border-black/[.08] px-4 py-2 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-sm text-black/60 dark:text-white/60">
        New here?{" "}
        <Link href="/signup" className="underline underline-offset-2">
          Create an account
        </Link>
        .
      </p>
      {/*
        Hidden unless the backend has a way to deliver the link. Offering it
        without one would send the reader to an endpoint that answers 503.
      */}
      {PASSWORD_RESET_ENABLED && (
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          <Link href="/forgot-password" className="underline underline-offset-2">
            Forgot your password?
          </Link>
        </p>
      )}
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Have an invitation?{" "}
        <Link href="/invite" className="underline underline-offset-2">
          Accept it here
        </Link>
        .
      </p>

      {/* Operator guidance, excluded from the production tree at build time. */}
      {!IS_PRODUCTION && (
        <p className="mt-4 border-t border-black/[.08] pt-4 text-xs text-black/50 dark:border-white/[.145] dark:text-white/50">
          {LOCAL_DEVELOPMENT_GUIDANCE}
        </p>
      )}
    </section>
  );
}
