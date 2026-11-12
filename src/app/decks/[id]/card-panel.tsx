"use client";

import { TrendChip } from "@/components/store-prices";
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

/**
 * The roomier preview: floats over the side of the screen away from the mouse only while a card is hovered, so
 * no column stays reserved for it. It never takes clicks; the card sheet has the clickable tags.
 */
export function FloatingPreview({ side, card, ...rest }: Omit<Props, "onOpen" | "onTag" | "card"> & { side: "left" | "right"; card: CardSummary }) {
  return (
    <div aria-hidden className={`panel pointer-events-none fixed top-4 z-[45] hidden max-h-[calc(100vh-2rem)] w-[270px] space-y-2 overflow-hidden p-2.5 shadow-2xl lg:block ${side === "left" ? "left-4" : "right-4"}`}>
      {card.image_normal && <img src={card.image_normal} alt="" width={250} height={349} className="w-full rounded-[4.75%/3.5%]" />}
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{card.name}</span>
        <span className="tabular-nums opacity-60"><TrendChip trend={card.price_trend} /> {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : ""}</span>
      </div>
      {rest.extra}
      <CardTags card={card} roleKeys={rest.roleKeys} roles={rest.roles} tags={rest.tags} highlight={rest.highlight} onTag={() => {}} />
    </div>
  );
}

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
        <span className="tabular-nums opacity-60"><TrendChip trend={card.price_trend} /> {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : ""}</span>
      </div>
      {extra}
      <CardTags card={card} roleKeys={roleKeys} roles={roles} tags={tags} highlight={highlight} onTag={onTag} />
    </div>
  );
}
