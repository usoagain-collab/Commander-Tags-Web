"use client";

import { MAX_MANA_VALUE } from "@/lib/deck/mana-values";
import type { SplitPart } from "@/lib/deck/splits";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ManaCost } from "@/components/mana-cost";
import { addCardToDeck } from "@/lib/deck/add-to-deck";
import { BOARD_LABELS, type Board, type CardSummary, type DeckLine } from "@/lib/deck/model";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagData } from "@/lib/tags/use-tag-data";
import { CommanderLegality, LegalityAndRulings, RulesText, useCardDetails } from "./card-details";
import { CardTags } from "./card-tags";
import { printingImage, printingPrice, type ChosenPrinting } from "@/lib/deck/printing";
import { StorePriceList } from "@/components/store-prices";
import { PrintingPicker } from "./printing-picker";
import { TUTORS_KEY } from "@/lib/tags/role-settings";
import { TutorBadge, TutorNote } from "./tutor-label";
import { WordingSearch } from "./wording-ui";

type Props = {
  deckId: string;
  line: DeckLine;
  index: number;
  total: number;
  warnings: string[];
  roleKeys: string[];
  roles: ResolvedRole[];
  tags: TagData;
  highlight: string | null;
  readOnly: boolean;
  onTag: (slug: string) => void;
  onMove: (to: Board) => void;
  onQuantity: (n: number) => void;
  onPrinting: (to: ChosenPrinting | null) => void;
  /** This deck has its own pick, rather than following your default. */
  pickedHere: boolean;
  myDefault: ChosenPrinting | null;
  onSetDefault: (to: ChosenPrinting | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Playtest flags (6d): how often it was flagged, and a way to clear them. */
  flags?: number;
  onClearFlags?: () => void;
  /** Category picker and My tags (step 3f), shown above the card's roles and tags. */
  extra?: React.ReactNode;
  /** This card's art heads the deck page. */
  /** Wish list (v2): whether this card is on your list, and a toggle. Absent for signed-out viewers. */
  wish?: { on: boolean; onToggle: () => void };
  /**
   * Collection tracking (v2): copies you own of the printing shown (`exact`) and of the card in all (`total`), your
   * other printings, and a way to add or remove copies of the shown one. Absent for signed-out viewers.
   */
  collection?: { exact: number; total: number; shownLabel: string; others: { label: string; quantity: number }[]; onAdd: (delta: number) => void };
  /** Mixed copies (v2): printings for some of this row's copies. Only for rows with more than one copy. */
  mixed?: { parts: SplitPart[]; onChange: (parts: SplitPart[]) => void };
  isCover: boolean;
  onCover: (on: boolean) => void;
  /** Change mana cost (v2): the card's own mana value, this deck's override (null = none), and a setter. */
  manaValue?: { own: number; counted: number | null; onChange: (value: number | null) => void };
  /** Search by wording (v2): opens the Search tab with a rules-text search, and what it is in words. */
  onSearchWording?: (query: string, label: string) => void;
  /**
   * Find cards (Nov 11, 2026): the sheet for a search result or suggestion, not a deck row. `context` names the list
   * Prev / Next step through, `status` says whether the deck already has it, `actions` are its add buttons.
   */
  candidate?: { context: string; status: string; actions: React.ReactNode };
};

/**
 * Opens when a card is tapped or clicked: the image first, then large buttons, then its roles and tags.
 * A bottom sheet on phones, a centered window on wider screens. Replaces small ⋯ menus on card images,
 * which are hard to hit on a phone (CLAUDE.md: Mobile matters).
 */
export function CardSheet(props: Props) {
  const { line, index, total, warnings, readOnly, onClose, onPrev, onNext } = props;
  const tutor = props.roleKeys.includes(TUTORS_KEY);
  const { card, board, quantity, printing } = line;
  const closeRef = useRef<HTMLButtonElement>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"main" | "decks" | "printing" | "mixed">("main");
  const [copied, setCopied] = useState(false);
  const [face, setFace] = useState(0);
  const multi = card.max_copies > 1 && (board === "main" || board === "maybe");
  const { details, error, retry } = useCardDetails(card.oracle_id);
  // The faces in details are the default printing's; a chosen printing has its own back image on the CDN.
  const image = !details?.flippable
    ? card.image_normal
    : printing
      ? printingImage(printing.id, "normal", face ? "back" : "front")
      : details.faces[face]?.image;

  // Keyboard: Esc closes, arrow keys step through the deck. Lock page scroll while open.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onPrev, onNext]);

  useEffect(() => {
    setPanel("main");
    setFace(0);
  }, [card.oracle_id, board]);

  async function copyName() {
    await navigator.clipboard.writeText(card.name);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-foreground/10 bg-panel p-4 shadow-2xl sm:max-w-4xl sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <SheetButton onClick={onPrev} label="Previous card (←)">
              ‹ Prev
            </SheetButton>
            <SheetButton onClick={onNext} label="Next card (→)">
              Next ›
            </SheetButton>
            <span className="self-center text-xs opacity-60">
              {props.candidate && `${props.candidate.context} `}
              {index + 1} / {total}
            </span>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close (Esc)"
            className="min-h-11 min-w-11 rounded-lg border border-foreground/20 px-3 text-sm"
          >
            Close
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
          <div className="mx-auto w-full max-w-[300px] space-y-2">
            {image ? (
              <div className="relative mx-auto w-fit sm:w-full">
                <img
                  key={image /* a new element, so the old art doesn't linger while the new image loads */}
                  src={image}
                  alt={details?.flippable ? details.faces[face].name : card.name}
                  width={300}
                  height={418}
                  className="mx-auto max-h-[38vh] w-auto rounded-[4.75%/3.5%] shadow-lg sm:max-h-none sm:w-full"
                />
                {tutor && (
                  <span className="pointer-events-none absolute right-2 top-[7%]">
                    <TutorBadge />
                  </span>
                )}
              </div>
            ) : (
              <div className="flex aspect-[63/88] items-center justify-center rounded-xl border p-4 text-center">{card.name}</div>
            )}
            {details?.flippable && (
              <button
                type="button"
                onClick={() => setFace((f) => (f + 1) % details.faces.length)}
                className="min-h-11 w-full rounded-lg border border-foreground/20 text-sm"
              >
                ⟲ Flip to {details.faces[(face + 1) % details.faces.length].name}
              </button>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="display text-2xl leading-tight">{card.name}</h2>
                <ManaCost cost={card.mana_cost} size={18} />
              </div>
              <p className="text-sm opacity-70">{card.type_line}</p>
              <p className="mt-1 text-sm">
                {props.candidate ? props.candidate.status : <>{quantity > 1 ? `${quantity} copies · ` : ""}{BOARD_LABELS[board]}</>}
                {card.price_usd != null && <> · ${Number(card.price_usd).toFixed(2)} each</>}
                {printing && printingPrice(printing) == null && card.price_usd != null && (
                  <span title="No price for this printing, so this is the card's cheapest price"> (est.)</span>
                )}
              </p>
              <div className="mt-2">
                <StorePriceList
                  tcg={printing ? printingPrice(printing) : (card.tcg_usd !== undefined ? card.tcg_usd : card.price_usd)}
                  stores={printing ? printing.stores : card.store_prices}
                  foil={!!printing?.foil}
                  exact={!!printing}
                  trend={card.price_trend}
                />
              </div>
              {printing && (
                <p className="mt-1 text-sm opacity-85">
                  {printing.set_name} ({printing.set.toUpperCase()}) #{printing.number}
                  {printing.foil && <span className="text-gold"> · ✦ Foil</span>}
                  {printing.id === props.myDefault?.id && <span> · ★ Your default</span>}
                </p>
              )}
              <CommanderLegality details={details} />
              {!readOnly && !props.candidate && card.image_art_crop && (
                <button type="button" onClick={() => props.onCover(!props.isCover)} className="mt-1 block min-h-9 text-[13px] underline opacity-80 hover:opacity-100">
                  {props.isCover ? "✓ Deck image · Back to the commander's art" : "Use as deck image"}
                </button>
              )}
              {props.manaValue && (board === "main" || board === "commander" || props.manaValue.counted !== null) && (
                <ManaValueControl {...props.manaValue} readOnly={readOnly} />
              )}
              {props.wish && (
                <button
                  type="button"
                  onClick={props.wish.onToggle}
                  aria-pressed={props.wish.on}
                  className={`mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm ${props.wish.on ? "border-gold text-gold" : "border-foreground/20"}`}
                >
                  {props.wish.on ? "♥ On your wish list" : "♡ Wish list"}
                </button>
              )}
              {props.collection && <CollectionControl card={card} {...props.collection} />}
              {tutor && <TutorNote />}
              {!!props.flags && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
                  ⚑ Flagged as an underperformer {props.flags}× in playtests
                  {!readOnly && props.onClearFlags && (
                    <button type="button" onClick={props.onClearFlags} className="min-h-9 rounded-md border border-foreground/20 px-2 text-xs text-foreground">
                      Clear
                    </button>
                  )}
                </p>
              )}
              {warnings.map((w) => (
                <p key={w} className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                  ⚠ {w}
                </p>
              ))}
            </div>

            {!readOnly && panel === "main" && props.candidate && (
              <div className="grid grid-cols-2 gap-2">
                {props.candidate.actions}
                <ActionButton onClick={() => setPanel("decks")}>Add to another deck…</ActionButton>
                <ActionButton onClick={copyName}>{copied ? "Copied" : "Copy card name"}</ActionButton>
              </div>
            )}
            {!readOnly && panel === "main" && !props.candidate && (
              <div className="grid grid-cols-2 gap-2">
                {board !== "commander" && card.can_be_commander && (
                  <ActionButton onClick={() => props.onMove("commander")}>♛ Make commander</ActionButton>
                )}
                {board !== "main" && <ActionButton onClick={() => props.onMove("main")}>Move to mainboard</ActionButton>}
                {board !== "maybe" && <ActionButton onClick={() => props.onMove("maybe")}>Move to maybeboard</ActionButton>}
                {multi && (
                  <div className="col-span-2 flex items-center gap-2">
                    <ActionButton onClick={() => props.onQuantity(quantity - 1)} label="One fewer">
                      −
                    </ActionButton>
                    <span className="min-w-12 text-center text-lg tabular-nums">{quantity}</span>
                    <ActionButton onClick={() => props.onQuantity(quantity + 1)} label="One more">
                      +
                    </ActionButton>
                  </div>
                )}
                <ActionButton onClick={() => setPanel("printing")}>Printing &amp; foil…</ActionButton>
                {props.mixed && line.quantity > 1 && (
                  <ActionButton onClick={() => setPanel("mixed")}>
                    Mixed printings…{props.mixed.parts.length > 0 && ` (${props.mixed.parts.reduce((s, p) => s + p.quantity, 0)} set)`}
                  </ActionButton>
                )}
                <ActionButton onClick={() => setPanel("decks")}>Add to another deck…</ActionButton>
                <ActionButton onClick={copyName}>{copied ? "Copied" : "Copy card name"}</ActionButton>
                <ActionButton onClick={() => props.onQuantity(0)} danger>
                  Remove from deck
                </ActionButton>
              </div>
            )}
            {!readOnly && panel === "decks" && (
              <OtherDecks deckId={props.deckId} line={line} onDone={() => setPanel("main")} />
            )}

            {!readOnly && panel === "mixed" && props.mixed && (
              <MixedPrintings
                card={card}
                quantity={line.quantity}
                base={printing ?? null}
                parts={props.mixed.parts}
                onChange={props.mixed.onChange}
                myDefault={props.myDefault}
                onSetDefault={props.onSetDefault}
                onDone={() => setPanel("main")}
              />
            )}
            {!readOnly && panel === "printing" && (
              <PrintingPicker
                card={card}
                printing={printing ?? null}
                pickedHere={props.pickedHere}
                myDefault={props.myDefault}
                onPick={props.onPrinting}
                onSetDefault={props.onSetDefault}
                onDone={() => setPanel("main")}
              />
            )}

            <div ref={rulesRef}>
              <RulesText details={details} error={error} onRetry={retry} />
            </div>
            {props.onSearchWording && <WordingSearch rulesRef={rulesRef} card={card} details={details} onSearch={props.onSearchWording} />}

            {props.extra}

            <CardTags
              card={card}
              roleKeys={props.roleKeys}
              roles={props.roles}
              tags={props.tags}
              highlight={props.highlight}
              onTag={props.onTag}
            />

            <LegalityAndRulings details={details} />

            <a
              href={details?.scryfallUri ?? `https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs underline opacity-70"
            >
              View on Scryfall
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Add to another deck…": lists the user's other decks; picking one adds the card to its mainboard. */
function OtherDecks({ deckId, line, onDone }: { deckId: string; line: DeckLine; onDone: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [decks, setDecks] = useState<{ id: string; name: string }[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("decks")
        .select("id, name")
        .eq("owner_id", user?.id ?? "")
        .neq("id", deckId)
        .order("updated_at", { ascending: false });
      setDecks((data ?? []) as { id: string; name: string }[]);
    })();
  }, [supabase, deckId]);

  async function add(target: { id: string; name: string }) {
    setStatus(`Adding to ${target.name}…`);
    const r = await addCardToDeck(supabase, target.id, line.card, "main");
    setStatus(r.ok ? `Added ${line.card.name} to ${target.name}.` : r.reason);
  }

  return (
    <div className="rounded-lg border border-foreground/15 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Add {line.card.name} to…</p>
        <button onClick={onDone} className="min-h-9 px-2 text-sm opacity-70">
          Back
        </button>
      </div>
      {decks === null ? (
        <p className="text-sm opacity-60">Loading your decks…</p>
      ) : decks.length === 0 ? (
        <p className="text-sm opacity-60">You don&apos;t have any other decks yet.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-auto">
          {decks.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => add(d)}
                className="min-h-11 w-full rounded-md px-3 text-left text-sm hover:bg-foreground/10"
              >
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && (
        <p aria-live="polite" className="mt-2 text-sm opacity-80">
          {status}
        </p>
      )}
    </div>
  );
}

export function ActionButton({
  onClick,
  danger,
  gold,
  label,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  /** The one main action. */
  gold?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
        danger
          ? "border-red-400/50 text-red-400 hover:bg-red-600/10"
          : gold
            ? "btn-gold border-transparent"
            : "border-foreground/20 hover:bg-foreground/10"
      }`}
    >
      {children}
    </button>
  );
}

function SheetButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="min-h-11 rounded-lg border border-foreground/20 px-3 text-sm"
    >
      {children}
    </button>
  );
}

/** "Counts as mana value N for stats": for X spells and cards you always cast for less (v2). */
function ManaValueControl({ own, counted, onChange, readOnly }: { own: number; counted: number | null; onChange: (v: number | null) => void; readOnly: boolean }) {
  const value = counted ?? own;
  if (readOnly) return counted !== null ? <p className="mt-1 text-sm">Counts as mana value {counted} in this deck&apos;s stats (printed {own}).</p> : null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <span className="opacity-85" title="For X spells and cards you usually cast for less: the curve, average and mana value groups use this number">
        Mana value for stats
      </span>
      <button type="button" aria-label="Lower the counted mana value" disabled={value <= 0} onClick={() => onChange(value - 1)} className="min-h-9 min-w-9 rounded-md border border-foreground/20">
        −
      </button>
      <span className={`w-6 text-center font-semibold tabular-nums ${counted !== null ? "text-gold" : ""}`}>{value}</span>
      <button type="button" aria-label="Raise the counted mana value" disabled={value >= MAX_MANA_VALUE} onClick={() => onChange(value + 1)} className="min-h-9 min-w-9 rounded-md border border-foreground/20">
        +
      </button>
      {counted !== null ? (
        <button type="button" onClick={() => onChange(null)} className="min-h-9 px-1 text-[13px] underline opacity-80">
          Back to {own}
        </button>
      ) : (
        <span className="text-[13px] opacity-60">printed</span>
      )}
    </div>
  );
}

/**
 * Mixed printings (v2): give some copies of this card other printings or foil. Copies not listed use the card's
 * own printing. Saved directly to the row (not Ctrl+Z).
 */
function MixedPrintings({
  card,
  quantity,
  base,
  parts,
  onChange,
  myDefault,
  onSetDefault,
  onDone,
}: {
  card: CardSummary;
  quantity: number;
  base: ChosenPrinting | null;
  parts: SplitPart[];
  onChange: (parts: SplitPart[]) => void;
  myDefault: ChosenPrinting | null;
  onSetDefault: (to: ChosenPrinting | null) => void;
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(parts.length === 0);
  const used = parts.reduce((s, p) => s + p.quantity, 0);
  const rest = Math.max(0, quantity - used);
  const set = (i: number, q: number) => onChange(q <= 0 ? parts.filter((_, j) => j !== i) : parts.map((p, j) => (j === i ? { ...p, quantity: q } : p)));
  const label = (p: ChosenPrinting | null) => (p ? `${p.set_name} (${p.set.toUpperCase()}) #${p.number}${p.foil ? " · ✦ Foil" : ""}` : "Default printing");
  return (
    <div className="space-y-2 rounded-lg border border-foreground/15 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Mixed printings</h3>
        <button type="button" onClick={onDone} className="btn min-h-9">
          Done
        </button>
      </div>
      <p className="opacity-80">Give some of your {quantity} copies other printings or foil. The rest use {label(base)}.</p>
      <ul className="divide-y divide-foreground/10">
        {parts.map((p, i) => (
          <li key={`${p.printing.id}-${p.printing.foil}`} className="flex min-h-11 items-center gap-2">
            <img src={printingImage(p.printing.id)} alt="" className="h-12 w-auto max-w-none shrink-0 rounded" />
            <span className="min-w-0 flex-1 truncate">{label(p.printing)}</span>
            <button type="button" aria-label="One copy fewer" onClick={() => set(i, p.quantity - 1)} className="min-h-9 min-w-9 rounded-md border border-foreground/20">
              −
            </button>
            <span className="w-5 text-center tabular-nums">{p.quantity}</span>
            <button type="button" aria-label="One copy more" disabled={rest === 0} onClick={() => set(i, p.quantity + 1)} className="min-h-9 min-w-9 rounded-md border border-foreground/20">
              +
            </button>
          </li>
        ))}
        <li className="flex min-h-11 items-center gap-2 opacity-80">
          <span className="min-w-0 flex-1 truncate">{label(base)}</span>
          <span className="w-5 text-center tabular-nums">{rest}</span>
        </li>
      </ul>
      {rest > 0 && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="min-h-10 w-full rounded-md border border-dashed border-foreground/25">
          + Add another printing
        </button>
      )}
      {adding && rest > 0 && (
        <PrintingPicker
          card={card}
          printing={null}
          pickedHere={false}
          myDefault={myDefault}
          onSetDefault={onSetDefault}
          onPick={(to) => {
            if (!to) return;
            const at = parts.findIndex((p) => p.printing.id === to.id && p.printing.foil === to.foil);
            onChange(at >= 0 ? parts.map((p, j) => (j === at ? { ...p, quantity: p.quantity + 1 } : p)) : [...parts, { printing: to, quantity: 1 }]);
            setAdding(false);
          }}
          onDone={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** The card sheet's collection box: add the printing shown, change its count, and see your other printings. */
function CollectionControl({ card, exact, total, shownLabel, others, onAdd }: { card: CardSummary } & NonNullable<Props["collection"]>) {
  if (total === 0)
    return (
      <button type="button" onClick={() => onAdd(1)} className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-foreground/20 px-3 text-sm font-medium hover:bg-foreground/10">
        ＋ Add to my collection
      </button>
    );
  const tone = exact > 0 ? "text-green-700 dark:text-green-300" : "text-orange-700 dark:text-orange-300";
  return (
    <div className="mt-1 rounded-md border border-foreground/15 p-2 text-sm">
      <p className={`font-medium ${tone}`}>✓ In your collection{exact > 0 ? "" : ", in another printing"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="min-w-0 opacity-85">{shownLabel}</span>
        <button type="button" aria-label="One fewer of this printing" disabled={exact <= 0} onClick={() => onAdd(-1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20 disabled:opacity-40">
          −
        </button>
        <span className="w-6 text-center font-semibold tabular-nums">{exact}</span>
        <button type="button" aria-label="One more of this printing" onClick={() => onAdd(1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
          +
        </button>
      </div>
      {others.length > 0 && (
        <p className="mt-1 text-xs opacity-80">
          Also: {others.map((o) => `${o.quantity} × ${o.label}`).join(" · ")}
        </p>
      )}
      <a href={`/collection?q=${encodeURIComponent(card.name)}`} className="mt-1 inline-flex min-h-9 items-center text-xs text-gold hover:underline">
        Open in Collection ›
      </a>
    </div>
  );
}
