// Who is signed in, for server components. getClaims() checks the sign-in token's signature locally with the
// project's published signing keys (cached), instead of asking the Auth server on every call like getUser().
// React cache() makes the header, the page and its metadata share one answer per request.
// Server-side writes don't rely on this alone: row-level security checks the same token in the database.
import { cache } from "react";
import { createClient } from "./server";

export const getCurrentUser = cache(async (): Promise<{ id: string } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub ? { id: sub } : null;
});
