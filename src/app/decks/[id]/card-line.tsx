"use client";

import { ManaCost } from "@/components/mana-cost";
import type { DeckItem } from "./deck-views";
import { MyTagChips } from "./my-tags-ui";
import { roleColor } from "@/lib/tags/pretty";

type Props = {
  item: DeckItem;
  readOnly: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onHover: () => void;
  onQuantity: (n: number) => void;
  /** Drag-to-category handlers (Group by Role on desktop), or nothing. */
  drag?: React.HTMLAttributes<HTMLLIElement>;
};

/** One card in Text view. The name opens the card sheet; quick −/+/✕ sit at the end on wider screens. */
export function CardLine({ item, readOnly, onOpen, onHover, onQuantity, drag }: Props) {
  const { line, warnings, untagged, highlighted, roleNames, myTags, manual, selected, flags, fresh } = item;
  const selecting = selected !== undefined;
  const { card, board, quantity } = line;
  const multi = card.max_copies > 1 && (board === "main" || board === "maybe");

  return (
    <li
      {...drag}
      onMouseEnter={onHover}
      className={`group flex items-center gap-2 rounded px-1.5 text-[15px] ${fresh ? "fresh" : ""} ${
        selected ? "bg-blue-500/15 ring-1 ring-blue-500/60" : highlighted ? "bg-amber-400/20 ring-1 ring-amber-500/60" : "hover:bg-foreground/5"
      }`}
    >
      {selecting && (
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold ${
            selected ? "border-blue-500 bg-blue-500 text-white" : "border-foreground/40"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
      )}
      <span className="w-6 shrink-0 text-right tabular-nums opacity-70">{quantity}</span>
      <button
        type="button"
        onClick={onOpen}
        onFocus={onHover}
        aria-pressed={selected}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left"
        title={`Open ${card.name}`}
      >
        {/* The name keeps at least ~45% of the row; badges shorten instead (full text in their tooltips). */}
        <span className="min-w-[45%] truncate">{card.name}</span>
        {warnings.length > 0 && (
          <span
            title={warnings.join(" · ")}
            className="min-w-0 truncate rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
          >
            ⚠<span className="hidden sm:inline"> {shortWarning(warnings[0])}</span>
          </span>
        )}
        {flags > 0 && (
          <span title={`Flagged as an underperformer ${flags}× in playtests`} className="shrink-0 rounded bg-rose-600/15 px-1.5 py-0.5 text-xs text-rose-700 dark:text-rose-300">
            ⚑{flags}
          </span>
        )}
        {untagged && (
          <span title="Scryfall's Tagger has no tags for this card yet" className="shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 text-xs opacity-70">
            untagged
          </span>
        )}
        {roleNames.length > 0 && (
          <span title={`Fills ${roleNames.join(", ")}`} className="flex min-w-0 items-center gap-2 overflow-hidden text-[13px] opacity-85">
            {roleNames.slice(0, 2).map((r) => (
              <span key={r} className="flex items-center gap-1 whitespace-nowrap">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: roleColor(r) }} />
                <span className="hidden lg:inline">{r}</span>
              </span>
            ))}
          </span>
        )}
        {manual && (
          <span title="Category set by you (open the card to change it)" className="shrink-0 text-xs opacity-60">
            ✎
          </span>
        )}
        <MyTagChips tags={myTags} className="hidden sm:flex" />
      </button>
      <ManaCost cost={card.mana_cost} />
      <span className="hidden w-14 shrink-0 text-right text-[13px] tabular-nums opacity-80 sm:inline">
        {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : "–"}
      </span>

      {/* Quick actions for mouse users. On phones everything lives in the card sheet instead (bigger targets). */}
      {!readOnly && !selecting && (
        <span className="hidden shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:sm:flex">
          {multi && (
            <>
              <QuickButton label={`One fewer ${card.name}`} onClick={() => onQuantity(quantity - 1)}>
                −
              </QuickButton>
              <QuickButton label={`One more ${card.name}`} onClick={() => onQuantity(quantity + 1)}>
                +
              </QuickButton>
            </>
          )}
          <QuickButton label={`Remove ${card.name}`} onClick={() => onQuantity(0)} danger>
            ✕
          </QuickButton>
        </span>
      )}
    </li>
  );
}

function QuickButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-7 min-w-7 rounded border border-foreground/15 px-1.5 text-xs hover:bg-foreground/10 ${
        danger ? "text-red-400" : ""
      }`}
    >
      {children}
    </button>
  );
}

/** "Above bracket 2: Game Changer" -> "Game Changer" for the row badge; the tooltip keeps the whole text. */
function shortWarning(w: string) {
  const i = w.indexOf(": ");
  return i > 0 ? w.slice(i + 2) : w;
}
