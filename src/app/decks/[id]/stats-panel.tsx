"use client";

import { useMemo } from "react";
// Deck stats (step 3i): mana curve, color pips against land sources, and card types, for the 100-card deck.
// Plain CSS bars (no chart library); everything is readable at phone width.
import type { DeckLine } from "@/lib/deck/model";
import { COLOR_NAMES, colorBalance, manaCurve, typeCounts, type Color } from "@/lib/deck/stats";
import { tokenImage, useDeckTokens, type DeckToken } from "@/lib/deck/tokens";
import { handStats } from "@/lib/deck/hand-stats";
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

export function StatsPanel({
  lines,
  identity,
  isRamp,
  onClose,
}: {
  lines: DeckLine[];
  identity: Set<string> | null;
  isRamp: (l: DeckLine) => boolean;
  onClose: () => void;
}) {
  const tokens = useDeckTokens(lines.map((l) => l.card.oracle_id));
  const nameOf = (id: string) => lines.find((l) => l.card.oracle_id === id)?.card.name ?? "a card";
  return (
    <Panel title="Stats" onClose={onClose}>
      {lines.length === 0 ? (
        <p className="text-sm opacity-60">Add some cards to see stats.</p>
      ) : (
        <div className="grid gap-6 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Curve lines={lines} />
          <Colors lines={lines} identity={identity} />
          <Types lines={lines} />
          <OpeningHands lines={lines} isRamp={isRamp} />
          <Tokens tokens={tokens} nameOf={nameOf} />
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

/** Tokens list (Phase 6c): every token the deck's cards can make, and which cards make it. */
function Tokens({ tokens, nameOf }: { tokens: DeckToken[] | null; nameOf: (id: string) => string }) {
  return (
    <section className="md:col-span-2 xl:col-span-3">
      <h3 className="mb-1 font-semibold">Tokens{tokens ? ` (${tokens.length})` : ""}</h3>
      {tokens === null ? (
        <p className="opacity-60">Checking…</p>
      ) : tokens.length === 0 ? (
        <p className="opacity-60">No cards in this deck make tokens.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          {tokens.map((t) => (
            <li key={t.token_id} className="text-xs">
              <img src={tokenImage(t.token_id)} alt={t.name} loading="lazy" width={146} height={204} className="w-full rounded-[4.75%/3.5%] shadow" />
              <p className="mt-1 font-medium">{t.name}</p>
              <p className="opacity-60" title={t.made_by.map(nameOf).join(", ")}>
                from {t.made_by.slice(0, 2).map(nameOf).join(", ")}
                {t.made_by.length > 2 ? ` +${t.made_by.length - 2}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Opening-hand stats (6d): 1,000 shuffles of the library (the commander starts in the command zone). */
function OpeningHands({ lines, isRamp }: { lines: DeckLine[]; isRamp: (l: DeckLine) => boolean }) {
  const library = lines
    .filter((l) => l.board === "main")
    .map((l) => ({ land: l.card.counts_as_land, ramp: isRamp(l), quantity: l.quantity }));
  const key = library.map((c) => `${c.land ? 1 : 0}${c.ramp ? 1 : 0}x${c.quantity}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => handStats(library), [key]);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const max = Math.max(0.01, ...s.landSpread);
  return (
    <section>
      <h3 className="mb-1 font-semibold">Opening hands</h3>
      {s.hands === 0 ? (
        <p className="opacity-60">Add more cards to simulate hands.</p>
      ) : (
        <>
          <p className="mb-3 text-xs opacity-70">
            {s.hands.toLocaleString()} shuffled 7-card hands · average {s.averageLands.toFixed(1)} lands · {pct(s.keepable)} have 2–4 lands
          </p>
          <div className="flex h-24 items-end gap-1.5" role="img" aria-label={s.landSpread.map((x, i) => `${i} lands: ${pct(x)}`).join(", ")}>
            {s.landSpread.map((x, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums opacity-70">{x >= 0.005 ? pct(x) : ""}</span>
                <div className={`w-full rounded-t ${i >= 2 && i <= 4 ? "bg-green-600/70" : "bg-foreground/35"}`} style={{ height: `${(x / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5 border-t border-foreground/15 pt-1">
            {s.landSpread.map((_, i) => (
              <span key={i} className="flex-1 text-center text-xs opacity-70">
                {i}
              </span>
            ))}
          </div>
          <p className="mt-1 text-center text-xs opacity-60">lands in the opening 7</p>
          <p className="mt-3">
            Ramp by turn 2: <strong>{pct(s.rampByTurn2.play)}</strong> on the play, <strong>{pct(s.rampByTurn2.draw)}</strong> on the draw
            <span className="opacity-60"> ({s.rampCards} Ramp cards)</span>
          </p>
        </>
      )}
    </section>
  );
}
