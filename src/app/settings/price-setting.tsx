"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRICE_SOURCES, type PriceSource } from "@/lib/deck/store-prices";
import { createClient } from "@/lib/supabase/client";

/** Prices from (v2): which store every price on the site follows. Saved in profiles.tag_view.priceSource. */
export function PriceSetting({ userId, initial }: { userId: string; initial: PriceSource }) {
  const router = useRouter();
  const [source, setSource] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(next: PriceSource) {
    const before = source;
    setSource(next);
    setMessage(null);
    // tag_view holds other choices too, so read the latest copy and change only this one.
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("profiles").select("tag_view").eq("id", userId).single();
    const { error } = readError
      ? { error: readError }
      : await supabase.from("profiles").update({ tag_view: { ...(data.tag_view as object | null), priceSource: next } }).eq("id", userId);
    if (error) {
      setSource(before);
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <fieldset className="mt-8">
      <legend className="display text-xl">Prices</legend>
      <p className="mt-1 text-sm opacity-80">
        Where deck totals, card prices, your collection&apos;s value, the wish list and price caps come from. A card that store doesn&apos;t sell uses its
        TCGplayer price. Each card still lists every store, Cardmarket (€) included. Store prices come from MTGJSON once a day.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {PRICE_SOURCES.map((s) => (
          <label key={s.key} className={`panel flex min-h-14 cursor-pointer items-start gap-3 p-3 ${source === s.key ? "border-gold" : ""}`}>
            <input type="radio" name="price-source" checked={source === s.key} onChange={() => choose(s.key)} className="mt-1 h-4 w-4 accent-gold" />
            <span>
              <span className="block font-medium">{s.label}</span>
              <span className="block text-sm opacity-75">{s.about}</span>
            </span>
          </label>
        ))}
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>
    </fieldset>
  );
}
