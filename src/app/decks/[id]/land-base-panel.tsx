"use client";

// Auto build land base (v2): previews the lands it would add, then adds them as one undoable edit.
// Candidates come from our card data (most played first) with their tags, so fetch lands count for the colors
// they find. The picking rules live in src/lib/deck/land-base.ts.
import { useEffect, useMemo, useState } from "react";
import { ManaSymbol } from "@/components/mana-cost";
import { BASIC_NAMES, NONBASIC_SHARE, planLandBase, type LandCandidate } from "@/lib/deck/land-base";
import type { CardSummary } from "@/lib/deck/model";
import type { Color } from "@/lib/deck/stats";
import { createClient } from "@/lib/supabase/client";
import { GlassOverlay } from "./glass-overlay";

/** The same words on the button's hover and at the top of the panel (phones read it here). */
export function landBaseAbout(target: number) {
  return `Fills your lands up to your Lands target (${target}). First the most-played lands that make two or more of your colors (duals, fetches, tri-lands, Command Tower and so on), then basics split by how many mana symbols of each color your spells have. Utility lands are left for you to add. One undo takes it all back.`;
}

const PRICE_CAPS: [string, number | null][] = [
  ["Any price", null],
  ["Up to $20", 20],
  ["Up to $5", 5],
  ["Up to $1", 1],
];

type Props = {
  identity: Color[] | null;
  target: number;
  landCount: number;
  nonbasicCount: number;
  basicCounts: Partial<Record<Color | "C", number>>;
  pips: Partial<Record<Color, number>>;
  inDeck: (oracleId: string) => boolean;
  onApply: (plan: ReturnType<typeof planLandBase>, basics: Record<string, CardSummary>, newCards: CardSummary[]) => void;
  onClose: () => void;
};

export function LandBasePanel(props: Props) {
  const { identity, target } = props;
  const supabase = useMemo(() => createClient(), []);
  const [pool, setPool] = useState<LandCandidate[] | null>(null);
  const [basics, setBasics] = useState<Record<string, CardSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const idKey = identity?.join("") ?? "";

  useEffect(() => {
    if (!identity) return;
    let current = true;
    (async () => {
      const [lands, basicRows] = await Promise.all([
        supabase
          .from("card_summaries")
          .select("*")
          .ilike("type_line", "%Land%")
          .not("type_line", "ilike", "%Basic%")
          .containedBy("color_identity", identity)
          // The stored flag, not the computed commander_status column: filtering on that one timed out (4 s+).
          .eq("commander_legal", true)
          .not("edhrec_rank", "is", null)
          .order("edhrec_rank")
          .limit(250),
        supabase.from("card_summaries").select("*").in("name", Object.values(BASIC_NAMES)).ilike("type_line", "Basic%"),
      ]);
      const rows = (lands.data ?? []) as CardSummary[];
      const tags = rows.length ? await supabase.rpc("card_tags_for", { oracle_ids: rows.map((c) => c.oracle_id) }) : { data: { o: {} }, error: null };
      if (!current) return;
      const failed = lands.error ?? basicRows.error ?? tags.error;
      if (failed) {
        setError(`Couldn't load lands: ${failed.message}`);
        return;
      }
      const byId = ((tags.data as { o?: Record<string, string[]> } | null)?.o ?? {}) as Record<string, string[]>;
      setPool(rows.filter((c) => c.counts_as_land).map((c) => ({ ...c, tags: byId[c.oracle_id] ?? [] })));
      setBasics(Object.fromEntries(((basicRows.data ?? []) as CardSummary[]).map((c) => [c.name, c])));
    })();
    return () => {
      current = false;
    };
    // identity is read through idKey so a new array with the same colors doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, supabase]);

  const plan = useMemo(
    () =>
      pool && identity
        ? planLandBase({
            identity,
            target,
            landCount: props.landCount,
            nonbasicCount: props.nonbasicCount,
            basicCounts: props.basicCounts,
            pips: props.pips,
            pool,
            inDeck: props.inDeck,
            maxPrice,
          })
        : null,
    [pool, identity, target, props.landCount, props.nonbasicCount, props.basicCounts, props.pips, props.inDeck, maxPrice],
  );
  const adding = plan ? plan.nonbasic.length + plan.basics.reduce((s, b) => s + b.count, 0) : 0;
  const cost = plan ? plan.nonbasic.reduce((s, x) => s + (x.card.price_usd ?? 0), 0) + plan.basics.reduce((s, b) => s + b.count * (basics[b.name]?.price_usd ?? 0), 0) : 0;
  const share = Math.round((NONBASIC_SHARE[identity?.length ?? 0] ?? 0) * 100);

  return (
    <GlassOverlay label="Auto build land base" paused={false} onClose={props.onClose}>
      <div className="mx-auto max-w-3xl space-y-6 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">Auto build land base</h2>
            <p className="mt-2 max-w-prose text-base opacity-90">{landBaseAbout(target)}</p>
            {identity && identity.length >= 2 && (
              <p className="mt-1 opacity-75">
                For {identity.length} colors, about {share}% of your lands are color-fixing nonbasics; you have {props.nonbasicCount} already.
              </p>
            )}
          </div>
          <button type="button" autoFocus onClick={props.onClose} className="btn shrink-0">
            Close
          </button>
        </div>

        {!identity ? (
          <p className="text-base">Choose a commander first: the lands follow its colors.</p>
        ) : error ? (
          <p className="text-red-400">{error}</p>
        ) : !plan ? (
          <p className="opacity-75">Finding the best lands in your colors…</p>
        ) : plan.need === 0 ? (
          <p className="text-base">
            You already have {props.landCount} lands, at or above your target of {target}. Raise the Lands target to add more.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="opacity-80">Lands up to:</span>
              {PRICE_CAPS.map(([label, cap]) => (
                <button key={label} type="button" aria-pressed={maxPrice === cap} onClick={() => setMaxPrice(cap)} className={`btn min-h-9 ${maxPrice === cap ? "border-gold" : ""}`}>
                  {label}
                </button>
              ))}
            </div>

            <section>
              <h3 className="eyebrow mb-2">
                {props.landCount} of {target} lands now · adds {adding}
              </h3>
              {plan.nonbasic.length > 0 && (
                <ul className="panel divide-y divide-foreground/10">
                  {plan.nonbasic.map(({ card, colors }) => (
                    <li key={card.oracle_id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">{card.name}</span>
                      <span className="inline-flex gap-0.5">
                        {colors.map((c) => (
                          <ManaSymbol key={c} symbol={c} size={16} />
                        ))}
                      </span>
                      <span className="w-14 text-right tabular-nums opacity-80">{card.price_usd != null ? `$${card.price_usd.toFixed(2)}` : "–"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.basics.length > 0 && (
                <ul className="panel mt-2 divide-y divide-foreground/10">
                  {plan.basics.map((b) => (
                    <li key={b.name} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 font-medium">
                        {b.name} <span className="opacity-70">×{b.count}</span>
                      </span>
                      <ManaSymbol symbol={b.color} size={16} />
                      <span className="w-14" />
                    </li>
                  ))}
                </ul>
              )}
              {plan.nonbasic.length === 0 && identity.length >= 2 && (
                <p className="mt-2 opacity-75">No new fixing lands: you already have enough, or none fit the price.</p>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-gold min-h-11 px-5"
                disabled={adding === 0}
                onClick={() => props.onApply(plan, basics, [...plan.nonbasic.map((x) => x.card), ...Object.values(basics)])}
              >
                Add {adding} land{adding === 1 ? "" : "s"}
              </button>
              <span className="opacity-80">About ${cost.toFixed(0)}</span>
            </div>
          </>
        )}
      </div>
    </GlassOverlay>
  );
}
