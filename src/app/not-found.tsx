import Link from "next/link";

export const metadata = { title: "Page not found · Deck Genome" };

// Every unknown address, and pages that call notFound() (a deleted or private deck someone shared, for example).
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center sm:py-24">
      <p className="eyebrow">404</p>
      <h1 className="display mt-2 text-3xl sm:text-4xl">This page isn&apos;t here</h1>
      <p className="mt-3 opacity-85">
        The link may be mistyped, or it points to a deck that was deleted or made private by its owner.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-gold min-h-11 px-5">
          Home
        </Link>
        <Link href="/precons" className="btn min-h-11 px-5">
          Explore precons
        </Link>
        <Link href="/decks" className="btn min-h-11 px-5">
          My decks
        </Link>
      </div>
    </main>
  );
}
