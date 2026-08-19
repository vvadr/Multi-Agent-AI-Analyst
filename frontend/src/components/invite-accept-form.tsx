"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { MIN_PASSWORD_LENGTH, validateInviteInput, type AuthUser } from "@/lib/auth";
import { acceptInvite } from "@/lib/auth-api";

import {
  AuthCard,
  BUTTON_CLASS,
  FIELD_CLASS,
  FormError,
  LINK_CLASS,
  MUTED_CLASS,
} from "./auth-shell";

const GENERIC_FAILURE = "The invitation could not be accepted. Try again.";

/**
 * Accept an invitation and set the password for the new account.
 *
 * This is the only account-creating screen in the app, and it cannot be used
 * without a token the backend issued to an administrator. The token is read
 * from the `?token=` parameter when the reader follows an invitation link, and
 * can also be pasted — the field stays editable so a wrapped or truncated link
 * does not become a dead end.
 *
 * Acceptance returns a user but no session, by design: the reader signs in
 * afterwards with the password they just chose, so the first use of that
 * password goes through the normal login path.
 */
export function InviteAcceptForm() {
  const searchParams = useSearchParams();
  const tokenFromLink = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromLink);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<AuthUser | null>(null);

  const tokenId = useId();
  const nameId = useId();
  const passwordId = useId();
  const errorId = useId();
  const hintId = useId();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The parameter is only available after hydration, so seed the field when it
  // arrives — but never overwrite something the reader has already typed.
  useEffect(() => {
    if (tokenFromLink) setToken((current) => current || tokenFromLink);
  }, [tokenFromLink]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const problem = validateInviteInput(token, password, displayName);
    if (problem) {
      setError(problem.message);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const user = await acceptInvite(token, password, displayName);
      if (!mountedRef.current) return;
      setAccepted(user);
      // The chosen password does not linger in component state once it has
      // served its purpose.
      setPassword("");
      setToken("");
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof ApiError ? caught.message : GENERIC_FAILURE);
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (accepted) {
    return (
      <AuthCard headingId="invite-accepted-heading" title="Invitation accepted">
        <p role="status" className="text-ink-dim mt-2 text-sm">
          Your account for {accepted.email} is ready. Sign in with the password
          you just chose.
        </p>
        <Link href="/login" className={`mt-6 inline-block text-center ${BUTTON_CLASS}`}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      headingId="invite-heading"
      title="Accept your invitation"
      subtitle="Set a password to finish setting up the account your administrator invited."
    >
      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor={tokenId} className="text-ink block text-sm font-medium">
            Invitation code
          </label>
          <input
            id={tokenId}
            name="token"
            type="text"
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={submitting}
            className={`${FIELD_CLASS} font-data text-xs`}
          />
        </div>

        <div>
          <label htmlFor={nameId} className="text-ink block text-sm font-medium">
            Your name
          </label>
          <input
            id={nameId}
            name="displayName"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={submitting}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="text-ink block text-sm font-medium">
            Choose a password
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
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className={FIELD_CLASS}
          />
          <p id={hintId} className="text-ink-faint mt-1.5 text-xs">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>

        {error && <FormError id={errorId} message={error} />}

        <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
          {submitting ? "Accepting…" : "Accept invitation"}
        </button>
      </form>

      <p className={`mt-6 ${MUTED_CLASS}`}>
        Already have an account?{" "}
        <Link href="/login" className={LINK_CLASS}>
          Sign in
        </Link>
        .
      </p>
    </AuthCard>
  );
}
