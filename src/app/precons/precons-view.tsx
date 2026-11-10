"use client";

// Precons (v2): every Commander precon, newest first and grouped by set, with search. Each one is a public deck
// (imported nightly from MTGJSON), so a tap opens the ordinary deck page, where "Start a deck from this" copies it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ManaSymbol } from "@/components/mana-cost";
import { printingImage } from "@/lib/deck/printing";

export type PreconTile = {
  id: string;
  name: string;
  precon: { code: string; set_name: string; release: string | null; collector: boolean; type: string };
  commanders: { name: string; printing_id: string | null; art: string | null }[];
  identity: string[];
  size: number;
  price: number;
};

const COLOR_ORDER = "WUBRG";
const year = (d: string | null) => (d ? d.slice(0, 4) : "");
// "Counter Blitz Collector's Edition (FINAL FANTASY X)": the tile already carries a Collector's Edition badge.
const plainName = (name: string) => name.replace(/\s*Collector['’]?s Edition/i, "").trim();
const COLLECTOR_KEY = "precons:collector";
const dateLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

export function PreconsView({ precons, failed }: { precons: PreconTile[]; failed: boolean }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [query, setQuery] = useState("");
  const [collector, setCollectorState] = useState(true);
  // Remembered on this browser (per-viewer convenience, so local storage rather than the profile).
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLECTOR_KEY) === "0") setCollectorState(false);
    } catch {}
  }, []);
  function setCollector(on: boolean) {
    setCollectorState(on);
    try {
      localStorage.setItem(COLLECTOR_KEY, on ? "1" : "0");
    } catch {}
  }
  const q = query.trim().toLowerCase();
  const shown = precons.filter(
    (p) =>
      (collector || !p.precon.collector) &&
      (!q || p.name.toLowerCase().includes(q) || p.precon.set_name.toLowerCase().includes(q) || p.precon.code.toLowerCase() === q || p.commanders.some((c) => c.name.toLowerCase().includes(q)) || year(p.precon.release) === q),
  );
  // Sets in the order of their newest deck (the list comes newest first).
  const sets = new Map<string, PreconTile[]>();
  for (const p of shown) sets.set(p.precon.set_name, [...(sets.get(p.precon.set_name) ?? []), p]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
      <p className="eyebrow">Explore</p>
      <h1 className="display text-3xl sm:text-4xl">Commander precons</h1>
      <p className="mt-1 max-w-2xl opacity-85">
        Every Commander precon, card for card with its real printings. Open one to see its roles, stats and bracket, playtest it, or start your own deck from
        it.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by deck, commander, set or year…"
          aria-label="Search precons"
          className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3 sm:w-96"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={collector} onChange={(e) => setCollector(e.target.checked)} className="h-5 w-5 accent-gold" />
          Show Collector&apos;s Editions
        </label>
        <span className="text-sm opacity-70">{shown.length} decks</span>
      </div>
      {failed && (
        <div role="alert" className="panel mt-5 flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1">The precon list is taking longer than usual to load. It usually works on a second try.</p>
          <button type="button" className="btn btn-gold min-h-11" disabled={retrying} onClick={() => startRetry(() => router.refresh())}>
            {retrying ? "Loading…" : "Try again"}
          </button>
        </div>
      )}
      {!failed && shown.length === 0 && <p className="mt-6 opacity-70">No precon matches “{query}”.</p>}

      <div className="mt-6 space-y-8">
        {[...sets].map(([setName, decks]) => (
          <section key={setName}>
            <h2 className="display mb-3 flex flex-wrap items-baseline gap-x-3 text-xl">
              {setName}
              <span className="font-sans text-sm opacity-60">
                {decks[0].precon.code} · {dateLabel(decks[0].precon.release)}
                {decks[0].precon.release && decks[0].precon.release > today ? " · coming soon" : ""}
              </span>
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {decks.map((p) => (
                <li key={p.id}>
                  <Tile precon={p} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs opacity-60">
        Decklists from{" "}
        <a href="https://mtgjson.com" className="underline" target="_blank" rel="noreferrer">
          MTGJSON
        </a>{" "}
        (MIT license), refreshed nightly. Card images and prices from Scryfall.
      </p>
    </main>
  );
}

function Tile({ precon: p }: { precon: PreconTile }) {
  const lead = p.commanders[0];
  const art = lead?.printing_id ? printingImage(lead.printing_id, "art_crop") : lead?.art;
  const colors = [...p.identity].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));
  return (
    <Link href={`/decks/${p.id}`} className="panel group block overflow-hidden transition hover:border-gold/60">
      <span className="relative block aspect-[626/457] overflow-hidden bg-foreground/10">
        {art && <img src={art} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}
        {p.precon.collector && <span className="absolute left-2 top-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-gold">✦ Collector&apos;s Edition</span>}
        {p.precon.type === "MTGO Commander Deck" && (
          <span className="absolute right-2 top-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white" title="Sold on Magic Online only, never in paper">
            Magic Online only
          </span>
        )}
      </span>
      <span className="block p-3">
        <span className="display block truncate text-lg">{plainName(p.name)}</span>
        <span className="block truncate text-sm opacity-80">{p.commanders.map((c) => c.name).join(" & ")}</span>
        <span className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-0.5">
            {colors.length ? colors.map((c) => <ManaSymbol key={c} symbol={c} size={18} />) : <ManaSymbol symbol="C" size={18} />}
          </span>
          <span className="tabular-nums opacity-80">${Math.round(p.price)}</span>
        </span>
      </span>
    </Link>
  );
}
