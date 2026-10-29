import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Hide the floating "N" Next.js badge that shows during development.
  devIndicators: false,
  // Lets the dev server serve its scripts to 127.0.0.1 (used by the e2e tests), not just localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Pin the project root so Next doesn't pick up a stray package-lock.json in the home folder.
  turbopack: { root: __dirname },
};

export default nextConfig;
