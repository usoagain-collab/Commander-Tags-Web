import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Placeholder: the editor (quick add, boards, autosave, undo) arrives in Phase 2b.
export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deck } = await supabase.from("decks").select("id, name").eq("id", id).maybeSingle();
  if (!deck) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/decks" className="text-sm opacity-70 hover:underline">
        ← My decks
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{deck.name}</h1>
      <p className="mt-4 opacity-70">The deck editor arrives in the next step (Phase 2b).</p>
    </main>
  );
}
