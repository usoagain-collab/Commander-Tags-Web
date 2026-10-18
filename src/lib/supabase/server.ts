// Supabase client for server components, route handlers and server actions.
// Reads the signed-in user's session from cookies, so queries run as that user.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a server component, which can't set cookies.
            // Safe to ignore once middleware refreshes sessions (added with sign-in in Phase 2).
          }
        },
      },
    },
  );
}
