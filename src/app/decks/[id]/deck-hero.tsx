"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ManaSymbol } from "@/components/mana-cost";
import { ManaConfetti } from "./mana-confetti";
import { ArtCredit } from "@/components/art-credit";
import type { CardSummary } from "@/lib/deck/model";

const WUBRG = ["W", "U", "B", "R", "G"];

/** The top of a deck page: the commander's art behind the deck's name, its colors and headline numbers. */
export function DeckHero({
  name,
  commanders,
  identity,
  size,
  price,
  backLink,
  complete,
  celebrate,
  plays,
  note,
  status,
  actions,
  onOpenCommander,
  wide,
  coverArt,
  coverArtist,
  genome,
  onRename,
  aboutLink,
}: {
  name: string;
  commanders: CardSummary[];
  identity: Set<string> | null;
  size: number;
  price: number;
  backLink: boolean;
  /** 100 cards and every role target met. */
  complete: boolean;
  /** Just became complete: one shimmer across the banner. */
  celebrate: boolean;
  /** The Plays line (archetype, own words, tags). Hidden on phones. */
  plays?: React.ReactNode;
  note?: React.ReactNode;
  status?: React.ReactNode;
  actions: React.ReactNode;
  onOpenCommander: (index: number) => void;
  /** No docked preview: the page runs the full width of the screen. */
  wide?: boolean;
  /** Art the owner picked for this deck, instead of the commander's. */
  coverArt?: string | null;
  /** Illustrator of coverArt, for the art credit. */
  coverArtist?: string | null;
  /** The genome strip, drawn full width along the bottom of the banner. */
  genome?: React.ReactNode;
  /** Owners: click the name to rename the deck here (David, Nov 21, 2026: it only lived on My decks). Returns an error. */
  onRename?: (name: string) => Promise<string | null>;
  /** A link down to the About this deck section at the bottom of the page. */
  aboutLink?: boolean;
}) {
  const artCard = commanders.find((c) => c.image_art_crop);
  const art = coverArt || artCard?.image_art_crop;
  const artist = coverArt ? coverArtist : artCard?.artist;
  const pips = identity ? WUBRG.filter((c) => identity.has(c)) : [];
  return (
    <header className="relative isolate z-30 border-b border-foreground/10">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: "linear-gradient(90deg, var(--deck-accent, transparent), var(--deck-accent-2, transparent))", opacity: 0.8 }} />
      {/* The art sits in its own clipped layer, so the More menu can hang outside the hero. */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        {art && <img src={art} alt="" className="h-full w-full scale-105 object-cover object-[center_25%] opacity-75" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/65 to-background/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/30 to-transparent" />
        {/* The commander's colors glow up from the bottom corners (gamer look, v2). */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 70% at 8% 105%, color-mix(in srgb, var(--deck-accent, transparent) 30%, transparent), transparent), radial-gradient(50% 65% at 92% 105%, color-mix(in srgb, var(--deck-accent-2, transparent) 24%, transparent), transparent)",
          }}
        />
        {celebrate && <div className="shimmer absolute inset-0" />}
      </div>
      <div className={`mx-auto flex flex-wrap ${wide ? "" : "max-w-[1500px]"} items-end gap-x-5 gap-y-3 px-4 pb-3 sm:px-6 ${art ? "pt-2 lg:pt-6" : "pt-2 sm:pt-4"}`}>
        {commanders.length > 0 && (
          <div className="hidden shrink-0 md:flex lg:hidden">
            {commanders.map((c, i) => (
              <button
                key={c.oracle_id}
                type="button"
                onClick={() => onOpenCommander(i)}
                title={`Open ${c.name}`}
                className={`card-lift w-32 rounded-[4.75%/3.5%] shadow-2xl ${i > 0 ? "-ml-24" : ""}`}
              >
                {c.image_normal && <img src={c.image_normal} alt={c.name} className="w-full rounded-[4.75%/3.5%]" />}
              </button>
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {backLink && (
            <Link href="/decks" className="-ml-1 inline-flex min-h-9 items-center px-1 text-sm opacity-85 hover:opacity-100">
              ← My decks
            </Link>
          )}
          {/* Design refresh (option E): the commander and colors sit above the name, the numbers beside them. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 [text-shadow:0_1px_8px_var(--art-shadow)]">
            {pips.length > 0 && (
              <span className="inline-flex gap-1">
                {pips.map((c) => (
                  <ManaSymbol key={c} symbol={c} size={18} />
                ))}
              </span>
            )}
            {commanders.length > 0 && <span className="eyebrow min-w-0 !text-gold">{commanders.map((c) => c.name).join(" & ")}</span>}
          </div>
          <DeckName name={name} onRename={onRename} />
          {note}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {complete && <span className={`${celebrate ? "complete " : ""}inline-flex min-h-9 items-center rounded-full bg-gold px-3 font-semibold text-gold-ink`}>✦ Complete</span>}
            <Stat good={size === 100}>
              <span key={size} className="pop inline-block">
                {size} / 100
              </span>
            </Stat>
            <Stat>${price.toFixed(0)}</Stat>
            {status}
            {aboutLink && (
              <a href="#about" className="inline-flex min-h-9 items-center rounded-full px-2 underline opacity-85 [text-shadow:0_1px_8px_var(--art-shadow)] hover:opacity-100">
                About this deck ↓
              </a>
            )}
          </div>
          {plays && <div className="hidden sm:block">{plays}</div>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:gap-2 lg:w-auto lg:max-w-[46%] lg:justify-end">{actions}</div>
      </div>
      {(genome || art) && (
        <div className={`mx-auto ${wide ? "" : "max-w-[1500px]"} px-4 pb-3 sm:px-6`}>
          {genome}
          {art && <ArtCredit artists={[artist]} className="mt-1.5 [text-shadow:0_1px_8px_var(--art-shadow)]" />}
        </div>
      )}
      {celebrate && <ManaConfetti colors={pips.length ? pips : ["C"]} />}
    </header>
  );
}

const NAME_CLASS = "display mt-1 text-3xl leading-tight [text-shadow:0_2px_16px_var(--art-shadow)] lg:text-[2.6rem]";

/** The deck's name. With onRename, a click turns it into a box: Enter or Save keeps it, Esc or Cancel doesn't. */
function DeckName({ name, onRename }: { name: string; onRename?: (name: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [shown, setShown] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => setShown(name), [name]);
  useEffect(() => {
    if (editing) box.current?.select();
  }, [editing]);

  if (!onRename) return <h1 className={NAME_CLASS}>{shown}</h1>;
  if (!editing)
    return (
      <h1 className={NAME_CLASS}>
        <button
          type="button"
          onClick={() => {
            setDraft(shown);
            setError(null);
            setEditing(true);
          }}
          title="Rename this deck"
          className="group text-left"
        >
          {shown}
          <span aria-hidden className="ml-2 align-middle text-base opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70 [@media(hover:none)]:opacity-60">
            ✎
          </span>
          <span className="sr-only"> (rename)</span>
        </button>
      </h1>
    );

  const save = async () => {
    const next = draft.trim().slice(0, 120);
    if (!next) return setError("A deck needs a name.");
    if (next === shown) return setEditing(false);
    setBusy(true);
    const problem = await onRename(next);
    setBusy(false);
    if (problem) return setError(problem);
    setShown(next);
    setEditing(false);
  };
  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        ref={box}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        maxLength={120}
        aria-label="Deck name"
        disabled={busy}
        className="display min-h-11 w-full max-w-xl rounded-lg border border-gold bg-background/80 px-3 text-2xl lg:text-3xl"
      />
      <button type="submit" disabled={busy} className="btn btn-gold min-h-11 px-4">
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={busy} className="btn min-h-11 px-4">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

function Stat({ good, children }: { good?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex min-h-9 items-center rounded-full bg-background/65 px-3 font-semibold tabular-nums backdrop-blur ${good ? "text-green-400" : ""}`}>
      {children}
    </span>
  );
}

export type MoreItem = { key: string; label: string; active?: boolean; onPick: () => void };
export type MoreGroup = { title: string; items: MoreItem[] };

/**
 * Less frequent tools, one click away, under short headings (two columns from 640 px, so the list stays short).
 * Opens toward the side of the screen with room and never runs past the bottom of the window (David, Nov 21, 2026:
 * it hung off the right edge on his laptop). Closes on picking, clicking elsewhere, or Esc.
 */
export function MoreMenu({ groups }: { groups: MoreGroup[] }) {
  const [place, setPlace] = useState<{ left: number; width: number; maxHeight: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const open = place !== null;
  const shown = groups.filter((g) => g.items.length > 0);

  function toggle() {
    if (open) return setPlace(null);
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const width = Math.min(vw >= 640 ? 496 : 240, vw - 16);
    // Hang from the button's right edge when it's in the right half of the screen (the usual spot on wide screens),
    // its left edge otherwise, then nudge it so it stays 8 px inside the window either way.
    const want = r.left + r.width / 2 > vw / 2 ? r.right - width : r.left;
    const left = Math.max(8, Math.min(want, vw - width - 8));
    // Left is relative to the button's box, which the menu is positioned in.
    setPlace({ left: left - r.left, width, maxHeight: Math.max(240, window.innerHeight - r.bottom - 12) });
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setPlace(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPlace(null);
    const close = () => setPlace(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        More <span aria-hidden>▾</span>
      </button>
      {place && (
        <div
          role="menu"
          style={{ left: place.left, width: place.width, maxHeight: place.maxHeight }}
          className="panel absolute z-40 mt-1 overflow-y-auto overscroll-contain bg-panel-raised px-1 py-2 shadow-2xl sm:columns-2 sm:gap-1"
        >
          {shown.map((g) => (
            <div key={g.title} role="group" aria-label={g.title} className="mb-1 break-inside-avoid last:mb-0">
              <div className="eyebrow px-3 pb-0.5 pt-2 text-[11px] opacity-60">{g.title}</div>
              {g.items.map((i) => (
                <button
                  key={i.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlace(null);
                    i.onPick();
                  }}
                  className={`block min-h-11 w-full rounded-md px-3 text-left text-sm hover:bg-foreground/10 ${i.active ? "text-gold" : ""}`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A short confirmation over the page, with Undo when the last edit can be taken back. */
export function Toast({ message, onUndo }: { message: string | null; onUndo?: () => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-16 left-1/2 z-50 w-[min(92vw,34rem)] -translate-x-1/2">
      {message && (
        <div key={message} className="toast panel pointer-events-auto flex items-center gap-3 border-gold/50 bg-panel-raised px-4 py-2.5 text-sm shadow-2xl">
          <span className="min-w-0 flex-1">{message}</span>
          {onUndo && (
            <button type="button" onClick={onUndo} className="min-h-9 shrink-0 px-2 font-semibold text-gold hover:underline">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
