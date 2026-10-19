"use client";

import { ManaCost } from "@/components/mana-cost";
import type { Board, DeckLine } from "@/lib/deck/model";

type Props = {
  line: DeckLine;
  offColor: boolean;
  readOnly: boolean;
  onPreview: () => void;
  onMove: (to: Board) => void;
  onQuantity: (n: number) => void;
};

export function CardLine({ line, offColor, readOnly, onPreview, onMove, onQuantity }: Props) {
  const { card, board, quantity } = line;
  const multi = card.max_copies > 1 && (board === "main" || board === "maybe");

  const warnings: string[] = [];
  if (!card.commander_legal) warnings.push("Not legal in Commander");
  if (offColor) warnings.push("Outside your commander's colors");
  if (board === "commander" && !card.can_be_commander) warnings.push("Can't normally be a commander");

  return (
    <li
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className="group flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-foreground/5"
    >
      <span className="w-6 shrink-0 text-right tabular-nums opacity-70">{quantity}</span>
      <span className="min-w-0 flex-1 truncate">
        {card.name}
        {warnings.length > 0 && (
          <span
            title={warnings.join(" · ")}
            className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
          >
            ⚠ {warnings[0]}
          </span>
        )}
      </span>
      <ManaCost cost={card.mana_cost} />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums opacity-60">
        {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : "–"}
      </span>

      {!readOnly && (
        <span className="flex shrink-0 gap-1 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {multi && (
            <>
              <IconButton label={`One fewer ${card.name}`} onClick={() => onQuantity(quantity - 1)}>
                −
              </IconButton>
              <IconButton label={`One more ${card.name}`} onClick={() => onQuantity(quantity + 1)}>
                +
              </IconButton>
            </>
          )}
          {board !== "commander" && card.can_be_commander && (
            <IconButton label={`Make ${card.name} your commander`} onClick={() => onMove("commander")}>
              ♛
            </IconButton>
          )}
          {board !== "main" && (
            <IconButton label={`Move ${card.name} to the mainboard`} onClick={() => onMove("main")}>
              Main
            </IconButton>
          )}
          {board !== "maybe" && (
            <IconButton label={`Move ${card.name} to the maybeboard`} onClick={() => onMove("maybe")}>
              Maybe
            </IconButton>
          )}
          <IconButton label={`Remove ${card.name}`} onClick={() => onQuantity(0)} danger>
            ✕
          </IconButton>
        </span>
      )}
    </li>
  );
}

function IconButton({
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
      className={`min-w-6 rounded border border-foreground/15 px-1.5 text-xs leading-5 hover:bg-foreground/10 ${
        danger ? "text-red-600" : ""
      }`}
    >
      {children}
    </button>
  );
}
