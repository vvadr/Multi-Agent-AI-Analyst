import Link from "next/link";

import { LINK_CLASS } from "@/components/auth-shell";
import { Wordmark } from "@/components/ui/wordmark";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <Wordmark />

      <div>
        {/* The status code set in the display face, so the page has a shape of
            its own rather than being an error message on an empty screen. */}
        <p
          aria-hidden
          className="font-display spectrum-text text-7xl leading-none font-semibold sm:text-8xl"
        >
          404
        </p>
        <h1 className="font-display text-ink mt-5 text-xl font-semibold">
          Page not found
        </h1>
        <p className="text-ink-dim mt-2 text-sm">
          This page is not part of the analyst workspace.
        </p>
      </div>

      <Link href="/" className={`text-sm ${LINK_CLASS}`}>
        Back to the workspace
      </Link>
    </main>
  );
}
