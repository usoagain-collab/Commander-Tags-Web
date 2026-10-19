"use client";

import { useState } from "react";
import type { ViewMode } from "@/lib/deck/grouping";
import type { DeckLine } from "@/lib/deck/model";
import type { MyTag } from "@/lib/tags/my-tags";
import { CardLine } from "./card-line";
import { MyTagChips } from "./my-tags-ui";

/** A deck line plus what the views show about it. */
export type DeckItem = {
  line: DeckLine;
  warnings: string[];
  untagged: boolean;
  highlighted: boolean;
  /** Roles beyond the first (the card is grouped under its first role). */
  extraRoles: number;
  /** My tags to show on the card (empty when "Show on cards" is off). */
  myTags: MyTag[];
  /** The category was set by hand (step 3f). */
  manual: boolean;
  /** Bulk edit (step 3g): undefined when not selecting, otherwise whether this card is selected. */
  selected?: boolean;
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
    // Stacks are columns, so each subgroup is its own column titled "Role › Subgroup".
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
        {sections.map((s) => (
          <DropZone key={s.key} sectionKey={s.key} onCardDrop={props.onCardDrop} className="min-w-0">
            <Heading section={s} {...props} prefix={s.parent?.title} />
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
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                  {b.section.items.map((it) => (
                    <li key={it.line.card.oracle_id}>
                      <Tile
                        item={it}
                        onOpen={(e) => props.onOpen(it.line, e)}
                        onHover={() => props.onHover(it.line)}
                        drag={dragProps(it.line, !!props.onCardDrop)}
                      />
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
    <div className="columns-1 gap-8 xl:columns-2">
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
      {parent.title} <span className="font-normal opacity-60">({parent.count})</span>
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
      className={`mb-1 flex min-h-8 w-full items-center gap-1.5 px-1.5 text-left text-xs font-semibold tracking-wide opacity-70 hover:opacity-100 ${
        sub ? "" : "uppercase"
      }`}
    >
      <span aria-hidden className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
        ›
      </span>
      {prefix && <span className="font-normal">{prefix} ›</span>}
      {section.title} ({section.count})
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
      {...drag}
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
      title={`Open ${card.name}`}
      aria-pressed={item.selected}
      className={`relative block w-full rounded-[5%/3.6%] text-left ${
        item.selected ? "ring-4 ring-blue-500" : item.highlighted ? "ring-4 ring-amber-400" : "hover:ring-2 hover:ring-foreground/30"
      }`}
    >
      <CardImage name={card.name} src={card.image_normal} />
      <TileBadges item={item} quantity={quantity} />
      <SelectedMark selected={item.selected} />
      {/* Under the image, not on it: the whole tile stays the one tap target. */}
      <MyTagChips tags={item.myTags} className="pointer-events-none mt-1" />
    </button>
  );
}

/** Stacks: each group's cards overlap so only their name bars show; the last card is shown whole. */
function Stack({ section, onOpen, onHover, onCardDrop }: { section: ViewSection } & Pick<Props, "onOpen" | "onHover" | "onCardDrop">) {
  return (
    <ul className="flex flex-col pb-2">
      {section.items.map((it, i) => (
        <li key={it.line.card.oracle_id} style={{ marginTop: i === 0 ? 0 : "-118%" }} className="relative hover:z-10 focus-within:z-10">
          <button
            type="button"
            onClick={(e) => onOpen(it.line, e)}
            onMouseEnter={() => onHover(it.line)}
            onFocus={() => onHover(it.line)}
            {...dragProps(it.line, !!onCardDrop)}
            title={`Open ${it.line.card.name}`}
            aria-pressed={it.selected}
            className={`relative block w-full rounded-[5%/3.6%] ${it.selected ? "ring-4 ring-blue-500" : it.highlighted ? "ring-4 ring-amber-400" : ""}`}
          >
            <CardImage name={it.line.card.name} src={it.line.card.image_normal} />
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

function CardImage({ name, src }: { name: string; src: string | null }) {
  return src ? (
    <img src={src} alt={name} loading="lazy" draggable={false} width={244} height={340} className="block w-full rounded-[4.75%/3.5%] shadow" />
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
