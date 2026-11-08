"use client";

// Smart Cutter screen (v2, docs/spec.md → Smart Cutter): full-screen frosted glass like Bracket and Stats.
// The cutting-room floor lives only here (session storage for this tab, so a refresh keeps it); Apply saves every
// cut and swap as one edit: one Ctrl+Z, one Timeline entry labeled "Smart Cutter" with each card's reason.
import { useEffect, useMemo, useState } from "react";
import { candidateIssues, type ComboRow, type EvaluateInput, type Finding } from "@/lib/brackets/evaluate";
import type { BracketNumber } from "@/lib/brackets/rules";
import {
  archetypeLabel,
  chooseArchetype,
  CURVE_LABELS,
  detectArchetypes,
  effectiveCurve,
  cheatTargets,
  type CutterCard,
  type DetectedArchetype,
} from "@/lib/cutter/archetype";
import { ARCHETYPES } from "@/lib/cutter/archetypes";
import { cutReason, explainCut } from "@/lib/cutter/explain";
import { keepScores, roleCountsOf, suggestCuts, type CardScore, type CutterContext } from "@/lib/cutter/score";
import { DISMISS_REASONS, H2H_LIMIT, type CutterPrefs, type CutterState } from "@/lib/cutter/state";
import { pickSwap, pickTwoForOne, twoForOnePairs, type Pair, type SwapPick } from "@/lib/cutter/swaps";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";
import type { PoolCard } from "@/lib/suggest/score";
import { roleColor } from "@/lib/tags/pretty";
import { isLand, type ResolvedRole } from "@/lib/tags/roles";
import type { TagKey, ThemeTag } from "@/lib/tags/themes";
import type { TagTree } from "@/lib/tags/tree";
import { GlassOverlay } from "./glass-overlay";

export type CutItem = { card: CardSummary; quantity: number; reason: string };
export type AddItem = { card: CardSummary; reason: string };

type FloorCut = { oracle_id: string; quantity: number; reason: string };
type FloorAdd = { card: PoolCard; reason: string; replaces: string[] };
type Floor = { cuts: FloorCut[]; adds: FloorAdd[] };
const EMPTY: Floor = { cuts: [], adds: [] };
const floorKey = (deckId: string) => `cutter:${deckId}`;

function readFloor(deckId: string): Floor {
  try {
    const raw = sessionStorage.getItem(floorKey(deckId));
    const f = raw ? (JSON.parse(raw) as Floor) : EMPTY;
    return Array.isArray(f.cuts) && Array.isArray(f.adds) ? f : EMPTY;
  } catch {
    return EMPTY;
  }
}
function writeFloor(deckId: string, f: Floor) {
  try {
    if (!f.cuts.length && !f.adds.length) sessionStorage.removeItem(floorKey(deckId));
    else sessionStorage.setItem(floorKey(deckId), JSON.stringify(f));
  } catch {
    // Private windows can refuse storage; the floor then lasts until the page closes.
  }
}

const pctText = (n: number) => `${Math.round(n * 100)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function CutterPanel(props: {
  deckId: string;
  /** Commander(s) and mainboard. */
  lines: DeckLine[];
  roleKeysOf: (l: DeckLine) => string[];
  tagsOf: (oracleId: string) => string[];
  /** The deck's visible roles. */
  roles: ResolvedRole[];
  tree: TagTree;
  themesFor: (cards: CutterCard[]) => ThemeTag[];
  keysOf: (tags: string[]) => TagKey[];
  rolesFor: (card: CardSummary, tags: string[]) => string[];
  combos: ComboRow[];
  bracketFindings: Finding[];
  bracket: { target: BracketNumber; deck: Omit<EvaluateInput, "combos"> };
  identity: Set<string> | null;
  dismissedSuggestions: Set<string>;
  state: CutterState;
  setState: (f: (s: CutterState) => CutterState) => void;
  prefs: CutterPrefs;
  setPrefs: (f: (p: CutterPrefs) => CutterPrefs) => void;
  saveError: string | null;
  paused: boolean;
  onApply: (cuts: CutItem[], adds: AddItem[], toMaybe: boolean) => boolean;
  onOpenCard: (line: DeckLine) => void;
  onSuggestRole: (key: string) => void;
  onClose: () => void;
}) {
  const { deckId, state, setState, prefs, setPrefs } = props;
  const [floor, setFloorState] = useState<Floor>(() => readFloor(deckId));
  const setFloor = (f: (x: Floor) => Floor) =>
    setFloorState((x) => {
      const next = f(x);
      writeFloor(deckId, next);
      return next;
    });
  const [why, setWhy] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tool, setTool] = useState<"walk" | "h2h" | "two" | "whatif" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pickList, setPickList] = useState(false);

  // The deck as the cutter sees it, and with the floor taken out and swaps put in.
  const entries: CutterCard[] = useMemo(
    () =>
      props.lines.map((l) => ({
        card: l.card,
        quantity: l.quantity,
        commander: l.board === "commander",
        tags: props.tagsOf(l.card.oracle_id),
        roles: props.roleKeysOf(l),
      })),
    [props],
  );
  const lineOf = useMemo(() => new Map(props.lines.map((l) => [l.card.oracle_id, l])), [props.lines]);

  // Floor cards no longer on the mainboard (the deck changed in another tab) drop off.
  useEffect(() => {
    const onMain = new Set(props.lines.filter((l) => l.board === "main").map((l) => l.card.oracle_id));
    if (floor.cuts.some((c) => !onMain.has(c.oracle_id))) setFloor((f) => ({ ...f, cuts: f.cuts.filter((c) => onMain.has(c.oracle_id)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lines]);

  const working: CutterCard[] = useMemo(() => {
    const removed = new Map(floor.cuts.map((c) => [c.oracle_id, c.quantity]));
    const kept = entries.flatMap((e) => {
      const n = e.commander ? 0 : removed.get(e.card.oracle_id) ?? 0;
      return e.quantity - n > 0 ? [{ ...e, quantity: e.quantity - n }] : [];
    });
    const added = floor.adds.map((a) => ({ card: a.card, quantity: 1, commander: false, tags: a.card.tags, roles: props.rolesFor(a.card, a.card.tags) }));
    return [...kept, ...added];
  }, [entries, floor, props]);

  const allArchetypes = useMemo(() => [...ARCHETYPES, ...prefs.archetypes], [prefs.archetypes]);
  const ranked = useMemo(
    () => detectArchetypes({ cards: entries, tree: props.tree, combos: props.combos.length, archetypes: allArchetypes }),
    [entries, props.tree, props.combos.length, allArchetypes],
  );
  const { chosen, askToPick } = chooseArchetype(ranked, state.archetype);

  const ctx: CutterContext = useMemo(
    () => ({
      cards: working,
      roles: props.roles,
      tree: props.tree,
      themes: props.themesFor(working),
      themesFor: props.themesFor,
      keysOf: (c) => props.keysOf(c.tags),
      archetype: chosen.archetype,
      combos: props.combos,
      bracketFindings: props.bracketFindings,
      identity: props.identity,
      state,
      prefs,
    }),
    [working, props, chosen.archetype, state, prefs],
  );
  const plan = useMemo(() => suggestCuts(ctx), [ctx]);
  const scores = useMemo(() => keepScores(ctx), [ctx]);
  const scoreOf = useMemo(() => new Map(scores.map((s) => [s.entry.card.oracle_id, s])), [scores]);
  const onFloor = new Set(floor.cuts.map((c) => c.oracle_id));

  // ---------- floor actions ----------
  const cut = (s: CardScore, reason = cutReason(s)) => {
    const id = s.entry.card.oracle_id;
    setFloor((f) => {
      const have = f.cuts.find((c) => c.oracle_id === id);
      const max = entries.find((e) => e.card.oracle_id === id && !e.commander)?.quantity ?? 1;
      if (have) return have.quantity >= max ? f : { ...f, cuts: f.cuts.map((c) => (c.oracle_id === id ? { ...c, quantity: c.quantity + 1 } : c)) };
      return { ...f, cuts: [...f.cuts, { oracle_id: id, quantity: 1, reason }] };
    });
  };
  const restore = (id: string) =>
    setFloor((f) => ({
      cuts: f.cuts.filter((c) => c.oracle_id !== id),
      // A swap made for this card goes with it.
      adds: f.adds.filter((a) => !a.replaces.includes(id)),
    }));
  const swap = (pick: SwapPick, cuts: CardScore[]) => {
    setFloor((f) => ({
      cuts: [...f.cuts.filter((c) => !cuts.some((s) => s.entry.card.oracle_id === c.oracle_id)), ...cuts.map((s) => ({ oracle_id: s.entry.card.oracle_id, quantity: 1, reason: `${cutReason(s)} · swapped for ${pick.card.name}` }))],
      adds: pick.fromFloor ? f.adds : [...f.adds, { card: { ...pick.card, tags: pick.tags } as PoolCard, reason: `Swapped in for ${cuts.map((s) => s.entry.card.name).join(" and ")}`, replaces: pick.replaces }],
    }));
  };
  const removeAdd = (id: string) => setFloor((f) => ({ ...f, adds: f.adds.filter((a) => a.card.oracle_id !== id) }));
  const lock = (id: string, on: boolean) =>
    setState((s) => ({ ...s, locks: on ? [...new Set([...s.locks, id])] : s.locks.filter((x) => x !== id) }));
  const dismiss = (id: string, reason: string) => setState((s) => ({ ...s, dismissed: { ...s.dismissed, [id]: reason } }));
  const undismiss = (id: string) =>
    setState((s) => {
      const d = { ...s.dismissed };
      delete d[id];
      return { ...s, dismissed: d };
    });

  const apply = () => {
    const cuts: CutItem[] = floor.cuts.flatMap((c) => {
      const l = lineOf.get(c.oracle_id);
      return l ? [{ card: l.card, quantity: c.quantity, reason: c.reason }] : [];
    });
    const adds: AddItem[] = floor.adds.map((a) => ({ card: a.card, reason: a.reason }));
    if (props.onApply(cuts, adds, prefs.cutsToMaybe)) {
      setFloor(() => EMPTY);
      setMessage(`Applied: ${plural(cuts.reduce((n, c) => n + c.quantity, 0), "cut")}${adds.length ? `, ${plural(adds.length, "swap")}` : ""}. Ctrl+Z undoes it.`);
      setClosing(false);
    }
  };
  const pending = floor.cuts.length + floor.adds.length;
  const close = () => (pending ? setClosing(true) : props.onClose());

  // ---------- swaps: one-for-one at exactly 100, and 2-for-1 for power users ----------
  const supabase = useMemo(() => createClient(), []);
  const [swaps, setSwaps] = useState<{ key: string; picks: Record<string, SwapPick | null>; pairs: { pair: Pair; pick: SwapPick | null }[]; error?: string } | null>(null);
  const exactCuts = plan.mode === "exact" ? plan.cuts.map((c) => c.score) : [];
  // Power users' 2-for-1 pairs load with the swaps, so switching tool tabs doesn't fetch again.
  const pairs = useMemo(() => (prefs.power ? twoForOnePairs(scores) : []), [prefs.power, scores]);
  const swapKey = [...exactCuts.map((s) => s.entry.card.oracle_id), "|", ...pairs.flatMap((p) => [p.a.entry.card.oracle_id, p.b.entry.card.oracle_id])].join(",");
  useEffect(() => {
    if (!exactCuts.length && !pairs.length) return;
    let live = true;
    (async () => {
      const roleKeys = new Set([...exactCuts.flatMap((s) => s.facts.roles.map((r) => r.key)), ...pairs.flatMap((p) => p.roles)]);
      const slugs = new Set<string>();
      for (const r of props.roles) if (roleKeys.has(r.key) && r.tagSet) r.tagSet.forEach((t) => slugs.add(t));
      for (const s of exactCuts) if (!s.facts.roles.length) s.facts.themes.forEach((t) => slugs.add(t.slug));
      if (!slugs.size) return setSwaps({ key: swapKey, picks: {}, pairs: [] });
      const deckIds = [...new Set(props.lines.map((l) => l.card.oracle_id))];
      const call = () =>
        supabase.rpc("suggestion_pool", { p_slugs: [...slugs], p_identity: props.identity ? [...props.identity] : ["W", "U", "B", "R", "G"], p_exclude: deckIds, p_lands: false, p_tail: 60 });
      let res = await call();
      if (res.error && /timeout/i.test(res.error.message) && live) res = await call();
      if (!live) return;
      if (res.error) return setSwaps({ key: swapKey, picks: {}, pairs: [], error: `Couldn't load swaps: ${res.error.message}` });
      const pool = (res.data ?? []) as PoolCard[];
      const c = await supabase.rpc("combos_within", { p_ids: [...deckIds, ...pool.map((p) => p.oracle_id)] });
      if (!live) return;
      const combos = c.error ? [] : ((c.data ?? []) as ComboRow[]);
      const deck: EvaluateInput = { ...props.bracket.deck, combos };
      const skip = (p: PoolCard) =>
        props.dismissedSuggestions.has(p.oracle_id) ||
        candidateIssues(deck, { line: { board: "main", quantity: 1, card: p }, tags: p.tags }, props.bracket.target).length > 0;
      const floorEntries = entries.filter((e) => onFloor.has(e.card.oracle_id));
      const opts = { rolesFor: props.rolesFor, skip, floor: floorEntries };
      // Each card gets its own swap: a card offered once isn't offered again for the next one.
      const offered = new Set<string>();
      const fresh = { ...opts, skip: (p: PoolCard) => offered.has(p.oracle_id) || skip(p) };
      const picks: Record<string, SwapPick | null> = {};
      for (const s of exactCuts) {
        const pick = pickSwap(ctx, s, pool, fresh);
        if (pick) offered.add(pick.card.oracle_id);
        picks[s.entry.card.oracle_id] = pick;
      }
      const twoForOne = pairs.map((pair) => {
        const pick = pickTwoForOne(ctx, pair, pool, fresh);
        if (pick) offered.add(pick.card.oracle_id);
        return { pair, pick };
      });
      setSwaps({ key: swapKey, picks, pairs: twoForOne });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapKey]);
  const swapsReady = swaps?.key === swapKey ? swaps : null;

  // ---------- render ----------
  const whyScore = why ? scoreOf.get(why) ?? null : null;
  const label = archetypeLabel(chosen);
  const headline =
    plan.mode === "over"
      ? `${plan.size} cards: cut ${plan.size - 100} to reach 100`
      : plan.mode === "exact"
        ? "100 cards: the 3 weakest, each with a swap"
        : `${plan.size} cards: ${plural(plan.need, "card")} to add`;

  return (
    <GlassOverlay label="Smart Cutter" paused={props.paused} onClose={close} onEscape={() => (why ? setWhy(null) : closing ? setClosing(false) : close())}>
      <div className="mx-auto max-w-5xl space-y-6 pb-40 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">Smart Cutter</h2>
            <p className="mt-1 text-base">{headline}</p>
            {message && <p className="mt-1 text-green-700 dark:text-green-400">{message}</p>}
            {props.saveError && <p className="mt-1 text-red-400">{props.saveError}</p>}
          </div>
          <button type="button" autoFocus onClick={close} className="btn shrink-0">
            Close
          </button>
        </div>

        <ArchetypeBar
          chosen={chosen}
          label={label}
          ranked={ranked}
          state={state}
          askToPick={askToPick}
          pickList={pickList}
          onPickList={setPickList}
          onAnswer={(next) => setState((s) => ({ ...s, archetype: next }))}
        />

        {plan.mode === "under" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="eyebrow">Nothing to cut yet</h3>
            <p>Add {plural(plan.need, "more card")} first. These roles are under target:</p>
            {plan.under.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {plan.under.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-2 rounded-lg border border-foreground/15 px-3 py-2">
                    <span>
                      <span className="font-semibold" style={{ color: roleColor(r.name) }}>
                        {r.name}
                      </span>{" "}
                      {r.count} / {r.target}
                    </span>
                    <button type="button" className="btn min-h-11" onClick={() => props.onSuggestRole(r.key)}>
                      💡 Suggest
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="opacity-75">Every role is on target: any card that fits your themes will do.</p>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="eyebrow">{plan.mode === "over" ? "Suggested cuts" : "Weakest cards"}</h3>
              {plan.mode === "over" && plan.cuts.length > 1 && (
                <button type="button" className="btn btn-gold min-h-11" onClick={() => plan.cuts.forEach((c) => cut(c.score))}>
                  Cut all {plan.cuts.length}
                </button>
              )}
            </div>
            {!plan.cuts.length ? (
              <p className="panel p-4 opacity-85">
                Nothing safe to cut: every card left either holds a role at its target, is locked, is a combo piece or is a land. Lower a
                role target, or cut by hand from &quot;Every card&quot; below.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {plan.cuts.map(({ score: s }) => (
                  <CutTile key={s.entry.card.oracle_id} score={s} onWhy={() => setWhy(s.entry.card.oracle_id)}>
                    <button type="button" className="btn btn-gold min-h-11 w-full" onClick={() => cut(s)}>
                      Cut
                    </button>
                    {plan.mode === "exact" && (
                      <SwapLine
                        pick={swapsReady ? swapsReady.picks[s.entry.card.oracle_id] : undefined}
                        error={swapsReady?.error}
                        onSwap={(p) => swap(p, [s])}
                      />
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn min-h-11 px-2 text-xs" onClick={() => lock(s.entry.card.oracle_id, true)} title="Never suggest cutting this card">
                        🔒 Keep
                      </button>
                      <button
                        type="button"
                        className="btn min-h-11 px-2 text-xs"
                        onClick={() => (prefs.power ? setWhy(s.entry.card.oracle_id) : dismiss(s.entry.card.oracle_id, ""))}
                        title={prefs.power ? "Pick a reason" : "Stop suggesting this card"}
                      >
                        Not a cut
                      </button>
                    </div>
                  </CutTile>
                ))}
              </ul>
            )}
          </section>
        )}

        {prefs.power && (
          <PowerTools
            tool={tool}
            onTool={setTool}
            ctx={ctx}
            scores={scores}
            entries={entries}
            roles={props.roles}
            onFloor={onFloor}
            state={state}
            pairs={swapsReady?.pairs ?? null}
            swapError={swapsReady?.error}
            onCut={cut}
            onWhy={setWhy}
            onSwap={swap}
            onH2h={(winner, loser) => setState((s) => ({ ...s, h2h: [...s.h2h, [winner, loser] as [string, string]].slice(-H2H_LIMIT) }))}
          />
        )}

        <section>
          <button type="button" className="eyebrow min-h-11" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? "▾" : "▸"} Every card, weakest first
          </button>
          {showAll && (
            <ul className="mt-2 divide-y divide-foreground/10 rounded-lg border border-foreground/15">
              {scores
                .filter((s) => !s.entry.commander && !isLand(s.entry.card.type_line))
                .sort((a, b) => a.keep - b.keep)
                .map((s) => (
                  <li key={s.entry.card.oracle_id} className="flex items-center gap-2 px-3 py-1.5">
                    <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-left" onClick={() => setWhy(s.entry.card.oracle_id)}>
                      <span className="mr-2 inline-block w-8 text-right tabular-nums opacity-70">{pctText(s.keep)}</span>
                      {s.entry.card.name}
                      {s.protect && <span className="ml-2 text-xs opacity-60">{protectLabel(s)}</span>}
                    </button>
                    {onFloor.has(s.entry.card.oracle_id) ? (
                      <span className="text-xs opacity-60">on the floor</span>
                    ) : (
                      <button type="button" className="btn min-h-11 px-3 text-xs" onClick={() => cut(s, `Cut by hand · ${cutReason(s)}`)}>
                        Cut
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </section>

        {Object.keys(state.dismissed).length > 0 && (
          <section>
            <h3 className="eyebrow mb-2">Not cuts ({Object.keys(state.dismissed).length})</h3>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(state.dismissed).map(([id, reason]) => (
                <li key={id} className="flex items-center gap-2 rounded-lg border border-foreground/15 px-3 py-1">
                  {lineOf.get(id)?.card.name ?? "A card no longer in the deck"}
                  {reason && <span className="text-xs opacity-60">({reason})</span>}
                  <button type="button" className="min-h-9 text-xs text-gold" onClick={() => undismiss(id)}>
                    Bring back
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <FloorBar
        floor={floor}
        lineOf={lineOf}
        toMaybe={prefs.cutsToMaybe}
        onToMaybe={(on) => setPrefs((p) => ({ ...p, cutsToMaybe: on }))}
        onRestore={restore}
        onRemoveAdd={removeAdd}
        onApply={apply}
        onDiscard={() => setFloor(() => EMPTY)}
      />

      {whyScore && (
        <WhySheet
          score={whyScore}
          ctx={ctx}
          archetypeName={label}
          power={prefs.power}
          locked={state.locks.includes(whyScore.entry.card.oracle_id)}
          dismissed={whyScore.entry.card.oracle_id in state.dismissed}
          curveOverride={state.curve[whyScore.entry.card.oracle_id]}
          onFloor={onFloor.has(whyScore.entry.card.oracle_id)}
          onCut={() => cut(whyScore)}
          onRestore={() => restore(whyScore.entry.card.oracle_id)}
          onLock={(on) => lock(whyScore.entry.card.oracle_id, on)}
          onDismiss={(reason) => {
            dismiss(whyScore.entry.card.oracle_id, reason);
            setWhy(null);
          }}
          onUndismiss={() => undismiss(whyScore.entry.card.oracle_id)}
          onCurve={(v) =>
            setState((s) => {
              const curve = { ...s.curve };
              if (v) curve[whyScore.entry.card.oracle_id] = v;
              else delete curve[whyScore.entry.card.oracle_id];
              return { ...s, curve };
            })
          }
          onOpenCard={() => {
            const l = lineOf.get(whyScore.entry.card.oracle_id);
            if (l) props.onOpenCard(l);
          }}
          onClose={() => setWhy(null)}
        />
      )}

      {closing && (
        <div role="alertdialog" aria-label="Unapplied cuts" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && setClosing(false)}>
          <div className="panel w-full max-w-md space-y-3 bg-panel-raised p-5">
            <h3 className="display text-xl">Apply {plural(floor.cuts.length + floor.adds.length, "change")}?</h3>
            <p className="opacity-85">The cutting-room floor goes away when you leave. Apply saves it as one edit (Ctrl+Z undoes it).</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" className="btn btn-gold min-h-11" onClick={() => (apply(), props.onClose())}>
                Apply
              </button>
              <button
                type="button"
                className="btn min-h-11"
                onClick={() => {
                  setFloor(() => EMPTY);
                  props.onClose();
                }}
              >
                Discard
              </button>
              <button type="button" className="btn min-h-11" onClick={() => setClosing(false)}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </GlassOverlay>
  );
}

function protectLabel(s: CardScore) {
  const p = s.protect!;
  return p.kind === "lock" ? "🔒 locked" : p.kind === "combo" ? "combo piece" : p.kind === "below-target" ? "holds a role" : p.kind === "no-tags" ? "no tags yet" : p.kind === "dismissed" ? "not a cut" : "";
}

// ---------- archetype ----------

function ArchetypeBar(props: {
  chosen: DetectedArchetype;
  label: string;
  ranked: DetectedArchetype[];
  state: CutterState;
  askToPick: boolean;
  pickList: boolean;
  onPickList: (on: boolean) => void;
  onAnswer: (a: CutterState["archetype"]) => void;
}) {
  const { chosen, state } = props;
  const key = chosen.archetype.key;
  const settled = state.archetype.status !== "auto" && state.archetype.key === key;
  const why = chosen.evidence[0] ? ` (${chosen.evidence[0].count} ${chosen.evidence[0].label})` : "";
  const list = (
    <select
      className="min-h-11 rounded-lg border border-foreground/20 bg-background px-2"
      value=""
      aria-label="Pick an archetype"
      onChange={(e) => {
        props.onAnswer({ key: e.target.value, status: "picked", rejected: state.archetype.rejected });
        props.onPickList(false);
      }}
    >
      <option value="" disabled>
        Pick an archetype…
      </option>
      {[...props.ranked].sort((a, b) => a.archetype.name.localeCompare(b.archetype.name)).map((d) => (
        <option key={d.archetype.key} value={d.archetype.key}>
          {archetypeLabel(d)}
        </option>
      ))}
    </select>
  );
  return (
    <section className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      {settled ? (
        <>
          <span>
            Archetype: <strong>{props.label}</strong>
          </span>
          <button type="button" className="min-h-11 text-gold underline" onClick={() => props.onAnswer({ key: null, status: "auto", rejected: [] })}>
            Change
          </button>
        </>
      ) : props.askToPick && !props.pickList ? (
        <>
          <span>
            Next guess: <strong>{props.label}</strong>. Pick an archetype from the list, or keep seeing suggestions?
          </span>
          <button type="button" className="btn min-h-11" onClick={() => props.onPickList(true)}>
            Pick from the list
          </button>
          <button type="button" className="btn min-h-11" onClick={() => props.onAnswer({ key, status: "confirmed", rejected: state.archetype.rejected })}>
            Yes, {props.label}
          </button>
          <button type="button" className="btn min-h-11" onClick={() => props.onAnswer({ ...state.archetype, rejected: [...state.archetype.rejected, key] })}>
            Keep suggesting
          </button>
        </>
      ) : props.pickList ? (
        <>
          {list}
          <button type="button" className="btn min-h-11" onClick={() => props.onPickList(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span title="Used for the expected mana curve">
            Detected: <strong>{props.label}</strong>
            <span className="opacity-70">{why}</span>. Is this your archetype?
          </span>
          <button type="button" className="btn min-h-11" onClick={() => props.onAnswer({ key, status: "confirmed", rejected: state.archetype.rejected })}>
            Yes
          </button>
          <button type="button" className="btn min-h-11" onClick={() => props.onAnswer({ ...state.archetype, rejected: [...state.archetype.rejected, key] })}>
            No
          </button>
        </>
      )}
    </section>
  );
}

// ---------- cards ----------

function CutTile({ score, onWhy, children }: { score: CardScore; onWhy: () => void; children?: React.ReactNode }) {
  const c = score.entry.card;
  return (
    <li className="space-y-2">
      <button type="button" onClick={onWhy} title={`Why ${c.name}?`} className="relative block w-full rounded-[5%/3.6%] hover:brightness-110">
        {c.image_normal ? (
          <img src={c.image_normal} alt={c.name} loading="lazy" width={244} height={340} className="block w-full rounded-[4.75%/3.5%] shadow" />
        ) : (
          <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/20 p-2 text-center">{c.name}</span>
        )}
        <span className="pointer-events-none absolute right-1.5 top-[7%] rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">
          keep {pctText(score.keep)}
        </span>
        {score.flags.bracket.length > 0 && (
          <span className="pointer-events-none absolute left-1.5 top-[7%] rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-black">⚠</span>
        )}
      </button>
      <p className="text-[13px] leading-snug">
        <span className="font-semibold">{c.name}</span>
        <br />
        <span className="opacity-80">{cutReason(score)}</span>{" "}
        <button type="button" onClick={onWhy} className="min-h-9 text-gold underline">
          Why?
        </button>
      </p>
      {children}
    </li>
  );
}

function SwapLine({ pick, error, onSwap }: { pick: SwapPick | null | undefined; error?: string; onSwap: (p: SwapPick) => void }) {
  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (pick === undefined) return <p className="text-xs opacity-60">Looking for a swap…</p>;
  if (!pick) return <p className="text-xs opacity-60">No better card found for its roles.</p>;
  return (
    <button type="button" className="btn min-h-11 w-full px-2 text-xs" onClick={() => onSwap(pick)} title={`Cut it and add ${pick.card.name}`}>
      ⇄ Swap for {pick.card.name}
    </button>
  );
}

// ---------- the floor ----------

function FloorBar(props: {
  floor: Floor;
  lineOf: Map<string, DeckLine>;
  toMaybe: boolean;
  onToMaybe: (on: boolean) => void;
  onRestore: (id: string) => void;
  onRemoveAdd: (id: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { floor } = props;
  // Open on wide screens; on phones the list starts folded so it doesn't cover the cards.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches);
  if (!floor.cuts.length && !floor.adds.length) return null;
  const n = floor.cuts.reduce((s, c) => s + c.quantity, 0);
  return (
    <div className="fixed inset-x-0 bottom-0 z-[55] border-t border-foreground/15 bg-panel-raised/95 px-4 py-2 shadow-2xl backdrop-blur sm:px-8 sm:py-3">
      <div className="mx-auto max-w-5xl space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-left font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "▾" : "▸"} Floor: {plural(n, "cut")}
            {floor.adds.length > 0 && `, ${plural(floor.adds.length, "swap")}`}
          </button>
          <label className="hidden min-h-11 items-center gap-2 sm:flex">
            <input type="checkbox" checked={props.toMaybe} onChange={(e) => props.onToMaybe(e.target.checked)} className="h-5 w-5" />
            Send cuts to the maybeboard
          </label>
          <button type="button" className="btn min-h-11 shrink-0" onClick={props.onDiscard}>
            Discard
          </button>
          <button type="button" className="btn btn-gold min-h-11 shrink-0" onClick={props.onApply}>
            Apply
          </button>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-xs sm:hidden">
          <input type="checkbox" checked={props.toMaybe} onChange={(e) => props.onToMaybe(e.target.checked)} className="h-5 w-5" />
          Send cuts to the maybeboard
        </label>
        {open && (
          <ul className="max-h-[32vh] space-y-1 overflow-y-auto">
            {floor.cuts.map((c) => (
              <li key={c.oracle_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="text-red-400">−</span> {c.quantity > 1 && `${c.quantity} `}
                  {props.lineOf.get(c.oracle_id)?.card.name ?? "Card"} <span className="text-xs opacity-65">{c.reason}</span>
                </span>
                <button type="button" className="min-h-11 shrink-0 px-2 text-gold" onClick={() => props.onRestore(c.oracle_id)}>
                  Restore
                </button>
              </li>
            ))}
            {floor.adds.map((a) => (
              <li key={a.card.oracle_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="text-green-700 dark:text-green-400">+</span> {a.card.name} <span className="text-xs opacity-65">{a.reason}</span>
                </span>
                <button type="button" className="min-h-11 shrink-0 px-2 text-gold" onClick={() => props.onRemoveAdd(a.card.oracle_id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- why ----------

function WhySheet(props: {
  score: CardScore;
  ctx: CutterContext;
  archetypeName: string;
  power: boolean;
  locked: boolean;
  dismissed: boolean;
  curveOverride?: "curve" | "cheat";
  onFloor: boolean;
  onCut: () => void;
  onRestore: () => void;
  onLock: (on: boolean) => void;
  onDismiss: (reason: string) => void;
  onUndismiss: () => void;
  onCurve: (v: "curve" | "cheat" | null) => void;
  onOpenCard: () => void;
  onClose: () => void;
}) {
  const s = props.score;
  const c = s.entry.card;
  const e = explainCut(s, props.ctx.archetype, props.archetypeName);
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={(ev) => ev.target === ev.currentTarget && props.onClose()}>
      <div role="dialog" aria-label={`Why ${c.name}`} className="panel max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-b-none bg-panel-raised p-5 sm:rounded-b-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="display text-2xl">{c.name}</h3>
            <p className="opacity-75">
              Keep score {pctText(s.keep)} of 100{s.protect ? ` · ${s.protect.detail}` : ""}
            </p>
          </div>
          <button type="button" className="btn shrink-0" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr]">
          <button type="button" onClick={props.onOpenCard} title="Open the card" className="mx-auto block w-40">
            {c.image_normal ? <img src={c.image_normal} alt={c.name} className="w-full rounded-[4.75%/3.5%] shadow" /> : <span>{c.name}</span>}
          </button>
          <div className="space-y-3">
            <div>
              <h4 className="eyebrow mb-1">What it does for the deck</h4>
              {e.hits.length ? (
                <ul className="space-y-0.5">
                  {e.hits.map((h) => (
                    <li key={h.label}>
                      <span className="font-semibold">{h.label}</span> <span className="opacity-80">{h.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="opacity-80">No role and none of your top themes.</p>
              )}
            </div>
            <p>
              <span className="eyebrow mr-1">In its role</span> {e.rank}
            </p>
            <p>
              <span className="eyebrow mr-1">Curve</span> {e.curve}
            </p>
            {e.flags.length > 0 && (
              <ul className="text-amber-800 dark:text-amber-300">
                {e.flags.map((f) => (
                  <li key={f}>⚠ {f}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="mt-4">
          <h4 className="eyebrow mb-1">Score breakdown</h4>
          <ul className="space-y-1.5">
            {e.parts.map((p) => (
              <li key={p.part} className="grid grid-cols-[110px_60px_1fr] items-center gap-2">
                <span>{p.label}</span>
                <span className="h-2 overflow-hidden rounded bg-foreground/10" aria-label={`${pctText(p.value)} of 100`}>
                  <span className="block h-full bg-gold" style={{ width: `${Math.round(p.value * 100)}%` }} />
                </span>
                <span className="opacity-80">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {props.onFloor ? (
            <button type="button" className="btn min-h-11" onClick={props.onRestore}>
              Restore
            </button>
          ) : (
            !s.entry.commander && (
              <button type="button" className="btn btn-gold min-h-11" onClick={props.onCut}>
                Cut
              </button>
            )
          )}
          <button type="button" className="btn min-h-11" onClick={() => props.onLock(!props.locked)}>
            {props.locked ? "🔓 Unlock" : "🔒 Never suggest"}
          </button>
          {props.dismissed ? (
            <button type="button" className="btn min-h-11" onClick={props.onUndismiss}>
              Suggest it again
            </button>
          ) : props.power ? (
            <div className="flex gap-1">
              <select value={reason} onChange={(ev) => setReason(ev.target.value)} aria-label="Why it isn't a cut" className="min-h-11 min-w-0 flex-1 rounded-lg border border-foreground/20 bg-background px-1">
                {DISMISS_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button type="button" className="btn min-h-11 px-2" onClick={() => props.onDismiss(reason)}>
                Not a cut
              </button>
            </div>
          ) : (
            <button type="button" className="btn min-h-11" onClick={() => props.onDismiss("")}>
              Not a cut
            </button>
          )}
        </div>
        {props.power && !isLand(c.type_line) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="opacity-75">On the curve:</span>
            {(["auto", "curve", "cheat"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={(props.curveOverride ?? "auto") === v}
                onClick={() => props.onCurve(v === "auto" ? null : v)}
                className={`min-h-11 rounded-lg border px-3 ${(props.curveOverride ?? "auto") === v ? "border-gold bg-gold text-gold-ink" : "border-foreground/20"}`}
              >
                {v === "auto" ? "Automatic" : v === "curve" ? "Count it" : "Cheated in"}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- power user tools ----------

function PowerTools(props: {
  tool: "walk" | "h2h" | "two" | "whatif" | null;
  onTool: (t: "walk" | "h2h" | "two" | "whatif" | null) => void;
  ctx: CutterContext;
  scores: CardScore[];
  entries: CutterCard[];
  roles: ResolvedRole[];
  onFloor: Set<string>;
  state: CutterState;
  pairs: { pair: Pair; pick: SwapPick | null }[] | null;
  swapError?: string;
  onCut: (s: CardScore, reason?: string) => void;
  onWhy: (id: string) => void;
  onSwap: (p: SwapPick, cuts: CardScore[]) => void;
  onH2h: (winner: string, loser: string) => void;
}) {
  const tabs = [
    ["walk", "Walkthrough"],
    ["h2h", "Head to head"],
    ["two", "2-for-1 swaps"],
    ["whatif", "What-if"],
  ] as const;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Power user tools">
        {tabs.map(([k, name]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={props.tool === k}
            onClick={() => props.onTool(props.tool === k ? null : k)}
            className={`min-h-11 rounded-lg border px-3 ${props.tool === k ? "border-gold bg-gold text-gold-ink" : "border-foreground/20"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {props.tool === "walk" && <Walkthrough {...props} />}
      {props.tool === "h2h" && <HeadToHead {...props} />}
      {props.tool === "two" && (
        <div className="panel space-y-2 p-4">
          <p className="opacity-80">Two cards that each fill one role, swapped for one card that fills both.</p>
          {props.swapError ? (
            <p className="text-red-400">{props.swapError}</p>
          ) : !props.pairs ? (
            <p className="opacity-60">Looking for swaps…</p>
          ) : !props.pairs.some((p) => p.pick) ? (
            <p className="opacity-70">No card found that fills both roles of any pair and scores higher.</p>
          ) : (
            <ul className="space-y-2">
              {props.pairs
                .filter((p) => p.pick)
                .map(({ pair, pick }) => (
                  <li key={pair.a.entry.card.oracle_id + pair.b.entry.card.oracle_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/15 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      Cut <strong>{pair.a.entry.card.name}</strong> ({pair.a.facts.roles[0].name}) and <strong>{pair.b.entry.card.name}</strong> ({pair.b.facts.roles[0].name}), add{" "}
                      <strong>{pick!.card.name}</strong>
                    </span>
                    <button type="button" className="btn min-h-11" onClick={() => props.onSwap(pick!, [pair.a, pair.b])}>
                      ⇄ Swap
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {props.tool === "whatif" && <WhatIf {...props} />}
    </section>
  );
}

function Walkthrough(props: { ctx: CutterContext; scores: CardScore[]; roles: ResolvedRole[]; onFloor: Set<string>; onCut: (s: CardScore, reason?: string) => void; onWhy: (id: string) => void }) {
  const counts = roleCountsOf(props.ctx.cards);
  const over = props.roles.filter((r) => !r.land && (counts[r.key] ?? 0) > r.target);
  const [i, setI] = useState(0);
  if (!over.length) return <p className="panel p-4 opacity-80">No role is over its target.</p>;
  const role = over[Math.min(i, over.length - 1)];
  const inRole = props.scores.filter((s) => !s.entry.commander && s.entry.roles.includes(role.key)).sort((a, b) => a.keep - b.keep);
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-semibold" style={{ color: roleColor(role.name) }}>
            {role.name}
          </span>{" "}
          {counts[role.key]} / {role.target}: {counts[role.key] - role.target} over · role {Math.min(i, over.length - 1) + 1} of {over.length}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn min-h-11" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))}>
            ‹ Back
          </button>
          <button type="button" className="btn min-h-11" disabled={i >= over.length - 1} onClick={() => setI((n) => n + 1)}>
            Next role ›
          </button>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {inRole.map((s, k) => (
          <li key={s.entry.card.oracle_id} className={`space-y-1 rounded-lg p-1 ${k === 0 && !s.protect ? "ring-2 ring-red-400" : ""}`}>
            <button type="button" onClick={() => props.onWhy(s.entry.card.oracle_id)} className="block w-full">
              {s.entry.card.image_normal ? <img src={s.entry.card.image_normal} alt={s.entry.card.name} loading="lazy" className="w-full rounded-[4.75%/3.5%]" /> : s.entry.card.name}
            </button>
            <p className="text-xs">keep {pctText(s.keep)}{s.protect ? ` · ${protectLabel(s)}` : k === 0 ? " · weakest" : ""}</p>
            {!s.protect && !props.onFloor.has(s.entry.card.oracle_id) && (
              <button type="button" className="btn min-h-11 w-full text-xs" onClick={() => props.onCut(s, `Walkthrough · ${cutReason(s)}`)}>
                Cut
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeadToHead(props: { scores: CardScore[]; roles: ResolvedRole[]; state: CutterState; onH2h: (w: string, l: string) => void; onWhy: (id: string) => void }) {
  // The pair compared least so far among same-role cards with the closest keep scores.
  const seen = new Map<string, number>();
  for (const [a, b] of props.state.h2h) {
    const k = [a, b].sort().join("|");
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let best: { a: CardScore; b: CardScore; role: string; cost: number } | null = null;
  for (const r of props.roles) {
    if (r.land) continue;
    const list = props.scores.filter((s) => !s.entry.commander && s.entry.roles.includes(r.key)).sort((x, y) => x.keep - y.keep);
    for (let i = 0; i + 1 < list.length; i++) {
      const [a, b] = [list[i], list[i + 1]];
      const cost = (seen.get([a.entry.card.oracle_id, b.entry.card.oracle_id].sort().join("|")) ?? 0) * 10 + Math.abs(a.keep - b.keep);
      if (!best || cost < best.cost) best = { a, b, role: r.name, cost };
    }
  }
  if (!best) return <p className="panel p-4 opacity-80">No role has two cards to compare yet.</p>;
  const { a, b, role } = best;
  return (
    <div className="panel space-y-3 p-4">
      <p>
        Two {role} cards. <strong>Which one stays?</strong> <span className="opacity-70">({plural(props.state.h2h.length, "pick")} so far; they count toward &quot;weakest in role&quot;)</span>
      </p>
      <div className="grid grid-cols-2 gap-4 sm:max-w-md">
        {[a, b].map((s, k) => (
          <div key={s.entry.card.oracle_id} className="space-y-2">
            <button type="button" onClick={() => props.onWhy(s.entry.card.oracle_id)} className="block w-full">
              {s.entry.card.image_normal ? <img src={s.entry.card.image_normal} alt={s.entry.card.name} className="w-full rounded-[4.75%/3.5%]" /> : s.entry.card.name}
            </button>
            <button type="button" className="btn btn-gold min-h-11 w-full" onClick={() => props.onH2h(s.entry.card.oracle_id, (k ? a : b).entry.card.oracle_id)}>
              Keep this one
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatIf(props: { ctx: CutterContext; entries: CutterCard[]; roles: ResolvedRole[] }) {
  const before = roleCountsOf(props.entries);
  const after = roleCountsOf(props.ctx.cards);
  const cheatBefore = cheatTargets(props.entries, props.ctx.tree, props.ctx.archetype, props.ctx.state?.curve);
  const cheatAfter = cheatTargets(props.ctx.cards, props.ctx.tree, props.ctx.archetype, props.ctx.state?.curve);
  const curveBefore = effectiveCurve(props.entries, cheatBefore.targets);
  const curveAfter = effectiveCurve(props.ctx.cards, cheatAfter.targets);
  const max = Math.max(1, ...props.ctx.archetype.curve, ...curveBefore.shares, ...curveAfter.shares);
  return (
    <div className="panel grid gap-6 p-4 sm:grid-cols-2">
      <div>
        <h4 className="eyebrow mb-2">Roles: now → after the floor</h4>
        <ul className="space-y-1">
          {props.roles.map((r) => {
            const a = after[r.key] ?? 0;
            return (
              <li key={r.key} className="flex items-center justify-between gap-2">
                <span style={{ color: roleColor(r.name) }}>{r.name}</span>
                <span className={a < r.target ? "text-amber-700 dark:text-amber-300" : a === r.target ? "text-green-700 dark:text-green-400" : "opacity-80"}>
                  {before[r.key] ?? 0} → {a} / {r.target}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h4 className="eyebrow mb-2">Curve (share of spells): now, after, expected</h4>
        <div className="flex h-40 items-end gap-2">
          {CURVE_LABELS.map((lbl, b) => (
            <div key={lbl} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end gap-0.5">
                <span className="flex-1 rounded-t bg-foreground/30" style={{ height: `${(curveBefore.shares[b] / max) * 100}%` }} title={`Now ${Math.round(curveBefore.shares[b])}%`} />
                <span className="flex-1 rounded-t bg-gold" style={{ height: `${(curveAfter.shares[b] / max) * 100}%` }} title={`After ${Math.round(curveAfter.shares[b])}%`} />
                <span className="flex-1 rounded-t border border-dashed border-foreground/50" style={{ height: `${(props.ctx.archetype.curve[b] / max) * 100}%` }} title={`Expected ${props.ctx.archetype.curve[b]}%`} />
              </div>
              <span className="text-xs">{lbl}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs opacity-70">Grey: now · gold: after · dashed: what {props.ctx.archetype.name} expects</p>
      </div>
    </div>
  );
}
