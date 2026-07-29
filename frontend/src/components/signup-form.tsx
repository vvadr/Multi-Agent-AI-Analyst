"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { validateSignupInput } from "@/lib/auth";
import { signup } from "@/lib/auth-api";

import { AuthCard, BUTTON_CLASS, FIELD_CLASS, FormError, MUTED_CLASS } from "./auth-shell";

const GENERIC_FAILURE = "Registration could not be completed. Try again.";

/**
 * Self-service registration.
 *
 * Registering signs the reader in and drops them straight into their workspace.
 * There is no confirmation step: the address is not used to authenticate
 * anything, so an emailed round trip would add a way to fail without adding a
 * guarantee.
 *
 * A taken address is reported plainly. This is the one place the API is willing
 * to confirm that an account exists, because a signup form that silently did
 * nothing would be unusable — and it is the same disclosure any registration
 * form makes.
 */
export function SignupForm() {
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const organizationId = useId();
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

    const problem = validateSignupInput(email, password, displayName);
    if (problem) {
      setError(problem.message);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, displayName, organizationName);
      if (!mountedRef.current) return;
      setPassword("");
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
      headingId="signup-heading"
      title="Create your account"
      subtitle="You will get your own workspace. Documents and analyses stay inside it."
    >
      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div>
          <label htmlFor={nameId} className="block text-sm font-medium">
            Your name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          />
        </div>

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

        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium">
            Password
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
          <p className={`mt-2 text-xs text-black/50 dark:text-white/50`}>
            At least 12 characters.
          </p>
        </div>

        <div>
          <label htmlFor={organizationId} className="block text-sm font-medium">
            Workspace name{" "}
            <span className="font-normal text-black/50 dark:text-white/50">
              (optional)
            </span>
          </label>
          <input
            id={organizationId}
            name="organization"
            type="text"
            autoComplete="organization"
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            disabled={submitting}
            className={FIELD_CLASS}
          />
        </div>

        {error && <FormError id={errorId} message={error} />}

        <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
        <p className="text-xs text-black/50 dark:text-white/50">
          No confirmation email — you go straight to your workspace.
        </p>
      </form>

      <p className={`mt-5 ${MUTED_CLASS}`}>
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </AuthCard>
  );
}
