/**
 * Client for the `/v1/auth` endpoints.
 *
 * Accounts come into being two ways: public self-registration via `signup`,
 * which signs the reader straight in, and `acceptInvite`, where an
 * administrator adds someone to an existing organization.
 *
 * Every message this module can produce is a local constant. Login failures in
 * particular are deliberately indistinguishable — "no such account", "wrong
 * password", and "account disabled" all read the same, so the form cannot be
 * used to enumerate users. `requestPasswordReset` resolves identically whether
 * or not the address is known, for the same reason. `signup` is the deliberate
 * exception: it has to say when an address is taken, or the form is unusable.
 */

import {
  parseAuthUser,
  parseIssuedSession,
  type AuthUser,
  type IssuedSession,
} from "./auth";
import { apiV1Url } from "./config";
import {
  ApiError,
  authorizedJson,
  mapApiError,
  sendJson,
  type FetchOptions,
} from "./http";
import { clearSession, setCurrentUser, setSession } from "./session";

const INVALID_CREDENTIALS_MESSAGE =
  "That email and password combination was not recognized.";

const LOGIN_MESSAGES: Readonly<Record<number, string>> = {
  400: INVALID_CREDENTIALS_MESSAGE,
  401: INVALID_CREDENTIALS_MESSAGE,
  403: INVALID_CREDENTIALS_MESSAGE,
  404: INVALID_CREDENTIALS_MESSAGE,
  422: "Enter a valid email address and password.",
  429: "Too many sign-in attempts. Wait a moment and try again.",
  503: "Sign-in is unavailable right now. Try again shortly.",
};

const SIGNUP_MESSAGES: Readonly<Record<number, string>> = {
  403: "Registration is closed on this deployment.",
  409: "An account already exists for that email address. Sign in instead.",
  422: "Check your name, email address, and password, then try again.",
  429: "Too many attempts. Wait a moment and try again.",
  503: "Registration is unavailable right now. Try again shortly.",
};

const INVALID_LINK_MESSAGE =
  "That link is invalid or has expired. Request a new one and try again.";

const TOKEN_LINK_MESSAGES: Readonly<Record<number, string>> = {
  400: INVALID_LINK_MESSAGE,
  404: INVALID_LINK_MESSAGE,
  410: INVALID_LINK_MESSAGE,
  422: "That link is not valid.",
  429: "Too many attempts. Wait a moment and try again.",
  503: "This is unavailable right now. Try again shortly.",
};

const INVALID_INVITE_MESSAGE =
  "That invitation is not valid, has expired, or has already been used. " +
  "Ask your administrator for a new one.";

const ACCEPT_INVITE_MESSAGES: Readonly<Record<number, string>> = {
  400: INVALID_INVITE_MESSAGE,
  404: INVALID_INVITE_MESSAGE,
  409: INVALID_INVITE_MESSAGE,
  410: INVALID_INVITE_MESSAGE,
  422: "Check the invitation code, your name, and your password, then try again.",
  429: "Too many attempts. Wait a moment and try again.",
  503: "Invitations are unavailable right now. Try again shortly.",
};

const CREATE_INVITE_MESSAGES: Readonly<Record<number, string>> = {
  403: "Only an organization administrator can create invitations.",
  409: "That address already has an account or a pending invitation.",
  422: "Enter a valid email address and role.",
  503: "Invitations are unavailable right now. Try again shortly.",
};

/**
 * `POST /v1/auth/login`.
 *
 * On success the backend sets the HttpOnly refresh cookie and returns the
 * access token, which is placed in memory and never persisted. A 401 here must
 * NOT trigger the refresh-and-retry policy — this call is what establishes a
 * session, so retrying it would be a second credential attempt.
 */
export async function login(
  email: string,
  password: string,
  options: FetchOptions = {},
): Promise<IssuedSession> {
  let parsed: unknown;
  try {
    ({ parsed } = await sendJson(apiV1Url("/auth/login"), {
      method: "POST",
      json: { email: email.trim(), password },
      credentials: "include",
      ...options,
    }));
  } catch (error) {
    return mapLoginError(error);
  }

  const issued = parseIssuedSession(parsed);
  if (!issued) {
    throw new ApiError("The backend returned an unexpected sign-in response.", 0);
  }

  setSession(issued.accessToken, issued.user);
  return issued;
}

/**
 * Login errors bypass `mapApiError`'s 401 passthrough on purpose: at this point
 * a 401 means bad credentials, not an ended session.
 */
function mapLoginError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw new ApiError("Sign-in could not be completed.", 0);
  }
  if (error.status === 0) throw error;
  throw new ApiError(
    LOGIN_MESSAGES[error.status] ?? "Sign-in could not be completed.",
    error.status,
    error.requestId,
  );
}

/**
 * `GET /v1/auth/me` — the server-verified identity for the current token.
 *
 * The bootstrap sequence calls this after a refresh so the rendered identity
 * comes from a fresh server check rather than from a token payload the client
 * would otherwise have to trust.
 */
export async function fetchCurrentUser(options: FetchOptions = {}): Promise<AuthUser> {
  let parsed: unknown;
  try {
    ({ parsed } = await authorizedJson(apiV1Url("/auth/me"), options));
  } catch (error) {
    return mapApiError(error, {}, "Your account could not be loaded.");
  }

  const user = parseAuthUser(parsed);
  if (!user) {
    throw new ApiError("The backend returned an unexpected account response.", 0);
  }

  setCurrentUser(user);
  return user;
}

/**
 * `POST /v1/auth/logout` — revoke the refresh session and clear its cookie.
 *
 * In-memory state is cleared whatever the server answers. A logout that fails
 * to reach the backend must still leave the browser signed out; the worst case
 * is a refresh session that expires on its own schedule.
 */
export async function logout(options: FetchOptions = {}): Promise<void> {
  try {
    await sendJson(apiV1Url("/auth/logout"), {
      method: "POST",
      credentials: "include",
      ...options,
    });
  } catch {
    // Intentionally swallowed: see above.
  } finally {
    clearSession("signed_out");
  }
}

/**
 * `POST /v1/auth/invites/accept` — the only way an account comes into being.
 *
 * The backend returns the created user but no token, so this does not sign the
 * reader in; they continue to the login screen with credentials they now own.
 */
export async function acceptInvite(
  token: string,
  password: string,
  displayName: string,
  options: FetchOptions = {},
): Promise<AuthUser> {
  let parsed: unknown;
  try {
    ({ parsed } = await sendJson(apiV1Url("/auth/invites/accept"), {
      method: "POST",
      json: {
        token: token.trim(),
        password,
        display_name: displayName.trim(),
      },
      ...options,
    }));
  } catch (error) {
    return mapApiError(error, ACCEPT_INVITE_MESSAGES, INVALID_INVITE_MESSAGE);
  }

  const user = parseAuthUser(parsed);
  if (!user) {
    throw new ApiError("The backend returned an unexpected invitation response.", 0);
  }
  return user;
}

/**
 * `POST /v1/auth/signup` — register and sign in, in one step.
 *
 * There is no confirmation round trip, so this establishes a session exactly as
 * `login` does: the access token goes into memory and the backend sets the
 * HttpOnly refresh cookie. Errors bypass the refresh-and-retry policy for the
 * same reason login's do — there is no session yet to refresh.
 */
export async function signup(
  email: string,
  password: string,
  displayName: string,
  organizationName?: string,
  options: FetchOptions = {},
): Promise<IssuedSession> {
  let parsed: unknown;
  try {
    ({ parsed } = await sendJson(apiV1Url("/auth/signup"), {
      method: "POST",
      json: {
        email: email.trim(),
        password,
        display_name: displayName.trim(),
        ...(organizationName?.trim()
          ? { organization_name: organizationName.trim() }
          : {}),
      },
      credentials: "include",
      ...options,
    }));
  } catch (error) {
    return mapApiError(error, SIGNUP_MESSAGES, "Registration could not be completed.");
  }

  const issued = parseIssuedSession(parsed);
  if (!issued) {
    throw new ApiError("The backend returned an unexpected sign-up response.", 0);
  }

  setSession(issued.accessToken, issued.user);
  return issued;
}

/**
 * `POST /v1/auth/password-reset` — always resolves for a known address.
 *
 * Answers 503 when the deployment has no email provider configured, which the
 * UI uses to hide the option rather than offer a dead end.
 */
export async function requestPasswordReset(
  email: string,
  options: FetchOptions = {},
): Promise<void> {
  try {
    await sendJson(apiV1Url("/auth/password-reset"), {
      method: "POST",
      json: { email: email.trim() },
      ...options,
    });
  } catch (error) {
    return mapApiError(error, TOKEN_LINK_MESSAGES, "That could not be sent right now.");
  }
}

/**
 * `POST /v1/auth/password-reset/confirm`.
 *
 * Succeeding here revokes every existing session for the account, so the reader
 * continues to the sign-in screen rather than being logged in implicitly.
 */
export async function confirmPasswordReset(
  token: string,
  password: string,
  options: FetchOptions = {},
): Promise<void> {
  try {
    await sendJson(apiV1Url("/auth/password-reset/confirm"), {
      method: "POST",
      json: { token: token.trim(), password },
      ...options,
    });
  } catch (error) {
    return mapApiError(error, TOKEN_LINK_MESSAGES, INVALID_LINK_MESSAGE);
  }
}

export interface CreatedInvite {
  id: string;
  email: string;
  expiresAt: string;
  token: string;
}

/**
 * `POST /v1/auth/invites` — admin only.
 *
 * The one-time token comes back in the response because the administrator has
 * to deliver it out of band. It is returned to the caller and never stored.
 */
export async function createInvite(
  email: string,
  role: "admin" | "member" = "member",
  options: FetchOptions = {},
): Promise<CreatedInvite> {
  let parsed: unknown;
  try {
    ({ parsed } = await authorizedJson(apiV1Url("/auth/invites"), {
      method: "POST",
      json: { email: email.trim(), role },
      ...options,
    }));
  } catch (error) {
    return mapApiError(error, CREATE_INVITE_MESSAGES, "The invitation could not be created.");
  }

  const invite = parseCreatedInvite(parsed);
  if (!invite) {
    throw new ApiError("The backend returned an unexpected invitation response.", 0);
  }
  return invite;
}

function parseCreatedInvite(value: unknown): CreatedInvite | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;

  const id = typeof source.id === "string" ? source.id.trim() : "";
  const email = typeof source.email === "string" ? source.email.trim() : "";
  const expiresAt = typeof source.expires_at === "string" ? source.expires_at.trim() : "";
  const token = typeof source.token === "string" ? source.token.trim() : "";

  if (!id || !email || !expiresAt || !token) return null;
  return { id, email, expiresAt, token };
}
