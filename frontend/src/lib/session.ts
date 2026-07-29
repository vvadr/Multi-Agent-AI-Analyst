/**
 * The in-memory session store.
 *
 * The access token lives in a module-level variable and nowhere else. It is
 * deliberately NOT written to `localStorage`, `sessionStorage`, `document
 * .cookie`, or any other persistent surface: anything readable by script
 * survives the tab and is exfiltratable by a single injected script. Closing
 * the tab must end the in-memory half of the session, and a reload must go back
 * through `POST /v1/auth/refresh` — which is authenticated by the HttpOnly
 * refresh cookie that this code can neither read nor write.
 *
 * The refresh token has no representation here at all. That is the point: there
 * is no variable to accidentally log, serialize, or persist.
 */

import type { AuthUser } from "./auth";

/** Why the session ended, so the login screen can explain it accurately. */
export type SessionEndReason = "expired" | "signed_out";

interface SessionSnapshot {
  accessToken: string | null;
  user: AuthUser | null;
}

let current: SessionSnapshot = { accessToken: null, user: null };

type Listener = (reason: SessionEndReason | null) => void;

const listeners = new Set<Listener>();

function notify(reason: SessionEndReason | null): void {
  // Copied first: a listener may unsubscribe while being notified.
  for (const listener of [...listeners]) listener(reason);
}

/**
 * Subscribe to session changes. Returns an unsubscribe function.
 *
 * The reason is non-null only when an established session ended, which is what
 * lets the UI distinguish "you were signed out" from "you were never signed
 * in".
 */
export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The bearer token for authenticated requests, or `null` when signed out. */
export function getAccessToken(): string | null {
  return current.accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return current.user;
}

export function isAuthenticated(): boolean {
  return current.accessToken !== null;
}

/** Replace the in-memory session after a successful login or refresh. */
export function setSession(accessToken: string, user: AuthUser): void {
  current = { accessToken, user };
  notify(null);
}

/**
 * Update the user without touching the token.
 *
 * Used by the `/auth/me` bootstrap step: the server-verified identity replaces
 * whatever the token response claimed, without re-issuing anything.
 */
export function setCurrentUser(user: AuthUser): void {
  if (!current.accessToken) return;
  current = { accessToken: current.accessToken, user };
  notify(null);
}

/**
 * Drop every trace of the session from memory.
 *
 * Idempotent, and silent when there was nothing to clear — a failed refresh on
 * a cold page load must not announce an expiry that never happened.
 */
export function clearSession(reason: SessionEndReason = "signed_out"): void {
  const hadSession = current.accessToken !== null || current.user !== null;
  current = { accessToken: null, user: null };
  if (hadSession) notify(reason);
}

/** Test seam: reset module state without emitting an end-of-session signal. */
export function resetSessionForTests(): void {
  current = { accessToken: null, user: null };
  listeners.clear();
}
