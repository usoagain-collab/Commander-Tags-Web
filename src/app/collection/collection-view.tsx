"use client";

// The collection page (v2): every printing you own, as a Visual grid, Stacks or Text, grouped and sorted, with a
// card sheet per card (printings, finishes, counts). Add cards one at a time or import an export from Moxfield,
// Archidekt, ManaBox or a plain list, keeping each line's printing; export it again as CSV. Decks then mark the
// cards you own (green = that printing, orange = another one) and price only what you don't.
import { useEffect, useMemo, useState } from "react";
import { useTagViewPrefs } from "@/app/decks/[id]/deck-toolbar";
import { exportCollectionCsv, parseCollection, rowUnitPrice } from "@/lib/deck/collection";
import {
  COLLECTION_FILTER_LABELS,
  COLLECTION_GROUP_LABELS,
  COLLECTION_SORT_LABELS,
  collectionItems,
  collectionSections,
  matchesQuery,
  readCollectionPrefs,
  type CollectionFilter,
  type CollectionItem,
  type CollectionPrefs,
  type CollectionSection,
} from "@/lib/deck/collection-view";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { VIEW_LABELS, type ViewMode } from "@/lib/deck/grouping";
import type { CardSummary } from "@/lib/deck/model";
import { readCardLang } from "@/lib/deck/card-language";
import { printingIdFromImage } from "@/lib/deck/printing";
import { useCollection, type OwnedTarget } from "@/lib/deck/use-collection";
import { useLocalized } from "@/lib/deck/use-localized";
import { createClient } from "@/lib/supabase/client";
import { CollectionSheet } from "./collection-sheet";
import { resolveImport } from "./import-collection";

const PAGE = 200;
const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

export function CollectionView({ userId, savedTagView, initialQuery }: { userId: string; savedTagView: Record<string, unknown>; initialQuery: string }) {
  const supabase = useMemo(() => createClient(), []);
  const collection = useCollection(userId);
  const [tagView, updateTagView] = useTagViewPrefs(savedTagView, userId);
  const prefs = readCollectionPrefs(tagView.collection);
  const setPrefs = (patch: Partial<CollectionPrefs>) => updateTagView({ collection: { ...prefs, ...patch } });

  const [cards, setCards] = useState<Record<string, CardSummary>>({});
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<CardSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Card details for every card you own (names, types, default images), fetched once per new card.
  const ids = useMemo(() => [...new Set(collection.rows.map((r) => r.oracle_id))], [collection.rows]);
  useEffect(() => {
    const missing = ids.filter((id) => !cards[id]);
    if (!missing.length) return;
    let live = true;
    fetchSummaries(supabase, missing)
      .then((list) => live && setCards((c) => ({ ...c, ...Object.fromEntries(list.map((x) => [x.oracle_id, x])) })))
      .catch((e: Error) => live && setMessage(e.message));
    return () => {
      live = false;
    };
  }, [ids, cards, supabase]);

  const save = async (changes: { target: OwnedTarget; quantity: number }[]) => {
    const failed = await collection.setMany(changes);
    if (failed) setMessage(failed);
  };

  const listed = collectionItems(collection.rows, cards, prefs.perCard, filter).filter((it) => matchesQuery(it, query));
  // Card language (v2): pictures in your language where that printing exists in it.
  const cardLang = readCardLang(tagView);
  const localize = useLocalized(cardLang, listed.slice(0, limit).map((it) => printingIdFromImage(it.image)));
  const items = cardLang === "en" ? listed : listed.map((it) => ({ ...it, image: localize({ ...it.card, image_normal: it.image }).image_normal }));
  const sections = collectionSections(items, prefs.group, prefs.sort);
  const known = collection.rows.filter((r) => cards[r.oracle_id]);
  const copies = known.reduce((s, r) => s + r.quantity, 0);
  const value = known.reduce((s, r) => s + r.quantity * rowUnitPrice(r, cards[r.oracle_id].price_usd), 0);
  const unknownCopies = known.filter((r) => !r.printing_id).reduce((s, r) => s + r.quantity, 0);
  const distinct = new Set(known.map((r) => r.oracle_id)).size;
  const shownCount = sections.reduce((n, s) => n + s.items.length, 0);

  // Draw at most `limit` items, section by section.
  let left = limit;
  const drawn = sections
    .map((s) => {
      const take = s.items.slice(0, Math.max(0, left));
      left -= take.length;
      return { ...s, items: take };
    })
    .filter((s) => s.items.length);

  return (
    <main className="mx-auto max-w-[1800px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Collection</h1>
          <p className="mt-1 opacity-85">
            {!collection.loaded
              ? collection.error
                ? `Couldn't load your collection: ${collection.error}`
                : "Loading…"
              : known.length === 0
                ? "Track what you own: decks then mark your cards and price only what you still need."
                : `${distinct} different cards · ${copies} copies · about ${money(value)}`}
          </p>
          {unknownCopies > 0 && (
            <button type="button" onClick={() => setFilter("unknown")} className="mt-1 min-h-9 text-left text-sm text-gold hover:underline">
              {unknownCopies} {unknownCopies === 1 ? "copy has" : "copies have"} no printing yet. Show them ›
            </button>
          )}
        </div>
        <AddCard
          onPick={(card) => {
            setCards((c) => ({ ...c, [card.oracle_id]: card }));
            setOpen(card);
          }}
        />
      </div>

      <ImportPanel
        hasCards={known.length > 0}
        onImport={async (text, mode) => {
          const { cards: parsed, skipped } = parseCollection(text);
          if (parsed.length === 0) return "Nothing to import: paste a collection export or a list like “4 Lightning Bolt”.";
          if (mode === "replace" && !window.confirm(`Replace your whole collection (${copies} copies) with this import?`)) return null;
          try {
            const r = await resolveImport(supabase, parsed, setMessage);
            if (mode === "replace") {
              const failed = await collection.clear();
              if (failed) return failed;
            }
            setMessage("Saving…");
            const changes = r.rows.map((row) => ({ target: row, quantity: row.quantity + (mode === "add" ? (collection.rowOf(row)?.quantity ?? 0) : 0) }));
            const failed = await collection.setMany(changes);
            if (failed) return failed;
            setMessage(null);
            return (
              `Imported ${r.copies} ${r.copies === 1 ? "copy" : "copies"}, ${r.printed} with their printing.` +
              (r.unknown ? ` ${r.unknown} name${r.unknown === 1 ? "" : "s"} not found.` : "") +
              (skipped ? ` ${skipped} line${skipped === 1 ? "" : "s"} skipped.` : "")
            );
          } catch (e) {
            return (e as Error).message;
          }
        }}
        onExport={() => {
          const url = URL.createObjectURL(new Blob([exportCollectionCsv(known, (id) => cards[id]?.name)], { type: "text/csv" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = "deck-genome-collection.csv";
          a.click();
          URL.revokeObjectURL(url);
        }}
      />
      {message && (
        <p aria-live="polite" className="mt-2 text-sm opacity-85">
          {message}
        </p>
      )}

      {known.length > 0 && (
        <>
          <Toolbar prefs={prefs} setPrefs={setPrefs} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />
          <p className="mt-2 text-sm opacity-70">
            {shownCount === 0 ? "Nothing matches." : `${shownCount} ${prefs.perCard ? "cards" : "printings"}${shownCount > limit ? `, showing ${limit}` : ""}`}
          </p>
          <div className="mt-3 space-y-6">
            {prefs.view === "stacks" ? (
              <div className="gap-x-4 [column-width:150px] sm:[column-width:190px]">
                {drawn.map((s) => (
                  <div key={s.key} className="mb-6 break-inside-avoid">
                    <Heading section={s} show={prefs.group !== "none"} />
                    <Stack items={s.items} onOpen={setOpen} />
                  </div>
                ))}
              </div>
            ) : (
              drawn.map((s) => (
                <section key={s.key}>
                  <Heading section={s} show={prefs.group !== "none"} />
                  {prefs.view === "grid" ? (
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 xl:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                      {s.items.map((it) => (
                        <li key={it.key}>
                          <Tile item={it} onOpen={() => setOpen(it.card)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="panel divide-y divide-foreground/10">
                      {s.items.map((it) => (
                        <TextRow key={it.key} item={it} onOpen={() => setOpen(it.card)} onQuantity={(q) => save([{ target: it.rows[0], quantity: q }])} />
                      ))}
                    </ul>
                  )}
                </section>
              ))
            )}
          </div>
          {shownCount > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="btn mt-4 min-h-11 w-full">
              Show {Math.min(PAGE, shownCount - limit)} more
            </button>
          )}
        </>
      )}

      {open && <CollectionSheet card={open} rows={collection.owned.get(open.oracle_id) ?? []} onSet={save} onClose={() => setOpen(null)} />}
    </main>
  );
}

function Toolbar({
  prefs,
  setPrefs,
  filter,
  setFilter,
  query,
  setQuery,
}: {
  prefs: CollectionPrefs;
  setPrefs: (p: Partial<CollectionPrefs>) => void;
  filter: CollectionFilter;
  setFilter: (f: CollectionFilter) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const select = "min-h-11 rounded-md border border-foreground/20 bg-background px-2 text-sm";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a card or set…"
        aria-label="Find a card or set in your collection"
        className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3 sm:w-64"
      />
      <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-foreground/20">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={prefs.view === v}
            onClick={() => setPrefs({ view: v })}
            className={`min-h-11 px-3 text-sm ${prefs.view === v ? "bg-gold/20 font-medium text-gold" : "hover:bg-foreground/10"}`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-sm">
        Group
        <select value={prefs.group} onChange={(e) => setPrefs({ group: e.target.value as CollectionPrefs["group"] })} className={select}>
          {Object.entries(COLLECTION_GROUP_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-sm">
        Sort
        <select value={prefs.sort} onChange={(e) => setPrefs({ sort: e.target.value as CollectionPrefs["sort"] })} className={select}>
          {Object.entries(COLLECTION_SORT_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-sm">
        Show
        <select value={filter} onChange={(e) => setFilter(e.target.value as CollectionFilter)} className={select}>
          {Object.entries(COLLECTION_FILTER_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-pressed={prefs.perCard}
        onClick={() => setPrefs({ perCard: !prefs.perCard })}
        title="Show each printing on its own, or one tile per card"
        className={`min-h-11 rounded-md border px-3 text-sm ${prefs.perCard ? "border-gold text-gold" : "border-foreground/20"}`}
      >
        {prefs.perCard ? "One per card" : "Each printing"}
      </button>
    </div>
  );
}

function Heading({ section, show }: { section: CollectionSection; show: boolean }) {
  if (!show) return null;
  return (
    <h2 className="mb-2 flex items-baseline gap-2 font-medium">
      {section.title}
      <span className="text-sm opacity-60">{section.count}</span>
    </h2>
  );
}

/** Quantity and printing as labels on the card; the whole card is the tap target. */
function Badges({ item }: { item: CollectionItem }) {
  return (
    <>
      {item.quantity > 1 && <span className="pointer-events-none absolute right-1.5 top-[7%] rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">×{item.quantity}</span>}
      {!item.rows.some((r) => r.printing_id) && (
        <span title="Printing unknown" className="pointer-events-none absolute left-1.5 top-[7%] rounded bg-orange-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          ?
        </span>
      )}
    </>
  );
}

function Tile({ item, onOpen }: { item: CollectionItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} title={`${item.card.name} · ${item.label}`} className="block w-full rounded-lg text-left hover:brightness-110">
      <span className={`relative block ${item.foil ? "foil-sheen" : ""}`}>
        <img src={item.image ?? undefined} alt={item.card.name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%]" />
        <Badges item={item} />
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-1 text-xs">
        <span className="truncate opacity-80">{item.label}</span>
        <span className="shrink-0 tabular-nums opacity-80">{money(item.unitPrice)}</span>
      </span>
    </button>
  );
}

function Stack({ items, onOpen }: { items: CollectionItem[]; onOpen: (c: CardSummary) => void }) {
  return (
    <ul className="flex flex-col pb-2">
      {items.map((it, i) => (
        <li key={it.key} style={{ marginTop: i === 0 ? 0 : "-124%" }} className="relative">
          <button type="button" onClick={() => onOpen(it.card)} title={`${it.card.name} · ${it.label}`} className={`relative block w-full rounded-[5%/3.6%] hover:brightness-125 ${it.foil ? "foil-sheen" : ""}`}>
            <img src={it.image ?? undefined} alt={it.card.name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%]" />
            <Badges item={it} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TextRow({ item, onOpen, onQuantity }: { item: CollectionItem; onOpen: () => void; onQuantity: (q: number) => void }) {
  const single = item.rows.length === 1;
  return (
    <li className="flex min-h-12 items-center gap-2 px-3 py-1 text-sm">
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left hover:text-gold">
        <span className="min-w-0 truncate font-medium">{item.card.name}</span>
        <span className={`shrink-0 text-xs ${item.rows.some((r) => r.printing_id) ? "opacity-70" : "text-orange-700 dark:text-orange-300"}`}>{item.label}</span>
      </button>
      {single && item.rows[0].finish !== "nonfoil" && <span className="hidden text-xs text-gold sm:inline">✦</span>}
      <span className="hidden w-16 text-right tabular-nums opacity-80 sm:inline">{money(item.unitPrice)}</span>
      {single ? (
        <span className="flex items-center gap-1">
          <button type="button" aria-label={`One fewer ${item.card.name}`} onClick={() => onQuantity(item.quantity - 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
            −
          </button>
          <span className="w-8 text-center tabular-nums">{item.quantity}</span>
          <button type="button" aria-label={`One more ${item.card.name}`} onClick={() => onQuantity(item.quantity + 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
            +
          </button>
        </span>
      ) : (
        <span className="w-24 text-right tabular-nums">×{item.quantity}</span>
      )}
    </li>
  );
}

/** Find a card by name and open its sheet to pick the printing you own. */
function AddCard({ onPick }: { onPick: (card: CardSummary) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setResults([]);
    let live = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_cards", { q, lim: 8, p_any_legality: true });
      if (live) setResults((data ?? []) as CardSummary[]);
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, supabase]);

  return (
    <div className="relative w-full sm:w-80">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setText("")}
        placeholder="＋ Add a card…"
        aria-label="Add a card to your collection"
        className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3"
      />
      {results.length > 0 && (
        <ul className="panel absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto py-1 shadow-lg">
          {results.map((c) => (
            <li key={c.oracle_id}>
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setResults([]);
                  onPick(c);
                }}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-foreground/10"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportPanel({
  hasCards,
  onImport,
  onExport,
}: {
  hasCards: boolean;
  onImport: (text: string, mode: "add" | "replace") => Promise<string | null>;
  onExport: () => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <details className="panel mt-5 p-4" open={!hasCards}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
        <span className="display text-xl">Import / export</span>
        {result && <span className="text-sm font-normal opacity-80">{result}</span>}
      </summary>
      <p className="mt-1 text-sm opacity-80">
        Paste or open a collection export from Moxfield, Archidekt or ManaBox (CSV), or a list like “4 Lightning Bolt” or “1 Sol Ring (CMR) 472 *F*”. Set codes, collector numbers and Scryfall IDs keep each printing.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Collection export" className="mt-2 w-full rounded-md border border-foreground/20 bg-transparent p-2 font-mono text-xs" />
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
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            const r = await onImport(text, mode);
            setBusy(false);
            if (r) setResult(r);
            if (r?.startsWith("Imported")) setText("");
          }}
          className="btn btn-gold min-h-10 px-4 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import"}
        </button>
        {hasCards && (
          <button type="button" onClick={onExport} className="btn min-h-10 sm:ml-auto">
            Export CSV
          </button>
        )}
      </div>
    </details>
  );
}

