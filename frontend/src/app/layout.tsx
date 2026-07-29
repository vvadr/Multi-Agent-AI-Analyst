import type { Metadata } from "next";

import { AuthProvider } from "@/components/auth-provider";

import "./globals.css";

/**
 * Typography is a system font stack defined in `globals.css`.
 *
 * `next/font/google` is deliberately not used: it fetches font files from
 * Google's servers *at build time*, so a network-restricted build fails and
 * every build otherwise depends on a third party being reachable. A system
 * stack also means no font request from the browser and no third-party origin
 * to allow in the Content-Security-Policy.
 */
export const metadata: Metadata = {
  title: "Multi-Agent AI Analyst",
  description: "Frontend for the Multi-Agent AI Analyst backend.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
