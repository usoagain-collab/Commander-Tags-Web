"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GUEST_KEY, guestSavePayload, hasCards, readGuestDeck } from "@/lib/deck/guest-deck";
import { saveGuestDeck } from "./actions";

export function SaveGuestDeck() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(GUEST_KEY);
    } catch {}
    const deck = readGuestDeck(raw);
    if (!hasCards(deck)) {
      router.replace("/decks");
      return;
    }
    saveGuestDeck(deck.name, guestSavePayload(deck))
      .then((res) => {
        if ("error" in res) return setError(res.error);
        try {
          localStorage.removeItem(GUEST_KEY);
        } catch {}
        router.replace(`/decks/${res.id}`);
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      {error ? (
        <>
          <p className="text-red-400">Couldn&rsquo;t save your deck: {error}</p>
          <p className="mt-2 text-sm opacity-80">It&rsquo;s still kept in this browser, so nothing is lost.</p>
          <button type="button" className="btn btn-gold mt-4 min-h-11" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      ) : (
        <p className="opacity-80">Saving your deck to your account…</p>
      )}
    </main>
  );
}
