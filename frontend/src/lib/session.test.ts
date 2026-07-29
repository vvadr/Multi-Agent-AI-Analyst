import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "./auth";
import {
  clearSession,
  getAccessToken,
  getCurrentUser,
  isAuthenticated,
  resetSessionForTests,
  setCurrentUser,
  setSession,
  subscribeToSession,
} from "./session";

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "analyst@example.invalid",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

const TOKEN = "header.payload.signature";

beforeEach(() => {
  resetSessionForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  resetSessionForTests();
});

describe("session storage discipline", () => {
  it("keeps the access token in memory and out of web storage", () => {
    setSession(TOKEN, USER);

    expect(getAccessToken()).toBe(TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN);
  });

  it("never writes to web storage, even indirectly", () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");

    setSession(TOKEN, USER);
    setCurrentUser({ ...USER, role: "admin" });
    clearSession("expired");

    expect(localSet).not.toHaveBeenCalled();
  });

  it("does not put the token in a cookie", () => {
    setSession(TOKEN, USER);

    // The refresh cookie is HttpOnly, so nothing this code sets should ever be
    // visible here — and the access token must not be a cookie at all.
    expect(document.cookie).not.toContain(TOKEN);
  });
});

describe("session lifecycle", () => {
  it("starts empty", () => {
    expect(getAccessToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("replaces the user without re-issuing the token", () => {
    setSession(TOKEN, USER);
    setCurrentUser({ ...USER, role: "admin" });

    expect(getAccessToken()).toBe(TOKEN);
    expect(getCurrentUser()?.role).toBe("admin");
  });

  it("ignores a user update when there is no session", () => {
    setCurrentUser(USER);

    expect(getCurrentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("clears both halves of the session", () => {
    setSession(TOKEN, USER);
    clearSession("signed_out");

    expect(getAccessToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });
});

describe("session subscribers", () => {
  it("reports why an established session ended", () => {
    const seen: (string | null)[] = [];
    subscribeToSession((reason) => seen.push(reason));

    setSession(TOKEN, USER);
    clearSession("expired");

    expect(seen).toEqual([null, "expired"]);
  });

  it("stays silent when there was no session to end", () => {
    const listener = vi.fn();
    subscribeToSession(listener);

    clearSession("expired");

    // A failed refresh on a cold page load must not announce an expiry that
    // never happened.
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSession(listener);

    unsubscribe();
    setSession(TOKEN, USER);

    expect(listener).not.toHaveBeenCalled();
  });

  it("survives a listener that unsubscribes while being notified", () => {
    const second = vi.fn();
    const unsubscribeFirst = subscribeToSession(() => unsubscribeFirst());
    subscribeToSession(second);

    expect(() => setSession(TOKEN, USER)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
