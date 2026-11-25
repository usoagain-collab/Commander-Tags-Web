"use client";

// The collection page (v2): every printing you own, as a Visual grid, Stacks or Text, grouped and sorted, with a
// card sheet per card (printings, finishes, counts). Add cards one at a time or import an export from Moxfield,
// Archidekt, ManaBox or a plain list, keeping each line's printing; export it again as CSV. Decks then mark the
// cards you own (green = that printing, orange = another one) and price only what you don't.
import { priceCard, priceCards, readPriceSource } from "@/lib/deck/store-prices";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
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
import { VIEW_LABELS } from "@/lib/deck/grouping";
import type { CardSummary } from "@/lib/deck/model";
import { readCardLang } from "@/lib/deck/card-language";
import { printingIdFromImage } from "@/lib/deck/printing";
import { useCollection, type OwnedTarget } from "@/lib/deck/use-collection";
import { useLocalized } from "@/lib/deck/use-localized";
import { createClient } from "@/lib/supabase/client";
import { AddCardBox } from "@/components/add-card-box";
import { CardDropTarget } from "@/components/card-drop-target";
import { finishFor, infoOf } from "@/lib/deck/collection-targets";
import { LAYOUT_LABELS, copiesByLocation, locationForAdds, locationName, planMoveAll, rowsIn, type LocationLayout, type LocationView } from "@/lib/deck/locations";
import { useLocations } from "@/lib/deck/use-locations";
import { CollectionSheet } from "./collection-sheet";
import { BinderPages, CustomizeLocation, LocationBar, LocationHeader, NewLocation, SIZE_COLUMNS, SIZE_STACK } from "./locations-ui";
import { resolveImport } from "./import-collection";
import { DropTray, MOVE_TYPE, MoveMenu, SelectBar } from "./move-ui";

const PAGE = 200;
const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/** What every card button on the page carries: tap/click, right-click menu, drag, selected state. */
type CardBind = {
  onClick: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  "aria-pressed"?: boolean;
};

/** The one location every row is in (null = Unsorted), or undefined when they're spread out. */
const placeOf = (items: CollectionItem[]) => {
  const at = new Set(items.flatMap((it) => it.rows.map((r) => r.location_id ?? null)));
  return at.size === 1 ? [...at][0] : undefined;
};

export function CollectionView({ userId, savedTagView, initialQuery }: { userId: string; savedTagView: Record<string, unknown>; initialQuery: string }) {
  const supabase = useMemo(() => createClient(), []);
  const collection = useCollection(userId);
  const [tagView, updateTagView] = useTagViewPrefs(savedTagView, userId);
  const prefs = readCollectionPrefs(tagView.collection);
  // Prices from your chosen store (Settings → Prices).
  const priceSource = readPriceSource(tagView);
  const savePrefs = (patch: Partial<CollectionPrefs>) => updateTagView({ collection: { ...prefs, ...patch } });
  // Binders and boxes (migration 0067): one open at a time, each with its own look and layout.
  const locations = useLocations(userId);
  const [where, setWhere] = useState<LocationView>("all");
  const [newLocation, setNewLocation] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const loc = locations.list.find((l) => l.id === where) ?? null;
  const view: LocationView = loc || where === "unsorted" ? where : "all";
  const addTo = locationForAdds(view);
  const layout: LocationLayout = loc ? loc.style.layout : prefs.view;
  // Inside a binder, view / group / sort belong to that binder; One per card stays one setting for the whole page.
  const shownPrefs: CollectionPrefs = loc ? { ...prefs, view: layout === "pages" ? "grid" : layout, group: layout === "pages" ? "none" : loc.style.group, sort: loc.style.sort } : prefs;
  const setPrefs = (patch: Partial<CollectionPrefs>) => {
    if (!loc) return savePrefs(patch);
    const { perCard, ...rest } = patch;
    if (perCard !== undefined) savePrefs({ perCard });
    if (Object.keys(rest).length) void locations.update(loc.id, { style: { ...(rest.view ? { layout: rest.view } : {}), ...(rest.group ? { group: rest.group } : {}), ...(rest.sort ? { sort: rest.sort } : {}) } }).then((m) => m && setMessage(m));
  };
  const setLayout = (l: LocationLayout) => (loc ? void locations.update(loc.id, { style: { layout: l } }).then((m) => m && setMessage(m)) : l !== "pages" && savePrefs({ view: l }));

  const [cards, setCards] = useState<Record<string, CardSummary>>({});
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<CardSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Moving cards between binders: select mode, the right-click menu and drags.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; keys: string[] } | null>(null);
  const [dragging, setDragging] = useState(0);
  const dragKeys = useRef<string[]>([]);
  const [moveAfterNew, setMoveAfterNew] = useState<string[] | null>(null);
  const endSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

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

  const inView = rowsIn(collection.rows, view);
  const listed = collectionItems(inView, priceCards(cards, priceSource), prefs.perCard, filter, priceSource).filter((it) => matchesQuery(it, query));
  // Card language (v2): pictures in your language where that printing exists in it.
  const cardLang = readCardLang(tagView);
  const localize = useLocalized(cardLang, listed.slice(0, limit).map((it) => printingIdFromImage(it.image)));
  const items = cardLang === "en" ? listed : listed.map((it) => ({ ...it, image: localize({ ...it.card, image_normal: it.image }).image_normal }));
  const sections = collectionSections(items, shownPrefs.group, shownPrefs.sort);
  const ordered = sections.flatMap((s) => s.items);
  const byKey = new Map(ordered.map((it) => [it.key, it]));
  const itemsOf = (keys: string[]) => keys.flatMap((k) => byKey.get(k) ?? []);
  const selectedItems = itemsOf([...selected]);

  const moveKeys = async (keys: string[], to: string | null) => {
    const list = itemsOf(keys);
    const sources = list.flatMap((it) => it.rows);
    const moving = sources.filter((r) => (r.location_id ?? null) !== to).reduce((n, r) => n + r.quantity, 0);
    const name = locationName(locations.list, to);
    const plan = planMoveAll(collection.rows, sources, to);
    setMenu(null);
    if (!plan.length) return setMessage(`${list.length === 1 ? "It's" : "They're"} already in ${name}.`);
    const failed = await collection.setMany(plan);
    if (failed) return setMessage(failed);
    setSelected(new Set());
    setMessage(`Moved ${list.length === 1 ? list[0].card.name : `${list.length} cards`} (${moving} ${moving === 1 ? "copy" : "copies"}) to ${name}.`);
  };
  const keysFor = (it: CollectionItem) => (selected.has(it.key) ? [...selected] : [it.key]);
  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const bind = (it: CollectionItem): CardBind => ({
    onClick: (e) => {
      if (selecting || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setSelecting(true);
        toggle(it.key);
        return;
      }
      setOpen(it.card);
    },
    onContextMenu: (e) => {
      if (!locations.ready) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, keys: keysFor(it) });
    },
    draggable: locations.ready && locations.list.length > 0,
    onDragStart: (e) => {
      const keys = keysFor(it);
      dragKeys.current = keys;
      e.dataTransfer.setData(MOVE_TYPE, String(keys.length));
      e.dataTransfer.effectAllowed = "move";
      setDragging(keys.length);
    },
    onDragEnd: () => setDragging(0),
    ...(selecting ? { "aria-pressed": selected.has(it.key) } : {}),
  });
  const dropOn = (to: string | null) => {
    setDragging(0);
    void moveKeys(dragKeys.current, to);
  };
  const known = collection.rows.filter((r) => cards[r.oracle_id]);
  const copies = known.reduce((s, r) => s + r.quantity, 0);
  const value = known.reduce((s, r) => s + r.quantity * rowUnitPrice(r, priceCard(cards[r.oracle_id], priceSource).price_usd, priceSource), 0);
  const unknownCopies = known.filter((r) => !r.printing_id).reduce((s, r) => s + r.quantity, 0);
  const distinct = new Set(known.map((r) => r.oracle_id)).size;
  const counts = copiesByLocation(known);
  const knownHere = inView.filter((r) => cards[r.oracle_id]);
  const valueHere = knownHere.reduce((s, r) => s + r.quantity * rowUnitPrice(r, priceCard(cards[r.oracle_id], priceSource).price_usd, priceSource), 0);
  const size = loc?.style.size ?? "medium";
  const shownCount = sections.reduce((n, s) => n + s.items.length, 0);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([exportCollectionCsv(known, (id) => cards[id]?.name)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "deck-genome-collection.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

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
    <main className={`mx-auto max-w-[1800px] px-4 py-8 sm:px-6 ${selecting || dragging ? "pb-40" : ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Collection</h1>
          <p className="mt-1 opacity-85">
            {!collection.loaded
              ? collection.error
                ? `Couldn't load your collection: ${collection.error}`
                : "Loading…"
              : known.length === 0
                ? "Track the cards you own. Your decks then mark which ones you have, and price only what you still need."
                : `${distinct} different cards · ${copies} copies · about ${money(value)}`}
          </p>
          {unknownCopies > 0 && (
            <button type="button" onClick={() => setFilter("unknown")} className="mt-1 min-h-9 text-left text-sm text-gold hover:underline">
              {unknownCopies} {unknownCopies === 1 ? "copy has" : "copies have"} no printing yet. Show them ›
            </button>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <AddCardBox
            label="Add a card to your collection"
            onPick={(card) => {
              setCards((c) => ({ ...c, [card.oracle_id]: card }));
              setOpen(card);
            }}
          />
          <button type="button" aria-expanded={importOpen} onClick={() => setImportOpen((o) => !o)} className={`btn min-h-11 px-4 ${importOpen ? "border-gold" : ""}`}>
            ⤓ Import
          </button>
          {known.length > 0 && (
            <button type="button" onClick={exportCsv} className="btn min-h-11 px-4">
              ⤒ Export CSV
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 hidden text-xs opacity-60 sm:block">Tip: drag a card image from a Scryfall tab onto this page to add that printing.</p>

      <CardDropTarget
        label={loc ? `Add to ${loc.name}` : "Add to your collection"}
        hint="Drop it anywhere: one copy of that printing"
        onMessage={setMessage}
        onCard={async (card, printing) => {
          setCards((c) => ({ ...c, [card.oracle_id]: card }));
          const target: OwnedTarget = printing
            ? { oracle_id: card.oracle_id, printing_id: printing.id, finish: finishFor(printing, printing.foil), printing_info: infoOf(printing), location_id: addTo }
            : { oracle_id: card.oracle_id, printing_id: null, finish: "nonfoil", printing_info: null, location_id: addTo };
          const have = collection.rowOf(target)?.quantity ?? 0;
          const failed = await collection.setMany([{ target, quantity: have + 1 }]);
          const where = printing ? ` (${printing.set.toUpperCase()} #${printing.number})` : " (printing unknown)";
          setMessage(failed ?? `Added ${card.name}${where}. You have ${have + 1} of that one.`);
        }}
      />

      <ImportPanel
        open={importOpen || (collection.loaded && known.length === 0)}
        onClose={known.length > 0 ? () => setImportOpen(false) : undefined}
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
            const changes = r.rows.map((row) => ({ target: { ...row, location_id: addTo }, quantity: row.quantity + (mode === "add" ? (collection.rowOf({ ...row, location_id: addTo })?.quantity ?? 0) : 0) }));
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
      />
      {message && (
        <p aria-live="polite" className="mt-2 text-sm opacity-85">
          {message}
        </p>
      )}

      {known.length > 0 && locations.ready && (
        <LocationBar locations={locations.list} counts={counts} total={copies} view={view} onView={setWhere} onNew={() => setNewLocation(true)} onDropCards={dropOn} />
      )}
      {loc && <LocationHeader loc={loc} cards={cards} copies={knownHere.reduce((n, r) => n + r.quantity, 0)} value={money(valueHere)} onCustomize={() => setCustomizing(true)} />}

      {known.length > 0 && (
        <>
          <Toolbar
            prefs={shownPrefs}
            setPrefs={setPrefs}
            layout={layout}
            layouts={loc ? LAYOUT_LABELS : VIEW_LABELS}
            setLayout={setLayout}
            filter={filter}
            setFilter={setFilter}
            query={query}
            setQuery={setQuery}
            selecting={selecting}
            onSelect={() => (selecting ? endSelect() : setSelecting(true))}
          />
          <p className="mt-2 text-sm opacity-70">
            {shownCount === 0 ? "Nothing matches." : `${shownCount} ${prefs.perCard ? "cards" : "printings"}${shownCount > limit ? `, showing ${limit}` : ""}`}
            {locations.list.length > 0 && !selecting && (
              <span className="hidden sm:inline"> · Drag cards onto a binder, right-click one, or use Select to move several.</span>
            )}
          </p>
          <div className="mt-3 space-y-6">
            {loc && layout === "pages" ? (
              <BinderPages
                key={`${loc.id}|${loc.style.pockets}|${shownPrefs.sort}|${query}|${filter}`}
                items={drawn.flatMap((s) => s.items)}
                style={loc.style}
                renderPocket={(it) => <Pocket item={it} bind={bind(it)} selected={selected.has(it.key)} />}
              />
            ) : shownPrefs.view === "stacks" ? (
              <div className={`gap-x-4 ${SIZE_STACK[size]}`}>
                {drawn.map((s) => (
                  <div key={s.key} className="mb-6 break-inside-avoid">
                    <Heading section={s} show={shownPrefs.group !== "none"} />
                    <Stack items={s.items} bind={bind} selected={selected} />
                  </div>
                ))}
              </div>
            ) : (
              drawn.map((s) => (
                <section key={s.key}>
                  <Heading section={s} show={shownPrefs.group !== "none"} />
                  {shownPrefs.view === "grid" ? (
                    <ul className={`grid gap-2.5 ${SIZE_COLUMNS[size]}`}>
                      {s.items.map((it) => (
                        <li key={it.key}>
                          <Tile item={it} bind={bind(it)} selected={selected.has(it.key)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="panel divide-y divide-foreground/10">
                      {s.items.map((it) => (
                        <TextRow key={it.key} item={it} bind={bind(it)} selected={selected.has(it.key)} onQuantity={(q) => save([{ target: it.rows[0], quantity: q }])} />
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

      {open && (
        <CollectionSheet
          priceSource={priceSource}
          card={open}
          rows={collection.owned.get(open.oracle_id) ?? []}
          onSet={save}
          onClose={() => setOpen(null)}
          locations={locations.ready ? locations.list : []}
          addTo={addTo}
          onCover={
            loc
              ? (row) =>
                  void locations
                    .update(loc.id, { style: { cover: { oracle_id: row.oracle_id, printing_id: row.printing_id, image_v: row.printing_info?.image_v ?? null, artist: row.printing_info?.artist ?? null } } })
                    .then((m) => setMessage(m ?? `${open.name} is now the cover of ${loc.name}.`))
              : undefined
          }
        />
      )}
      {dragging > 0 && locations.list.length > 0 && <DropTray count={dragging} locations={locations.list} onDrop={dropOn} />}
      {selecting && !dragging && (
        <SelectBar
          count={selectedItems.length}
          copies={selectedItems.reduce((n, it) => n + it.quantity, 0)}
          shown={ordered.length}
          here={selectedItems.length ? placeOf(selectedItems) : undefined}
          locations={locations.list}
          onAll={() => setSelected(new Set(ordered.map((it) => it.key)))}
          onNone={() => setSelected(new Set())}
          onMove={(to) => void moveKeys([...selected], to)}
          onNew={() => {
            setMoveAfterNew([...selected]);
            setNewLocation(true);
          }}
          onDone={endSelect}
        />
      )}
      {menu && (
        <MoveMenu
          x={menu.x}
          y={menu.y}
          title={menu.keys.length === 1 ? (byKey.get(menu.keys[0])?.card.name ?? "Card") : `${menu.keys.length} selected cards`}
          count={menu.keys.length}
          here={placeOf(itemsOf(menu.keys))}
          locations={locations.list}
          onMove={(to) => void moveKeys(menu.keys, to)}
          onNew={() => {
            setMoveAfterNew(menu.keys);
            setMenu(null);
            setNewLocation(true);
          }}
          onOpen={
            menu.keys.length === 1
              ? () => {
                  const it = byKey.get(menu.keys[0]);
                  setMenu(null);
                  if (it) setOpen(it.card);
                }
              : undefined
          }
          onSelect={
            selecting
              ? undefined
              : () => {
                  setSelecting(true);
                  setSelected(new Set(menu.keys));
                  setMenu(null);
                }
          }
          onClose={closeMenu}
        />
      )}
      {newLocation && (
        <NewLocation
          locations={locations.list}
          onClose={() => {
            setNewLocation(false);
            setMoveAfterNew(null);
          }}
          onCreate={async (name, kind) => {
            const made = await locations.create(name, kind);
            if (typeof made === "string") return made;
            setNewLocation(false);
            if (moveAfterNew) {
              // Made from a Move to menu: put the cards in, stay where you are.
              await moveKeys(moveAfterNew, made.id);
              setMoveAfterNew(null);
            } else setWhere(made.id);
            return null;
          }}
        />
      )}
      {loc && customizing && (
        <CustomizeLocation
          loc={loc}
          locations={locations.list}
          cards={cards}
          copies={counts.get(loc.id) ?? 0}
          onSave={(patch) => locations.update(loc.id, patch)}
          onMove={(step) => void locations.reorder(loc.id, step).then((m) => m && setMessage(m))}
          onDelete={async () => {
            const r = await locations.remove(loc.id);
            if (typeof r === "string") return setMessage(r);
            setCustomizing(false);
            setWhere("all");
            collection.reload();
            setMessage(`Deleted ${loc.name}.${r ? ` Its ${r} ${r === 1 ? "copy is" : "copies are"} in Unsorted now.` : ""}`);
          }}
          onClose={() => setCustomizing(false)}
        />
      )}
    </main>
  );
}

function Toolbar({
  prefs,
  setPrefs,
  layout,
  layouts,
  setLayout,
  filter,
  setFilter,
  query,
  setQuery,
  selecting,
  onSelect,
}: {
  selecting: boolean;
  onSelect: () => void;
  prefs: CollectionPrefs;
  setPrefs: (p: Partial<CollectionPrefs>) => void;
  layout: LocationLayout;
  /** The collection's three views, or inside a binder also Binder pages. */
  layouts: Partial<Record<LocationLayout, string>>;
  setLayout: (l: LocationLayout) => void;
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
        {(Object.keys(layouts) as LocationLayout[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={layout === v}
            onClick={() => setLayout(v)}
            className={`min-h-11 px-3 text-sm ${layout === v ? "bg-gold/20 font-medium text-gold" : "hover:bg-foreground/10"}`}
          >
            {layouts[v]}
          </button>
        ))}
      </div>
      {layout !== "pages" && (
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
      )}
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
      <button
        type="button"
        aria-pressed={selecting}
        onClick={onSelect}
        title="Pick several cards, then move them to a binder or box. Ctrl or Cmd-click a card does the same."
        className={`min-h-11 rounded-md border px-3 text-sm ${selecting ? "border-sky-400 bg-sky-400/15 text-sky-700 dark:text-sky-300" : "border-foreground/20 hover:bg-foreground/10"}`}
      >
        {selecting ? "✓ Selecting" : "☑ Select"}
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
function Badges({ item, selected }: { item: CollectionItem; selected?: boolean }) {
  return (
    <>
      {selected && (
        <>
          <span className="pointer-events-none absolute inset-0 rounded-[4.75%/3.5%] ring-4 ring-inset ring-sky-400" />
          <span aria-hidden className="pointer-events-none absolute bottom-[8%] right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-sm font-bold text-white shadow">
            ✓
          </span>
        </>
      )}
      {item.quantity > 1 && <span className="pointer-events-none absolute right-1.5 top-[7%] rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">×{item.quantity}</span>}
      {!item.rows.some((r) => r.printing_id) && (
        <span title="Printing unknown" className="pointer-events-none absolute left-1.5 top-[7%] rounded bg-orange-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          ?
        </span>
      )}
    </>
  );
}

function Tile({ item, bind, selected }: { item: CollectionItem; bind: CardBind; selected: boolean }) {
  return (
    <button type="button" {...bind} title={`${item.card.name} · ${item.label}`} className="block w-full rounded-lg text-left hover:brightness-110">
      <span className={`relative block ${item.foil ? "foil-sheen" : ""}`}>
        <img src={item.image ?? undefined} alt={item.card.name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%]" />
        <Badges item={item} selected={selected} />
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-1 text-xs">
        <span className="truncate opacity-80">{item.label}</span>
        <span className="shrink-0 tabular-nums opacity-80">{money(item.unitPrice)}</span>
      </span>
    </button>
  );
}

/** One card in a binder pocket: the whole pocket opens it. */
function Pocket({ item, bind, selected }: { item: CollectionItem; bind: CardBind; selected: boolean }) {
  return (
    <button type="button" {...bind} title={`${item.card.name} · ${item.label}`} className={`relative block h-full w-full rounded-[5%/3.6%] hover:brightness-110 ${item.foil ? "foil-sheen" : ""}`}>
      <img src={item.image ?? undefined} alt={item.card.name} loading="lazy" draggable={false} width={244} height={340} className="block h-full w-full rounded-[4.75%/3.5%] object-cover" />
      <Badges item={item} selected={selected} />
    </button>
  );
}

function Stack({ items, bind, selected }: { items: CollectionItem[]; bind: (it: CollectionItem) => CardBind; selected: Set<string> }) {
  return (
    <ul className="flex flex-col pb-2">
      {items.map((it, i) => (
        <li key={it.key} style={{ marginTop: i === 0 ? 0 : "-124%" }} className="relative">
          <button type="button" {...bind(it)} title={`${it.card.name} · ${it.label}`} className={`relative block w-full rounded-[5%/3.6%] hover:brightness-125 ${it.foil ? "foil-sheen" : ""}`}>
            <img src={it.image ?? undefined} alt={it.card.name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%]" />
            <Badges item={it} selected={selected.has(it.key)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TextRow({ item, bind, selected, onQuantity }: { item: CollectionItem; bind: CardBind; selected: boolean; onQuantity: (q: number) => void }) {
  const single = item.rows.length === 1;
  return (
    <li className={`flex min-h-12 items-center gap-2 px-3 py-1 text-sm ${selected ? "bg-sky-400/15 shadow-[inset_4px_0_0_#38bdf8]" : ""}`}>
      <button type="button" {...bind} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left hover:text-gold">
        {selected && (
          <span aria-hidden className="text-sky-500">
            ✓
          </span>
        )}
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

function ImportPanel({ open, onClose, onImport }: { open: boolean; onClose?: () => void; onImport: (text: string, mode: "add" | "replace") => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  if (!open) return result ? <p className="mt-2 text-sm opacity-85">{result}</p> : null;
  return (
    <section aria-label="Import a collection" className="panel mt-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="display text-xl">Import cards</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close import" className="btn min-h-10 min-w-10">
            ✕
          </button>
        )}
      </div>
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
            if (r?.startsWith("Imported")) {
              setText("");
              onClose?.();
            }
          }}
          className="btn btn-gold min-h-10 px-4 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {result && <p className="mt-2 text-sm opacity-85">{result}</p>}
    </section>
  );
}
