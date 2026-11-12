// Every store's price for a card (v2, Nov 11, 2026): the card sheet and the collection sheet. TCGplayer comes from
// Scryfall, the others from MTGJSON once a day. Credit for MTGJSON sits in the site footer.
import { storeList, trendMark, trendText, type PriceTrend, type StorePrices } from "@/lib/deck/store-prices";

export function StorePriceList({
  tcg,
  stores,
  foil,
  exact,
  trend,
}: {
  /** The TCGplayer price for this printing (or the card's cheapest). */
  tcg: number | null;
  stores: StorePrices | null | undefined;
  foil: boolean;
  /** True for a picked printing; false = the cheapest printing at each store. */
  exact: boolean;
  trend?: PriceTrend | null;
}) {
  const { rows, buylist } = storeList(tcg, stores, foil);
  const mark = trendMark(trend);
  if (rows.length < 2 && buylist === null && !mark) return null;
  return (
    <div className="text-sm">
      <p className="text-xs uppercase tracking-wide opacity-60">{exact ? `Prices${foil ? " (foil)" : ""}` : "Cheapest printing at each store"}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((r) => (
          <li key={r.key} className="tabular-nums">
            <span className="opacity-70">{r.name}</span> {r.currency}
            {r.price!.toFixed(2)}
          </li>
        ))}
        {buylist !== null && (
          <li className="tabular-nums" title="What Card Kingdom pays for a copy in good condition (its buylist)">
            <span className="opacity-70">Card Kingdom pays</span> ${buylist.toFixed(2)}
          </li>
        )}
      </ul>
      {mark && (
        <p className={`mt-1 tabular-nums ${mark.up ? "text-amber-300" : "text-green-300"}`} title={`TCGplayer, cheapest printing: $${mark.was.toFixed(2)} 30 days ago`}>
          {trendText(mark.share)}
        </p>
      )}
    </div>
  );
}

/** A small ↑ / ↓ for grid tiles and text rows when a card moved 20%+ (and 50¢+) in 30 days. A label, not a button. */
export function TrendChip({ trend }: { trend: PriceTrend | null | undefined }) {
  const mark = trendMark(trend);
  if (!mark) return null;
  return (
    <span className={`tabular-nums text-[11px] ${mark.up ? "text-amber-300" : "text-green-300"}`} title={trendText(mark.share)}>
      {mark.up ? "↑" : "↓"}
      {Math.round(Math.abs(mark.share) * 100)}%
    </span>
  );
}
