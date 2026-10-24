import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/user";
import { FeedbackButton } from "./feedback-button";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 whitespace-nowrap px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold">
          Commander Tags
        </Link>
        <nav className="flex items-center gap-3 text-sm sm:gap-4">
          {user ? (
            <>
              <Link href="/decks" className="hover:underline">
                My decks
              </Link>
              <FeedbackButton />
              <form action="/auth/signout" method="post">
                <button className="opacity-70 hover:opacity-100">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="hover:underline">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
