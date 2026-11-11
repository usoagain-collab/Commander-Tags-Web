"use client";

// Find cards (Nov 11, 2026): the pieces Search and Suggest share, so both tabs look and work the same.
// One result tile (the image and name open the card sheet; the buttons sit under the image, never on it),
// one grid, and the "Showing" line that says in words what the list below is.
import type { ReactNode } from "react";
import type { Board, CardSummary } from "@/lib/deck/model";
import { statusLabel } from "@/lib/deck/model";

/** The grid every result list uses: two columns on phones, as many 170 px columns as fit above that. */
export const RESULT_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4";

export function ResultCard({
  name,
  image,
  card,
  inDeck = 0,
  best,
  onOpen,
  onPreview,
  onAdd,
  wish,
  onDismiss,
  pending,
  children,
}: {
  name: string;
  image: string | null | undefined;
  /** The card as our data knows it. Missing while a search result is being matched, or for a brand-new card. */
  card?: CardSummary;
  /** Copies already in the deck (commander, companion and mainboard). */
  inDeck?: number;
  best?: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onAdd: (board: Board) => void;
  wish?: { on: boolean; toggle: () => void };
  /** Suggestions only: Not for this deck. */
  onDismiss?: () => void;
  /** Shown in place of the buttons when `card` is missing (Matching…, or fetch a new card). */
  pending?: ReactNode;
  /** Why it's here: shared themes, roles it fills, wording, bracket warnings. */
  children?: ReactNode;
}) {
  const price = card?.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : card ? "no price" : null;
  const rank = card ? (card.edhrec_rank ? `EDHREC #${card.edhrec_rank.toLocaleString()}` : "unranked") : null;
  return (
    <li data-preview-card className="relative flex flex-col gap-2" onMouseEnter={onPreview}>
      {best && <span className="pointer-events-none absolute -left-1 top-3 z-10 rounded-r-md bg-gold px-2 py-0.5 text-xs font-bold text-gold-ink shadow-lg">Best match</span>}
      <button
        type="button"
        onClick={card ? onOpen : undefined}
        onFocus={onPreview}
        disabled={!card}
        title={card ? `Open ${name}: the full card, rules text and tags` : undefined}
        className="group block text-left disabled:cursor-default"
      >
        <span className="card-lift relative block rounded-[4.75%/3.5%]">
          {image ? (
            <img src={image} alt={name} loading="lazy" draggable={false} width={244} height={340} className="w-full rounded-[4.75%/3.5%] shadow" />
          ) : (
            <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/15 p-2 text-center text-sm">{name}</span>
          )}
          {inDeck > 0 && (
            <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-green-700 px-1.5 py-0.5 text-xs font-medium text-white">
              In deck{inDeck > 1 ? ` ×${inDeck}` : ""}
            </span>
          )}
          {card && statusLabel(card) && <StatusBadge card={card} className="pointer-events-none absolute bottom-1.5 left-1.5" />}
        </span>
        <span className="mt-1.5 block min-w-0 text-sm">
          <span className="block truncate font-medium group-hover:underline" title={name}>
            {name}
          </span>
          {card && (
            <span className="block text-[13px] tabular-nums opacity-80">
              {price} · <span className="whitespace-nowrap">{rank}</span>
            </span>
          )}
        </span>
      </button>
      {children && <div className="min-w-0 text-sm">{children}</div>}
      {card ? (
        <div className="mt-auto grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onAdd("main")} title={`Add ${name} to the mainboard`} className="btn btn-gold min-h-11 whitespace-nowrap px-1">
            + Main
          </button>
          <button
            type="button"
            onClick={() => onAdd("maybe")}
            title={`Add ${name} to the maybeboard`}
            className="min-h-11 whitespace-nowrap rounded-lg border border-foreground/20 px-1 text-sm hover:bg-foreground/10"
          >
            + Maybe
          </button>
          {(wish || onDismiss) && (
            <div className={`col-span-2 grid gap-2 ${wish && onDismiss ? "grid-cols-[auto_minmax(0,1fr)]" : ""}`}>
              {wish && (
                <button
                  type="button"
                  onClick={wish.toggle}
                  aria-pressed={wish.on}
                  aria-label={wish.on ? `Take ${name} off your wish list` : `Add ${name} to your wish list`}
                  title={wish.on ? "On your wish list" : "Add to your wish list"}
                  className={`min-h-10 rounded-lg border px-3 text-sm hover:bg-foreground/10 ${wish.on ? "border-gold text-gold" : "border-foreground/20"}`}
                >
                  {wish.on ? "♥" : "♡"}
                  {!onDismiss && <span className="ml-1.5">{wish.on ? "On your wish list" : "Wish list"}</span>}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  title="Don't suggest this card for this deck again"
                  className="min-h-10 rounded-lg px-2 text-[13px] opacity-75 hover:bg-foreground/10 hover:opacity-100"
                >
                  Not for this deck
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-auto">{pending}</div>
      )}
    </li>
  );
}

/**
 * "Showing: …" above a result list: what the list is, in words, with ✕ to step back (to the whole-deck picks,
 * or to an empty search). The same line in both tabs.
 */
export function ShowingChip({ label, detail, onClear, clearLabel }: { label: ReactNode; detail?: ReactNode; onClear?: () => void; clearLabel?: string }) {
  return (
    <div className="mt-3 flex min-h-11 items-center gap-2 rounded-lg bg-foreground/5 py-1 pl-3 pr-1 text-sm">
      <p className="min-w-0 flex-1">
        <span className="opacity-60">Showing </span>
        <span className="font-medium">{label}</span>
        {detail && <span className="opacity-60"> · {detail}</span>}
      </p>
      {onClear && (
        <button type="button" onClick={onClear} aria-label={clearLabel ?? "Clear"} title={clearLabel} className="min-h-10 min-w-10 shrink-0 rounded-lg opacity-70 hover:bg-foreground/10 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}

/** "Banned" or "Preview" on a card that isn't Commander-legal (yet). */
export function StatusBadge({ card, className = "" }: { card: CardSummary; className?: string }) {
  const label = statusLabel(card);
  if (!label) return null;
  return (
    <span
      title={label === "Banned" ? "Banned in Commander" : "Not released yet: legal in Commander from its release day"}
      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${label === "Banned" ? "bg-red-700 text-white" : "bg-sky-600 text-white"} ${className}`}
    >
      {label}
    </span>
  );
}
