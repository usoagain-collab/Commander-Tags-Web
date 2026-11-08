"use client";

// The wish list page (v2): cards you want to buy, with copies, foil, a note, the total price and an export.
// Every change saves directly (it's a shopping list, not a deck, so there's no undo).
import { useMemo, useState } from "react";
import type { CardSummary } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";

export type WishRow = { oracle_id: string; quantity: number; foil: boolean; note: string | null; added_at: string; card: CardSummary };
type Sort = "added" | "price" | "name";

export function WishlistView({ userId, initial, loadError }: { userId: string; initial: WishRow[]; loadError: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState(initial);
  const [sort, setSort] = useState<Sort>("added");
  const [message, setMessage] = useState<string | null>(loadError ? `Couldn't load your wish list: ${loadError}` : null);

  const sorted = [...rows].sort((a, b) =>
    sort === "price" ? (b.card.price_usd ?? 0) * b.quantity - (a.card.price_usd ?? 0) * a.quantity : sort === "name" ? a.card.name.localeCompare(b.card.name) : b.added_at.localeCompare(a.added_at),
  );
  const total = rows.reduce((s, r) => s + (r.card.price_usd ?? 0) * r.quantity, 0);
  const copies = rows.reduce((s, r) => s + r.quantity, 0);

  async function change(id: string, patch: Partial<Pick<WishRow, "quantity" | "foil" | "note">>) {
    const before = rows;
    setRows((rs) => rs.map((r) => (r.oracle_id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("wishlist").update(patch).eq("owner_id", userId).eq("oracle_id", id);
    if (error) {
      setRows(before);
      setMessage(`Couldn't save that: ${error.message}`);
    }
  }
  async function remove(id: string) {
    const before = rows;
    setRows((rs) => rs.filter((r) => r.oracle_id !== id));
    const { error } = await supabase.from("wishlist").delete().eq("owner_id", userId).eq("oracle_id", id);
    if (error) {
      setRows(before);
      setMessage(`Couldn't remove that: ${error.message}`);
    }
  }
  async function copyList() {
    // "1 Name *F*" lines read in Moxfield, Archidekt and most store mass-entry boxes.
    const text = sorted.map((r) => `${r.quantity} ${r.card.name}${r.foil ? " *F*" : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`Copied ${rows.length} line${rows.length === 1 ? "" : "s"}: paste into a store's mass entry or Moxfield.`);
    } catch {
      setMessage("Couldn't reach the clipboard.");
    }
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Wish list</h1>
          <p className="mt-1 opacity-85">
            {rows.length === 0 ? "Cards you want to buy, separate from any deck." : `${copies} card${copies === 1 ? "" : "s"} · about $${total.toFixed(2)}`}
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="opacity-80">Sort</span>
            {(["added", "price", "name"] as Sort[]).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} className={`btn min-h-10 ${sort === s ? "border-gold" : ""}`}>
                {s === "added" ? "Newest" : s === "price" ? "Price" : "Name"}
              </button>
            ))}
            <button type="button" onClick={copyList} className="btn btn-gold min-h-10">
              Copy as a list
            </button>
          </div>
        )}
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>

      {rows.length === 0 ? (
        <div className="panel mt-4 p-6 text-center">
          <p className="text-base">Nothing here yet.</p>
          <p className="mt-1 text-sm opacity-80">Open any card in a deck, or use Search, and choose ♡ Wish list.</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {sorted.map((r) => (
            <li key={r.oracle_id} className="flex flex-col gap-2">
              <div className="relative">
                {r.card.image_normal ? (
                  <img src={r.card.image_normal} alt={r.card.name} className="w-full rounded-[4.75%/3.5%]" />
                ) : (
                  <div className="panel flex aspect-[63/88] items-center justify-center p-2 text-center">{r.card.name}</div>
                )}
                {r.foil && <div aria-hidden className="foil-sheen absolute inset-0 rounded-[4.75%/3.5%]" />}
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{r.card.name}</span>
                <span className="shrink-0 tabular-nums opacity-80">{r.card.price_usd != null ? `$${(r.card.price_usd * r.quantity).toFixed(2)}` : "–"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <button type="button" aria-label={`One fewer ${r.card.name}`} disabled={r.quantity <= 1} onClick={() => change(r.oracle_id, { quantity: r.quantity - 1 })} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
                  −
                </button>
                <span className="w-6 text-center tabular-nums">{r.quantity}</span>
                <button type="button" aria-label={`One more ${r.card.name}`} disabled={r.quantity >= 99} onClick={() => change(r.oracle_id, { quantity: r.quantity + 1 })} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
                  +
                </button>
                <label className="ml-1 flex min-h-10 items-center gap-1">
                  <input type="checkbox" checked={r.foil} onChange={(e) => change(r.oracle_id, { foil: e.target.checked })} className="h-4 w-4 accent-gold" />
                  Foil
                </label>
                <button type="button" onClick={() => remove(r.oracle_id)} className="ml-auto min-h-10 px-2 text-red-400">
                  Remove
                </button>
              </div>
              <input
                defaultValue={r.note ?? ""}
                maxLength={200}
                placeholder="Note (where to buy, which art…)"
                aria-label={`Note for ${r.card.name}`}
                onBlur={(e) => {
                  const note = e.target.value.trim() || null;
                  if (note !== r.note) void change(r.oracle_id, { note });
                }}
                className="min-h-10 rounded-md border border-foreground/20 bg-transparent px-2 text-sm"
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
