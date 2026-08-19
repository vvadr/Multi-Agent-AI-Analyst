import type { Metadata, Viewport } from "next";

import { AuthProvider } from "@/components/auth-provider";
import { SmoothScroll } from "@/components/smooth-scroll";
import { AmbientField } from "@/components/ui/ambient-field";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/*
 * Typography is self-hosted through `@fontsource-variable`.
 *
 * `next/font/google` remains deliberately unused: it fetches font files from
 * Google's servers *at build time*, so a network-restricted build fails and
 * every build otherwise depends on a third party being reachable. These
 * packages ship the `.woff2` files inside `node_modules`, so the bundler emits
 * them as same-origin assets — which is what keeps the `font-src 'self'`
 * directive in `security-headers.ts` intact, with no third-party origin to
 * allow and no font request leaving the reader's browser.
 *
 * Three faces, three jobs: a display grotesque used only at large sizes, a
 * quiet body face, and a monospace that every piece of data is set in.
 */
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-Agent AI Analyst",
  description:
    "Upload a document, ask a question, and watch each stage of the analysis " +
    "as it runs. Every answer arrives with the sources it was drawn from.",
};

export const viewport: Viewport = {
  // Matches the two palettes so the mobile browser chrome does not sit on a
  // white bar above a dark page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f9" },
    { media: "(prefers-color-scheme: dark)", color: "#05070f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint. Without it every load
          flashes the system palette before snapping to the chosen one.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <AmbientField />
        <SmoothScroll />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
