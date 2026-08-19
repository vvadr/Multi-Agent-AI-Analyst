"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { validateLoginInput } from "@/lib/auth";
import { IS_PRODUCTION, PASSWORD_RESET_ENABLED } from "@/lib/config";
import { LOCAL_DEVELOPMENT_GUIDANCE } from "@/lib/local-development";

import { useAuth } from "./auth-provider";
import {
  AuthCard,
  BUTTON_CLASS,
  FIELD_CLASS,
  FormError,
  FormNotice,
  LINK_CLASS,
  MUTED_CLASS,
} from "./auth-shell";

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
    <AuthCard
      headingId="login-heading"
      title="Sign in"
      subtitle="Sign in to your analyst workspace."
    >
      {notice && <FormNotice>{notice}</FormNotice>}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor={emailId} className="text-ink block text-sm font-medium">
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
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="text-ink block text-sm font-medium">
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
            className={FIELD_CLASS}
          />
        </div>

        {error && <FormError id={errorId} message={error} />}

        <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className={`mt-6 space-y-2 ${MUTED_CLASS}`}>
        <p>
          New here?{" "}
          <Link href="/signup" className={LINK_CLASS}>
            Create an account
          </Link>
          .
        </p>
        {/*
          Hidden unless the backend has a way to deliver the link. Offering it
          without one would send the reader to an endpoint that answers 503.
        */}
        {PASSWORD_RESET_ENABLED && (
          <p>
            <Link href="/forgot-password" className={LINK_CLASS}>
              Forgot your password?
            </Link>
          </p>
        )}
        <p>
          Have an invitation?{" "}
          <Link href="/invite" className={LINK_CLASS}>
            Accept it here
          </Link>
          .
        </p>
      </div>

      {/* Operator guidance, excluded from the production tree at build time. */}
      {!IS_PRODUCTION && (
        <p className="border-line text-ink-faint mt-5 border-t pt-4 text-xs leading-relaxed">
          {LOCAL_DEVELOPMENT_GUIDANCE}
        </p>
      )}
    </AuthCard>
  );
}
