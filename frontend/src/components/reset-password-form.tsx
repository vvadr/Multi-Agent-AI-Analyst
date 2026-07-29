"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { validateResetInput } from "@/lib/auth";
import { confirmPasswordReset } from "@/lib/auth-api";

import {
  AuthCard,
  BUTTON_CLASS,
  FIELD_CLASS,
  FormError,
  MUTED_CLASS,
} from "./auth-shell";

/**
 * Choose a new password against a token from the reset email.
 *
 * Completing this revokes every existing session for the account, so it ends on
 * the sign-in screen rather than signing the reader in — whoever prompted the
 * reset may have been holding one of those sessions.
 */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const passwordId = useId();
  const errorId = useId();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const problem = validateResetInput(token, password);
    if (problem) {
      setError(problem.message);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await confirmPasswordReset(token, password);
      if (mountedRef.current) setDone(true);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Your password could not be changed.",
      );
      setPassword("");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthCard
        headingId="reset-heading"
        title="Password changed"
        subtitle="Any other sessions have been signed out. Sign in with your new password."
      >
        <p className="mt-5">
          <Link href="/login" className="text-sm underline underline-offset-2">
            Go to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (!token) {
    return (
      <AuthCard
        headingId="reset-heading"
        title="That link is incomplete"
        subtitle="Open the reset link from your email, or request a new one."
      >
        <p className="mt-5">
          <Link
            href="/forgot-password"
            className="text-sm underline underline-offset-2"
          >
            Request a new reset link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard headingId="reset-heading" title="Choose a new password">
      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium">
            New password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          />
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            At least 12 characters.
          </p>
        </div>

        {error && <FormError id={errorId} message={error} />}

        <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
          {submitting ? "Saving…" : "Change password"}
        </button>
      </form>

      <p className={`mt-5 ${MUTED_CLASS}`}>
        <Link href="/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
