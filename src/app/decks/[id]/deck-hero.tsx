"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ManaSymbol } from "@/components/mana-cost";
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
  themes,
  note,
  status,
  actions,
  onOpenCommander,
  wide,
  coverArt,
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
  /** The deck's top themes, in words. */
  themes: string[];
  note?: React.ReactNode;
  status?: React.ReactNode;
  actions: React.ReactNode;
  onOpenCommander: (index: number) => void;
  /** No docked preview: the page runs the full width of the screen. */
  wide?: boolean;
  /** Art the owner picked for this deck, instead of the commander's. */
  coverArt?: string | null;
}) {
  const art = coverArt || commanders.find((c) => c.image_art_crop)?.image_art_crop;
  const pips = identity ? WUBRG.filter((c) => identity.has(c)) : [];
  return (
    <header className="relative isolate z-30 border-b border-foreground/10">
      {/* The art sits in its own clipped layer, so the More menu can hang outside the hero. */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        {art && <img src={art} alt="" className="h-full w-full scale-105 object-cover object-[center_25%] opacity-75" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/65 to-background/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/30 to-transparent" />
        {celebrate && <div className="shimmer absolute inset-0" />}
      </div>
      <div className={`mx-auto flex ${wide ? "" : "max-w-[1500px]"} items-end gap-5 px-4 pb-4 sm:px-6 ${art ? "pt-2 lg:pt-8" : "pt-2 sm:pt-4"}`}>
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
          <h1 className="display text-3xl leading-tight [text-shadow:0_2px_16px_var(--art-shadow)] lg:text-5xl">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 [text-shadow:0_1px_8px_var(--art-shadow)]">
            {pips.length > 0 && (
              <span className="inline-flex gap-1">
                {pips.map((c) => (
                  <ManaSymbol key={c} symbol={c} size={20} />
                ))}
              </span>
            )}
            {commanders.length > 0 && <span className="min-w-0 opacity-90">{commanders.map((c) => c.name).join(" & ")}</span>}
          </div>
          {note}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {complete && <span className={`${celebrate ? "complete " : ""}inline-flex min-h-9 items-center rounded-lg bg-gold px-3 font-semibold text-gold-ink`}>✦ Complete</span>}
            <Stat good={size === 100}>
              <span key={size} className="pop inline-block">
                {size} / 100
              </span>
            </Stat>
            <Stat>${price.toFixed(0)}</Stat>
            {status}
          </div>
          {themes.length > 0 && (
            <p className="mt-2 hidden text-sm [text-shadow:0_1px_8px_var(--art-shadow)] sm:block">
              <span className="opacity-75">Plays: </span>
              {themes.join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">{actions}</div>
        </div>
      </div>
    </header>
  );
}

function Stat({ good, children }: { good?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex min-h-9 items-center rounded-lg bg-background/65 px-3 font-semibold tabular-nums backdrop-blur ${good ? "text-green-400" : ""}`}>
      {children}
    </span>
  );
}

/** Less frequent tools, one click away. Closes on picking, clicking elsewhere, or Esc. */
export function MoreMenu({ items }: { items: { key: string; label: string; active?: boolean; onPick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        More <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="panel absolute right-0 z-40 mt-1 w-44 overflow-hidden bg-panel-raised py-1 shadow-2xl sm:left-0 sm:right-auto">
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                i.onPick();
              }}
              className={`block min-h-11 w-full px-4 text-left text-sm hover:bg-foreground/10 ${i.active ? "text-gold" : ""}`}
            >
              {i.label}
            </button>
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
