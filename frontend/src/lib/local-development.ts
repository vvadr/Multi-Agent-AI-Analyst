/**
 * The canonical local development origins, and the guidance shown for them.
 *
 * `localhost` is the only hostname this project uses locally, and the loopback
 * IP literal is deliberately absent everywhere — from these constants, from the
 * copy, and from the committed `.env.development`. The two are different
 * origins to a browser: cookies set for one are not sent to the other, and the
 * backend's CORS allowlist names `localhost` alone. Opening the app on the IP
 * literal therefore breaks sign-in in ways whose symptoms (a blocked request, a
 * session that will not persist) point nowhere near the cause.
 *
 * Keeping the values here, rather than inline in a component, is what lets a
 * test assert the rule for the whole app in one place.
 */

/** Where the frontend must be opened during local development. */
export const LOCAL_APP_URL = "http://localhost:3000";

/** Where the local backend API listens. */
export const LOCAL_API_URL = "http://localhost:8000";

/** Shown on the sign-in screen outside production. */
export const LOCAL_DEVELOPMENT_GUIDANCE =
  `Local development: open the app at ${LOCAL_APP_URL}. ` +
  `It signs in against the backend at ${LOCAL_API_URL}.`;
