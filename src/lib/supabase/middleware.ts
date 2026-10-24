// Refreshes the Supabase session cookie on every request, so server components always see a valid sign-in.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Don't put code between createServerClient and getUser: getUser is what refreshes an expired session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out visitors to My decks go to the login page, then come back. A single deck page (and its
  // playtest) may be a shared link, so those pages decide for themselves (Phase 7a).
  const path = request.nextUrl.pathname;
  const deckPage = /^\/decks\/[0-9a-f-]{36}(\/playtest)?\/?$/i.test(path);
  if (!user && path.startsWith("/decks") && !deckPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
