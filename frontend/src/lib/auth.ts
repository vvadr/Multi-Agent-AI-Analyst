/**
 * The invite-only authentication contract and its defensive parsers.
 *
 * Mirrors `backend/app/api/routes/auth.py`. Kept free of network and storage
 * code so every rule below is testable as a pure function.
 *
 * Two rules here are load-bearing:
 *
 *  1. Only the **access token** is ever modelled on the client. The refresh
 *     token lives in an HttpOnly cookie the browser sets and sends on its own;
 *     it has no representation in this file precisely so no code path can read
 *     it, log it, or hand it to storage.
 *  2. Failures render fixed local copy. The backend's `detail` strings are not
 *     parsed, so a credential probe and an expired session cannot be told apart
 *     from the text the page shows.
 */

import { asRecord, readNumber, readString } from "./parse";

export const USER_ROLES = ["admin", "member"] as const;

export type UserRole = (typeof USER_ROLES)[number];

const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES);

/** The server-verified identity behind the current access token. */
export interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
  role: UserRole;
}

/**
 * A successful `login` or `refresh`.
 *
 * `expiresIn` is seconds, as sent. It is advisory only: the backend remains the
 * authority on expiry, and the client reacts to a 401 rather than pre-empting
 * it from a clock it cannot trust.
 */
export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

/** The backend requires at least 12 characters; mirrored for local feedback. */
export const MIN_PASSWORD_LENGTH = 12;

export const MAX_PASSWORD_LENGTH = 256;

export const MAX_EMAIL_LENGTH = 320;

export const MAX_DISPLAY_NAME_LENGTH = 120;

/** The shortest invite token the backend will consider. */
export const MIN_INVITE_TOKEN_LENGTH = 32;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLE_SET.has(value);
}

/**
 * Validate a `UserResponse` payload.
 *
 * Returns `null` for anything that does not match, so a drifted contract is
 * handled as an API error instead of rendering a half-built identity.
 */
export function parseAuthUser(value: unknown): AuthUser | null {
  const source = asRecord(value);
  if (!source) return null;

  const id = readString(source, "id");
  const email = readString(source, "email");
  const organizationId = readString(source, "organization_id");
  const role = source.role;

  if (!id || !email || !organizationId || !isUserRole(role)) return null;

  return { id, email, organizationId, role };
}

/**
 * Validate a `TokenResponse` payload.
 *
 * The token type must be `bearer`: anything else would mean the server expects
 * a scheme this client does not implement, and sending `Bearer` anyway would
 * silently fail every authenticated request.
 */
export function parseIssuedSession(value: unknown): IssuedSession | null {
  const source = asRecord(value);
  if (!source) return null;

  const accessToken = readString(source, "access_token");
  const tokenType = readString(source, "token_type");
  const expiresIn = readNumber(source, "expires_in");
  const user = parseAuthUser(source.user);

  if (!accessToken || !user) return null;
  if (tokenType !== undefined && tokenType.toLowerCase() !== "bearer") return null;
  if (expiresIn === undefined || expiresIn <= 0) return null;

  return { accessToken, expiresIn, user };
}

export interface FieldProblem {
  field: string;
  message: string;
}

/**
 * Local credential checks, so an obviously malformed form does not cost a round
 * trip. The backend re-validates everything and its answer is authoritative.
 */
export function validateLoginInput(email: string, password: string): FieldProblem | null {
  const trimmed = email.trim();
  if (!trimmed) return { field: "email", message: "Enter your email address." };
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return { field: "email", message: "That email address is too long." };
  }
  if (!password) return { field: "password", message: "Enter your password." };
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { field: "password", message: "That password is too long." };
  }
  return null;
}

/** Shared rule for every screen where the reader chooses a new password. */
export function validateNewPassword(password: string): FieldProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { field: "password", message: "That password is too long." };
  }
  return null;
}

/** Local checks for self-registration. */
export function validateSignupInput(
  email: string,
  password: string,
  displayName: string,
): FieldProblem | null {
  const trimmedName = displayName.trim();
  if (!trimmedName) return { field: "displayName", message: "Enter your name." };
  if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { field: "displayName", message: "That name is too long." };
  }
  const trimmedEmail = email.trim();
  if (!trimmedEmail) return { field: "email", message: "Enter your email address." };
  if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    return { field: "email", message: "That email address is too long." };
  }
  // A shape check only. The backend decides what is deliverable.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return { field: "email", message: "Enter a valid email address." };
  }
  return validateNewPassword(password);
}

/** Local checks for redeeming a password-reset link. */
export function validateResetInput(
  token: string,
  password: string,
): FieldProblem | null {
  if (token.trim().length < MIN_INVITE_TOKEN_LENGTH) {
    return {
      field: "token",
      message: "That reset link is not complete. Use the link from your email.",
    };
  }
  return validateNewPassword(password);
}

/**
 * Local checks for invite acceptance.
 *
 * The password rule is stated up front rather than after a rejected request:
 * this is the one screen where the reader is choosing a new password, so the
 * requirement has to be visible before they submit.
 */
export function validateInviteInput(
  token: string,
  password: string,
  displayName: string,
): FieldProblem | null {
  const trimmedToken = token.trim();
  if (trimmedToken.length < MIN_INVITE_TOKEN_LENGTH) {
    return {
      field: "token",
      message: "That invitation code is not complete. Use the link from your invitation email.",
    };
  }
  const trimmedName = displayName.trim();
  if (!trimmedName) return { field: "displayName", message: "Enter your name." };
  if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { field: "displayName", message: "That name is too long." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { field: "password", message: "That password is too long." };
  }
  return null;
}
