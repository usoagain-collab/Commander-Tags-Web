"use client";

// Bracket targeting in the editor (Phase 5b): the header badge, the Bracket panel (target picker and every
// finding), and the banner shown while the deck's cards go above the target. Nothing is ever blocked.
import { estimateLabel, overTarget, type BracketEstimate, type Finding } from "@/lib/brackets/evaluate";
import { BRACKETS, type BracketNumber } from "@/lib/brackets/rules";
import { Panel } from "./deck-text-panel";

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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title="Target bracket, and the bracket this deck's cards fit. Click for details."
      className={`min-h-9 rounded-md border px-3 text-sm ${
        active
          ? "border-foreground bg-foreground text-background"
          : over
            ? "border-amber-500 bg-amber-400/15 text-amber-800 dark:text-amber-300"
            : "border-foreground/20"
      }`}
    >
      Bracket {target}
      <span className="opacity-70"> · cards {estimate ? estimateLabel(estimate.floor) : "…"}</span>
      {over && <span aria-label="above target"> ⚠</span>}
    </button>
  );
}

/** Under the toolbar while the cards go above the target: what crossed the line, highest first. */
export function BracketBanner({ target, estimate, onDetails }: { target: BracketNumber; estimate: BracketEstimate; onDetails: () => void }) {
  const over = overTarget(estimate, target);
  if (!over.length) return null;
  return (
    <div role="status" className="mt-3 rounded-md border border-amber-500/50 bg-amber-400/15 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">
          Above your target, bracket {target} ({BRACKETS[target - 1].name}): the cards fit {estimateLabel(estimate.floor)}.
        </p>
        <button type="button" onClick={onDetails} className="min-h-8 rounded border border-foreground/20 px-2 text-xs">
          Details
        </button>
      </div>
      <ul className="mt-1 list-disc pl-5">
        {over.slice(0, 3).map((f) => (
          <li key={findingKey(f)}>{f.label}</li>
        ))}
        {over.length > 3 && <li className="list-none opacity-70">and {over.length - 3} more (see Details)</li>}
      </ul>
    </div>
  );
}

export function BracketPanel({
  target,
  estimate,
  readOnly,
  saveError,
  comboError,
  onTarget,
  onClose,
}: {
  target: BracketNumber;
  estimate: BracketEstimate | null;
  readOnly: boolean;
  saveError: string | null;
  comboError: string | null;
  onTarget: (b: BracketNumber) => void;
  onClose: () => void;
}) {
  return (
    <Panel title="Bracket" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <h3 className="mb-2 font-semibold">Target bracket</h3>
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
                  target === b.n ? "border-foreground bg-foreground text-background" : "border-foreground/20 hover:bg-foreground/10"
                }`}
              >
                <span className="font-semibold">{b.n}</span> {b.name}
              </button>
            ))}
          </div>
          <p className="mt-1 opacity-70">{BRACKETS[target - 1].blurb}</p>
          {saveError && <p className="mt-1 text-red-600">{saveError}</p>}
        </div>

        <div>
          <h3 className="mb-1 font-semibold">
            The cards fit: {estimate ? estimateLabel(estimate.floor) : "checking…"}
          </h3>
          <p className="opacity-70">
            Based on Game Changers, mass land denial, extra turns and two-card combos (rated by Commander Spellbook). Cards
            can&apos;t show intent, so 1 vs 2, &quot;early&quot; combos, chained extra turns and cEDH are up to you.
          </p>
          {comboError && <p className="mt-1 text-amber-700 dark:text-amber-400">{comboError}</p>}
          {estimate && estimate.findings.length === 0 && <p className="mt-2 opacity-70">Nothing in this deck raises its bracket.</p>}
          {estimate && estimate.findings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {estimate.findings.map((f) => {
                const over = f.minBracket > target;
                return (
                  <li key={findingKey(f)} className={`flex items-start gap-2 rounded-md px-2 py-1 ${over ? "bg-amber-400/15" : ""}`}>
                    <span
                      className={`shrink-0 rounded px-1.5 text-xs font-semibold tabular-nums ${
                        over ? "bg-amber-500 text-black" : "bg-foreground/10"
                      }`}
                      title={`Fits bracket ${f.minBracket} and up`}
                    >
                      {f.minBracket === 1 ? "any" : `${f.minBracket}+`}
                    </span>
                    <span>{f.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
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
