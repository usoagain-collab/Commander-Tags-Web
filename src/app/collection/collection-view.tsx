"use client";

// The collection page (v2): import an export from Moxfield, Archidekt, ManaBox or a plain list, see what you
// own, change counts, and export it again. Decks then mark the cards you own and price only what you don't.
import { useEffect, useMemo, useState } from "react";
import { mergeImported, parseCollection, type Owned } from "@/lib/deck/collection";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { CardSummary } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";

const SHOWN = 120;

export function CollectionView({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [owned, setOwned] = useState<Map<string, Owned> | null>(null);
  const [cards, setCards] = useState<Record<string, CardSummary>>({});
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const all = new Map<string, Owned>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("collection").select("oracle_id, quantity, foil_quantity").order("oracle_id").range(from, from + 999);
        if (!live) return;
        if (error) return setMessage(`Couldn't load your collection: ${error.message}`);
        for (const r of data as ({ oracle_id: string } & Owned)[]) all.set(r.oracle_id, { quantity: r.quantity, foil_quantity: r.foil_quantity });
        if (data.length < 1000) break;
      }
      const details = all.size ? await fetchSummaries(supabase, [...all.keys()]).catch(() => []) : [];
      if (!live) return;
      setCards(Object.fromEntries(details.map((c) => [c.oracle_id, c])));
      setOwned(all);
    })();
    return () => {
      live = false;
    };
  }, [supabase, reload]);

  async function runImport() {
    const { cards: parsed, skipped } = parseCollection(text);
    if (parsed.length === 0) return setMessage("Nothing to import: paste a collection export or a list like “4 Lightning Bolt”.");
    if (mode === "replace" && !window.confirm(`Replace your whole collection (${owned?.size ?? 0} cards) with this import?`)) return;
    setBusy(true);
    setMessage("Looking up the cards…");
    const names = [...new Set(parsed.map((c) => c.name))];
    const found = new Map<string, string>();
    for (let i = 0; i < names.length; i += 500) {
      const { data, error } = await supabase.rpc("resolve_card_names", { names: names.slice(i, i + 500) });
      if (error) {
        setBusy(false);
        return setMessage(`Couldn't look up the cards: ${error.message}`);
      }
      for (const { input, card } of (data ?? []) as { input: string; card: CardSummary }[]) found.set(input.toLowerCase(), card.oracle_id);
    }
    const resolved = parsed.flatMap((c) => {
      const oracleId = found.get(c.name.toLowerCase());
      return oracleId ? [{ oracleId, quantity: c.quantity, foil: c.foil }] : [];
    });
    const unknown = parsed.length - resolved.length;
    const merged = mergeImported(resolved);
    if (mode === "add" && owned) {
      for (const [id, o] of merged) {
        const had = owned.get(id);
        if (had) merged.set(id, { quantity: Math.min(9999, had.quantity + o.quantity), foil_quantity: Math.min(9999, had.foil_quantity + o.foil_quantity) });
      }
    }
    if (mode === "replace") {
      const { error } = await supabase.from("collection").delete().eq("owner_id", userId);
      if (error) {
        setBusy(false);
        return setMessage(`Couldn't clear your collection: ${error.message}`);
      }
    }
    const rows = [...merged].map(([oracle_id, o]) => ({ owner_id: userId, oracle_id, quantity: Math.min(9999, o.quantity), foil_quantity: Math.min(9999, o.foil_quantity), updated_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("collection").upsert(rows.slice(i, i + 500));
      if (error) {
        setBusy(false);
        return setMessage(`Saved ${i} cards, then stopped: ${error.message}`);
      }
    }
    setBusy(false);
    setText("");
    setMessage(
      `Imported ${rows.length} card${rows.length === 1 ? "" : "s"}.` +
        (unknown ? ` ${unknown} name${unknown === 1 ? "" : "s"} not found.` : "") +
        (skipped ? ` ${skipped} line${skipped === 1 ? "" : "s"} skipped.` : ""),
    );
    setReload((n) => n + 1);
  }

  async function setCount(id: string, quantity: number) {
    const had = owned?.get(id);
    if (!had || !owned) return;
    const next = { quantity: Math.max(0, quantity), foil_quantity: had.foil_quantity };
    const copy = new Map(owned);
    if (next.quantity + next.foil_quantity === 0) copy.delete(id);
    else copy.set(id, next);
    setOwned(copy);
    const res =
      next.quantity + next.foil_quantity === 0
        ? await supabase.from("collection").delete().eq("owner_id", userId).eq("oracle_id", id)
        : await supabase.from("collection").update(next).eq("owner_id", userId).eq("oracle_id", id);
    if (res.error) {
      setOwned(owned);
      setMessage(`Couldn't save that: ${res.error.message}`);
    }
  }

  function exportCsv() {
    const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ["Count,Name,Foil"];
    for (const [id, o] of owned ?? []) {
      const name = cards[id]?.name;
      if (!name) continue;
      if (o.quantity) lines.push(`${o.quantity},${quote(name)},`);
      if (o.foil_quantity) lines.push(`${o.foil_quantity},${quote(name)},foil`);
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "deck-genome-collection.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const entries = [...(owned ?? [])].filter(([id]) => cards[id]);
  const copies = entries.reduce((s, [, o]) => s + o.quantity + o.foil_quantity, 0);
  const value = entries.reduce((s, [id, o]) => s + (o.quantity + o.foil_quantity) * (cards[id].price_usd ?? 0), 0);
  const q = filter.trim().toLowerCase();
  const shown = entries.filter(([id]) => !q || cards[id].name.toLowerCase().includes(q)).sort((a, b) => cards[a[0]].name.localeCompare(cards[b[0]].name));

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Collection</h1>
      <p className="mt-1 opacity-85">
        {owned === null ? "Loading…" : owned.size === 0 ? "Track what you own: decks then mark your cards and price only what you still need." : `${owned.size} different cards · ${copies} copies · about $${value.toFixed(0)}`}
      </p>

      <section className="panel mt-5 p-4">
        <h2 className="display text-xl">Import</h2>
        <p className="mt-1 text-sm opacity-80">Paste or open a collection export from Moxfield, Archidekt or ManaBox (CSV), or a plain list like “4 Lightning Bolt”.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          aria-label="Collection export"
          className="mt-2 w-full rounded-md border border-foreground/20 bg-transparent p-2 font-mono text-xs"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="btn min-h-10 cursor-pointer">
            Open a file…
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={async (e) => setText(await (e.target.files?.[0]?.text() ?? Promise.resolve("")))} />
          </label>
          <label className="flex min-h-10 items-center gap-1">
            <input type="radio" name="mode" checked={mode === "add"} onChange={() => setMode("add")} className="accent-gold" /> Add to my collection
          </label>
          <label className="flex min-h-10 items-center gap-1">
            <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-gold" /> Replace it
          </label>
          <button type="button" onClick={runImport} disabled={busy || !text.trim()} className="btn btn-gold min-h-10 px-4 disabled:opacity-50">
            {busy ? "Importing…" : "Import"}
          </button>
          {owned && owned.size > 0 && (
            <button type="button" onClick={exportCsv} className="btn min-h-10 sm:ml-auto">
              Export CSV
            </button>
          )}
        </div>
        <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
          {message}
        </p>
      </section>

      {entries.length > 0 && (
        <section className="mt-6">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a card…" aria-label="Find a card in your collection" className="min-h-11 w-full max-w-sm rounded-md border border-foreground/20 bg-transparent px-3" />
          <ul className="panel mt-3 divide-y divide-foreground/10">
            {shown.slice(0, SHOWN).map(([id, o]) => (
              <li key={id} className="flex min-h-12 items-center gap-2 px-3 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{cards[id].name}</span>
                {o.foil_quantity > 0 && <span className="text-xs text-gold">✦ {o.foil_quantity} foil</span>}
                <button type="button" aria-label={`One fewer ${cards[id].name}`} onClick={() => setCount(id, o.quantity - 1)} disabled={o.quantity === 0} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
                  −
                </button>
                <span className="w-8 text-center tabular-nums">{o.quantity}</span>
                <button type="button" aria-label={`One more ${cards[id].name}`} onClick={() => setCount(id, o.quantity + 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
                  +
                </button>
              </li>
            ))}
          </ul>
          {shown.length > SHOWN && <p className="mt-2 text-sm opacity-70">Showing {SHOWN} of {shown.length}. Type to narrow it down.</p>}
        </section>
      )}
    </main>
  );
}
