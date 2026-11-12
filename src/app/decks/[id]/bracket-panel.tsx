"use client";

// Bracket targeting in the editor (Phase 5b): the header badge, the one place that says the deck is above its
// target, and the Bracket panel it opens (target picker and every finding). Nothing is ever blocked.
import { useState } from "react";
import { bracketSections, estimateLabel, overTarget, type BracketEstimate, type Finding } from "@/lib/brackets/evaluate";
import { BRACKETS, COMBO_TAG_NAMES, type BracketNumber } from "@/lib/brackets/rules";
import type { DeckLine } from "@/lib/deck/model";
import { GlassOverlay } from "./glass-overlay";
import type { PowerEstimate } from "@/lib/brackets/power";

/** Below this many cards, "on target" says more than the cards can prove (stress test, Nov 2026). */
export const BRACKET_VERDICT_MIN = 60;

/** "Bracket 3 · cards 4+": target and estimate; amber when the cards go above the target. */
export function BracketBadge({
  target,
  estimate,
  size,
  active,
  onClick,
}: {
  target: BracketNumber;
  estimate: BracketEstimate | null;
  /** Cards in the deck (commander + mainboard). */
  size: number;
  active: boolean;
  onClick: () => void;
}) {
  const over = estimate ? estimate.floor > target : false;
  // Going over the target is news at any size; being on it only means something once most of the deck is in.
  const verdict = !estimate ? "" : over ? `cards fit ${estimateLabel(estimate.floor)}` : size < BRACKET_VERDICT_MIN ? "too early to tell" : "on target";
  const reasons = estimate ? overTarget(estimate, target).map((f) => f.label) : [];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={over ? `Above your target:\n${reasons.join("\n")}\nClick for details.` : "Target bracket, and the bracket this deck's cards fit. Click for details."}
      className={`min-h-9 rounded-lg border bg-background/65 px-3 text-sm backdrop-blur ${
        active
          ? "border-gold bg-gold text-gold-ink"
          : over
            ? "border-amber-500 bg-amber-400/15 text-amber-800 dark:text-amber-300"
            : "border-foreground/20"
      }`}
    >
      Bracket {target}
      <span className="opacity-80">{verdict && ` · ${verdict}`}</span>
      {over && <span aria-label="above target"> ⚠</span>}
    </button>
  );
}

/** The whole screen under frosted glass: the target, then every card and combo behind the estimate. */
export function BracketPanel({
  target,
  estimate,
  lines,
  readOnly,
  saveError,
  comboError,
  paused,
  power,
  onTarget,
  onOpenCard,
  onClose,
}: {
  /** Refined estimate (v2): how the deck is likely to play, with the points behind it. */
  power?: PowerEstimate | null;
  target: BracketNumber;
  estimate: BracketEstimate | null;
  /** The cards the estimate looked at. */
  lines: DeckLine[];
  readOnly: boolean;
  saveError: string | null;
  comboError: string | null;
  /** A card is open on top, so Esc belongs to it. */
  paused: boolean;
  onTarget: (b: BracketNumber) => void;
  onOpenCard: (line: DeckLine) => void;
  onClose: () => void;
}) {
  const lineOf = new Map(lines.map((l) => [l.card.oracle_id, l]));
  const linesIn = (ids: string[]) => ids.flatMap((id) => lineOf.get(id) ?? []);
  const combos = estimate?.findings.filter((f) => f.combo) ?? [];
  const over = estimate ? estimate.floor > target : false;
  const reasons = estimate ? overTarget(estimate, target) : [];

  return (
    <GlassOverlay label="Bracket" paused={paused} onClose={onClose}>
      <div className="mx-auto max-w-5xl space-y-8 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">
              Bracket {target}: {BRACKETS[target - 1].name}
            </h2>
            <p className={`mt-1 text-base ${over ? "text-amber-300" : ""}`}>
              {!estimate ? "Checking the cards…" : over ? `⚠ The cards fit ${estimateLabel(estimate.floor)}, above your target.` : `The cards fit ${estimateLabel(estimate.floor)}, within your target.`}
            </p>
            {reasons.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-amber-300">
                {reasons.map((f) => (
                  <li key={findingKey(f)}>{f.label}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" autoFocus onClick={onClose} className="btn shrink-0">
            Close
          </button>
        </div>

        <section>
          <h3 className="eyebrow mb-2">Target bracket</h3>
          <div className="grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Target bracket">
            {BRACKETS.map((b) => (
              <button
                key={b.n}
                type="button"
                role="radio"
                aria-checked={target === b.n}
                disabled={readOnly}
                onClick={() => onTarget(b.n)}
                title={b.blurb}
                className={`min-h-11 rounded-lg border px-3 py-1.5 text-left ${
                  target === b.n ? "border-gold bg-gold text-gold-ink" : "border-foreground/20 hover:bg-foreground/10"
                }`}
              >
                <span className="font-semibold">{b.n}</span> {b.name}
              </button>
            ))}
          </div>
          <p className="mt-2 opacity-80">
            {BRACKETS[target - 1].blurb} {BRACKETS[target - 1].turns}
          </p>
          {saveError && <p className="mt-1 text-red-400">{saveError}</p>}
          {comboError && <p className="mt-1 text-amber-400">{comboError}</p>}
        </section>

        {power && <HowItPlays power={power} floor={estimate?.floor ?? 1} target={target} linesIn={linesIn} onOpenCard={onOpenCard} />}

        {estimate &&
          bracketSections(estimate, target).map((s) => {
            const cards = linesIn(s.cards);
            return (
              <section key={s.kind}>
                <SectionHeading title={s.title} count={cards.length} note={s.limit} over={s.over} />
                {cards.length === 0 ? (
                  <p className="opacity-70">None in this deck.</p>
                ) : (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                    {cards.map((l) => (
                      <li key={l.card.oracle_id}>
                        <CardButton line={l} onOpen={onOpenCard} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

        {estimate && (
          <section>
            <SectionHeading title="Two-card combos" count={combos.length} note="Commander Spellbook's rating sets each one's bracket" over={combos.some((f) => f.minBracket > target)} />
            {combos.length === 0 ? (
              <p className="opacity-70">None found in this deck.</p>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {combos.map((f) => {
                  const c = f.combo!;
                  const tooHigh = f.minBracket > target;
                  const pair = linesIn(f.cards);
                  return (
                    <li key={c.id} className={`panel flex gap-3 p-3 ${tooHigh ? "border-amber-500/60" : ""}`}>
                      <div className="grid w-44 shrink-0 grid-cols-2 gap-1.5 sm:w-56">
                        {pair.map((l) => (
                          <CardButton key={l.card.oracle_id} line={l} onOpen={onOpenCard} />
                        ))}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">{pair.map((l) => l.card.name).join(" + ")}</p>
                        <p className={`mt-1 ${tooHigh ? "text-amber-300" : "opacity-80"}`}>
                          {f.minBracket === 1 ? "Fits any bracket" : `Fits bracket ${f.minBracket} and up`} · Spellbook: {c.bracket_tag ? COMBO_TAG_NAMES[c.bracket_tag] ?? c.bracket_tag : "unrated"}
                        </p>
                        <a
                          href={`https://commanderspellbook.com/combo/${c.id}/`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block underline opacity-80 hover:opacity-100"
                        >
                          How it works on Commander Spellbook ↗
                        </a>
                        {c.results.length > 0 && (
                          <ul className="mt-2 list-disc pl-4 opacity-85">
                            {c.results.slice(0, 4).map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                            {c.results.length > 4 && <li className="list-none opacity-70">and {c.results.length - 4} more</li>}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {estimate && (estimate.alsoNeeds?.length ?? 0) > 0 && (
          <section>
            <SectionHeading title="Combos that need one more piece" count={estimate.alsoNeeds!.length} note="Not two-card combos, so they don't set the bracket" over={false} />
            <p className="mb-2 opacity-80">
              These two cards make a combo once you also have a common kind of card (for example any sacrifice outlet). If your deck has that piece, your table may treat them like a two-card combo.
            </p>
            <ul className="grid gap-2 lg:grid-cols-2">
              {estimate.alsoNeeds!.map((c) => {
                const pair = linesIn([c.card_a, c.card_b]);
                return (
                  <li key={c.id} className="panel flex items-center gap-3 p-3">
                    <div className="grid w-28 shrink-0 grid-cols-2 gap-1">
                      {pair.map((l) => (
                        <CardButton key={l.card.oracle_id} line={l} onOpen={onOpenCard} />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{pair.map((l) => l.card.name).join(" + ")}</p>
                      <p className="opacity-80">
                        {c.results.slice(0, 2).join(" · ") || "Combo"} · Spellbook: {c.bracket_tag ? COMBO_TAG_NAMES[c.bracket_tag] ?? c.bracket_tag : "unrated"}
                      </p>
                      <a href={`https://commanderspellbook.com/combo/${c.id}/`} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">
                        What else it needs ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="space-y-2 border-t border-foreground/15 pt-4 pb-4 opacity-85">
          <h3 className="eyebrow">What this checks</h3>
          <p>
            The bracket line above comes only from the rules Wizards of the Coast set for each bracket: Game Changers (their official list), mass land denial, extra turns and two-card combos (from Commander Spellbook, using its own rating of each combo). It reads every card in the commander zone, companion and mainboard, whatever roles or tags you track. Tutors have had no bracket limit since Wizards&apos; October 2025 update (the strongest ones are Game Changers), so they count toward How it plays but never move the bracket.
          </p>
          <p>
            Cards can&apos;t show intent. Whether a deck is 1 or 2, whether a combo comes together early, whether extra turns chain, and whether a deck is cEDH depend on how it&apos;s built to play, so the estimate never claims bracket 5 and says &quot;2 or lower&quot; or &quot;4+&quot; where the cards can&apos;t tell.
          </p>
          <h3 className="eyebrow pt-2">Brackets are a rough guide</h3>
          <p>
            A bracket is an estimate of power, not an exact measure. Your bracket 3 deck may be much stronger or much weaker than another bracket 3 deck: the commander, card quality, speed, synergy, how often it draws its best cards and the person piloting it all matter, and no card list shows all of that. Wizards of the Coast describes the brackets as a tool to guide the conversation before a game, not a ruling on who can play against whom.
          </p>
          <p>
            Use this number to start that conversation, not to end it. Tell the table your bracket, mention anything they&apos;d want to know (a combo, Game Changers, fast mana, a plan that ends games early), and adjust together so everyone has a good game.
          </p>
          <p className="text-[13px] opacity-80">
            Sources: Wizards of the Coast,{" "}
            <a className="underline" href="https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta" target="_blank" rel="noreferrer">
              Introducing Commander Brackets
            </a>
            ,{" "}
            <a className="underline" href="https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025" target="_blank" rel="noreferrer">
              October 2025 update
            </a>{" "}
            and{" "}
            <a className="underline" href="https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026" target="_blank" rel="noreferrer">
              February 2026 update
            </a>
            ; combos from{" "}
            <a className="underline" href="https://commanderspellbook.com" target="_blank" rel="noreferrer">
              Commander Spellbook
            </a>
            , refreshed nightly.
          </p>
        </section>
      </div>
    </GlassOverlay>
  );
}

function SectionHeading({ title, count, note, over }: { title: string; count: number; note: string; over: boolean }) {
  return (
    <h3 className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="display text-xl">
        {title} <span className="tabular-nums opacity-70">({count})</span>
      </span>
      <span className={over ? "text-amber-300" : "opacity-70"}>
        {over && "⚠ "}
        {note}
      </span>
    </h3>
  );
}

function CardButton({ line, onOpen }: { line: DeckLine; onOpen: (l: DeckLine) => void }) {
  return (
    <button type="button" onClick={() => onOpen(line)} title={`Open ${line.card.name}`} className="card-lift block w-full rounded-[5%/3.6%]">
      {line.card.image_normal ? (
        <img src={line.card.image_normal} alt={line.card.name} loading="lazy" width={244} height={340} className="w-full rounded-[5%/3.6%]" />
      ) : (
        <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/20 p-2 text-center text-xs">{line.card.name}</span>
      )}
    </button>
  );
}

const findingKey = (f: Finding) => (f.combo ? `combo:${f.combo.id}` : f.kind);

/** Short words for a card's badge, e.g. "Game Changer" or "Combo with Thassa's Oracle". */
export function cardFlag(f: Finding, oracleId: string, nameOf: (id: string) => string) {
  if (f.kind === "game-changers") return "Game Changer";
  if (f.kind === "mass-land-denial") return "Mass land denial";
  if (f.kind === "extra-turns") return "Extra turn";
  const other = f.cards.find((c) => c !== oracleId);
  return `Combo with ${other ? nameOf(other) : "another card"}`;
}

/**
 * How it plays (v2): the points model behind "plays like N". Each part opens its cards, so the reason for the
 * number is never hidden. Rules still set the floor: the cards above can only raise it.
 */
function HowItPlays({
  power,
  floor,
  target,
  linesIn,
  onOpenCard,
}: {
  power: PowerEstimate;
  floor: BracketNumber;
  target: BracketNumber;
  linesIn: (ids: string[]) => DeckLine[];
  onOpenCard: (line: DeckLine) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ? power.parts.find((p) => p.key === open) : null;
  const ahead = power.playsLike > target;
  return (
    <section>
      <h3 className="eyebrow mb-2">How it plays</h3>
      <div className="panel p-4">
        <p className="text-base">
          <span className={`display text-2xl ${ahead ? "text-amber-300" : ""}`}>Plays like bracket {power.playsLike}</span>
          <span className="ml-2 opacity-80">power {power.score} / 100</span>
        </p>
        <p className="mt-1 opacity-80">
          {power.playsLike > power.mapped
            ? `The points alone say ${power.mapped}, but its cards already put it at ${floor} or higher.`
            : ahead
              ? `Stronger than your target of ${target}: the parts below show where the power comes from.`
              : `Within your target of ${target}.`}{" "}
          Under 15 plays like 1, 15-34 like 2, 35-59 like 3, 60+ like 4.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {power.parts.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => setOpen(open === p.key ? null : p.key)}
                disabled={p.cards.length === 0}
                aria-expanded={open === p.key}
                className={`block w-full rounded-lg border px-3 py-2 text-left ${open === p.key ? "border-gold" : "border-foreground/15"} ${p.cards.length ? "hover:bg-foreground/5" : "cursor-default"}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{p.label}</span>
                  <span className="tabular-nums">
                    {p.points} <span className="opacity-60">/ {p.max}</span>
                  </span>
                </span>
                <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <span className="block h-full rounded-full bg-gold" style={{ width: `${(p.points / p.max) * 100}%` }} />
                </span>
                <span className="mt-1 block text-[13px] opacity-75">{p.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        {shown && (
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
            {linesIn(shown.cards).map((l) => (
              <li key={l.card.oracle_id}>
                <button type="button" onClick={() => onOpenCard(l)} className="block w-full text-left" title={`Open ${l.card.name}`}>
                  {l.card.image_normal ? <img src={l.card.image_normal} alt={l.card.name} className="w-full rounded-[4.75%/3.5%]" /> : <span className="text-sm">{l.card.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
