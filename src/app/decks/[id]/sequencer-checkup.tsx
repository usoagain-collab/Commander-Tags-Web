"use client";

// Deck Sequencer checkup (Nov 21, 2026): the land count with its reasoning, then four quick build checks from
// deck-building advice David shared (Deck Driver MTG). Works on the deck as the Sequencer sees it, so planned cuts
// and swaps already count. Logic: src/lib/deck/mana-checkup.ts and src/lib/deck/checkup.ts.
import { useMemo } from "react";
import type { CardScore } from "@/lib/cutter/score";
import { balanceCheck, CHECKUP, curveCheck, offPlan, overlapCheck, type CheckCard } from "@/lib/deck/checkup";
import { cheapForLands, KARSTEN, landAdvice, landGap, landOdds, landsText, MDFC_WEIGHT } from "@/lib/deck/mana-checkup";
import type { DeckLine } from "@/lib/deck/model";
import { useLandText } from "@/lib/deck/use-land-text";
import { roleColor } from "@/lib/tags/pretty";
import { isLand, type ResolvedRole } from "@/lib/tags/roles";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const copies = (cs: { quantity: number }[]) => cs.reduce((n, c) => n + c.quantity, 0);

/** Popular decks, for context (EDHREC average decks of the 100 most popular commanders, pulled Nov 7, 2026). */
const POPULAR = { medianLands: 35, cheapRamp: 8, cheapDraw: 2 } as const;

export function SequencerCheckup(props: {
  /** Every card as the Sequencer sees it, with its keep score (planned cuts out, swaps in). */
  scores: CardScore[];
  roles: ResolvedRole[];
  /** Cards on the floor or swaps waiting: the numbers already include them. */
  planned: boolean;
  /** Cards that can be opened (on the deck now). */
  lineOf: Map<string, DeckLine>;
  onOpenCard: (line: DeckLine) => void;
  onSuggestRole: (key: string) => void;
  /** Sets the deck's Lands target; absent when you can't edit it. */
  onSetLandTarget?: (n: number) => void;
  /** Puts a mainboard card on the floor with a reason. */
  onCut: (oracleId: string, reason: string) => void;
  /** Cards already on the floor. */
  onFloor: Set<string>;
}) {
  const { scores, roles } = props;
  const lines: DeckLine[] = useMemo(
    () => scores.map((s) => ({ board: s.entry.commander ? "commander" : "main", quantity: s.entry.quantity, card: s.entry.card })),
    [scores],
  );
  const roleKeys = useMemo(() => new Map(scores.map((s) => [s.entry.card.oracle_id, s.entry.roles])), [scores]);
  const has = (l: DeckLine, key: string) => (roleKeys.get(l.card.oracle_id) ?? []).includes(key);
  const mdfcIds = useMemo(() => lines.filter((l) => l.card.counts_as_land && !isLand(l.card.type_line)).map((l) => l.card.oracle_id), [lines]);
  const text = useLandText(mdfcIds);
  const advice = useMemo(
    () => landAdvice(lines, (l) => has(l, "ramp") || has(l, "draw"), text ? (id) => text.get(id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, roleKeys, text],
  );
  const cheapSpells = lines.filter((l) => !isLand(l.card.type_line) && l.card.mana_value <= KARSTEN.cheapMaxValue);
  const cheapRamp = copies(cheapSpells.filter((l) => has(l, "ramp")));
  const cheapDraw = copies(cheapSpells.filter((l) => has(l, "draw")));
  const gap = landGap(advice);
  const off = Math.abs(gap) >= 2;
  const target = roles.find((r) => r.key === "lands")?.target;
  const nameOf = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  const cards: CheckCard[] = useMemo(
    () =>
      scores.map((s) => ({
        oracle_id: s.entry.card.oracle_id,
        name: s.entry.card.name,
        quantity: s.entry.quantity,
        mana_value: s.entry.card.mana_value,
        spell: !isLand(s.entry.card.type_line),
        commander: s.entry.commander,
        roles: s.entry.roles.filter((k) => k !== "lands"),
        themes: s.facts.themes.length,
        cheat: s.flags.cheatTarget,
      })),
    [scores],
  );
  const curve = curveCheck(cards);
  const balance = balanceCheck(cards);
  const overlap = overlapCheck(cards);
  const stray = offPlan(cards);

  const chip = (c: CheckCard, extra?: string) => {
    const line = props.lineOf.get(c.oracle_id);
    return (
      <li key={c.oracle_id}>
        <button type="button" disabled={!line} onClick={() => line && props.onOpenCard(line)} className="btn min-h-11 px-3 text-xs">
          {c.name}
          {c.quantity > 1 && ` ×${c.quantity}`}
          {extra && <span className="ml-1 opacity-70">{extra}</span>}
        </button>
      </li>
    );
  };
  const status = (ok: boolean) => (ok ? <span className="text-green-700 dark:text-green-400">✓</span> : <span className="text-amber-700 dark:text-amber-400">⚠</span>);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="eyebrow">Checkup</h3>
        {props.planned && <p className="mt-1 text-xs opacity-70">These numbers already count your planned cuts and swaps.</p>}
      </div>

      <div className="panel space-y-3 p-4">
        <h4 className="flex items-center gap-2 font-semibold">
          {status(!off)} Land count
        </h4>
        <p className="text-base">
          You run <b>{landsText(advice.effective)}</b> {advice.effective === 1 ? "land" : "lands"}. We&apos;d recommend <b>{advice.recommended}</b>, based on these things:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Average mana value of your {plural(advice.spells, "spell")}: <b>{advice.average.toFixed(2)}</b>. Each point adds {KARSTEN.perManaValue} lands.
          </li>
          <li>
            Cheap ramp and card draw (mana value {KARSTEN.cheapMaxValue} or less): <b>{advice.cheap}</b> ({cheapRamp} ramp, {cheapDraw} draw). Each one stands in for {KARSTEN.perCheap} of a land.
          </li>
          {advice.mdfcs.length > 0 && (
            <li>
              Spell-and-land cards (modal double-faced) count as part of a land: {MDFC_WEIGHT.tapped} if the land side enters tapped, {MDFC_WEIGHT.untapped} if it can enter untapped.{" "}
              {advice.mdfcs.map((m) => `${m.line.card.name} ${m.weight}${m.untapped === null ? " (reading…)" : ""}`).join(", ")}. That&apos;s why your {advice.lands} land drops count as {landsText(advice.effective)}.
            </li>
          )}
          <li className="opacity-80">
            Frank Karsten&apos;s formula for 99-card decks: {KARSTEN.base} + {KARSTEN.perManaValue} × {advice.average.toFixed(2)} − {KARSTEN.perCheap} × {advice.cheap} = {advice.exact.toFixed(1)}. He calls it a back-of-the-envelope estimate, so treat it as a starting point.
          </li>
        </ul>
        <p>
          Fourth land by turn four: <b>{pct(landOdds(advice.lands))}</b> with your {advice.lands}
          {advice.recommended !== advice.lands && (
            <>
              , <b>{pct(landOdds(advice.recommended))}</b> with {advice.recommended}
            </>
          )}
          . <span className="opacity-70">(Lands only, before any mulligan, drawing on turn one as everyone does in multiplayer.)</span>
        </p>
        {gap < 0 && (
          <p>
            Rather not add lands? About <b>{cheapForLands(advice.exact - advice.effective)}</b> more cheap ramp or draw spells would earn the count you run now. Cheap draw is the usual gap: popular decks run about {POPULAR.cheapRamp} cheap ramp spells but only {POPULAR.cheapDraw} cheap draw.
          </p>
        )}
        <p className="text-xs opacity-70">
          For comparison, the average decks of EDHREC&apos;s 100 most popular commanders run a median of {POPULAR.medianLands} lands (Nov 2026): what people play, not what wins. Go above the number for landfall, below it for cEDH or a very low curve.
        </p>
        <div className="flex flex-wrap gap-2">
          {props.onSetLandTarget && target !== undefined && target !== advice.recommended && (
            <button type="button" className="btn min-h-11" onClick={() => props.onSetLandTarget?.(advice.recommended)}>
              Set Lands target to {advice.recommended} (now {target})
            </button>
          )}
          {gap < 0 && (
            <>
              <button type="button" className="btn min-h-11" onClick={() => props.onSuggestRole("lands")}>
                💡 Suggest lands
              </button>
              <button type="button" className="btn min-h-11" onClick={() => props.onSuggestRole("draw")}>
                💡 Suggest card draw
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel space-y-2 p-4">
          <h4 className="flex items-center gap-2 font-semibold">{status(curve.ok)} Curve</h4>
          <p>
            Average mana value <b>{curve.average.toFixed(2)}</b>
            {curve.average > CHECKUP.curveIdeal && ` (over ${CHECKUP.curveIdeal})`}. {curve.low} of {curve.spells} spells ({pct(curve.spells ? curve.low / curve.spells : 0)}) cost 3 or less.
          </p>
          <p className="text-xs opacity-75">Lower curves play smoother: lean on 1, 2 and 3 drops. Big spells the deck cheats into play (reanimation, sneak effects) don&apos;t count here.</p>
          {curve.heavy.length > 0 && (
            <>
              <p className="text-xs">
                {plural(copies(curve.heavy), "spell")} at mana value {CHECKUP.heavyFrom}+ you cast yourself{copies(curve.heavy) > CHECKUP.heavyMax ? `, more than ${CHECKUP.heavyMax}` : ""}:
              </p>
              <ul className="flex flex-wrap gap-2">{curve.heavy.map((c) => chip(c, `MV ${c.mana_value}`))}</ul>
            </>
          )}
        </div>

        <div className="panel space-y-2 p-4">
          <h4 className="flex items-center gap-2 font-semibold">{status(balance.even)} Mana and cards</h4>
          <p>
            <span style={{ color: roleColor(nameOf("ramp")) }} className="font-semibold">
              {nameOf("ramp")}
            </span>{" "}
            {balance.ramp} ·{" "}
            <span style={{ color: roleColor(nameOf("draw")) }} className="font-semibold">
              {nameOf("draw")}
            </span>{" "}
            {balance.draw}
          </p>
          <p className="text-xs opacity-75">
            Whatever your commander leans on, keep mana and cards roughly even so you never run dry on either one.
            {balance.short && ` You're light on ${balance.short === "ramp" ? "ramp" : "card advantage"}.`}
          </p>
          {balance.short && (
            <button type="button" className="btn min-h-11" onClick={() => props.onSuggestRole(balance.short!)}>
              💡 Suggest {nameOf(balance.short)}
            </button>
          )}
        </div>

        <div className="panel space-y-2 p-4">
          <h4 className="flex items-center gap-2 font-semibold">{status(overlap.ok)} Cards that do two jobs</h4>
          <p>
            {copies(overlap.multi)} of {overlap.spells} spells ({pct(overlap.share)}) fill two or more roles.
          </p>
          <p className="text-xs opacity-75">A creature that removes something, or a mana rock that draws, is rarely a dead draw. When choosing between two cards, the one with two jobs usually wins.</p>
          {overlap.multi.length > 0 && <ul className="flex flex-wrap gap-2">{overlap.multi.slice(0, 12).map((c) => chip(c, c.roles.map(nameOf).join(" + ")))}</ul>}
        </div>

        <div className="panel space-y-2 p-4">
          <h4 className="flex items-center gap-2 font-semibold">{status(!stray.length)} Off the game plan</h4>
          {stray.length ? (
            <>
              <p>
                {plural(copies(stray), "spell")} {copies(stray) === 1 ? "fills no role and shares" : "fill no role and share"} no theme with the deck:
              </p>
              <ul className="space-y-1">
                {stray.map((c) => {
                  const line = props.lineOf.get(c.oracle_id);
                  const canCut = line?.board === "main" && !props.onFloor.has(c.oracle_id);
                  return (
                    <li key={c.oracle_id} className="flex items-center gap-2">
                      <button type="button" disabled={!line} onClick={() => line && props.onOpenCard(line)} className="min-h-11 min-w-0 flex-1 truncate text-left">
                        {c.name}
                      </button>
                      {canCut ? (
                        <button type="button" className="btn min-h-11 px-3 text-xs" onClick={() => props.onCut(c.oracle_id, "Off the game plan: no role and no shared theme")}>
                          Cut
                        </button>
                      ) : (
                        props.onFloor.has(c.oracle_id) && <span className="text-xs opacity-60">on the floor</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p>Every spell fills a role or shares a theme with the deck.</p>
          )}
          <p className="text-xs opacity-75">Every card should push toward how the deck wins. A deck that feels clunky often carries too many cards that don&apos;t.</p>
        </div>
      </div>
      <p className="text-xs opacity-60">Land math from Frank Karsten (2022). Build checks from deck-building tips by Deck Driver MTG.</p>
    </section>
  );
}
