/**
 * Stand-in for `next/navigation` and `next/link` in component tests.
 *
 * The App Router hooks throw outside a Next request context, so suites that
 * render a screen using them mock this module in instead. `replace` is a spy,
 * which is how the redirect assertions ("an unauthenticated reader is sent to
 * /login") are made without a router.
 *
 * Not a `.test.` file, so the runner does not collect it as a suite.
 */

import { vi } from "vitest";

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let currentSearchParams = new URLSearchParams();

/** Set the query string the next `useSearchParams()` call will see. */
export function setSearchParams(query: string): void {
  currentSearchParams = new URLSearchParams(query);
}

let currentPathname = "/";

export function setPathname(pathname: string): void {
  currentPathname = pathname;
}

export function resetNavigationMock(): void {
  for (const spy of Object.values(routerMock)) spy.mockReset();
  currentSearchParams = new URLSearchParams();
  currentPathname = "/";
}

export function useRouter() {
  return routerMock;
}

export function useSearchParams() {
  return currentSearchParams;
}

export function usePathname() {
  return currentPathname;
}

export function useParams() {
  return {};
}

export function redirect(): never {
  throw new Error("redirect() is not supported in tests");
}
