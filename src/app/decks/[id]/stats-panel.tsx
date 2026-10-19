"use client";

// Deck stats (step 3i): mana curve, color pips against land sources, and card types, for the 100-card deck.
// Plain CSS bars (no chart library); everything is readable at phone width.
import type { DeckLine } from "@/lib/deck/model";
import { COLOR_NAMES, colorBalance, manaCurve, typeCounts, type Color } from "@/lib/deck/stats";
import { Panel } from "./deck-text-panel";

const COLOR_BAR: Record<Color, string> = {
  W: "bg-amber-200 dark:bg-amber-100",
  U: "bg-blue-500",
  B: "bg-neutral-700 dark:bg-neutral-400",
  R: "bg-red-500",
  G: "bg-green-600",
};
const COLOR_BAR_LIGHT: Record<Color, string> = {
  W: "bg-amber-200/50 dark:bg-amber-100/40",
  U: "bg-blue-500/40",
  B: "bg-neutral-700/40 dark:bg-neutral-400/40",
  R: "bg-red-500/40",
  G: "bg-green-600/40",
};

export function StatsPanel({ lines, identity, onClose }: { lines: DeckLine[]; identity: Set<string> | null; onClose: () => void }) {
  return (
    <Panel title="Stats" onClose={onClose}>
      {lines.length === 0 ? (
        <p className="text-sm opacity-60">Add some cards to see stats.</p>
      ) : (
        <div className="grid gap-6 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Curve lines={lines} />
          <Colors lines={lines} identity={identity} />
          <Types lines={lines} />
        </div>
      )}
    </Panel>
  );
}

function Curve({ lines }: { lines: DeckLine[] }) {
  const { buckets, average, spells } = manaCurve(lines);
  const max = Math.max(1, ...buckets.map((b) => b.creatures + b.other));
  return (
    <section>
      <h3 className="mb-1 font-semibold">Mana curve</h3>
      <p className="mb-3 text-xs opacity-70">
        {spells} spells · average mana value {average.toFixed(2)}
      </p>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={buckets.map((b) => `${b.label}: ${b.creatures + b.other}`).join(", ")}>
        {buckets.map((b) => {
          const total = b.creatures + b.other;
          return (
            <div key={b.mv} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs tabular-nums opacity-70">{total || ""}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: `${(total / max) * 100}%` }}>
                <div className="bg-foreground/35" style={{ flexGrow: b.other }} title={`${b.other} non-creature`} />
                <div className="bg-foreground/80" style={{ flexGrow: b.creatures }} title={`${b.creatures} creatures`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-foreground/15 pt-1">
        {buckets.map((b) => (
          <span key={b.mv} className="flex-1 text-center text-xs opacity-70">
            {b.label}
          </span>
        ))}
      </div>
      <p className="mt-2 flex gap-4 text-xs opacity-70">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-foreground/80" />
          Creatures
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-foreground/35" />
          Other spells
        </span>
      </p>
    </section>
  );
}

function Colors({ lines, identity }: { lines: DeckLine[]; identity: Set<string> | null }) {
  const { rows, lands, colorlessLands } = colorBalance(lines, identity);
  return (
    <section>
      <h3 className="mb-1 font-semibold">Colors: pips vs land sources</h3>
      <p className="mb-3 text-xs opacity-70">
        Each color&apos;s share of the colored symbols in your spells&apos; costs, next to its share of what your lands can make.
      </p>
      {rows.length === 0 ? (
        <p className="opacity-60">No colored costs or lands yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const short = r.pipShare - r.sourceShare > 0.1;
            return (
              <li key={r.color}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-medium">{COLOR_NAMES[r.color]}</span>
                  {short && (
                    <span className="text-xs text-amber-700 dark:text-amber-400" title="Its share of pips is over 10 points above its share of land sources">
                      ⚠ few sources
                    </span>
                  )}
                </div>
                <Bar share={r.pipShare} className={COLOR_BAR[r.color]} label={`Pips ${Math.round(r.pipShare * 100)}% (${r.pips})`} />
                <Bar share={r.sourceShare} className={COLOR_BAR_LIGHT[r.color]} label={`Lands ${Math.round(r.sourceShare * 100)}% (${r.sources})`} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs opacity-60">
        {lands} lands (MDFCs included).
        {colorlessLands > 0 &&
          ` ${colorlessLands} make no colored mana themselves (colorless lands and fetch lands like Evolving Wilds), so they aren't counted as sources.`}
      </p>
    </section>
  );
}

function Bar({ share, className, label }: { share: number; className: string; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <div className="h-3 flex-1 overflow-hidden rounded bg-foreground/10">
        <div className={`h-full rounded ${className}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className="w-28 shrink-0 text-xs tabular-nums opacity-80">{label}</span>
    </div>
  );
}

function Types({ lines }: { lines: DeckLine[] }) {
  const types = typeCounts(lines);
  const max = Math.max(1, ...types.map((t) => t.count));
  return (
    <section>
      <h3 className="mb-1 font-semibold">Card types</h3>
      <p className="mb-3 text-xs opacity-70">A card with two types (Artifact Creature) counts under both.</p>
      <ul className="space-y-1.5">
        {types.map((t) => (
          <li key={t.type} className="flex items-center gap-2">
            <span className="w-24 shrink-0">{t.type}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-foreground/10">
              <div className="h-full rounded bg-foreground/60" style={{ width: `${(t.count / max) * 100}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums opacity-80">{t.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
