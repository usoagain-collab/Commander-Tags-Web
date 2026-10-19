"use client";

import type { ViewMode } from "@/lib/deck/grouping";
import type { DeckLine } from "@/lib/deck/model";
import { CardLine } from "./card-line";

/** A deck line plus what the views show about it. */
export type DeckItem = {
  line: DeckLine;
  warnings: string[];
  untagged: boolean;
  highlighted: boolean;
  /** Roles beyond the first (the card is grouped under its first role). */
  extraRoles: number;
};
export type ViewSection = { key: string; title: string; count: number; items: DeckItem[] };

type Props = {
  sections: ViewSection[];
  view: ViewMode;
  collapsed: Set<string>;
  readOnly: boolean;
  onToggle: (key: string) => void;
  onOpen: (line: DeckLine) => void;
  onHover: (line: DeckLine) => void;
  onQuantity: (line: DeckLine, n: number) => void;
};

/** Renders grouped cards as Text, a Visual grid, or Stacks. Every card is the tap target for its sheet. */
export function DeckView(props: Props) {
  const { sections, view } = props;
  if (view === "stacks") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
        {sections.map((s) => (
          <div key={s.key} className="min-w-0">
            <Heading section={s} {...props} />
            {!props.collapsed.has(s.key) && <Stack section={s} {...props} />}
          </div>
        ))}
      </div>
    );
  }
  if (view === "grid") {
    return (
      <div className="space-y-5">
        {sections.map((s) => (
          <div key={s.key}>
            <Heading section={s} {...props} />
            {!props.collapsed.has(s.key) && (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                {s.items.map((it) => (
                  <li key={it.line.card.oracle_id}>
                    <Tile item={it} onOpen={() => props.onOpen(it.line)} onHover={() => props.onHover(it.line)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="columns-1 gap-8 xl:columns-2">
      {sections.map((s) => (
        <div key={s.key} className="mb-4 break-inside-avoid">
          <Heading section={s} {...props} />
          {!props.collapsed.has(s.key) && (
            <ul>
              {s.items.map((it) => (
                <CardLine
                  key={it.line.card.oracle_id}
                  item={it}
                  readOnly={props.readOnly}
                  onOpen={() => props.onOpen(it.line)}
                  onHover={() => props.onHover(it.line)}
                  onQuantity={(n) => props.onQuantity(it.line, n)}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Heading({ section, collapsed, onToggle }: { section: ViewSection; collapsed: Set<string>; onToggle: (k: string) => void }) {
  const isOpen = !collapsed.has(section.key);
  return (
    <button
      type="button"
      onClick={() => onToggle(section.key)}
      aria-expanded={isOpen}
      className="mb-1 flex min-h-8 w-full items-center gap-1.5 px-1.5 text-left text-xs font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
    >
      <span aria-hidden className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
        ›
      </span>
      {section.title} ({section.count})
    </button>
  );
}

/** A card image tile (Visual grid). Badges sit beside the image's edge, never as tiny buttons on it. */
function Tile({ item, onOpen, onHover }: { item: DeckItem; onOpen: () => void; onHover: () => void }) {
  const { card, quantity } = item.line;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
      title={`Open ${card.name}`}
      className={`relative block w-full rounded-[5%/3.6%] text-left ${
        item.highlighted ? "ring-4 ring-amber-400" : "hover:ring-2 hover:ring-foreground/30"
      }`}
    >
      <CardImage name={card.name} src={card.image_normal} />
      <TileBadges item={item} quantity={quantity} />
    </button>
  );
}

/** Stacks: each group's cards overlap so only their name bars show; the last card is shown whole. */
function Stack({ section, onOpen, onHover }: { section: ViewSection } & Pick<Props, "onOpen" | "onHover">) {
  return (
    <ul className="flex flex-col pb-2">
      {section.items.map((it, i) => (
        <li key={it.line.card.oracle_id} style={{ marginTop: i === 0 ? 0 : "-118%" }} className="relative hover:z-10 focus-within:z-10">
          <button
            type="button"
            onClick={() => onOpen(it.line)}
            onMouseEnter={() => onHover(it.line)}
            onFocus={() => onHover(it.line)}
            title={`Open ${it.line.card.name}`}
            className={`relative block w-full rounded-[5%/3.6%] ${it.highlighted ? "ring-4 ring-amber-400" : ""}`}
          >
            <CardImage name={it.line.card.name} src={it.line.card.image_normal} />
            <TileBadges item={it} quantity={it.line.quantity} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardImage({ name, src }: { name: string; src: string | null }) {
  return src ? (
    <img src={src} alt={name} loading="lazy" width={244} height={340} className="block w-full rounded-[4.75%/3.5%] shadow" />
  ) : (
    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/20 bg-foreground/5 p-2 text-center text-xs">
      {name}
    </span>
  );
}

function TileBadges({ item, quantity }: { item: DeckItem; quantity: number }) {
  return (
    <span className="pointer-events-none absolute right-1.5 top-[7%] flex flex-col items-end gap-1">
      {quantity > 1 && <span className="rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">×{quantity}</span>}
      {item.warnings.length > 0 && (
        <span title={item.warnings.join(" · ")} className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-black">
          ⚠
        </span>
      )}
      {item.untagged && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">untagged</span>}
    </span>
  );
}
