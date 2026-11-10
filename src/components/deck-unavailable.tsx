import Link from "next/link";

/**
 * A signed-out visitor following a link to a deck they can't open (stress test round 2, Nov 10, 2026). We can't tell a
 * deleted deck from a private one, or from the visitor's own deck, so say so plainly and offer sign-in for the owner,
 * instead of a sign-in page that says "Welcome back".
 */
export function DeckUnavailable({ next }: { next: string }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center sm:py-24">
      <p className="eyebrow">Deck unavailable</p>
      <h1 className="display mt-2 text-3xl sm:text-4xl">This deck isn&apos;t shared</h1>
      <p className="mt-3 opacity-85">
        Its owner made it private, or deleted it. If it&apos;s your deck, sign in to open it.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn btn-gold min-h-11 px-5">
          Sign in
        </Link>
        <Link href="/precons" className="btn min-h-11 px-5">
          Explore precons
        </Link>
        <Link href="/" className="btn min-h-11 px-5">
          Home
        </Link>
      </div>
    </main>
  );
}
