"use client";

// Suggestions (Phase 4a). Asks suggestion_pool() (migration 0012) for candidates, scores them in the browser
// against the deck's theme tags and under-target roles (src/lib/suggest/score.ts), and shows why each card fits.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { prettyTag } from "@/lib/tags/pretty";
import type { Board, CardSummary } from "@/lib/deck/model";
import {
  pickStaples,
  scorePool,
  STYLE_LABELS,
  type PoolCard,
  type ScoreContext,
  type Scored,
  type SuggestSettings,
  type SuggestStyle,
} from "@/lib/suggest/score";
import { candidateIssues, type ComboRow, type EvaluateInput, type Finding } from "@/lib/brackets/evaluate";
import type { BracketNumber } from "@/lib/brackets/rules";
import { cardFlag } from "./bracket-panel";
import { Panel } from "./deck-text-panel";

/** What the suggestions are for: a role, a tag, or the deck overall. */
export type SuggestSource = {
  label: string;
  /** Oracle tag slugs, each with its descendants. Empty with `lands`. */
  slugs: string[];
  lands?: boolean;
  /** Set for a role: only cards that really fill it are kept (Targeted removal leaves out board wipes). */
  roleKey?: string;
  /** Overall Suggest: tag slugs of the roles to find staples for (most-played cards, themes or not). */
  staples?: string[];
  /** Overall Suggest while the deck is under its Lands target: how many lands it's short (v2). */
  landsShort?: number;
};

type Props = {
  source: SuggestSource;
  identity: string[];
  /** Cards in the deck when the panel asked (left out of the pool). */
  deckIds: string[];
  isInDeck: (oracleId: string) => boolean;
  score: Omit<ScoreContext, "dismissed" | "limit">;
  roleNames: Record<string, string>;
  hasCommander: boolean;
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary) => void;
  onClose: () => void;
  /** Phase 4b: change the deck's suggestion style (saved per deck). */
  onSettings: (s: SuggestSettings) => void;
  saveError: string | null;
  /** Phase 4c: cards marked "Not for this deck". */
  dismissed: Set<string>;
  onDismiss: (card: CardSummary) => void;
  onRestore: (oracleId: string) => void;
  /**
   * Phase 5c: cards that would push the deck above its target bracket are hidden unless shown with the toggle.
   * `deck` is the 100-card deck as the bracket check sees it; `deckIds` are its card ids (for combo lookups).
   */
  bracket: { target: BracketNumber; deck: Omit<EvaluateInput, "combos">; deckIds: string[] };
};

export function SuggestPanel(props: Props) {
  const { source, identity, deckIds, isInDeck, score, roleNames, hasCommander, onAdd, onPreview, onClose } = props;
  const supabase = useMemo(() => createClient(), []);
  const [pool, setPool] = useState<PoolCard[] | null>(null);
  // Overall Suggest only: most-played cards for the roles the deck is short on.
  const [staplePool, setStaplePool] = useState<PoolCard[]>([]);
  // Overall Suggest under the Lands target only: lands, ranked like role picks.
  const [landPool, setLandPool] = useState<PoolCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [combos, setCombos] = useState<ComboRow[] | null>(null);
  const [showAbove, setShowAbove] = useState(false);
  const requestKey = `${source.label}|${source.lands ? "lands" : source.slugs.join(",")}|${source.staples?.join(",") ?? ""}|${source.landsShort ? "L" : ""}|${identity.join("")}`;

  useEffect(() => {
    let live = true;
    setPool(null);
    setStaplePool([]);
    setLandPool([]);
    setCombos(null);
    setError(null);
    (async () => {
      const ask = async (slugs: string[], lands: boolean, tail: number) => {
        const call = () => supabase.rpc("suggestion_pool", { p_slugs: slugs, p_identity: identity, p_exclude: deckIds, p_lands: lands, p_tail: tail });
        let res = await call();
        // The first call after a quiet spell can hit the database's time limit while it loads the tag tables
        // into memory; the second try runs warm.
        if (res.error && /timeout/i.test(res.error.message) && live) res = await call();
        return res;
      };
      // Staples need only the most-played end, so no least-played tail.
      const [main, staples, lands] = await Promise.all([
        ask(source.slugs, !!source.lands, 60),
        source.staples?.length ? ask(source.staples, false, 0) : Promise.resolve({ data: [], error: null }),
        source.landsShort ? ask([], true, 60) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!live) return;
      if (main.error) return setError(`Couldn't load suggestions: ${main.error.message}`);
      const found = (main.data ?? []) as PoolCard[];
      const foundStaples = staples.error ? [] : ((staples.data ?? []) as PoolCard[]);
      const foundLands = lands.error ? [] : ((lands.data ?? []) as PoolCard[]);
      // Combos between the deck and the candidates, so a card that completes one can be held back (5c).
      const ids = [...new Set([...props.bracket.deckIds, ...found.map((c) => c.oracle_id), ...foundStaples.map((c) => c.oracle_id), ...foundLands.map((c) => c.oracle_id)])];
      const c = ids.length ? await supabase.rpc("combos_within", { p_ids: ids }) : { data: [], error: null };
      if (!live) return;
      setCombos(c.error ? [] : ((c.data ?? []) as ComboRow[]));
      if (c.error) setError(`Couldn't check combos, so suggestions may include some: ${c.error.message}`);
      setStaplePool(foundStaples);
      setLandPool(foundLands);
      setPool(found);
    })();
    return () => {
      live = false;
    };
    // Re-ask only when what we're suggesting for changes; cards added meanwhile are filtered out below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, supabase]);

  const target = props.bracket.target;
  const eligible = pool && combos ? pool.filter((c) => !isInDeck(c.oracle_id) && (!source.roleKey || score.rolesOf(c).includes(source.roleKey))) : [];
  const eligibleStaples = pool && combos ? staplePool.filter((c) => !isInDeck(c.oracle_id)) : [];
  const eligibleLands = pool && combos ? landPool.filter((c) => !isInDeck(c.oracle_id)) : [];
  const deckInput: EvaluateInput = { ...props.bracket.deck, combos: combos ?? [] };
  const issues = new Map<string, Finding[]>();
  for (const c of [...eligible, ...eligibleStaples, ...eligibleLands]) {
    if (issues.has(c.oracle_id)) continue;
    const found = candidateIssues(deckInput, { line: { board: "main", quantity: 1, card: c }, tags: c.tags }, target);
    if (found.length) issues.set(c.oracle_id, found);
  }
  const allowed = (c: PoolCard) => showAbove || !issues.has(c.oracle_id);
  // Hidden gems is about less-played cards, so no staples there; Budget keeps them under the price cap.
  const { style, priceCap } = score.settings;
  const staples: Scored[] =
    style === "gems"
      ? []
      : pickStaples(
          eligibleStaples.filter((c) => allowed(c) && (style !== "budget" || (c.price_usd != null && Number(c.price_usd) <= priceCap))),
          { ...score, dismissed: props.dismissed },
        );
  const stapleIds = new Set(staples.map((r) => r.card.oracle_id));
  // Lands while the deck is short of its target: themes, how cheap and how played, like a role's picks; up to 8.
  const lands: Scored[] = source.landsShort
    ? scorePool(
        eligibleLands.filter((c) => allowed(c) && (style !== "budget" || (c.price_usd != null && Number(c.price_usd) <= priceCap))),
        { ...score, dismissed: props.dismissed, role: true, limit: 8 },
      )
    : [];
  const landIds = new Set(lands.map((r) => r.card.oracle_id));
  // A staple shows once, in the Staples row.
  const hiddenAbove = new Set(
    [...eligible, ...eligibleStaples, ...eligibleLands].filter((c) => issues.has(c.oracle_id) && !props.dismissed.has(c.oracle_id)).map((c) => c.oracle_id),
  ).size;
  const rows: Scored[] = scorePool(
    eligible.filter((c) => allowed(c) && !stapleIds.has(c.oracle_id) && !landIds.has(c.oracle_id)),
    { ...score, dismissed: props.dismissed, role: !!source.roleKey },
  );
  const nameOf = (x: string) =>
    pool?.find((c) => c.oracle_id === x)?.name ??
    staplePool.find((c) => c.oracle_id === x)?.name ??
    landPool.find((c) => c.oracle_id === x)?.name ??
    props.bracket.deck.lines.find((l) => l.card.oracle_id === x)?.card.name ??
    "a card in your deck";
  const flagsOf = (id: string) => (issues.get(id) ?? []).map((f) => cardFlag(f, id, nameOf));
  const cardFor = (r: Scored, best: boolean) => (
    <SuggestionCard
      key={r.card.oracle_id}
      best={best}
      row={r}
      roleNames={roleNames}
      above={flagsOf(r.card.oracle_id)}
      target={target}
      onAdd={onAdd}
      onPreview={onPreview}
      onDismiss={props.onDismiss}
    />
  );

  return (
    <Panel title={`Suggestions: ${prettyTag(source.label)}`} onClose={onClose}>
      <StyleControls settings={score.settings} onChange={props.onSettings} />
      {props.saveError && <p className="mt-1 text-sm text-red-400">{props.saveError}</p>}
      {!hasCommander && <p className="mt-2 text-sm opacity-70">No commander yet, so every color is allowed.</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!error && (pool === null || combos === null) && (
        <>
          <p className="mt-3 text-sm opacity-80">Finding cards that fit… the first search can take a few seconds.</p>
          <ul aria-hidden className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="aspect-[63/88] animate-pulse rounded-xl bg-foreground/10" />
            ))}
          </ul>
        </>
      )}
      {(hiddenAbove > 0 || showAbove) && (
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={showAbove} onChange={(e) => setShowAbove(e.target.checked)} />
          Show cards above bracket {target}
          <span className="opacity-60">({hiddenAbove} {showAbove ? "marked" : "hidden"})</span>
        </label>
      )}
      {lands.length > 0 && (
        <section aria-label="Lands" className="mt-3">
          <h3 className="eyebrow">
            Lands: you&apos;re {source.landsShort} short of your target
          </h3>
          <p className="text-[13px] opacity-70">Ranked like the other picks: your themes, then how widely played. More → Auto build land base fills them all at once.</p>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
            {lands.map((r) => cardFor(r, false))}
          </ul>
          {!staples.length && rows.length > 0 && <h3 className="eyebrow mt-5">Built for this deck</h3>}
        </section>
      )}
      {staples.length > 0 && (
        <section aria-label="Staples" className="mt-3">
          <h3 className="eyebrow">Staples for roles you&apos;re short on</h3>
          <p className="text-[13px] opacity-70">The most-played cards in your colors that fill them, themes or not.</p>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
            {staples.map((r) => cardFor(r, false))}
          </ul>
          {rows.length > 0 && <h3 className="eyebrow mt-5">Built for this deck</h3>}
        </section>
      )}
      {pool !== null && combos !== null && rows.length === 0 && !staples.length && !lands.length && (
        <p className="mt-3 text-sm opacity-60">
          {pool.length && score.settings.style === "budget"
            ? "Nothing under this price cap. Try raising it."
            : pool.length && score.settings.style === "gems"
              ? "No lesser-played cards share this deck's themes. Try Best fit."
              : "No new cards found for this in your colors."}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
          {rows.map((r, i) => cardFor(r, i === 0))}
        </ul>
      )}
      {props.dismissed.size > 0 && <DismissedList ids={[...props.dismissed]} pool={pool ?? []} onRestore={props.onRestore} />}
    </Panel>
  );
}

/** "Show dismissed (N)": the cards marked Not for this deck, each with Bring back. */
function DismissedList({ ids, pool, onRestore }: { ids: string[]; pool: PoolCard[]; onRestore: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const known: Record<string, string> = { ...Object.fromEntries(pool.map((c) => [c.oracle_id, c.name])), ...names };
  const missing = ids.filter((id) => !known[id]);

  useEffect(() => {
    if (!open || !missing.length) return;
    fetchSummaries(supabase, missing)
      .then((found) => setNames((n) => ({ ...n, ...Object.fromEntries(found.map((c) => [c.oracle_id, c.name])) })))
      .catch(() => undefined);
    // Look names up once per opening; ids missing from our data just show as "Unknown card".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supabase]);

  return (
    <div className="mt-4 border-t border-foreground/10 pt-3 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-11 rounded-lg px-2 opacity-70 hover:opacity-100">
        {open ? "Hide" : "Show"} dismissed ({ids.length})
      </button>
      {open && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {ids
            .map((id) => ({ id, name: known[id] ?? "Unknown card" }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ id, name }) => (
              <li key={id} className="flex items-center gap-1 rounded-lg border border-foreground/15 pl-3">
                <span>{name}</span>
                <button type="button" onClick={() => onRestore(id)} className="min-h-11 rounded-r-lg px-3 text-xs underline opacity-70 hover:opacity-100">
                  Bring back
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  best,
  row,
  roleNames,
  onAdd,
  onPreview,
  onDismiss,
  above,
  target,
}: {
  best: boolean;
  row: Scored;
  above: string[];
  target: BracketNumber;
  roleNames: Record<string, string>;
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary) => void;
  onDismiss: (card: CardSummary) => void;
}) {
  const { card } = row;
  return (
    <li data-preview-card className="relative flex flex-col gap-2" onMouseEnter={() => onPreview(card)}>
      {best && <span className="absolute -left-1 top-3 z-10 rounded-r-md bg-gold px-2 py-0.5 text-xs font-bold text-gold-ink shadow-lg">Best match</span>}
      <button type="button" onClick={() => onPreview(card)} onFocus={() => onPreview(card)} title={`Show ${card.name} in the card panel`} className="card-lift block rounded-[4.75%/3.5%]">
        {card.image_normal ? (
          <img src={card.image_normal} alt={card.name} loading="lazy" draggable={false} width={244} height={340} className="w-full rounded-[4.75%/3.5%] shadow" />
        ) : (
          <span className="flex aspect-[63/88] items-center justify-center rounded-lg border p-2 text-center text-sm">{card.name}</span>
        )}
      </button>
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium" title={card.name}>
          {card.name}
        </p>
        <p className="text-[13px] tabular-nums opacity-80">
          {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : "no price"} ·{" "}
          {card.edhrec_rank ? `EDHREC #${card.edhrec_rank.toLocaleString()}` : "unranked"}
        </p>
        {row.shared.length > 0 && (
          <p className="mt-1 text-[13px] font-medium text-gold" title={`Fit ${Math.round(row.fit * 100)} of 100. Played ${Math.round(row.pop * 100)} of 100.`}>
            Shares {row.shared.length} of your themes
          </p>
        )}
        {above.map((a) => (
          <p key={a} className="mt-1 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
            ⚠ Above bracket {target}: {a}
          </p>
        ))}
        <div className="mt-1 flex flex-wrap gap-1">
          {row.fills.map((k) => (
            <span key={k} className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-300">
              Fills {roleNames[k] ?? k}
            </span>
          ))}
          {row.shared.slice(0, 3).map((t) => (
            <span key={t.key} className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs" title="A theme this deck already has">
              {prettyTag(t.label)}
            </span>
          ))}
          {!row.fills.length && !row.shared.length && <span className="text-[11px] opacity-60">matches the tag, no shared themes</span>}
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onAdd(card, "main")} className="btn btn-gold min-h-11 whitespace-nowrap px-1">
          + Main
        </button>
        <button type="button" onClick={() => onAdd(card, "maybe")} className="min-h-11 whitespace-nowrap rounded-lg border border-foreground/20 px-1 text-sm">
          + Maybe
        </button>
        <button
          type="button"
          onClick={() => onDismiss(card)}
          title="Don't suggest this card for this deck again"
          className="col-span-2 min-h-10 rounded-lg px-2 text-[13px] opacity-75 hover:bg-foreground/10 hover:opacity-100"
        >
          Not for this deck
        </button>
      </div>
    </li>
  );
}

const STYLE_HELP: Record<SuggestStyle, string> = {
  best: "Cards that fit your themes, proven ones first.",
  gems: "Cards sharing at least two of your themes that few decks play.",
  budget: "Cards that fit, under your price cap, cheaper ones higher.",
  custom: "Set how much fit, popularity and price count.",
};
const PRICE_STEPS = [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 100];

function StyleControls({ settings, onChange }: { settings: SuggestSettings; onChange: (s: SuggestSettings) => void }) {
  const capIndex = PRICE_STEPS.reduce((best, v, i) => (Math.abs(v - settings.priceCap) < Math.abs(PRICE_STEPS[best] - settings.priceCap) ? i : best), 0);
  const w = settings.weights;
  const setW = (patch: Partial<SuggestSettings["weights"]>) => onChange({ ...settings, weights: { ...w, ...patch } });
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Suggestion style">
        {(Object.keys(STYLE_LABELS) as SuggestStyle[]).map((st) => (
          <button
            key={st}
            type="button"
            role="radio"
            aria-checked={settings.style === st}
            title={STYLE_HELP[st]}
            onClick={() => onChange({ ...settings, style: st })}
            className={`min-h-11 rounded-lg border px-3 ${
              settings.style === st ? "border-gold bg-gold font-medium text-gold-ink" : "border-foreground/20 hover:bg-foreground/10"
            }`}
          >
            {STYLE_LABELS[st]}
          </button>
        ))}
      </div>
      <p className="opacity-70">{STYLE_HELP[settings.style]}</p>
      {settings.style === "budget" && (
        <label className="flex max-w-md items-center gap-3">
          <span className="shrink-0">Price cap</span>
          <input
            type="range"
            min={0}
            max={PRICE_STEPS.length - 1}
            value={capIndex}
            onChange={(e) => onChange({ ...settings, priceCap: PRICE_STEPS[Number(e.target.value)] })}
            aria-label="Price cap"
            className="h-8 min-w-0 flex-1 accent-gold"
          />
          <span className="w-14 shrink-0 tabular-nums">${settings.priceCap < 1 ? settings.priceCap.toFixed(2) : settings.priceCap}</span>
        </label>
      )}
      {settings.style === "custom" && (
        <div className="grid max-w-xl gap-1">
          <Slider label="Fit" left="ignore" right="matters most" min={0} max={1} value={w.fit} onChange={(v) => setW({ fit: v })} />
          <Slider label="Popularity" left="less played" right="more played" min={-1} max={1} value={w.pop} onChange={(v) => setW({ pop: v })} />
          <Slider label="Cheap" left="ignore" right="cheaper first" min={0} max={1} value={w.price} onChange={(v) => setW({ price: v })} />
        </div>
      )}
    </div>
  );
}

function Slider(props: { label: string; left: string; right: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={0.05}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={`${props.label} weight`}
        className="h-8 accent-gold"
      />
      <span />
      <span className="-mt-1 flex justify-between text-[11px] opacity-60">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </span>
    </label>
  );
}
