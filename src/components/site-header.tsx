import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/user";
import { FeedbackButton } from "./feedback-button";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="relative z-40 border-b border-foreground/10 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 whitespace-nowrap px-4 sm:px-6">
        <Link href="/" className="display flex min-h-12 items-center gap-2 text-lg">
          <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" className="text-gold">
            <path fill="currentColor" d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z" />
          </svg>
          <span className="sr-only sm:not-sr-only">Commander Tags</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          {user ? (
            <>
              <Link href="/decks" className="flex min-h-11 items-center px-2 font-medium hover:text-gold">
                My decks
              </Link>
              <Link href="/settings" className="flex min-h-11 items-center px-2 hover:text-gold">
                Settings
              </Link>
              <FeedbackButton />
              <form action="/auth/signout" method="post" className="ml-2 border-l border-foreground/15 pl-2 sm:ml-4 sm:pl-4">
                <button className="min-h-11 px-1 opacity-70 hover:opacity-100">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="flex min-h-11 items-center px-2 font-medium hover:text-gold">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
