"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ManaCost } from "@/components/mana-cost";
import { addCardToDeck } from "@/lib/deck/add-to-deck";
import { BOARD_LABELS, type Board, type DeckLine } from "@/lib/deck/model";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagData } from "@/lib/tags/use-tag-data";
import { CommanderLegality, LegalityAndRulings, RulesText, useCardDetails } from "./card-details";
import { CardTags } from "./card-tags";
import { printingImage, printingPrice, type ChosenPrinting } from "@/lib/deck/printing";
import { PrintingPicker } from "./printing-picker";
import { TUTORS_KEY } from "@/lib/tags/role-settings";
import { TutorBadge, TutorNote } from "./tutor-label";

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
  isCover: boolean;
  onCover: (on: boolean) => void;
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
  const [panel, setPanel] = useState<"main" | "decks" | "printing">("main");
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
                {quantity > 1 ? `${quantity} copies · ` : ""}
                {BOARD_LABELS[board]}
                {card.price_usd != null && <> · ${Number(card.price_usd).toFixed(2)} each</>}
                {printing && printingPrice(printing) == null && card.price_usd != null && (
                  <span title="Scryfall has no price for this printing, so this is the card's cheapest price"> (est.)</span>
                )}
              </p>
              {printing && (
                <p className="mt-1 text-sm opacity-85">
                  {printing.set_name} ({printing.set.toUpperCase()}) #{printing.number}
                  {printing.foil && <span className="text-gold"> · ✦ Foil</span>}
                  {printing.id === props.myDefault?.id && <span> · ★ Your default</span>}
                </p>
              )}
              <CommanderLegality details={details} />
              {!readOnly && card.image_art_crop && (
                <button type="button" onClick={() => props.onCover(!props.isCover)} className="mt-1 block min-h-9 text-[13px] underline opacity-80 hover:opacity-100">
                  {props.isCover ? "✓ Deck image · Back to the commander's art" : "Use as deck image"}
                </button>
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

            {!readOnly && panel === "main" && (
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

            <RulesText details={details} error={error} onRetry={retry} />

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

function ActionButton({
  onClick,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
        danger ? "border-red-400/50 text-red-400 hover:bg-red-600/10" : "border-foreground/20 hover:bg-foreground/10"
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
