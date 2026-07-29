/**
 * Shared chrome for the signed-out screens.
 *
 * Sign-in, registration, confirmation, and password reset are the same card
 * with different contents. Keeping the shell and the field styling in one place
 * means a change to the focus ring or the error treatment lands on all of them
 * rather than on whichever was edited most recently.
 */

import type { ReactNode } from "react";

export const FIELD_CLASS =
  "mt-2 w-full rounded-lg border border-black/[.08] bg-transparent p-2.5 text-sm " +
  "disabled:opacity-50 dark:border-white/[.145]";

export const BUTTON_CLASS =
  "w-full rounded-full border border-black/[.08] px-4 py-2 text-sm transition-colors " +
  "hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]";

export const MUTED_CLASS = "text-sm text-black/60 dark:text-white/60";

export function AuthCard({
  headingId,
  title,
  subtitle,
  children,
}: {
  headingId: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="w-full max-w-sm rounded-xl border border-black/[.08] p-6 text-left dark:border-white/[.145]"
    >
      <h1 id={headingId} className="text-lg font-semibold">
        {title}
      </h1>
      {subtitle && <p className={`mt-1 ${MUTED_CLASS}`}>{subtitle}</p>}
      {children}
    </section>
  );
}

/** An assertive message. `role="alert"` so a failed submit is announced. */
export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-sm text-red-700 dark:text-red-400">
      {message}
    </p>
  );
}

/** A polite confirmation. `role="status"` so it does not interrupt. */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mt-4 rounded-lg border border-black/[.08] p-3 text-sm dark:border-white/[.145]"
    >
      {children}
    </p>
  );
}
