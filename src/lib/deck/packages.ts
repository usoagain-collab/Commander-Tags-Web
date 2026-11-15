// Packages (V3, migration 0057): a saved group of cards, such as a ramp suite, that you add to any deck in one go.
// Packages belong to you, not a deck, and only you see them. Until the migration runs, loading fails quietly and
// the Packages panel says the feature isn't switched on yet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryKey, planBulk, planSetQuantity, type Board, type CardSummary, type Entries, type Plan } from "./model";

export const PACKAGE_NAME_MAX = 60;
export type PackageCard = { oracle_id: string; quantity: number };
export type CardPackage = { id: string; name: string; cards: PackageCard[] };

export function cleanPackageName(name: unknown): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, PACKAGE_NAME_MAX).trim();
}

/** The cards to save from deck lines: one row per card, copies added up (at most 99), commanders left out. */
export function packageFromLines(lines: { card: { oracle_id: string }; board: Board; quantity: number }[]): PackageCard[] {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.board === "commander" || l.board === "companion" || l.quantity < 1) continue;
    out.set(l.card.oracle_id, Math.min(99, (out.get(l.card.oracle_id) ?? 0) + l.quantity));
  }
  return [...out].map(([oracle_id, quantity]) => ({ oracle_id, quantity }));
}

const DECK: Board[] = ["commander", "companion", "main"];
const have = (e: Entries, board: Board, id: string) => (board === "maybe" ? (e[entryKey("maybe", id)] ?? 0) : DECK.reduce((n, b) => n + (e[entryKey(b, id)] ?? 0), 0));

/**
 * Adds a package to the mainboard or maybeboard as one edit (one save, one Ctrl+Z). Cards the deck already has
 * enough copies of are left as they are and named in `already`; cards a rule refuses come back in `skipped`.
 */
export function planAddPackage(
  entries: Entries,
  items: { card: CardSummary; quantity: number }[],
  board: "main" | "maybe",
  name: string,
): { plan: Plan; added: number; already: string[]; skipped: string[] } {
  const already: string[] = [];
  const todo = items.filter(({ card, quantity }) => {
    const enough = have(entries, board, card.oracle_id) >= Math.min(quantity, card.max_copies);
    if (enough) already.push(card.name);
    return !enough;
  });
  const { plan, done, skipped } = planBulk(
    entries,
    todo,
    (e, { card, quantity }) => {
      const current = e[entryKey(board, card.oracle_id)] ?? 0;
      return planSetQuantity(e, card, board, current + Math.max(0, quantity - have(e, board, card.oracle_id)));
    },
    (n) => `Added ${name} (${n === 1 ? "1 card" : `${n} cards`})${board === "maybe" ? " to the maybeboard" : ""}`,
  );
  return { plan: plan.ok || todo.length ? plan : { ok: false, reason: `Every card in ${name} is already here.` }, added: done, already, skipped };
}

export type Packages = {
  /** null while loading; false when packages aren't switched on yet (migration 0057) or you're signed out. */
  available: boolean | null;
  list: CardPackage[];
  create: (name: string, cards: PackageCard[]) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
};

export function usePackages(userId: string | null): Packages {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState<boolean | null>(userId ? null : false);
  const [list, setList] = useState<CardPackage[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("card_packages").select("id, name, card_package_cards(oracle_id, quantity)").order("name");
    if (error) return setAvailable(false);
    type Row = { id: string; name: string; card_package_cards: PackageCard[] };
    setList(((data ?? []) as Row[]).map((p) => ({ id: p.id, name: p.name, cards: p.card_package_cards ?? [] })));
    setAvailable(true);
  }, [supabase]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const taken = (m: string, name: string) => (/duplicate|unique/i.test(m) ? `You already have a package called ${name}.` : m);

  const create = useCallback(
    async (raw: string, cards: PackageCard[]) => {
      const name = cleanPackageName(raw);
      if (!name) return "A package needs a name.";
      if (!cards.length) return "There are no cards to save.";
      const { data, error } = await supabase.from("card_packages").insert({ name }).select("id").single();
      if (error) return taken(error.message, name);
      const { error: cardsError } = await supabase.from("card_package_cards").insert(cards.map((c) => ({ package_id: data.id, ...c })));
      if (cardsError) {
        await supabase.from("card_packages").delete().eq("id", data.id);
        return cardsError.message;
      }
      await load();
      return null;
    },
    [supabase, load],
  );

  const rename = useCallback(
    async (id: string, raw: string) => {
      const name = cleanPackageName(raw);
      if (!name) return "A package needs a name.";
      const { error } = await supabase.from("card_packages").update({ name }).eq("id", id);
      if (error) return taken(error.message, name);
      await load();
      return null;
    },
    [supabase, load],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("card_packages").delete().eq("id", id);
      if (error) return error.message;
      setList((l) => l.filter((p) => p.id !== id));
      return null;
    },
    [supabase],
  );

  return { available, list, create, rename, remove };
}
