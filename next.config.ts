import type { NextConfig } from "next";

// Stress test round 2 (Nov 10, 2026): without these, another site could show Deck Genome in a hidden frame and trick a
// signed-in user into clicking Delete ("clickjacking"). frame-ancestors 'none' (and the older X-Frame-Options) forbid framing.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // Pin the project root. Without it, Next.js sees a stray package-lock.json in the home folder
  // and guesses the wrong root (harmless on Vercel, noisy locally).
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
