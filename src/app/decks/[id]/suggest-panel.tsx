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
import { FiltersBox } from "./filters-box";
import { HiddenNote, RESULT_GRID, ResultCard, ShowingChip, type HiddenReason } from "./result-card";
import { appendSyntax, EMPTY_FILTERS, filterSyntax, type FilterForm } from "@/lib/search/filters";
import { buildQuery } from "@/lib/search/query";
import { scryfallOracleIds } from "@/lib/scryfall/oracle-ids";
import { angleQuery, onePerReason, spreadByReason, type Angle, type WordingPlan } from "@/lib/search/wording-pairs";
import { AngleButtons } from "./wording-ui";

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
  /** Overall Suggest (v2): phrases from the commander's wording and what feeds it, for the Wording matches row. */
  wording?: WordingPlan;
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
  /** Opens the card sheet on one suggestion; Prev / Next step through `list`. */
  onOpen: (list: CardSummary[], index: number) => void;
  /** Back to the whole-deck picks (✕ on the Showing line). Absent while showing them. */
  onOverall?: () => void;
  /** Switches to the Search tab with a query, and what it is in words. */
  onSearch: (query: string, label: string) => void;
  wish?: { has: (oracleId: string) => boolean; toggle: (oracleId: string) => void };
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
  const { source, identity, deckIds, isInDeck, score, roleNames, hasCommander, onAdd, onPreview } = props;
  const supabase = useMemo(() => createClient(), []);
  const [pool, setPool] = useState<PoolCard[] | null>(null);
  // Overall Suggest only: most-played cards for the roles the deck is short on.
  const [staplePool, setStaplePool] = useState<PoolCard[]>([]);
  // Overall Suggest under the Lands target only: lands, ranked like role picks.
  const [landPool, setLandPool] = useState<PoolCard[]>([]);
  // Overall Suggest (v2): cards whose rules text says the commander's wording or what feeds it.
  const [wordPool, setWordPool] = useState<(PoolCard & { says: string[] })[]>([]);
  // Other angles (v2): per idea, cards in the deck that already do it and how many more there are; one idea open.
  const [angleCounts, setAngleCounts] = useState<Record<string, { inDeck: number; toAdd: number }>>({});
  const [angle, setAngle] = useState<Angle | null>(null);
  const [anglePool, setAnglePool] = useState<(PoolCard & { says: string[] })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [combos, setCombos] = useState<ComboRow[] | null>(null);
  const [showAbove, setShowAbove] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  // Scryfall filters (v2, Nov 8, 2026): the pool is narrowed to the cards a Scryfall search finds. Kept for the visit.
  const [filterDraft, setFilterDraft] = useState<FilterForm>(EMPTY_FILTERS);
  const [ownDraft, setOwnDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [filterInfo, setFilterInfo] = useState<{ total: number; used: number; warnings: string[] } | null>(null);
  const applyFilter = (form = filterDraft, own = ownDraft) => setFilter(appendSyntax(filterSyntax(form), own));
  const wordingPhrases = source.wording?.phrases ?? [];
  const requestKey = `${source.label}|${source.lands ? "lands" : source.slugs.join(",")}|${source.staples?.join(",") ?? ""}|${source.landsShort ? "L" : ""}|${wordingPhrases.join(";")}|${identity.join("")}|${filter}`;

  useEffect(() => {
    let live = true;
    setPool(null);
    setStaplePool([]);
    setLandPool([]);
    setWordPool([]);
    setCombos(null);
    setError(null);
    setFilterInfo(null);
    (async () => {
      let only: string[] | undefined;
      if (filter) {
        try {
          const found = await scryfallOracleIds(buildQuery(filter, { identity: new Set(identity), inIdentity: true, legalOnly: true }));
          if (!live) return;
          setFilterInfo({ total: found.total, used: found.ids.length, warnings: found.warnings });
          if (!found.ids.length) {
            setCombos([]);
            setPool([]);
            return;
          }
          only = found.ids;
        } catch (e) {
          if (live) setError(`Couldn't run the filter on Scryfall: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
      const ask = async (slugs: string[], lands: boolean, tail: number) => {
        const call = () =>
          supabase.rpc("suggestion_pool", { p_slugs: slugs, p_identity: identity, p_exclude: deckIds, p_lands: lands, p_tail: tail, ...(only ? { p_only: only } : {}) });
        let res = await call();
        // The first call after a quiet spell can hit the database's time limit while it loads the tag tables
        // into memory; the second try runs warm.
        if (res.error && /timeout/i.test(res.error.message) && live) res = await call();
        return res;
      };
      // Staples need only the most-played end, so no least-played tail.
      const [main, staples, lands, words] = await Promise.all([
        ask(source.slugs, !!source.lands, 60),
        source.staples?.length ? ask(source.staples, false, 0) : Promise.resolve({ data: [], error: null }),
        source.landsShort ? ask([], true, 60) : Promise.resolve({ data: [], error: null }),
        // Without migration 0050 this errors, and the row simply doesn't show.
        wordingPhrases.length
          ? supabase.rpc("wording_pool", { p_phrases: wordingPhrases, p_identity: identity, p_exclude: deckIds, p_lim: 60, ...(only ? { p_only: only } : {}) })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!live) return;
      // Filters need migration 0044 (suggestion_pool with p_only); before it runs, the database doesn't know p_only.
      if (main.error && only && /p_only|suggestion_pool/i.test(main.error.message))
        return setError("Filters aren't available yet: the database needs an update. Clear the filters to see suggestions.");
      if (main.error) return setError(`Couldn't load suggestions: ${main.error.message}`);
      const found = (main.data ?? []) as PoolCard[];
      const foundStaples = staples.error ? [] : ((staples.data ?? []) as PoolCard[]);
      const foundLands = lands.error ? [] : ((lands.data ?? []) as PoolCard[]);
      const foundWords = words.error ? [] : ((words.data ?? []) as (PoolCard & { says: string[] })[]);
      // Combos between the deck and the candidates, so a card that completes one can be held back (5c).
      const ids = [
        ...new Set([
          ...props.bracket.deckIds,
          ...[...found, ...foundStaples, ...foundLands, ...foundWords].map((c) => c.oracle_id),
        ]),
      ];
      const c = ids.length ? await supabase.rpc("combos_within", { p_ids: ids }) : { data: [], error: null };
      if (!live) return;
      setCombos(c.error ? [] : ((c.data ?? []) as ComboRow[]));
      if (c.error) setError(`Couldn't check combos, so suggestions may include some: ${c.error.message}`);
      setStaplePool(foundStaples);
      setLandPool(foundLands);
      setWordPool(foundWords);
      setPool(found);
    })();
    return () => {
      live = false;
    };
    // Re-ask only when what we're suggesting for changes; cards added meanwhile are filtered out below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, supabase]);

  // Angle counts: one wording search per idea in the commander's colors, split into in the deck and not.
  const angles = source.wording?.angles ?? [];
  const anglesKey = angles.map((a) => a.phrases.join(";")).join("|");
  useEffect(() => {
    let live = true;
    setAngleCounts({});
    if (!angles.length) return;
    const inDeck = new Set(deckIds);
    Promise.all(
      angles.map(async (a) => {
        const { data, error } = await supabase.rpc("cards_with_wording", { p_phrases: a.phrases, p_identity: identity, lim: 2000 });
        if (error) return null;
        const ids = ((data ?? []) as { oracle_id: string }[]).map((r) => r.oracle_id);
        const have = ids.filter((id) => inDeck.has(id)).length;
        return [a.key, { inDeck: have, toAdd: ids.length - have }] as const;
      }),
    ).then((rows) => live && setAngleCounts(Object.fromEntries(rows.filter((r) => r !== null))));
    return () => {
      live = false;
    };
    // Counted once per opening, like the pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anglesKey, identity.join(""), supabase]);

  // One idea open: every card for it (up to 60, most phrases then most played), scored like the rest.
  useEffect(() => {
    let live = true;
    setAnglePool(null);
    if (!angle) return;
    supabase
      .rpc("wording_pool", { p_phrases: angle.phrases, p_identity: identity, p_exclude: deckIds, p_lim: 60 })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(`Couldn't load the cards for ${angle.name}: ${error.message}`);
        setAnglePool(error ? [] : ((data ?? []) as (PoolCard & { says: string[] })[]));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle?.key, supabase]);

  const target = props.bracket.target;
  const eligible = pool && combos ? pool.filter((c) => !isInDeck(c.oracle_id) && (!source.roleKey || score.rolesOf(c).includes(source.roleKey))) : [];
  const eligibleStaples = pool && combos ? staplePool.filter((c) => !isInDeck(c.oracle_id)) : [];
  const eligibleLands = pool && combos ? landPool.filter((c) => !isInDeck(c.oracle_id)) : [];
  const deckInput: EvaluateInput = { ...props.bracket.deck, combos: combos ?? [] };
  const issues = new Map<string, Finding[]>();
  for (const c of [
    ...eligible,
    ...eligibleStaples,
    ...eligibleLands,
    ...(pool && combos ? [...wordPool, ...(anglePool ?? [])].filter((w) => !isInDeck(w.oracle_id)) : []),
  ]) {
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
  // Wording matches (v2): every card saying a phrase gets a little fit, here and in the main list; the best 8
  // that aren't staples or lands get their own row, at most 3 per reason. Hidden gems keeps its less-played meaning.
  // Two phrases with one reason (typal: "choose a creature type", "of the chosen type") count once.
  const sayWhy = source.wording?.why ?? {};
  const wording = new Map(wordPool.map((c) => [c.oracle_id, onePerReason(c.says, sayWhy)]));
  const eligibleWords = pool && combos ? wordPool.filter((c) => !isInDeck(c.oracle_id) && !stapleIds.has(c.oracle_id) && !landIds.has(c.oracle_id)) : [];
  const words: Scored[] = eligibleWords.length
    ? spreadByReason(
        scorePool(
          eligibleWords.filter((c) => allowed(c) && (style !== "budget" || (c.price_usd != null && Number(c.price_usd) <= priceCap))),
          { ...score, wording, dismissed: props.dismissed, limit: 60 },
        ),
        sayWhy,
      )
    : [];
  const wordIds = new Set(words.map((r) => r.card.oracle_id));
  const angleRows: Scored[] =
    angle && anglePool && pool && combos
      ? scorePool(
          anglePool.filter((c) => !isInDeck(c.oracle_id) && allowed(c) && (style !== "budget" || (c.price_usd != null && Number(c.price_usd) <= priceCap))),
          { ...score, wording: new Map(anglePool.map((c) => [c.oracle_id, onePerReason(c.says, sayWhy)])), dismissed: props.dismissed, limit: 60 },
        )
      : [];
  // A card shows once: in the Lands, Staples or Wording row before the main list.
  const hiddenAbove = new Set(
    [...eligible, ...eligibleStaples, ...eligibleLands, ...eligibleWords]
      .filter((c) => issues.has(c.oracle_id) && !props.dismissed.has(c.oracle_id))
      .map((c) => c.oracle_id),
  ).size;
  const rows: Scored[] = scorePool(
    eligible.filter((c) => allowed(c) && !stapleIds.has(c.oracle_id) && !landIds.has(c.oracle_id) && !wordIds.has(c.oracle_id)),
    { ...score, wording, dismissed: props.dismissed, role: !!source.roleKey },
  );
  const nameOf = (x: string) =>
    pool?.find((c) => c.oracle_id === x)?.name ??
    staplePool.find((c) => c.oracle_id === x)?.name ??
    landPool.find((c) => c.oracle_id === x)?.name ??
    wordPool.find((c) => c.oracle_id === x)?.name ??
    props.bracket.deck.lines.find((l) => l.card.oracle_id === x)?.card.name ??
    "a card in your deck";
  const flagsOf = (id: string) => (issues.get(id) ?? []).map((f) => cardFlag(f, id, nameOf));
  // Said on a card with no role filled and no shared theme, so it never just reads "matches the tag".
  const why = (kind: "land" | "staple" | "main") =>
    kind === "land"
      ? "A popular land in your colors"
      : kind === "staple"
        ? "Popular in your colors"
        : source.lands
          ? "A popular land in your colors"
          : source.roleKey
            ? `A popular ${prettyTag(source.label).toLowerCase()} card in your colors`
            : `Has the ${prettyTag(source.label).toLowerCase()} tag, but none of your other themes`;
  // A card opens the sheet, and Prev / Next step through everything shown, in screen order.
  let openList: CardSummary[] = [];
  const cardFor = (r: Scored, best: boolean, kind: "land" | "staple" | "main" = "main") => (
    <ResultCard
      key={r.card.oracle_id}
      name={r.card.name}
      image={r.card.image_normal}
      card={r.card}
      best={best}
      onPreview={() => onPreview(r.card)}
      onOpen={() => props.onOpen(openList, Math.max(0, openList.findIndex((c) => c.oracle_id === r.card.oracle_id)))}
      onAdd={(board) => onAdd(r.card, board)}
      wish={props.wish ? { on: props.wish.has(r.card.oracle_id), toggle: () => props.wish!.toggle(r.card.oracle_id) } : undefined}
      dismiss={{ on: false, toggle: () => props.onDismiss(r.card) }}
    >
      <WhyLines row={r} why={why(kind)} sayWhy={sayWhy} roleNames={roleNames} above={flagsOf(r.card.oracle_id)} target={target} />
    </ResultCard>
  );
  openList = [...lands, ...staples, ...(angle ? angleRows : words), ...rows].map((r) => r.card);
  const overall = !source.roleKey && !source.lands && !!source.staples;
  const showing = source.lands
    ? "picks for Lands"
    : source.roleKey
      ? `picks for ${prettyTag(source.label)}`
      : overall
        ? "picks for the whole deck"
        : `picks with the ${prettyTag(source.label)} tag`;

  // What the picks leave out, at the top so a card hidden long ago isn't forgotten.
  const nDismissed = props.dismissed.size;
  const hiddenReasons: HiddenReason[] = [
    ...(nDismissed
      ? [
          {
            text: `${nDismissed} ${nDismissed === 1 ? "card" : "cards"} you marked Not for this deck ${nDismissed === 1 ? "is" : "are"} never suggested`,
            action: { label: reviewDismissed ? "Close" : "Review", onClick: () => setReviewDismissed((o) => !o) },
          },
        ]
      : []),
    ...(hiddenAbove > 0 && !showAbove
      ? [{ text: `${hiddenAbove} ${hiddenAbove === 1 ? "card" : "cards"} would go above bracket ${target}`, action: { label: "Show", onClick: () => setShowAbove(true) } }]
      : showAbove
        ? [{ text: `Showing cards above bracket ${target} (marked ⚠)`, action: { label: "Hide", onClick: () => setShowAbove(false) } }]
        : []),
  ];

  return (
    <div>
      <StyleControls settings={score.settings} onChange={props.onSettings} />
      <FiltersBox
        fields={["types", "text", "mv", "price", "keyword", "set", "since", "instantSpeed", "noReserved"]}
        draft={filterDraft}
        onDraft={(next, immediate) => {
          setFilterDraft(next);
          if (immediate) applyFilter(next);
        }}
        own={{ value: ownDraft, onChange: setOwnDraft }}
        applied={filter}
        applyLabel="Apply filters"
        hint="narrow the picks with Scryfall search"
        onApply={() => applyFilter()}
        onClear={() => {
          setFilterDraft(EMPTY_FILTERS);
          setOwnDraft("");
          setFilter("");
        }}
        footer={filter ? <FilterInfo applied={filter} info={filterInfo} /> : null}
      />
      <ShowingChip
        label={showing}
        detail={STYLE_LABELS[score.settings.style]}
        onClear={props.onOverall}
        clearLabel="Back to picks for the whole deck"
      />
      <HiddenNote reasons={hiddenReasons}>
        {reviewDismissed && props.dismissed.size > 0 && <DismissedList ids={[...props.dismissed]} pool={pool ?? []} onRestore={props.onRestore} />}
      </HiddenNote>
      {props.saveError && <p className="mt-1 text-sm text-red-400">{props.saveError}</p>}
      {!hasCommander && <p className="mt-2 text-sm opacity-70">No commander yet, so every color is allowed.</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!error && (pool === null || combos === null) && (
        <>
          <p className="mt-3 text-sm opacity-80">Finding cards that fit… the first search can take a few seconds.</p>
          <ul aria-hidden className={`mt-3 ${RESULT_GRID}`}>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="aspect-[63/88] animate-pulse rounded-xl bg-foreground/10" />
            ))}
          </ul>
        </>
      )}
      {lands.length > 0 && (
        <section aria-label="Lands" className="mt-3">
          <h3 className="eyebrow">
            Lands: you&apos;re {source.landsShort} short of your target
          </h3>
          <p className="text-[13px] opacity-70">Ranked like the other picks: your themes, then how widely played. More → Auto build land base fills them all at once.</p>
          <ul className={`mt-2 ${RESULT_GRID}`}>
            {lands.map((r) => cardFor(r, false, "land"))}
          </ul>
          {!staples.length && !words.length && rows.length > 0 && <h3 className="eyebrow mt-5">Built for this deck</h3>}
        </section>
      )}
      {staples.length > 0 && (
        <section aria-label="Staples" className="mt-3">
          <h3 className="eyebrow">Staples for roles you&apos;re short on</h3>
          <p className="text-[13px] opacity-70">The most-played cards in your colors that fill them, themes or not.</p>
          <ul className={`mt-2 ${RESULT_GRID}`}>
            {staples.map((r) => cardFor(r, false, "staple"))}
          </ul>
          {!words.length && rows.length > 0 && <h3 className="eyebrow mt-5">Built for this deck</h3>}
        </section>
      )}
      {(words.length > 0 || (angles.length > 0 && pool !== null)) && (
        <section aria-label="Wording matches" className="mt-3">
          <h3 className="eyebrow">Wording matches</h3>
          <p className="text-[13px] opacity-70">
            Cards whose rules text says what your commander says, or makes it happen, read straight from the text (so brand-new cards count too).
          </p>
          {angles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[13px] opacity-70">Angles: the ideas behind them. Tap one for every card for that idea.</p>
              <AngleButtons
                angles={angles}
                why={sayWhy}
                counts={angleCounts}
                active={angle?.key ?? null}
                onPick={(a) => setAngle(angle?.key === a.key ? null : a)}
              />
            </div>
          )}
          {angle ? (
            <>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">
                  Every card for {angle.name}
                  {anglePool && (anglePool.length >= 60 ? ` (the top ${angleRows.length})` : ` (${angleRows.length})`)}
                </h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => props.onSearch(angleQuery(angle), `every card for ${angle.name}`)}
                    title="Every card for this idea on Scryfall, not only the ones that fit your themes"
                    className="min-h-11 rounded-lg border border-foreground/20 px-3 text-sm hover:bg-foreground/10"
                  >
                    Search all cards for this ›
                  </button>
                  <button type="button" onClick={() => setAngle(null)} className="min-h-11 rounded-lg px-3 text-sm opacity-80 hover:bg-foreground/10">
                    ← Back to the mix
                  </button>
                </div>
              </div>
              {anglePool === null ? (
                <p className="mt-2 text-sm opacity-70">Reading every card for {angle.name}…</p>
              ) : angleRows.length === 0 ? (
                <p className="mt-2 text-sm opacity-60">Nothing new for this idea in your colors (cards already in the deck, dismissed or over the price cap are left out).</p>
              ) : (
                <ul className={`mt-2 ${RESULT_GRID}`}>
                  {angleRows.map((r) => cardFor(r, false))}
                </ul>
              )}
            </>
          ) : (
            <ul className={`mt-2 ${RESULT_GRID}`}>
              {words.map((r) => cardFor(r, false))}
            </ul>
          )}
          {rows.length > 0 && <h3 className="eyebrow mt-5">Built for this deck</h3>}
        </section>
      )}
      {pool !== null && combos !== null && rows.length === 0 && !staples.length && !lands.length && !words.length && (
        <p className="mt-3 text-sm opacity-60">
          {filter && !pool.length
            ? "No cards in your colors match these filters and this deck's themes. Try loosening a filter."
            : pool.length && score.settings.style === "budget"
            ? "Nothing under this price cap. Try raising it."
            : pool.length && score.settings.style === "gems"
              ? "No lesser-played cards share this deck's themes. Try Best fit."
              : "No new cards found for this in your colors."}
        </p>
      )}
      {rows.length > 0 && (
        <ul className={`mt-3 ${RESULT_GRID}`}>
          {rows.map((r, i) => cardFor(r, i === 0))}
        </ul>
      )}
    </div>
  );
}

/** The cards marked Not for this deck, each with Bring back (opened from the hidden-cards note). */
function DismissedList({ ids, pool, onRestore }: { ids: string[]; pool: PoolCard[]; onRestore: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [names, setNames] = useState<Record<string, string>>({});
  const known: Record<string, string> = { ...Object.fromEntries(pool.map((c) => [c.oracle_id, c.name])), ...names };
  const missing = ids.filter((id) => !known[id]);

  useEffect(() => {
    if (!missing.length) return;
    fetchSummaries(supabase, missing)
      .then((found) => setNames((n) => ({ ...n, ...Object.fromEntries(found.map((c) => [c.oracle_id, c.name])) })))
      .catch(() => undefined);
    // Look names up once per opening; ids missing from our data just show as "Unknown card".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  return (
    <ul className="mb-1.5 mt-1 flex flex-wrap gap-2">
      {ids
        .map((id) => ({ id, name: known[id] ?? "Unknown card" }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name }) => (
          <li key={id} className="flex items-center gap-1 rounded-lg border border-foreground/15 bg-background pl-3">
            <span>{name}</span>
            <button type="button" onClick={() => onRestore(id)} className="min-h-11 rounded-r-lg px-3 text-xs underline opacity-80 hover:opacity-100">
              Bring back
            </button>
          </li>
        ))}
    </ul>
  );
}

function WhyLines({
  row,
  roleNames,
  above,
  target,
  why,
  sayWhy,
}: {
  row: Scored;
  why: string;
  /** Wording phrase -> why it helps ("Feeds Omo: makes lands enter"). */
  sayWhy: Record<string, string>;
  above: string[];
  target: BracketNumber;
  roleNames: Record<string, string>;
}) {
  return (
    <>
      {row.shared.length > 0 && (
        <p className="text-[13px] font-medium text-gold" title={`Fit ${Math.round(row.fit * 100)} of 100. Played ${Math.round(row.pop * 100)} of 100.`}>
          Shares {row.shared.length} of your themes
        </p>
      )}
      {!!row.says?.length && (
        <p className="mt-1 text-[13px]">
          <span className="font-medium text-gold">{sayWhy[row.says[0]] ?? "Says your commander's wording"}</span>
          <span className="block opacity-80">
            Says {row.says.slice(0, 2).map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}“{s}”
              </span>
            ))}
            {row.says.length > 2 && ` +${row.says.length - 2} more`}
          </span>
        </p>
      )}
      {above.map((a) => (
        <p key={a} className="mt-1 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
          ⚠ Above bracket {target}: {a}
        </p>
      ))}
      <div className="mt-1 flex flex-wrap gap-1">
        {row.fills.map((k) => (
          <span key={k} className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-700 dark:text-green-300">
            Fills {roleNames[k] ?? k}
          </span>
        ))}
        {row.shared.slice(0, 3).map((t) => (
          <span key={t.key} className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs" title="A theme this deck already has">
            {prettyTag(t.label)}
          </span>
        ))}
        {!row.fills.length && !row.shared.length && !row.says?.length && <span className="text-xs opacity-70">{why}</span>}
      </div>
    </>
  );
}

/** Under the Filters box while a filter is on: the syntax, and how many cards Scryfall found. */
function FilterInfo({ applied, info }: { applied: string; info: { total: number; used: number; warnings: string[] } | null }) {
  return (
    <div className="border-t border-foreground/10 px-3 py-2 text-xs">
      <p>
        <span className="opacity-60">Scryfall filter </span>
        <code className="break-all font-mono">{applied}</code>
        {info &&
          ` · ${info.total.toLocaleString()} ${info.total === 1 ? "card matches" : "cards match"}${
            info.total > info.used ? `, using the ${info.used.toLocaleString()} most played` : ""
          }`}
      </p>
      {info?.warnings.map((w) => (
        <p key={w} className="mt-1 text-amber-700 dark:text-amber-400">
          Scryfall: {w}
        </p>
      ))}
    </div>
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
