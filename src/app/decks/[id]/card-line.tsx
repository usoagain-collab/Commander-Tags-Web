"use client";

import { ManaCost } from "@/components/mana-cost";
import type { DeckItem } from "./deck-views";
import { MyTagChips } from "./my-tags-ui";

type Props = {
  item: DeckItem;
  readOnly: boolean;
  onOpen: () => void;
  onHover: () => void;
  onQuantity: (n: number) => void;
  /** Drag-to-category handlers (Group by Role on desktop), or nothing. */
  drag?: React.HTMLAttributes<HTMLLIElement>;
};

/** One card in Text view. The name opens the card sheet; quick −/+/✕ sit at the end on wider screens. */
export function CardLine({ item, readOnly, onOpen, onHover, onQuantity, drag }: Props) {
  const { line, warnings, untagged, highlighted, extraRoles, myTags, manual } = item;
  const { card, board, quantity } = line;
  const multi = card.max_copies > 1 && (board === "main" || board === "maybe");

  return (
    <li
      {...drag}
      onMouseEnter={onHover}
      className={`group flex items-center gap-2 rounded px-1.5 text-sm ${
        highlighted ? "bg-amber-400/20 ring-1 ring-amber-500/60" : "hover:bg-foreground/5"
      }`}
    >
      <span className="w-6 shrink-0 text-right tabular-nums opacity-70">{quantity}</span>
      <button
        type="button"
        onClick={onOpen}
        onFocus={onHover}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left"
        title={`Open ${card.name}`}
      >
        <span className="truncate">{card.name}</span>
        {warnings.length > 0 && (
          <span
            title={warnings.join(" · ")}
            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
          >
            ⚠<span className="hidden sm:inline"> {warnings[0]}</span>
          </span>
        )}
        {untagged && (
          <span title="Scryfall's Tagger has no tags for this card yet" className="shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 text-xs opacity-70">
            untagged
          </span>
        )}
        {extraRoles > 0 && (
          <span title="Fills more than one role" className="shrink-0 text-xs opacity-60">
            +{extraRoles} role{extraRoles > 1 ? "s" : ""}
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
      <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums opacity-60 sm:inline">
        {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : "–"}
      </span>

      {/* Quick actions for mouse users. On phones everything lives in the card sheet instead (bigger targets). */}
      {!readOnly && (
        <span className="hidden shrink-0 gap-1 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
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
        danger ? "text-red-600" : ""
      }`}
    >
      {children}
    </button>
  );
}
