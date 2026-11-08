"use client";

import { useState } from "react";
import type { ViewMode } from "@/lib/deck/grouping";
import type { DeckLine } from "@/lib/deck/model";
import type { MyTag } from "@/lib/tags/my-tags";
import { CardLine } from "./card-line";
import { MyTagChips } from "./my-tags-ui";
import { TutorBadge } from "./tutor-label";

/** A deck line plus what the views show about it. */
export type DeckItem = {
  line: DeckLine;
  warnings: string[];
  untagged: boolean;
  highlighted: boolean;
  /** Roles to name on the row (the group heading already names one in Group by Role). */
  roleNames: string[];
  /** My tags to show on the card (empty when "Show on cards" is off). */
  myTags: MyTag[];
  /** The category was set by hand (step 3f). */
  manual: boolean;
  /** Just added: flashes once so you can see where it landed. */
  fresh: boolean;
  /** Bulk edit (step 3g): undefined when not selecting, otherwise whether this card is selected. */
  selected?: boolean;
  /** Times this card was flagged as an underperformer in the playtester (6d). */
  flags: number;
  /** Counts toward the Tutors role (C1b): shows the blue Tutor label. */
  tutor: boolean;
  /** Locked in the Smart Cutter: never suggested as a cut. */
  locked?: boolean;
};
export type ViewSection = {
  key: string;
  title: string;
  count: number;
  items: DeckItem[];
  /** Role subgroups (step 3e) carry the role they belong to; the role gets its own collapsible heading. */
  parent?: { key: string; title: string; count: number };
};

type Props = {
  sections: ViewSection[];
  view: ViewMode;
  collapsed: Set<string>;
  readOnly: boolean;
  onToggle: (key: string) => void;
  /** Click or tap on a card. The event carries Shift/Ctrl for bulk selection (step 3g). */
  onOpen: (line: DeckLine, e?: React.MouseEvent) => void;
  onHover: (line: DeckLine) => void;
  onQuantity: (line: DeckLine, n: number) => void;
  /**
   * Group by Role on desktop (step 3f): drag a mainboard card onto a role group to put it there. Only set when
   * that's allowed; phones use the Category picker in the card sheet instead.
   */
  onCardDrop?: (card: { oracle_id: string; board: string }, sectionKey: string) => void;
  /** The left column is collapsed, so the cards take the room and grow. */
  roomy?: boolean;
};

/** Our own drag type, so the Scryfall drop overlay (which looks for links and text) ignores these drags. */
const DRAG_TYPE = "application/x-ctw-card";

/** Makes a mainboard card draggable when drag-to-category is on. */
export function dragProps(line: DeckLine, enabled: boolean) {
  if (!enabled || line.board !== "main") return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ oracle_id: line.card.oracle_id, board: line.board }));
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** A role group that accepts dragged cards; outlined while a card is over it. */
function DropZone({
  sectionKey,
  onCardDrop,
  className = "",
  children,
}: {
  sectionKey: string;
  onCardDrop?: Props["onCardDrop"];
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  if (!onCardDrop || !sectionKey.startsWith("main:")) return <div className={className}>{children}</div>;
  const ours = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div
      className={`${className} rounded-md ${over ? "bg-foreground/5 outline-2 outline-dashed outline-foreground/40" : ""}`}
      onDragOver={(e) => {
        if (!ours(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!ours(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        try {
          onCardDrop(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)), sectionKey);
        } catch {
          // not one of our drags
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Sections in screen order, with a role heading inserted before each role's first subgroup. Subgroups of a
 * collapsed role are left out.
 */
function withParents(sections: ViewSection[], collapsed: Set<string>) {
  const out: ({ type: "parent"; parent: NonNullable<ViewSection["parent"]> } | { type: "section"; section: ViewSection })[] = [];
  let last: string | undefined;
  for (const s of sections) {
    if (s.parent && s.parent.key !== last) out.push({ type: "parent", parent: s.parent });
    last = s.parent?.key;
    if (!(s.parent && collapsed.has(s.parent.key))) out.push({ type: "section", section: s });
  }
  return out;
}

/** Renders grouped cards as Text, a Visual grid, or Stacks. Every card is the tap target for its sheet. */
export function DeckView(props: Props) {
  const { sections, view } = props;
  if (view === "stacks") {
    // Archidekt's Stacks: big cards in columns of uneven height, groups flowing to fill each column.
    // Each subgroup is its own stack titled "Role › Subgroup".
    return (
      <div className={`gap-x-4 ${props.roomy ? "[column-width:150px] sm:[column-width:190px] xl:[column-width:230px]" : "[column-width:150px] sm:[column-width:190px]"}`}>
        {sections.map((s) => (
          <DropZone key={s.key} sectionKey={s.key} onCardDrop={props.onCardDrop} className="mb-6 min-w-0 break-inside-avoid">
            <StackHeading section={s} {...props} />
            {!props.collapsed.has(s.key) && <Stack section={s} {...props} />}
          </DropZone>
        ))}
      </div>
    );
  }
  const blocks = withParents(sections, props.collapsed);
  if (view === "grid") {
    return (
      <div className="space-y-5">
        {blocks.map((b) =>
          b.type === "parent" ? (
            <DropZone key={`p:${b.parent.key}`} sectionKey={b.parent.key} onCardDrop={props.onCardDrop}>
              <ParentHeading parent={b.parent} {...props} />
            </DropZone>
          ) : (
            <DropZone key={b.section.key} sectionKey={b.section.key} onCardDrop={props.onCardDrop} className={b.section.parent ? "pl-3" : ""}>
              <Heading section={b.section} {...props} sub={!!b.section.parent} />
              {!props.collapsed.has(b.section.key) && (
                <ul className={`grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 ${props.roomy ? "xl:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]" : ""}`}>
                  {b.section.items.map((it) => (
                    <li key={it.line.card.oracle_id} className="group relative">
                      <Tile
                        item={it}
                        onOpen={(e) => props.onOpen(it.line, e)}
                        onHover={() => props.onHover(it.line)}
                        drag={dragProps(it.line, !!props.onCardDrop)}
                      />
                      {!props.readOnly && it.selected === undefined && (
                        <TileRemove name={it.line.card.name} onRemove={() => props.onQuantity(it.line, 0)} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DropZone>
          ),
        )}
      </div>
    );
  }
  return (
    <div>
      {blocks.map((b) =>
        b.type === "parent" ? (
          <DropZone key={`p:${b.parent.key}`} sectionKey={b.parent.key} onCardDrop={props.onCardDrop} className="break-inside-avoid">
            <ParentHeading parent={b.parent} {...props} />
          </DropZone>
        ) : (
          <DropZone
            key={b.section.key}
            sectionKey={b.section.key}
            onCardDrop={props.onCardDrop}
            className={`mb-4 break-inside-avoid ${b.section.parent ? "pl-3" : ""}`}
          >
            <Heading section={b.section} {...props} sub={!!b.section.parent} />
            {!props.collapsed.has(b.section.key) && (
              <ul>
                {b.section.items.map((it) => (
                  <CardLine
                    key={it.line.card.oracle_id}
                    item={it}
                    readOnly={props.readOnly}
                    onOpen={(e) => props.onOpen(it.line, e)}
                    onHover={() => props.onHover(it.line)}
                    onQuantity={(n) => props.onQuantity(it.line, n)}
                    drag={dragProps(it.line, !!props.onCardDrop)}
                  />
                ))}
              </ul>
            )}
          </DropZone>
        ),
      )}
    </div>
  );
}

/** A role's own heading above its subgroups; collapsing it hides all of them. */
function ParentHeading({
  parent,
  collapsed,
  onToggle,
}: {
  parent: NonNullable<ViewSection["parent"]>;
  collapsed: Set<string>;
  onToggle: (k: string) => void;
}) {
  const isOpen = !collapsed.has(parent.key);
  return (
    <button
      type="button"
      onClick={() => onToggle(parent.key)}
      aria-expanded={isOpen}
      className="mb-1 flex min-h-9 w-full items-center gap-1.5 border-b border-foreground/10 px-1.5 text-left text-sm font-semibold hover:opacity-100"
    >
      <span aria-hidden className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
        ›
      </span>
      <span className="display text-lg">{parent.title}</span> <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums">{parent.count}</span>
    </button>
  );
}

function Heading({
  section,
  collapsed,
  onToggle,
  sub,
  prefix,
}: {
  section: ViewSection;
  collapsed: Set<string>;
  onToggle: (k: string) => void;
  sub?: boolean;
  prefix?: string;
}) {
  const isOpen = !collapsed.has(section.key);
  return (
    <button
      type="button"
      onClick={() => onToggle(section.key)}
      aria-expanded={isOpen}
      className={`mb-2 flex min-h-10 w-full items-center gap-2 border-b border-foreground/15 px-1.5 text-left text-sm font-semibold hover:text-gold ${
        sub ? "opacity-90" : "eyebrow !text-[13px] !text-foreground"
      }`}
    >
      <span aria-hidden className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
        ›
      </span>
      {prefix && <span className="font-normal">{prefix} ›</span>}
      {section.title}
      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums tracking-normal">{section.count}</span>
    </button>
  );
}

/** A stack's heading: its name over its card count and total price, like Archidekt's. */
function StackHeading({ section, collapsed, onToggle }: { section: ViewSection; collapsed: Set<string>; onToggle: (k: string) => void }) {
  const isOpen = !collapsed.has(section.key);
  const price = section.items.reduce((sum, it) => sum + Number(it.line.card.price_usd ?? 0) * it.line.quantity, 0);
  return (
    <button type="button" onClick={() => onToggle(section.key)} aria-expanded={isOpen} className="mb-1.5 block min-h-11 w-full px-0.5 text-left hover:text-gold">
      <span className="block truncate text-sm font-semibold">
        <span aria-hidden className={`mr-1.5 inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
          ›
        </span>
        {section.parent && <span className="font-normal opacity-80">{section.parent.title} › </span>}
        {section.title}
      </span>
      <span className="flex justify-between text-xs tabular-nums opacity-70">
        <span>Qty: {section.count}</span>
        <span>${price.toFixed(2)}</span>
      </span>
    </button>
  );
}

/** A card image tile (Visual grid). Badges sit beside the image's edge, never as tiny buttons on it. */
function Tile({
  item,
  onOpen,
  onHover,
  drag,
}: {
  item: DeckItem;
  onOpen: (e: React.MouseEvent) => void;
  onHover: () => void;
  drag: ReturnType<typeof dragProps>;
}) {
  const { card, quantity } = item.line;
  return (
    <button
      type="button"
      data-preview-card
      {...drag}
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
      title={`Open ${card.name}`}
      aria-pressed={item.selected}
      className={`card-lift relative block w-full rounded-[5%/3.6%] text-left ${item.fresh ? "fresh" : ""} ${
        item.selected ? "ring-4 ring-blue-500" : item.highlighted ? "ring-4 ring-gold" : ""
      }`}
    >
      <CardImage name={card.name} src={card.image_normal} foil={item.line.printing?.foil} />
      <TileBadges item={item} quantity={quantity} />
      <SelectedMark selected={item.selected} />
      {/* Under the image, not on it: the whole tile stays the one tap target. */}
      <MyTagChips tags={item.myTags} className="pointer-events-none mt-1" />
    </button>
  );
}

/**
 * Quick remove on a grid tile: a round ✕ just off the top-left corner, shown on hover. Mouse screens only; on phones
 * the whole card stays the one tap target and Remove lives in the card sheet.
 */
function TileRemove({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      title={`Remove ${name}`}
      aria-label={`Remove ${name}`}
      className="absolute -left-2 -top-2 z-10 hidden h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/85 text-sm font-bold text-red-400 opacity-0 shadow transition-[opacity,transform] duration-[140ms] hover:bg-red-600 hover:text-white focus-visible:opacity-100 group-hover:-translate-y-[3px] group-hover:opacity-100 [@media(hover:hover)]:sm:flex"
    >
      ✕
    </button>
  );
}

/**
 * Stacks: each group's cards overlap so only their name bars show; the last card is shown whole. A hovered card
 * doesn't jump to the front, or it would cover the name bars below it; the preview shows it whole.
 */
function Stack({ section, onOpen, onHover, onCardDrop }: { section: ViewSection } & Pick<Props, "onOpen" | "onHover" | "onCardDrop">) {
  return (
    <ul className="flex flex-col pb-2">
      {section.items.map((it, i) => (
        <li key={it.line.card.oracle_id} style={{ marginTop: i === 0 ? 0 : "-124%" }} className="relative">
          <button
            type="button"
            data-preview-card
            onClick={(e) => onOpen(it.line, e)}
            onMouseEnter={() => onHover(it.line)}
            onFocus={() => onHover(it.line)}
            {...dragProps(it.line, !!onCardDrop)}
            title={`Open ${it.line.card.name}`}
            aria-pressed={it.selected}
            className={`relative block w-full rounded-[5%/3.6%] hover:brightness-125 ${it.fresh ? "fresh" : ""} ${it.selected ? "ring-4 ring-blue-500" : it.highlighted ? "ring-4 ring-gold" : ""}`}
          >
            <CardImage name={it.line.card.name} src={it.line.card.image_normal} foil={it.line.printing?.foil} />
            <TileBadges item={it} quantity={it.line.quantity} />
            <SelectedMark selected={it.selected} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A check in the card's name bar while selecting. A label only: the whole card is the tap target. */
function SelectedMark({ selected }: { selected?: boolean }) {
  if (selected === undefined) return null;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute left-1.5 top-[7%] flex h-6 w-6 items-center justify-center rounded-full border-2 text-sm font-bold ${
        selected ? "border-blue-500 bg-blue-500 text-white" : "border-white/80 bg-black/50"
      }`}
    >
      {selected ? "✓" : ""}
    </span>
  );
}

function CardImage({ name, src, foil }: { name: string; src: string | null; foil?: boolean }) {
  return src ? (
    <span className={`relative block ${foil ? "foil-sheen" : ""}`}>
      <img src={src} alt={foil ? `${name} (foil)` : name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%] shadow" />
    </span>
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
      {item.tutor && <TutorBadge />}
      {item.locked && (
        <span title="Locked: the Smart Cutter never suggests cutting it" className="rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
          🔒
        </span>
      )}
      {item.untagged && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">untagged</span>}
      {item.flags > 0 && (
        <span title={`Flagged as an underperformer ${item.flags}× in playtests`} className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          ⚑{item.flags}
        </span>
      )}
    </span>
  );
}
