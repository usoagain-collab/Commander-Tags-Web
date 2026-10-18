import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Commander Tags</h1>
      <p className="mt-4 opacity-80">
        A Commander deck builder where Scryfall Tagger tags drive categories, role targets and suggestions:
        cards picked for what they do, not just how popular they are.
      </p>
      <Link href="/decks" className="mt-8 inline-block rounded-md bg-foreground px-4 py-2 font-medium text-background">
        Go to my decks
      </Link>
    </main>
  );
}
