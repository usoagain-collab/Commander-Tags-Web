"use client";

import type { CardSummary } from "@/lib/deck/model";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagData } from "@/lib/tags/use-tag-data";
import { CardTags } from "./card-tags";

type Props = {
  card: CardSummary | null;
  roleKeys: string[];
  roles: ResolvedRole[];
  tags: TagData;
  highlight: string | null;
  onTag: (slug: string) => void;
  onOpen: () => void;
  /** Shown under the card's roles and tags (its My tags). */
  extra?: React.ReactNode;
};

/** Right-hand panel on wide screens: the hovered card's image, the roles it fills, and its tags. */
export function CardPanel({ card, roleKeys, roles, tags, highlight, onTag, onOpen, extra }: Props) {
  if (!card) {
    return (
      <div className="flex aspect-[63/88] w-full items-center justify-center rounded-xl border border-dashed border-foreground/20 p-6 text-center text-sm opacity-60">
        Hover a card to see it and its tags here. Click a card for more.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <button type="button" onClick={onOpen} title={`Open ${card.name}`} className="block w-full">
        {card.image_normal ? (
          <img src={card.image_normal} alt={card.name} width={300} height={418} className="w-full rounded-[4.75%/3.5%] shadow-lg" />
        ) : (
          <span className="flex aspect-[63/88] items-center justify-center rounded-xl border p-4 text-center">{card.name}</span>
        )}
      </button>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{card.name}</span>
        <span className="tabular-nums opacity-60">{card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : ""}</span>
      </div>
      {extra}
      <CardTags card={card} roleKeys={roleKeys} roles={roles} tags={tags} highlight={highlight} onTag={onTag} />
    </div>
  );
}
