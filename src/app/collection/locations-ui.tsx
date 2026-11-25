"use client";

// Binders and boxes on the Collection page (v2, migration 0067): the location chips, a new-binder form, each
// binder's own header (color, texture, cover art, note), its Customize panel and the Binder pages layout.
// The look of a binder is the owner's: everything here reads LocationStyle (src/lib/deck/locations.ts).
import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { MOVE_TYPE } from "./move-ui";
import { ArtCredit } from "@/components/art-credit";
import { GlassOverlay } from "@/app/decks/[id]/glass-overlay";
import { COLLECTION_GROUP_LABELS, COLLECTION_SORT_LABELS, type CollectionItem } from "@/lib/deck/collection-view";
import {
  CARD_SIZE_LABELS,
  LAYOUT_LABELS,
  LOCATION_COLORS,
  LOCATION_KINDS,
  NOTE_MAX,
  POCKETS,
  TEXTURE_LABELS,
  binderPages,
  locationNameProblem,
  type CardSize,
  type CollectionLocation,
  type LocationKind,
  type LocationLayout,
  type LocationStyle,
  type LocationView,
  type PocketSize,
  type Texture,
} from "@/lib/deck/locations";
import type { CardSummary } from "@/lib/deck/model";
import { printingImage } from "@/lib/deck/printing";

/** The binder's cover color with its texture, as a CSS background. */
export function textureStyle(color: string, texture: Texture): CSSProperties {
  const shade = "linear-gradient(135deg, rgba(255,255,255,0.10), rgba(0,0,0,0.35))";
  if (texture === "leather")
    return { backgroundColor: color, backgroundImage: `radial-gradient(rgba(0,0,0,0.18) 1px, transparent 1.2px), ${shade}`, backgroundSize: "5px 5px, 100% 100%" };
  if (texture === "canvas")
    return {
      backgroundColor: color,
      backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0 1px, transparent 1px 4px), ${shade}`,
    };
  return { backgroundColor: color, backgroundImage: shade };
}

/** Grid column widths per card size (phones, then wide screens). */
export const SIZE_COLUMNS: Record<CardSize, string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(105px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(125px,1fr))]",
  medium: "grid-cols-[repeat(auto-fill,minmax(150px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
  large: "grid-cols-[repeat(auto-fill,minmax(200px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]",
};
export const SIZE_STACK: Record<CardSize, string> = {
  small: "[column-width:115px] sm:[column-width:140px]",
  medium: "[column-width:150px] sm:[column-width:190px]",
  large: "[column-width:200px] sm:[column-width:250px]",
};

export const Dot = ({ color }: { color: string }) => <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full border border-white/30" style={{ backgroundColor: color }} />;

export function LocationBar({
  locations,
  counts,
  total,
  view,
  onView,
  onNew,
  onDropCards,
}: {
  locations: CollectionLocation[];
  counts: Map<string, number>;
  total: number;
  view: LocationView;
  onView: (v: LocationView) => void;
  onNew: () => void;
  /** Cards from the page dropped on a chip: null = Unsorted. */
  onDropCards?: (to: string | null) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const chip = (on: boolean, id?: string) =>
    `flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm ${over === id && id !== undefined ? "border-sky-400 bg-sky-400/20 text-foreground" : on ? "border-gold bg-gold/15 font-medium text-gold" : "border-foreground/20 hover:bg-foreground/10"}`;
  const unsorted = counts.get("") ?? 0;
  // Drop targets for cards dragged from the page (Visual grid, Stacks, Text, Binder pages).
  const target = (id: string, to: string | null) =>
    onDropCards
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(MOVE_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(id);
          },
          onDragLeave: () => setOver((o) => (o === id ? null : o)),
          onDrop: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(MOVE_TYPE)) return;
            e.preventDefault();
            setOver(null);
            onDropCards(to);
          },
        }
      : {};
  return (
    <nav aria-label="Binders and boxes" className="mt-5 flex gap-2 overflow-x-auto pb-1">
      <button type="button" aria-pressed={view === "all"} onClick={() => onView("all")} className={chip(view === "all")}>
        All cards <span className="opacity-60">{total}</span>
      </button>
      {locations.map((l) => (
        <button key={l.id} type="button" aria-pressed={view === l.id} onClick={() => onView(l.id)} className={chip(view === l.id, l.id)} {...target(l.id, l.id)}>
          <Dot color={l.style.color} />
          <span className="max-w-[12rem] truncate">{l.name}</span>
          <span className="opacity-60">{counts.get(l.id) ?? 0}</span>
        </button>
      ))}
      {locations.length > 0 && (
        <button type="button" aria-pressed={view === "unsorted"} onClick={() => onView("unsorted")} className={chip(view === "unsorted", "")} {...target("", null)}>
          Unsorted <span className="opacity-60">{unsorted}</span>
        </button>
      )}
      <button type="button" onClick={onNew} className="flex min-h-11 shrink-0 items-center rounded-full border border-dashed border-foreground/30 px-3 text-sm hover:border-gold hover:text-gold">
        ＋ {locations.length ? "New binder or box" : "Sort into binders and boxes"}
      </button>
    </nav>
  );
}

export function NewLocation({ locations, onCreate, onClose }: { locations: CollectionLocation[]; onCreate: (name: string, kind: LocationKind) => Promise<string | null>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LocationKind>("binder");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <GlassOverlay label="New binder or box" paused={false} onClose={onClose}>
      <form
        className="panel mx-auto max-w-md p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = locationNameProblem(name, locations);
          if (problem) return setError(problem);
          setBusy(true);
          const failed = await onCreate(name, kind);
          setBusy(false);
          if (failed) setError(failed);
        }}
      >
        <h2 className="display text-2xl">New binder or box</h2>
        <p className="mt-1 text-sm opacity-80">Match your shelf: each one keeps its own cards, look and layout. Decks still count every copy you own.</p>
        <label className="mt-4 block text-sm font-medium">
          Name
          <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Blue binder, Trade box…" className="mt-1 min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3 font-normal" />
        </label>
        <div role="group" aria-label="Kind" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(LOCATION_KINDS) as LocationKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`btn min-h-14 flex-col gap-0.5 text-sm ${kind === k ? "border-gold text-gold" : ""}`}>
              <span aria-hidden className="text-lg">
                {LOCATION_KINDS[k].icon}
              </span>
              {LOCATION_KINDS[k].label}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn min-h-11 px-4">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
            {busy ? "Making it…" : "Make it"}
          </button>
        </div>
      </form>
    </GlassOverlay>
  );
}

/** The cover image of a binder, from its chosen card (art crop, so the artist is credited beside it). */
export function coverOf(style: LocationStyle, cards: Record<string, CardSummary>) {
  const c = style.cover;
  if (!c) return null;
  const card = cards[c.oracle_id];
  const image = c.printing_id ? printingImage(c.printing_id, "art_crop", "front", c.image_v) : card?.image_art_crop;
  if (!image) return null;
  return { image, artist: c.printing_id ? c.artist : (card?.artist ?? null), name: card?.name ?? "" };
}

export function LocationHeader({ loc, cards, copies, value, onCustomize }: { loc: CollectionLocation; cards: Record<string, CardSummary>; copies: number; value: string; onCustomize: () => void }) {
  const cover = coverOf(loc.style, cards);
  return (
    <header className="mt-4 overflow-hidden rounded-xl text-white shadow-lg" style={textureStyle(loc.style.color, loc.style.texture)}>
      <div className="relative flex min-h-36 flex-wrap items-end gap-4 p-4 sm:p-5">
        {cover && (
          <img src={cover.image} alt="" aria-hidden className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 object-cover opacity-55 [mask-image:linear-gradient(to_left,black_40%,transparent)]" />
        )}
        <div className="relative min-w-0 flex-1" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
          <p className="text-xs uppercase tracking-wider opacity-85">
            {LOCATION_KINDS[loc.kind].icon} {LOCATION_KINDS[loc.kind].label}
          </p>
          <h2 className="display text-3xl">{loc.name}</h2>
          {loc.style.note && <p className="mt-0.5 opacity-90">{loc.style.note}</p>}
          <p className="mt-1 text-sm opacity-90">
            {copies} {copies === 1 ? "copy" : "copies"} · about {value}
          </p>
        </div>
        <button type="button" onClick={onCustomize} className="relative min-h-11 rounded-md border border-white/40 bg-black/30 px-4 text-sm font-medium backdrop-blur hover:bg-black/45">
          ✎ Customize
        </button>
      </div>
      {cover && <ArtCredit artists={[cover.artist]} className="bg-black/40 px-4 py-1 text-right !opacity-90" />}
    </header>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-sm font-medium opacity-80">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ options, value, onChange }: { options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <>
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={`btn min-h-10 px-3 text-sm ${value === k ? "border-gold text-gold" : ""}`}>
          {options[k]}
        </button>
      ))}
    </>
  );
}

export function CustomizeLocation({
  loc,
  locations,
  cards,
  copies,
  onSave,
  onMove,
  onDelete,
  onClose,
}: {
  loc: CollectionLocation;
  locations: CollectionLocation[];
  cards: Record<string, CardSummary>;
  copies: number;
  onSave: (patch: { name?: string; kind?: LocationKind; style?: Partial<LocationStyle> }) => Promise<string | null>;
  onMove: (step: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(loc.name);
  const [note, setNote] = useState(loc.style.note);
  const [error, setError] = useState<string | null>(null);
  const s = loc.style;
  const save = async (patch: Parameters<typeof onSave>[0]) => setError(await onSave(patch));
  const index = locations.findIndex((l) => l.id === loc.id);
  const cover = coverOf(s, cards);
  return (
    <GlassOverlay label={`Customize ${loc.name}`} paused={false} onClose={onClose}>
      <div className="panel mx-auto max-w-2xl p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="display text-2xl">Customize</h2>
          <button type="button" onClick={onClose} className="btn min-h-11 px-4">
            Done
          </button>
        </div>
        <div className="mt-3 h-20 rounded-lg" style={textureStyle(s.color, s.texture)} aria-hidden />
        <div className="mt-4 space-y-3">
          <Row label="Name">
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() === loc.name) return;
                const problem = locationNameProblem(name, locations, loc.id);
                if (problem) return setError(problem);
                void save({ name });
              }}
              className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3"
            />
          </Row>
          <Row label="Note">
            <input
              value={note}
              maxLength={NOTE_MAX}
              placeholder="What's in it, where it sits…"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== s.note && void save({ style: { note } })}
              className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3"
            />
          </Row>
          <Row label="Kind">
            <Choice options={Object.fromEntries(Object.entries(LOCATION_KINDS).map(([k, v]) => [k, `${v.icon} ${v.label}`])) as Record<LocationKind, string>} value={loc.kind} onChange={(kind) => save({ kind })} />
          </Row>
          <Row label="Color">
            {LOCATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={s.color === c}
                onClick={() => save({ style: { color: c } })}
                className={`h-11 w-11 rounded-full border-2 ${s.color === c ? "border-gold" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="flex h-11 items-center gap-1 text-sm">
              <input type="color" value={s.color} onChange={(e) => save({ style: { color: e.target.value } })} aria-label="Any color" className="h-9 w-11 cursor-pointer rounded bg-transparent" />
              Any
            </label>
          </Row>
          <Row label="Cover">
            <Choice options={TEXTURE_LABELS} value={s.texture} onChange={(texture) => save({ style: { texture } })} />
          </Row>
          <Row label="Cover card">
            {cover ? (
              <>
                <span className="flex min-h-10 items-center text-sm">{cover.name || "Chosen card"}</span>
                <button type="button" onClick={() => save({ style: { cover: null } })} className="btn min-h-10 px-3 text-sm">
                  Remove
                </button>
              </>
            ) : (
              <span className="flex min-h-10 items-center text-sm opacity-75">Open any card in here and choose Use as cover.</span>
            )}
          </Row>
          <Row label="Layout">
            <Choice options={LAYOUT_LABELS} value={s.layout} onChange={(layout: LocationLayout) => save({ style: { layout } })} />
          </Row>
          {s.layout === "pages" && (
            <Row label="Pockets">
              <Choice
                options={Object.fromEntries(Object.entries(POCKETS).map(([k, [c, r]]) => [k, `${c * r} per page`])) as Record<PocketSize, string>}
                value={s.pockets}
                onChange={(pockets) => save({ style: { pockets } })}
              />
            </Row>
          )}
          {s.layout !== "pages" && s.layout !== "text" && (
            <Row label="Card size">
              <Choice options={CARD_SIZE_LABELS} value={s.size} onChange={(size) => save({ style: { size } })} />
            </Row>
          )}
          <Row label="Sort">
            <Choice options={COLLECTION_SORT_LABELS} value={s.sort} onChange={(sort) => save({ style: { sort } })} />
          </Row>
          {s.layout !== "pages" && (
            <Row label="Group">
              <Choice options={COLLECTION_GROUP_LABELS} value={s.group} onChange={(group) => save({ style: { group } })} />
            </Row>
          )}
          <Row label="Order">
            <button type="button" disabled={index <= 0} onClick={() => onMove(-1)} className="btn min-h-10 px-3 text-sm disabled:opacity-40">
              ← Earlier
            </button>
            <button type="button" disabled={index >= locations.length - 1} onClick={() => onMove(1)} className="btn min-h-10 px-3 text-sm disabled:opacity-40">
              Later →
            </button>
          </Row>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 border-t border-foreground/10 pt-4">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${loc.name}? ${copies ? `Its ${copies} ${copies === 1 ? "copy goes" : "copies go"} to Unsorted; nothing leaves your collection.` : "It's empty."}`)) onDelete();
            }}
            className="min-h-11 px-2 text-sm text-red-400 hover:underline"
          >
            Delete this {LOCATION_KINDS[loc.kind].label.toLowerCase()}…
          </button>
        </div>
      </div>
    </GlassOverlay>
  );
}

/** Pockets like a real binder: one page on phones, two facing pages from 1024 px. */
export function BinderPages({ items, style, renderPocket }: { items: CollectionItem[]; style: LocationStyle; renderPocket: (item: CollectionItem) => ReactNode }) {
  const pages = binderPages(items, style.pockets);
  const [spread, setSpread] = useState(0);
  const [cols, rows] = POCKETS[style.pockets];
  // Two pages per spread on wide screens; on narrow ones the second page is hidden, so step one at a time there.
  const wideStep = 2;
  const first = Math.min(spread, Math.max(0, pages.length - 1));
  const shown = [pages[first], pages[first + 1]].filter(Boolean);
  const page = (list: CollectionItem[], n: number, extra = "") => (
    <div key={n} className={`flex-1 rounded-lg bg-black/35 p-2 shadow-inner sm:p-3 ${extra}`}>
      <ol className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols * rows }, (_, i) => (
          <li key={i} className="aspect-[63/88] rounded-[5%/3.6%] border border-white/10 bg-white/5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)]">
            {list[i] && renderPocket(list[i])}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-center text-xs text-white/70">Page {n + 1}</p>
    </div>
  );
  return (
    <div className="mx-auto mt-3 max-w-5xl">
      <div className="rounded-xl p-2 shadow-lg sm:p-3" style={textureStyle(style.color, style.texture)}>
        <div className="flex gap-3">
          {shown.map((p, k) => page(p, first + k, k === 1 ? "hidden lg:block" : ""))}
        </div>
      </div>
      {pages.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={first === 0} onClick={() => setSpread((s) => Math.max(0, s - (isWide() ? wideStep : 1)))} className="btn min-h-11 px-4 disabled:opacity-40">
            ← Previous
          </button>
          <span className="tabular-nums opacity-80">
            {isWide() && shown.length > 1 ? `Pages ${first + 1}–${first + 2}` : `Page ${first + 1}`} of {pages.length}
          </span>
          <button
            type="button"
            disabled={first + (isWide() ? wideStep : 1) >= pages.length}
            onClick={() => setSpread((s) => Math.min(pages.length - 1, s + (isWide() ? wideStep : 1)))}
            className="btn min-h-11 px-4 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
