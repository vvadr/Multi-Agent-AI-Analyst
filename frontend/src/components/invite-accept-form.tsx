"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { MIN_PASSWORD_LENGTH, validateInviteInput, type AuthUser } from "@/lib/auth";
import { acceptInvite } from "@/lib/auth-api";

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
      <section
        aria-labelledby="invite-accepted-heading"
        className="w-full max-w-sm rounded-xl border border-black/[.08] p-6 text-left dark:border-white/[.145]"
      >
        <h1 id="invite-accepted-heading" className="text-lg font-semibold">
          Invitation accepted
        </h1>
        <p role="status" className="mt-2 text-sm">
          Your account for {accepted.email} is ready. Sign in with the password
          you just chose.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-full border border-black/[.08] px-4 py-2 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          Go to sign in
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="invite-heading"
      className="w-full max-w-sm rounded-xl border border-black/[.08] p-6 text-left dark:border-white/[.145]"
    >
      <h1 id="invite-heading" className="text-lg font-semibold">
        Accept your invitation
      </h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Set a password to finish setting up the account your administrator
        invited.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div>
          <label htmlFor={tokenId} className="block text-sm font-medium">
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
            className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 font-mono text-xs disabled:opacity-50 dark:border-white/[.145]"
          />
        </div>

        <div>
          <label htmlFor={nameId} className="block text-sm font-medium">
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
            className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 text-sm disabled:opacity-50 dark:border-white/[.145]"
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium">
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
            className="mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 text-sm disabled:opacity-50 dark:border-white/[.145]"
          />
          <p id={hintId} className="mt-1 text-xs text-black/60 dark:text-white/60">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
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
          {submitting ? "Accepting…" : "Accept invitation"}
        </button>
      </form>

      <p className="mt-5 text-sm text-black/60 dark:text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </section>
  );
}
