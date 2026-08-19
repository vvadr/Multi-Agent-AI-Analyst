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
  "mt-2 w-full rounded-xl border border-line bg-[var(--field)] p-3 text-sm " +
  "text-ink placeholder:text-ink-faint transition-colors " +
  "focus:border-[color-mix(in_oklab,var(--accent)_55%,transparent)] focus:outline-none " +
  "disabled:opacity-50";

export const BUTTON_CLASS =
  "w-full rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold " +
  "text-[var(--accent-contrast)] transition-all duration-200 " +
  "shadow-[0_6px_22px_-6px_color-mix(in_oklab,var(--accent)_70%,transparent)] " +
  "hover:brightness-110 active:scale-[0.98] " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

export const MUTED_CLASS = "text-sm text-ink-dim";

/** The underline treatment every inline link on these screens shares. */
export const LINK_CLASS =
  "text-ink underline decoration-[color-mix(in_oklab,var(--ink)_35%,transparent)] " +
  "underline-offset-4 transition-colors hover:decoration-[var(--accent)]";

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
      className="glass lit-edge animate-rise relative w-full max-w-sm overflow-hidden rounded-2xl p-6 text-left shadow-[0_24px_70px_-30px_rgb(0_0_0/0.65)] sm:p-7"
    >
      <h1 id={headingId} className="font-display text-ink text-xl font-semibold">
        {title}
      </h1>
      {subtitle && <p className={`mt-1.5 ${MUTED_CLASS}`}>{subtitle}</p>}
      {children}
    </section>
  );
}

/** An assertive message. `role="alert"` so a failed submit is announced. */
export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="rounded-xl border border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] p-3 text-sm text-bad"
    >
      {message}
    </p>
  );
}

/** A polite confirmation. `role="status"` so it does not interrupt. */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="border-line bg-[var(--surface-raised)] text-ink-dim mt-4 rounded-xl border p-3 text-sm"
    >
      {children}
    </p>
  );
}
