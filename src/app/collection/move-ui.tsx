"use client";

// Moving cards between binders and boxes on the Collection page (David, Nov 25, 2026: moving was too hard).
// Three ways, all ending in planMoveCounts (src/lib/deck/locations.ts), one save per move:
// - drag a card (or every selected card) onto a binder chip or onto the tray that rises while dragging;
// - right-click a card for a Move to menu;
// - Select, tap cards (or Ctrl/Cmd-click), then Move to in the bar at the bottom. This is the way on phones.
// Whenever a card being moved has more than one copy, HowMany asks how many (all by default), also in the card sheet.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GlassOverlay } from "@/app/decks/[id]/glass-overlay";
import type { CollectionLocation } from "@/lib/deck/locations";
import { LOCATION_KINDS } from "@/lib/deck/locations";

/** Drag type for cards moved inside the page, so the Scryfall drop overlay ignores them. */
export const MOVE_TYPE = "application/x-ctw-collection";

const dot = (color: string) => <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full border border-white/30" style={{ backgroundColor: color }} />;

/** Big drop targets fixed at the bottom while a card is being dragged, so they're there however far you scrolled. */
export function DropTray({ count, locations, onDrop }: { count: number; locations: CollectionLocation[]; onDrop: (to: string | null) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const zone = (id: string, to: string | null, label: ReactNode) => (
    <div
      key={id}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MOVE_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(id);
      }}
      onDragLeave={() => setOver((o) => (o === id ? null : o))}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(MOVE_TYPE)) return;
        e.preventDefault();
        setOver(null);
        onDrop(to);
      }}
      className={`flex min-h-14 min-w-36 shrink-0 items-center gap-2 rounded-lg border-2 border-dashed px-4 text-sm ${over === id ? "border-sky-400 bg-sky-400/25" : "border-foreground/30 bg-background"}`}
    >
      {label}
    </div>
  );
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background/95 p-3 shadow-2xl backdrop-blur">
      <p className="mb-2 text-sm font-medium">
        Drop to move {count === 1 ? "this card" : `${count} cards`} to…
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {locations.map((l) =>
          zone(
            l.id,
            l.id,
            <>
              {dot(l.style.color)}
              <span className="max-w-[12rem] truncate">{l.name}</span>
            </>,
          ),
        )}
        {zone("", null, <span>Unsorted</span>)}
      </div>
    </div>
  );
}

/** Where a set of cards can go: every binder and box, then Unsorted. `here` greys out the one they're all in. */
function Destinations({ locations, here, onMove }: { locations: CollectionLocation[]; here: string | null | undefined; onMove: (to: string | null) => void }) {
  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-foreground/10 disabled:opacity-40";
  return (
    <>
      {locations.map((l) => (
        <button key={l.id} type="button" disabled={here === l.id} onClick={() => onMove(l.id)} className={item}>
          {dot(l.style.color)}
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
          <span aria-hidden className="opacity-60">
            {LOCATION_KINDS[l.kind].icon}
          </span>
        </button>
      ))}
      <button type="button" disabled={here === null} onClick={() => onMove(null)} className={item}>
        <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-foreground/40" />
        Unsorted
      </button>
    </>
  );
}

/** Right-click menu on a card. */
export function MoveMenu({
  x,
  y,
  title,
  count,
  here,
  locations,
  onMove,
  onNew,
  onOpen,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  count: number;
  /** The location every copy is already in, null = all in Unsorted, undefined = mixed. */
  here: string | null | undefined;
  locations: CollectionLocation[];
  onMove: (to: string | null) => void;
  onNew: () => void;
  onOpen?: () => void;
  onSelect?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (el) setPos({ left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-foreground/10";
  return (
    <div ref={ref} role="menu" aria-label={`Move ${title}`} style={pos} className="panel fixed z-50 max-h-[80vh] w-64 overflow-y-auto p-1 shadow-2xl">
      <p className="truncate px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide opacity-60">{title}</p>
      {onOpen && (
        <button type="button" onClick={onOpen} className={item}>
          Open card
        </button>
      )}
      {onSelect && (
        <button type="button" onClick={onSelect} className={item}>
          ☑ Select more cards
        </button>
      )}
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide opacity-60">Move {count === 1 ? "it" : `${count} cards`} to</p>
      <Destinations locations={locations} here={here} onMove={onMove} />
      <button type="button" onClick={onNew} className={`${item} text-gold`}>
        ＋ New binder or box…
      </button>
    </div>
  );
}

/** The bar at the bottom while selecting. */
export function SelectBar({
  count,
  copies,
  shown,
  here,
  locations,
  onAll,
  onNone,
  onMove,
  onNew,
  onDone,
}: {
  count: number;
  copies: number;
  shown: number;
  here: string | null | undefined;
  locations: CollectionLocation[];
  onAll: () => void;
  onNone: () => void;
  onMove: (to: string | null) => void;
  onNew: () => void;
  onDone: () => void;
}) {
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (picking ? setPicking(false) : onDone());
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picking, onDone]);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background/95 p-3 shadow-2xl backdrop-blur">
      {picking && count > 0 && (
        <div className="panel mx-auto mb-2 max-h-[50vh] max-w-md overflow-y-auto p-1">
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide opacity-60">
            Move {count === 1 ? "1 card" : `${count} cards`} ({copies} {copies === 1 ? "copy" : "copies"}) to
          </p>
          <Destinations
            locations={locations}
            here={here}
            onMove={(to) => {
              setPicking(false);
              onMove(to);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setPicking(false);
              onNew();
            }}
            className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm text-gold hover:bg-foreground/10"
          >
            ＋ New binder or box…
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-medium">{count ? `${count} selected` : "Tap cards to select them"}</span>
        <button type="button" onClick={count === shown ? onNone : onAll} className="btn min-h-11 px-3 text-sm">
          {count === shown && shown > 0 ? "Select none" : `Select all ${shown}`}
        </button>
        <button type="button" disabled={!count} aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="btn btn-gold min-h-11 px-4 text-sm disabled:opacity-50">
          Move to… ▴
        </button>
        <button type="button" onClick={onDone} className="btn ml-auto min-h-11 px-4 text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

export type HowManyLine = { key: string; name: string; image: string | null; max: number };

/**
 * How many copies to move, asked whenever a card being moved has more than one copy (David, Nov 25, 2026).
 * Every card starts at all its copies, so Move straight away does what a drag always did.
 */
export function HowMany({ lines, toName, onConfirm, onCancel }: { lines: HowManyLine[]; toName: string; onConfirm: (counts: Record<string, number>) => void; onCancel: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.key, l.max])));
  const total = lines.reduce((n, l) => n + (counts[l.key] ?? 0), 0);
  const set = (key: string, max: number, v: number) => setCounts((c) => ({ ...c, [key]: Math.max(0, Math.min(max, Number.isFinite(v) ? Math.round(v) : 0)) }));
  const step = "min-h-11 min-w-11 rounded-md border border-foreground/20 text-lg disabled:opacity-40";
  return (
    <GlassOverlay label="How many to move" paused={false} onClose={onCancel}>
      <form
        className="panel mx-auto max-w-md p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (total > 0) onConfirm(counts);
        }}
      >
        <h2 className="display text-2xl">How many?</h2>
        <p className="mt-1 text-sm opacity-80">Moving to {toName}. Every card starts at all its copies.</p>
        <ul className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto">
          {lines.map((l) => {
            const v = counts[l.key] ?? 0;
            return (
              <li key={l.key} className="flex items-center gap-3">
                {l.image && <img src={l.image} alt="" width={40} height={56} draggable={false} className="h-14 w-10 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="text-xs opacity-70">
                    {l.max} {l.max === 1 ? "copy" : "copies"}
                  </span>
                </span>
                {l.max > 1 ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label={`One fewer ${l.name}`} disabled={v <= 0} onClick={() => set(l.key, l.max, v - 1)} className={step}>
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={l.max}
                      value={v}
                      aria-label={`Copies of ${l.name} to move`}
                      onChange={(e) => set(l.key, l.max, e.target.valueAsNumber)}
                      onFocus={(e) => e.target.select()}
                      className="min-h-11 w-14 rounded-md border border-foreground/20 bg-transparent text-center tabular-nums"
                    />
                    <button type="button" aria-label={`One more ${l.name}`} disabled={v >= l.max} onClick={() => set(l.key, l.max, v + 1)} className={step}>
                      +
                    </button>
                  </span>
                ) : (
                  <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm">
                    <input type="checkbox" checked={v === 1} onChange={(e) => set(l.key, 1, e.target.checked ? 1 : 0)} className="h-5 w-5 accent-gold" />
                    Move
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex gap-2">
          <button type="submit" autoFocus disabled={total === 0} className="btn btn-gold min-h-11 flex-1 px-4 disabled:opacity-50">
            Move {total} {total === 1 ? "copy" : "copies"}
          </button>
          <button type="button" onClick={onCancel} className="btn min-h-11 px-4">
            Cancel
          </button>
        </div>
      </form>
    </GlassOverlay>
  );
}
