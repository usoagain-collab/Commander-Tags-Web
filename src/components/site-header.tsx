import Link from "next/link";
import { getProfileLook } from "@/lib/supabase/profile";
import { getCurrentUser } from "@/lib/supabase/user";
import { Avatar } from "./avatar";
import { FeedbackButton } from "./feedback-button";
import { HeaderMenu } from "./header-menu";
import { GenomeMark, NavLinks, type NavItem } from "./nav-links";

// Design refresh (option E, Nov 20, 2026): one slim header on every page. The main places are pills, the page you're on
// is filled in, and account things (Playgroups, Settings, Sign out) sit in a menu under your picture.
const SIGNED_IN: NavItem[] = [
  { href: "/decks", label: "My decks" },
  { href: "/precons", label: "Precons", title: "Every Commander precon" },
  { href: "/browse", label: "Browse", title: "Public decks by commander, colors and bracket" },
  { href: "/collection", label: "Collection", title: "Cards you own" },
  { href: "/wishlist", label: "Wish list", title: "Cards you want to buy" },
];

const SIGNED_OUT: NavItem[] = [
  { href: "/precons", label: "Precons", title: "Every Commander precon" },
  { href: "/browse", label: "Browse", title: "Public decks by commander, colors and bracket" },
];

function SignOut({ className }: { className: string }) {
  return (
    <form action="/auth/signout" method="post" className="!p-0 mt-1 border-t border-line !rounded-none pt-1">
      <button className={className}>Sign out</button>
    </form>
  );
}

export async function SiteHeader() {
  const [user, look] = await Promise.all([getCurrentUser(), getProfileLook()]);
  const avatar = <Avatar url={look.avatarUrl} name={look.name} size={34} />;
  const menuButton = "min-h-12 w-full rounded-xl px-3 text-left opacity-80 hover:bg-foreground/5";

  return (
    <header className="relative z-40 border-b border-line bg-background">
      <div className="mx-auto flex h-[60px] max-w-[1500px] items-center gap-2 whitespace-nowrap px-4 sm:px-6">
        <Link href="/" className="display mr-3 flex min-h-11 items-center gap-2.5 text-[19px] font-semibold">
          <GenomeMark />
          <span>Deck Genome</span>
        </Link>

        {user ? (
          <>
            <nav aria-label="Main" className="hidden md:block">
              <NavLinks items={SIGNED_IN} />
            </nav>
            <div className="ml-auto hidden items-center gap-1 md:flex">
              <FeedbackButton signedIn className="flex min-h-10 items-center rounded-full px-3 text-sm text-foreground/75 hover:text-foreground" />
              <HeaderMenu label={avatar} burger={false} menuLabel="Account menu" id="account-menu">
                <Link href="/playgroups">Playgroups</Link>
                <Link href="/settings">Settings</Link>
                <SignOut className={menuButton} />
              </HeaderMenu>
            </div>
            {/* Phones and narrow tablets: everything folds into one menu. */}
            <nav aria-label="Main" className="ml-auto md:hidden">
              <HeaderMenu label={avatar}>
                {SIGNED_IN.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
                <Link href="/playgroups">Playgroups</Link>
                <Link href="/settings">Settings</Link>
                <FeedbackButton signedIn className="text-left opacity-80 hover:bg-foreground/5" />
                <SignOut className={menuButton} />
              </HeaderMenu>
            </nav>
          </>
        ) : (
          <>
            <nav aria-label="Main" className="hidden sm:block">
              <NavLinks items={SIGNED_OUT} />
            </nav>
            <div className="ml-auto hidden items-center gap-1 text-sm sm:flex">
              <FeedbackButton className="flex min-h-10 items-center rounded-full px-3 text-foreground/75 hover:text-foreground" />
              <Link href="/login" className="flex min-h-11 items-center px-3 font-medium">
                Sign in
              </Link>
              <Link href="/try" className="btn btn-gold">
                Start building
              </Link>
            </div>
            {/* Phones (Nov 27, 2026): the signed-out links ran 30 px past a 390 px screen, so the page
                scrolled sideways. Sign in stays in view; the rest folds into the menu. */}
            <div className="ml-auto flex items-center gap-1 text-sm sm:hidden">
              <Link href="/login" className="flex min-h-11 items-center px-2 font-medium">
                Sign in
              </Link>
              <HeaderMenu label={null} id="guest-menu">
                <Link href="/try">Start building</Link>
                <Link href="/precons">Precons</Link>
                <Link href="/browse">Browse</Link>
                <FeedbackButton className="text-left opacity-80 hover:bg-foreground/5" />
              </HeaderMenu>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
