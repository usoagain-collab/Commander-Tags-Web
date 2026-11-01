// Test sign-in for local development. Off unless DEV_LOGIN=1, which only .env.local sets (never set it on Vercel).

export const TEST_USER_EMAIL = "test-user@commander-tags.test";

export function devLoginEnabled() {
  return process.env.DEV_LOGIN === "1";
}

export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
