"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { requestPasswordReset } from "@/lib/auth-api";

import {
  AuthCard,
  BUTTON_CLASS,
  FIELD_CLASS,
  FormError,
  MUTED_CLASS,
} from "./auth-shell";

/**
 * Ask for a reset link.
 *
 * The confirmation is deliberately conditional — "if that address has an
 * account" — because the backend answers identically for an unknown address and
 * this screen must not leak what the API withheld.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const emailId = useId();
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
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      if (mountedRef.current) setSent(true);
    } catch (caught) {
      if (!mountedRef.current) return;
      // 503 means the deployment has no email provider at all, which is a
      // different thing from a request that failed and is worth saying plainly.
      const unavailable = caught instanceof ApiError && caught.status === 503;
      setError(
        unavailable
          ? "Password reset is not available on this deployment. Ask an administrator to reset your password."
          : caught instanceof ApiError
            ? caught.message
            : "That could not be sent.",
      );
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthCard
        headingId="forgot-heading"
        title="Check your inbox"
        subtitle={
          <>
            If <strong>{email.trim()}</strong> has an account, a reset link is on
            its way. It expires shortly, so use it soon.
          </>
        }
      >
        <p className={`mt-5 ${MUTED_CLASS}`}>
          <Link href="/login" className="underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      headingId="forgot-heading"
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
    >
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
            className={FIELD_CLASS}
          />
        </div>

        {error && <FormError id={errorId} message={error} />}

        <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
          {submitting ? "Sending…" : "Send reset link"}
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
