import Link from "next/link";
import { getProfileLook } from "@/lib/supabase/profile";
import { getCurrentUser } from "@/lib/supabase/user";
import { Avatar } from "./avatar";
import { FeedbackButton } from "./feedback-button";
import { HeaderMenu } from "./header-menu";

export async function SiteHeader() {
  const [user, look] = await Promise.all([getCurrentUser(), getProfileLook()]);

  return (
    <header className="relative z-40 border-b border-foreground/10 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 whitespace-nowrap px-4 sm:px-6">
        <Link
          href="/"
          className="display flex min-h-12 items-center gap-2 text-lg"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width="20"
            height="20"
            className="text-gold"
          >
            <path
              fill="currentColor"
              d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z"
            />
          </svg>
          <span>Deck Genome</span>
        </Link>
        <nav
          aria-label="Main"
          className="hidden items-center gap-2 text-sm sm:flex"
        >
          <Link
            href="/precons"
            className="flex min-h-11 items-center px-2 hover:text-gold"
            title="Every Commander precon"
          >
            Precons
          </Link>
          {user ? (
            <>
              <Link
                href="/decks"
                className="flex min-h-11 items-center px-2 font-medium hover:text-gold"
              >
                My decks
              </Link>
              <Link
                href="/wishlist"
                className="flex min-h-11 items-center px-2 hover:text-gold"
                title="Cards you want to buy"
              >
                <span aria-hidden>♡</span>
                <span className="ml-1">Wish list</span>
              </Link>
              <Link
                href="/collection"
                className="flex min-h-11 items-center px-2 hover:text-gold"
                title="Cards you own"
              >
                Collection
              </Link>
              <Link
                href="/settings"
                className="flex min-h-11 items-center gap-2 px-2 hover:text-gold"
              >
                <Avatar url={look.avatarUrl} name={look.name} size={28} />
                Settings
              </Link>
              <FeedbackButton
                signedIn
                className="flex min-h-11 items-center px-2 opacity-70 hover:opacity-100"
              />
              <form
                action="/auth/signout"
                method="post"
                className="ml-4 border-l border-foreground/15 pl-4"
              >
                <button className="min-h-11 px-1 opacity-70 hover:opacity-100">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <FeedbackButton className="flex min-h-11 items-center px-2 opacity-70 hover:opacity-100" />
              <Link
                href="/login"
                className="flex min-h-11 items-center px-2 font-medium hover:text-gold"
              >
                Sign in
              </Link>
            </>
          )}
        </nav>
        {/* Phones: signed out there are only three short links, which fit; signed in they fold into a menu. */}
        {user ? (
          <nav aria-label="Main" className="sm:hidden">
            <HeaderMenu
              label={<Avatar url={look.avatarUrl} name={look.name} size={28} />}
            >
              <Link href="/decks" className="font-medium">
                My decks
              </Link>
              <Link href="/precons">Precons</Link>
              <Link href="/wishlist">♡ Wish list</Link>
              <Link href="/collection">Collection</Link>
              <Link href="/settings">Settings</Link>
              <FeedbackButton
                signedIn
                className="text-left opacity-80 hover:bg-foreground/5"
              />
              <form
                action="/auth/signout"
                method="post"
                className="!p-0 border-t border-foreground/10 !rounded-none mt-1 pt-1"
              >
                <button className="min-h-12 w-full rounded-lg px-3 text-left opacity-80 hover:bg-foreground/5">
                  Sign out
                </button>
              </form>
            </HeaderMenu>
          </nav>
        ) : (
          <nav
            aria-label="Main"
            className="flex items-center gap-1 text-sm sm:hidden"
          >
            <Link
              href="/precons"
              className="flex min-h-11 items-center px-2 hover:text-gold"
            >
              Precons
            </Link>
            <FeedbackButton className="flex min-h-11 items-center px-2 opacity-70 hover:opacity-100" />
            <Link
              href="/login"
              className="flex min-h-11 items-center px-2 font-medium hover:text-gold"
            >
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
