"use client";

// Asks the server to fetch a card that isn't in our data yet (spoiler fallback, /api/cards/import) and returns
// its CardSummary, ready to add to a deck.
import type { CardSummary } from "@/lib/deck/model";

export async function importCard(scryfallId: string): Promise<{ ok: true; card: CardSummary } | { ok: false; reason: string }> {
  try {
    const res = await fetch("/api/cards/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scryfallId }),
    });
    const body = (await res.json()) as { card?: CardSummary; error?: string };
    return body.card ? { ok: true, card: body.card } : { ok: false, reason: body.error ?? `Couldn't fetch the card (HTTP ${res.status}).` };
  } catch {
    return { ok: false, reason: "Couldn't reach the server to fetch that card." };
  }
}
