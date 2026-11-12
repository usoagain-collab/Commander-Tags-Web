"use client";

// The deck's price over time (v2, Nov 11, 2026): one total per day from the nightly price import
// (deck_price_history, migration 0053), in the viewer's chosen store, plus today's live total. Plain SVG.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { historyLine, priceSourceLabel, type HistoryPoint, type PriceSource } from "@/lib/deck/store-prices";

const usd = (n: number) => `$${n.toFixed(n >= 1000 ? 0 : 2)}`;
const W = 600;
const H = 140;
const PAD = 6;

export function PriceHistory({ deckId, source, total }: { deckId: string; source: PriceSource; total: number }) {
  const [rows, setRows] = useState<{ day: string; totals: Record<string, number> }[] | null>(null);
  useEffect(() => {
    let live = true;
    createClient()
      .from("deck_price_history")
      .select("day, totals")
      .eq("deck_id", deckId)
      .order("day")
      .then(({ data, error }) => {
        // Before migration 0053 the table doesn't exist; the section then just says the line starts soon.
        if (live) setRows(error ? [] : ((data ?? []) as { day: string; totals: Record<string, number> }[]));
      });
    return () => {
      live = false;
    };
  }, [deckId]);

  const points = useMemo<HistoryPoint[]>(() => {
    if (!rows) return [];
    const line = historyLine(rows, source);
    const today = new Date().toISOString().slice(0, 10);
    // Today's live total replaces (or follows) the stored one, so the line ends at what the deck page shows.
    return [...line.filter((p) => p.day < today), { day: today, total: Math.round(total * 100) / 100 }];
  }, [rows, source, total]);

  if (!rows) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const change = points.length > 1 ? last.total - first.total : 0;
  const min = Math.min(...points.map((p) => p.total));
  const max = Math.max(...points.map((p) => p.total));
  const span = Math.max(1, max - min);
  const t0 = Date.parse(first.day);
  const days = Math.max(1, (Date.parse(last.day) - t0) / 86_400_000);
  const xy = points.map((p) => [PAD + ((Date.parse(p.day) - t0) / 86_400_000 / days) * (W - 2 * PAD), PAD + (1 - (p.total - min) / span) * (H - 2 * PAD)] as const);

  return (
    <section className="panel p-4 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-lg">Price over time</h3>
        <p className="text-xs opacity-70">
          {priceSourceLabel(source)} · updated nightly{points.length > 1 ? ` · since ${first.day}` : ""}
        </p>
      </div>
      {points.length < 2 ? (
        <p className="mt-2 opacity-75">The line starts tonight: each night adds the deck&apos;s total, so check back in a few days.</p>
      ) : (
        <>
          <p className="mt-1 tabular-nums">
            {usd(last.total)}{" "}
            <span className={change > 0 ? "text-amber-300" : change < 0 ? "text-green-300" : "opacity-70"}>
              ({change >= 0 ? "+" : "−"}
              {usd(Math.abs(change))} since {first.day})
            </span>
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={`Deck price from ${usd(first.total)} on ${first.day} to ${usd(last.total)} today`}>
            <polyline fill="none" stroke="var(--gold)" strokeWidth={2.5} strokeLinejoin="round" points={xy.map(([x, y]) => `${x},${y}`).join(" ")} />
            {xy.length <= 60 && xy.map(([x, y], i) => <circle key={points[i].day} cx={x} cy={y} r={3} fill="var(--gold)" />)}
          </svg>
          <div className="flex justify-between text-xs tabular-nums opacity-60">
            <span>
              {first.day} · {usd(first.total)}
            </span>
            <span>low {usd(min)} · high {usd(max)}</span>
          </div>
        </>
      )}
    </section>
  );
}
