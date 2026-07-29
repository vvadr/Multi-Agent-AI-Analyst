import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/lib/security-headers";

/**
 * `NEXT_PUBLIC_APP_ENV` is the app's own environment label, kept separate from
 * `NODE_ENV` so a production-shaped build can be exercised locally. Header
 * strictness follows it.
 */
const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

const securityHeaders = buildSecurityHeaders({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  isProduction,
});

const nextConfig: NextConfig = {
  // The framework version is operational detail; it does not need publishing.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
