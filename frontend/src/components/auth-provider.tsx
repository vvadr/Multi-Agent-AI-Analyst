"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AuthUser } from "@/lib/auth";
import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from "@/lib/auth-api";
import { clearAllDrafts } from "@/lib/drafts";
import { SESSION_EXPIRED_MESSAGE, refreshSession } from "@/lib/http";
import { clearSession, subscribeToSession } from "@/lib/session";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export const SIGNED_OUT_MESSAGE = "You are signed out.";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Fixed copy explaining why the reader is on the login screen, if at all. */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  dismissNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ProviderState {
  status: AuthStatus;
  user: AuthUser | null;
  notice: string | null;
}

/**
 * Owns the session lifecycle for the whole app.
 *
 * Startup runs the sequence the contract requires: `POST /v1/auth/refresh` with
 * the HttpOnly cookie, keep the returned access token in memory, then confirm
 * the identity with `GET /v1/auth/me`. The token response already carries a
 * user, but it is not trusted for display — `me` is a fresh server check, and
 * only its answer is rendered.
 *
 * The provider also listens for sessions ended elsewhere: a failed refresh
 * inside the 401 policy clears the store, and this is what turns that into a
 * visible, explained sign-out rather than a page of failing requests.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProviderState>({
    status: "loading",
    user: null,
    notice: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return subscribeToSession((reason) => {
      // `null` means a session was established or updated, which the calling
      // code already reflected; only an ending is handled here.
      if (reason === null || !mountedRef.current) return;
      setState({
        status: "unauthenticated",
        user: null,
        notice: reason === "expired" ? SESSION_EXPIRED_MESSAGE : SIGNED_OUT_MESSAGE,
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const refreshed = await refreshSession();
      if (cancelled || !mountedRef.current) return;

      if (!refreshed) {
        // No cookie, or one the backend rejected. This is the ordinary
        // first-visit path, so it carries no notice.
        setState({ status: "unauthenticated", user: null, notice: null });
        return;
      }

      try {
        const user = await fetchCurrentUser();
        if (cancelled || !mountedRef.current) return;
        setState({ status: "authenticated", user, notice: null });
      } catch {
        if (cancelled || !mountedRef.current) return;
        clearSession("expired");
        setState({
          status: "unauthenticated",
          user: null,
          notice: SESSION_EXPIRED_MESSAGE,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    // `login` stores the token in memory and throws fixed copy on failure; the
    // form renders that message and this state stays untouched.
    const issued = await loginRequest(email, password);
    if (!mountedRef.current) return;
    setState({ status: "authenticated", user: issued.user, notice: null });
  }, []);

  const signOut = useCallback(async () => {
    // Drafts belong to the person leaving, not to the next person at this
    // browser, so a deliberate sign-out drops them.
    clearAllDrafts();
    await logoutRequest();
    if (!mountedRef.current) return;
    setState({ status: "unauthenticated", user: null, notice: SIGNED_OUT_MESSAGE });
  }, []);

  const dismissNotice = useCallback(() => {
    setState((previous) => (previous.notice ? { ...previous, notice: null } : previous));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      notice: state.notice,
      signIn,
      signOut,
      dismissNotice,
    }),
    [state, signIn, signOut, dismissNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return value;
}
