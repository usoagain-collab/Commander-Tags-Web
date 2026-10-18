import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root. Without it, Next.js sees a stray package-lock.json in the home folder
  // and guesses the wrong root (harmless on Vercel, noisy locally).
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
