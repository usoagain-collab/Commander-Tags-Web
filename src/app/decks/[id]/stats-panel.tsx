"use client";

import { useCallback, useMemo, useState } from "react";
// Deck stats (step 3i), on the same full-screen glass as Bracket: every number and bar is a button that lists its
// cards beside the charts (a sheet from the bottom on narrow screens). Plain CSS bars, no chart library.
import type { DeckLine } from "@/lib/deck/model";
import type { PriceSource } from "@/lib/deck/store-prices";
import { PriceHistory } from "./price-history";
import {
  COLOR_NAMES,
  colorBalance,
  creatureTypeCounts,
  creatureTypesOf,
  deckOverview,
  hasType,
  inCurveBucket,
  isCreature,
  isSpell,
  landMakes,
  manaCurve,
  pipCount,
  priceBandOf,
  priceBands,
  typeCounts,
  type Color,
} from "@/lib/deck/stats";
import { tokenImage, useDeckTokens, type DeckToken } from "@/lib/deck/tokens";
import { handStats, sampleHand } from "@/lib/deck/hand-stats";
import { roleColor } from "@/lib/tags/pretty";
import { GlassOverlay } from "./glass-overlay";

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

const usd = (n: number) => `$${n.toFixed(2)}`;
const byName = (a: DeckLine, b: DeckLine) => a.card.name.localeCompare(b.card.name);
const byPrice = (a: DeckLine, b: DeckLine) => Number(b.card.price_usd ?? 0) - Number(a.card.price_usd ?? 0);
const priceOf = (l: DeckLine) => (l.card.price_usd == null ? undefined : usd(Number(l.card.price_usd)));
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Listed = { line: DeckLine; detail?: string; copies?: number };

/** What the user clicked. `list` runs against the current cards, so a card removed in the sheet leaves the list. */
type Selection = {
  key: string;
  title: string;
  note?: string;
  list: (all: DeckLine[]) => Listed[];
  another?: () => void;
};

/** A selection that is simply every card matching a test. */
const matching = (
  key: string,
  title: string,
  test: (l: DeckLine) => boolean,
  opts: { note?: string; sort?: (a: DeckLine, b: DeckLine) => number; detail?: (l: DeckLine) => string | undefined } = {},
): Selection => ({
  key,
  title,
  note: opts.note,
  list: (all) =>
    all
      .filter(test)
      .sort(opts.sort ?? byName)
      .map((line) => ({ line, detail: opts.detail?.(line) })),
});

type Select = (s: Selection) => void;
type Shared = { lines: DeckLine[]; selected: string | null; onSelect: Select };

export function StatsPanel({
  lines,
  identity,
  roles,
  roleCounts,
  roleKeysOf,
  paused,
  onOpenCard,
  onClose,
  history,
}: {
  /** The deck's price line (v2): needs the deck, your price source and today's total. */
  history?: { deckId: string; source: PriceSource; total: number };
  lines: DeckLine[];
  identity: Set<string> | null;
  roles: { key: string; name: string; target: number }[];
  roleCounts: Record<string, number>;
  roleKeysOf: (l: DeckLine) => string[];
  /** A card is open on top, so Esc belongs to it. */
  paused: boolean;
  onOpenCard: (l: DeckLine) => void;
  onClose: () => void;
}) {
  const tokens = useDeckTokens(lines.map((l) => l.card.oracle_id));
  const nameOf = (id: string) => lines.find((l) => l.card.oracle_id === id)?.card.name ?? "a card";
  const [selection, setSelection] = useState<Selection | null>(null);
  const clear = useCallback(() => setSelection(null), []);
  // Clicking the selected bar again closes its list.
  const onSelect: Select = (s) => setSelection((cur) => (cur?.key === s.key && !s.another ? null : s));
  const shared: Shared = { lines, selected: selection?.key ?? null, onSelect };

  return (
    <GlassOverlay label="Stats" paused={paused} onClose={onClose} onEscape={selection ? clear : undefined}>
      <div className="mx-auto max-w-7xl text-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">Stats</h2>
            <p className="mt-1 text-base opacity-80">Click any number or bar to see its cards.</p>
          </div>
          <button type="button" autoFocus onClick={onClose} className="btn shrink-0">
            Close
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="opacity-70">Add some cards to see stats.</p>
        ) : (
          <div className={`items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] ${selection ? "pb-[58vh] lg:pb-0" : ""}`}>
            <div className="min-w-0 space-y-6">
              <Overview {...shared} />
              <div className="grid gap-4 md:grid-cols-2">
                <Curve {...shared} />
                <OpeningHands {...shared} isRamp={(l) => roleKeysOf(l).includes("ramp")} />
                <Roles {...shared} roles={roles} counts={roleCounts} roleKeysOf={roleKeysOf} />
                <Colors {...shared} identity={identity} />
                <Types {...shared} />
                <CreatureTypes {...shared} />
                <Prices {...shared} />
                {history && <PriceHistory deckId={history.deckId} source={history.source} total={history.total} />}
              </div>
              <Tokens {...shared} tokens={tokens} nameOf={nameOf} />
            </div>
            <CardList selection={selection} lines={lines} onOpenCard={onOpenCard} onClear={clear} />
          </div>
        )}
      </div>
    </GlassOverlay>
  );
}

/** The cards behind the current selection. Sticks beside the charts; on narrow screens, a sheet from the bottom. */
function CardList({
  selection,
  lines,
  onOpenCard,
  onClear,
}: {
  selection: Selection | null;
  lines: DeckLine[];
  onOpenCard: (l: DeckLine) => void;
  onClear: () => void;
}) {
  const place = "lg:sticky lg:top-0 lg:mt-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto";
  if (!selection) {
    return <aside className={`panel hidden p-4 opacity-70 lg:block ${place}`}>Pick a bar and its cards show up here. Click a card to open it.</aside>;
  }
  const items = selection.list(lines);
  const copies = items.reduce((n, i) => n + (i.copies ?? i.line.quantity), 0);
  return (
    <aside
      aria-label={selection.title}
      className={`fixed inset-x-0 bottom-0 z-10 max-h-[55vh] overflow-y-auto rounded-t-2xl border-t border-foreground/20 bg-background p-4 shadow-2xl lg:static lg:rounded-xl lg:border lg:shadow-none ${place}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="display text-xl">
            {selection.title} <span className="tabular-nums opacity-70">({copies})</span>
          </h3>
          {selection.note && <p className="mt-0.5 opacity-75">{selection.note}</p>}
        </div>
        <button type="button" onClick={onClear} className="btn shrink-0">
          Clear
        </button>
      </div>
      {selection.another && (
        <button type="button" onClick={selection.another} className="btn mb-3 w-full">
          Show another hand
        </button>
      )}
      {items.length === 0 ? (
        <p className="opacity-70">No cards here.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          {items.map((i, n) => {
            const count = i.copies ?? i.line.quantity;
            return (
              <li key={`${i.line.card.oracle_id}-${n}`}>
                <button type="button" onClick={() => onOpenCard(i.line)} title={`Open ${i.line.card.name}`} className="card-lift relative block w-full rounded-[5%/3.6%]">
                  {i.line.card.image_normal ? (
                    <img src={i.line.card.image_normal} alt={i.line.card.name} loading="lazy" width={244} height={340} className="w-full rounded-[5%/3.6%]" />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/20 p-2 text-center text-xs">{i.line.card.name}</span>
                  )}
                  {count > 1 && <span className="absolute right-1 top-1 rounded bg-black/80 px-1.5 text-xs font-semibold text-white">×{count}</span>}
                </button>
                {i.detail && <p className="mt-0.5 text-center text-xs tabular-nums opacity-80">{i.detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function Section({ title, note, children, className = "" }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel min-w-0 p-4 ${className}`}>
      <h3 className="display text-xl">{title}</h3>
      {note && <p className="mb-3 mt-0.5 opacity-70">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

const pressable = (on: boolean) => `rounded transition-colors hover:bg-foreground/10 disabled:pointer-events-none ${on ? "bg-gold/20 outline outline-2 outline-gold" : ""}`;

function Overview({ lines, selected, onSelect }: Shared) {
  const o = deckOverview(lines);
  const { average } = manaCurve(lines);
  const tiles: { value: string; label: string; pick: Selection }[] = [
    { value: String(o.cards), label: "Cards", pick: matching("all", "All cards", () => true) },
    { value: String(o.lands), label: "Lands", pick: matching("lands", "Lands", (l) => l.card.counts_as_land, { note: "Modal double-faced cards with a land side count." }) },
    { value: String(o.creatures), label: "Creatures", pick: matching("creatures", "Creatures", isCreature, { sort: (a, b) => a.card.mana_value - b.card.mana_value || byName(a, b), detail: (l) => `MV ${l.card.mana_value}` }) },
    {
      value: average.toFixed(2),
      label: `Average mana value (median ${o.medianValue})`,
      pick: matching("topend", "Spells, highest mana value first", isSpell, { sort: (a, b) => b.card.mana_value - a.card.mana_value || byName(a, b), detail: (l) => `MV ${l.card.mana_value}` }),
    },
    { value: usd(o.price), label: "Deck price", pick: matching("value", "Most expensive first", () => true, { sort: byPrice, detail: priceOf }) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <button key={t.pick.key} type="button" aria-pressed={selected === t.pick.key} onClick={() => onSelect(t.pick)} className={`panel min-h-20 p-3 text-left ${pressable(selected === t.pick.key)}`}>
          <span className="display block text-2xl tabular-nums">{t.value}</span>
          <span className="block text-xs opacity-75">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function Curve({ lines, selected, onSelect }: Shared) {
  const { buckets, average, spells } = manaCurve(lines);
  const max = Math.max(1, ...buckets.map((b) => b.creatures + b.other));
  return (
    <Section title="Mana curve" note={`${spells} spells · average mana value ${average.toFixed(2)}`}>
      <div className="flex h-48 items-stretch gap-1">
        {buckets.map((b) => {
          const total = b.creatures + b.other;
          const key = `curve:${b.mv}`;
          return (
            <button
              key={b.mv}
              type="button"
              disabled={!total}
              aria-pressed={selected === key}
              aria-label={`Mana value ${b.label}: ${b.creatures} creatures, ${b.other} other spells`}
              onClick={() =>
                onSelect(
                  matching(key, `Mana value ${b.label}`, (l) => inCurveBucket(l, b.mv), {
                    note: `${b.creatures} creatures, ${b.other} other spells`,
                    sort: (x, y) => Number(isCreature(y)) - Number(isCreature(x)) || byName(x, y),
                  }),
                )
              }
              className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 px-0.5 pb-0.5 ${pressable(selected === key)}`}
            >
              <span className="text-xs tabular-nums opacity-75">{total || ""}</span>
              <span className="flex w-full flex-col overflow-hidden rounded-t" style={{ height: `${(total / max) * 78}%` }}>
                <span className="block bg-foreground/35" style={{ flexGrow: b.other }} />
                <span className="block bg-foreground/80" style={{ flexGrow: b.creatures }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 border-t border-foreground/15 pt-1">
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
    </Section>
  );
}

/** A full-width row that lists its cards when clicked: label, bar, number. */
function BarRow({
  label,
  share,
  value,
  barClass,
  barColor,
  on,
  disabled,
  onClick,
}: {
  label: string;
  share: number;
  value: string;
  barClass?: string;
  barColor?: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className={`flex min-h-9 w-full items-center gap-2 px-1 text-left ${pressable(on)}`}>
      <span className="w-28 shrink-0 truncate" title={label}>
        {label}
      </span>
      <span className="h-3.5 flex-1 overflow-hidden rounded bg-foreground/10">
        <span className={`block h-full rounded ${barClass ?? ""}`} style={{ width: `${Math.min(100, share * 100)}%`, background: barColor }} />
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums opacity-80">{value}</span>
    </button>
  );
}

function Roles({ selected, onSelect, roles, counts, roleKeysOf }: Shared & { roles: { key: string; name: string; target: number }[]; counts: Record<string, number>; roleKeysOf: (l: DeckLine) => string[] }) {
  return (
    <Section title="Roles" note="Cards filling each role against your target.">
      {roles.map((r) => {
        const n = counts[r.key] ?? 0;
        const key = `role:${r.key}`;
        return (
          <BarRow
            key={r.key}
            label={r.name}
            share={r.target ? n / r.target : n ? 1 : 0}
            value={`${n} / ${r.target}`}
            barColor={roleColor(r.name)}
            on={selected === key}
            onClick={() => onSelect(matching(key, r.name, (l) => roleKeysOf(l).includes(r.key), { note: n < r.target ? `${r.target - n} short of your target of ${r.target}.` : `Target ${r.target}.` }))}
          />
        );
      })}
    </Section>
  );
}

function Colors({ lines, selected, onSelect, identity }: Shared & { identity: Set<string> | null }) {
  const { rows, lands, colorlessLands } = colorBalance(lines, identity);
  return (
    <Section title="Colors: pips vs land sources" note="Each color's share of the colored symbols in your spells' costs, next to its share of what your lands can make.">
      {rows.length === 0 ? (
        <p className="opacity-70">{identity && identity.size === 0 ? "Your commander is colorless, so there are no colors to balance." : "No colored costs or lands yet."}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const short = r.pipShare - r.sourceShare > 0.1;
            const name = COLOR_NAMES[r.color];
            return (
              <li key={r.color}>
                <div className="mb-0.5 flex items-baseline justify-between px-1">
                  <span className="font-medium">{name}</span>
                  {short && (
                    <span className="text-xs text-amber-700 dark:text-amber-400" title="Its share of pips is over 10 points above its share of land sources">
                      ⚠ few sources
                    </span>
                  )}
                </div>
                <BarRow
                  label="Pips"
                  share={r.pipShare}
                  value={`${pct(r.pipShare)} (${r.pips})`}
                  barClass={COLOR_BAR[r.color]}
                  on={selected === `pips:${r.color}`}
                  disabled={!r.pips}
                  onClick={() =>
                    onSelect(
                      matching(`pips:${r.color}`, `${name} spells`, (l) => pipCount(l, r.color) > 0, {
                        note: "Most demanding first.",
                        sort: (a, b) => pipCount(b, r.color) - pipCount(a, r.color) || byName(a, b),
                        detail: (l) => `${pipCount(l, r.color)} pip${pipCount(l, r.color) === 1 ? "" : "s"}`,
                      }),
                    )
                  }
                />
                <BarRow
                  label="Land sources"
                  share={r.sourceShare}
                  value={`${pct(r.sourceShare)} (${r.sources})`}
                  barClass={COLOR_BAR_LIGHT[r.color]}
                  on={selected === `sources:${r.color}`}
                  disabled={!r.sources}
                  onClick={() => onSelect(matching(`sources:${r.color}`, `Lands making ${name.toLowerCase()}`, (l) => landMakes(l, r.color)))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs opacity-60">
        {lands} lands (MDFCs included).
        {colorlessLands > 0 && ` ${colorlessLands} make no colored mana themselves (colorless lands and fetch lands like Evolving Wilds), so they aren't counted as sources.`}
      </p>
    </Section>
  );
}

function Types({ lines, selected, onSelect }: Shared) {
  const types = typeCounts(lines);
  const max = Math.max(1, ...types.map((t) => t.count));
  return (
    <Section title="Card types" note="A card with two types (Artifact Creature) counts under both.">
      {types.map((t) => (
        <BarRow
          key={t.type}
          label={t.type}
          share={t.count / max}
          value={String(t.count)}
          barClass="bg-foreground/60"
          on={selected === `type:${t.type}`}
          onClick={() => onSelect(matching(`type:${t.type}`, t.type, (l) => hasType(l, t.type)))}
        />
      ))}
    </Section>
  );
}

function CreatureTypes({ lines, selected, onSelect }: Shared) {
  const types = creatureTypeCounts(lines);
  const top = types.slice(0, 8);
  const max = Math.max(1, ...top.map((t) => t.count));
  return (
    <Section title="Creature types" note={types.length > 8 ? `The top 8 of ${types.length}.` : undefined}>
      {top.length === 0 ? (
        <p className="opacity-70">No creatures with a type yet.</p>
      ) : (
        top.map((t) => (
          <BarRow
            key={t.type}
            label={t.type}
            share={t.count / max}
            value={String(t.count)}
            barClass="bg-foreground/60"
            on={selected === `tribe:${t.type}`}
            onClick={() => onSelect(matching(`tribe:${t.type}`, t.type, (l) => creatureTypesOf(l).includes(t.type)))}
          />
        ))
      )}
    </Section>
  );
}

function Prices({ lines, selected, onSelect }: Shared) {
  const bands = priceBands(lines);
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <Section title="Price" note="Cards in each price range, and what they add up to.">
      {bands.map((b) => (
        <BarRow
          key={b.key}
          label={b.label}
          share={b.count / max}
          value={`${b.count} · ${usd(b.value)}`}
          barClass="bg-gold"
          on={selected === `price:${b.key}`}
          disabled={!b.count}
          onClick={() => onSelect(matching(`price:${b.key}`, b.label, (l) => priceBandOf(l) === b.key, { sort: byPrice, detail: priceOf }))}
        />
      ))}
    </Section>
  );
}

/** Tokens list (Phase 6c): every token the deck's cards can make; click one for the cards that make it. */
function Tokens({ selected, onSelect, tokens, nameOf }: Shared & { tokens: DeckToken[] | null; nameOf: (id: string) => string }) {
  return (
    <Section title={`Tokens${tokens ? ` (${tokens.length})` : ""}`}>
      {tokens === null ? (
        <p className="opacity-70">Checking…</p>
      ) : tokens.length === 0 ? (
        <p className="opacity-70">No cards in this deck make tokens.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          {tokens.map((t) => {
            const key = `token:${t.token_id}`;
            return (
              <li key={t.token_id} className="text-xs">
                <button
                  type="button"
                  aria-pressed={selected === key}
                  onClick={() => onSelect(matching(key, `Makes: ${t.name}`, (l) => t.made_by.includes(l.card.oracle_id)))}
                  className={`block w-full p-1 text-left ${pressable(selected === key)}`}
                >
                  <img src={tokenImage(t.token_id)} alt={t.name} loading="lazy" width={146} height={204} className="w-full rounded-[4.75%/3.5%] shadow" />
                  <span className="mt-1 block font-medium">{t.name}</span>
                  <span className="block opacity-60" title={t.made_by.map(nameOf).join(", ")}>
                    from {t.made_by.slice(0, 2).map(nameOf).join(", ")}
                    {t.made_by.length > 2 ? ` +${t.made_by.length - 2}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Opening-hand stats (6d): 1,000 shuffles of the library (the commander starts in the command zone). */
function OpeningHands({ lines, selected, onSelect, isRamp }: Shared & { isRamp: (l: DeckLine) => boolean }) {
  const main = lines.filter((l) => l.board === "main");
  const library = main.map((l) => ({ land: l.card.counts_as_land, ramp: isRamp(l), quantity: l.quantity, id: l.card.oracle_id }));
  const key = library.map((c) => `${c.land ? 1 : 0}${c.ramp ? 1 : 0}x${c.quantity}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => handStats(library), [key]);
  const max = Math.max(0.01, ...s.landSpread);

  // "Show another hand" moves the seed on by one.
  const hand = (lands: number | null, seed: number): Selection => {
    const ids = (sampleHand(library, lands, seed) ?? []).map((c) => c.id);
    const counted = [...new Map(ids.map((id) => [id, ids.filter((x) => x === id).length]))];
    return {
      key: lands === null ? "hand:any" : `hand:${lands}`,
      title: lands === null ? "An example hand" : `A hand with ${lands} land${lands === 1 ? "" : "s"}`,
      note: lands === null ? undefined : `${pct(s.landSpread[lands])} of opening hands look like this.`,
      list: (all) => counted.flatMap(([id, copies]) => {
        const line = all.find((l) => l.card.oracle_id === id && l.board === "main");
        return line ? [{ line, copies }] : [];
      }),
      another: () => onSelect(hand(lands, seed + 1)),
    };
  };
  const rampCards = matching("ramp", "Ramp", (l) => l.board === "main" && isRamp(l));

  return (
    <Section title="Opening hands" note={s.hands === 0 ? undefined : `${s.hands.toLocaleString()} shuffled 7-card hands · average ${s.averageLands.toFixed(1)} lands · ${pct(s.keepable)} have 2–4 lands`}>
      {s.hands === 0 ? (
        <p className="opacity-70">Add more cards to simulate hands.</p>
      ) : (
        <>
          <div className="flex h-32 items-stretch gap-1">
            {s.landSpread.map((x, i) => {
              const possible = x > 0;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!possible}
                  aria-pressed={selected === `hand:${i}`}
                  aria-label={`${i} lands: ${pct(x)} of hands. Show an example.`}
                  onClick={() => onSelect(hand(i, 1 + i))}
                  className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 px-0.5 pb-0.5 ${pressable(selected === `hand:${i}`)}`}
                >
                  <span className="text-[10px] tabular-nums opacity-70">{x >= 0.005 ? pct(x) : ""}</span>
                  <span className={`block w-full rounded-t ${i >= 2 && i <= 4 ? "bg-green-600/70" : "bg-foreground/35"}`} style={{ height: `${(x / max) * 72}%` }} />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1 border-t border-foreground/15 pt-1">
            {s.landSpread.map((_, i) => (
              <span key={i} className="flex-1 text-center text-xs opacity-70">
                {i}
              </span>
            ))}
          </div>
          <p className="mt-1 text-center text-xs opacity-60">lands in the opening 7. Click for an example hand.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" aria-pressed={selected === "hand:any"} onClick={() => onSelect(hand(null, 1))} className={`btn ${selected === "hand:any" ? "border-gold" : ""}`}>
              Deal a hand
            </button>
            <button type="button" aria-pressed={selected === "ramp"} onClick={() => onSelect(rampCards)} className={`min-h-9 flex-1 px-2 text-left ${pressable(selected === "ramp")}`}>
              Ramp by turn 2: <strong>{pct(s.rampByTurn2.play)}</strong> on the play, <strong>{pct(s.rampByTurn2.draw)}</strong> on the draw
              <span className="opacity-60"> ({s.rampCards} Ramp cards)</span>
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
