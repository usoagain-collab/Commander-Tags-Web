"use client";

// Bracket targeting in the editor (Phase 5b): the header badge, the one place that says the deck is above its
// target, and the Bracket panel it opens (target picker and every finding). Nothing is ever blocked.
import { bracketSections, estimateLabel, overTarget, type BracketEstimate, type Finding } from "@/lib/brackets/evaluate";
import { BRACKETS, COMBO_TAG_NAMES, type BracketNumber } from "@/lib/brackets/rules";
import type { DeckLine } from "@/lib/deck/model";
import { GlassOverlay } from "./glass-overlay";

/** "Bracket 3 · cards 4+": target and estimate; amber when the cards go above the target. */
export function BracketBadge({
  target,
  estimate,
  active,
  onClick,
}: {
  target: BracketNumber;
  estimate: BracketEstimate | null;
  active: boolean;
  onClick: () => void;
}) {
  const over = estimate ? estimate.floor > target : false;
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
      <span className="opacity-80">{!estimate ? "" : " · "}{!estimate ? "" : over ? `cards fit ${estimateLabel(estimate.floor)}` : "on target"}</span>
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
  onTarget,
  onOpenCard,
  onClose,
}: {
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
          <p className="mt-2 opacity-80">{BRACKETS[target - 1].blurb}</p>
          {saveError && <p className="mt-1 text-red-400">{saveError}</p>}
          {comboError && <p className="mt-1 text-amber-400">{comboError}</p>}
        </section>

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

        <p className="pb-4 opacity-70">
          Cards can&apos;t show intent, so 1 vs 2, &quot;early&quot; combos, chained extra turns and cEDH are up to you.
        </p>
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
