"use client";

// Drop a card from Scryfall onto a deck in the "My decks" list: it goes to that deck's mainboard
// (same rules as the editor), without opening the deck.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryKey, planAdd, toSaveRows, type Board, type Entries } from "@/lib/deck/model";
import { looksDroppable, readDrop } from "@/lib/drop/scryfall-drop";
import { resolveDrop } from "@/lib/drop/resolve";

export function useDeckDrop(deckId: string) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "busy" | "ok" | "warn" } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function show(text: string, tone: "busy" | "ok" | "warn") {
    window.clearTimeout(timer.current);
    setStatus({ text, tone });
    if (tone !== "busy") timer.current = window.setTimeout(() => setStatus(null), 5000);
  }

  async function drop(data: DataTransfer) {
    const ref = readDrop(data);
    if (!ref) return show("That doesn't look like a card.", "warn");
    show("Adding…", "busy");

    const found = await resolveDrop(ref, supabase);
    if (!found.ok) return show(found.reason, "warn");
    const card = found.card;

    // This deck's current copies of the card, so the singleton and copy-limit rules apply.
    const { data: rows, error: readError } = await supabase
      .from("deck_cards")
      .select("board, quantity")
      .eq("deck_id", deckId)
      .eq("oracle_id", card.oracle_id);
    if (readError) return show(`Couldn't read the deck: ${readError.message}`, "warn");
    const entries: Entries = {};
    for (const r of rows ?? []) entries[entryKey(r.board as Board, card.oracle_id)] = r.quantity as number;

    const plan = planAdd(entries, card, "main");
    if (!plan.ok) return show(plan.reason, "warn");
    const { error } = await supabase.rpc("apply_deck_changes", { p_deck: deckId, p_changes: toSaveRows(plan.change) });
    if (error) return show(`Couldn't save: ${error.message}`, "warn");
    show(`Added ${card.name}`, "ok");
    router.refresh(); // updates the card count and "edited" time
  }

  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!looksDroppable(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!looksDroppable(e.dataTransfer.types)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      void drop(e.dataTransfer);
    },
  };

  return { over, status, handlers };
}

/** Stops the browser from navigating away when a card is dropped beside, rather than on, a deck. */
export function useBlockStrayDrops() {
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer && looksDroppable(e.dataTransfer.types)) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
}
