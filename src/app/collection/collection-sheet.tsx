"use client";

// One card in your collection (v2): every printing you own with its own count and finish, a way to add another
// printing, and "Which printing?" for copies whose printing is unknown. Printings load live from Scryfall.
import { useEffect, useState } from "react";
import { GlassOverlay } from "@/app/decks/[id]/glass-overlay";
import { rowKey, rowUnitPrice, type Finish, type OwnedRow } from "@/lib/deck/collection";
import { finishFor, infoOf } from "@/lib/deck/collection-targets";
import type { CardSummary } from "@/lib/deck/model";
import { hasFoil, printingImage, type ChosenPrinting } from "@/lib/deck/printing";
import type { OwnedTarget } from "@/lib/deck/use-collection";
import { fetchPrintings } from "@/lib/scryfall/printings";

const money = (n: number) => `$${n.toFixed(2)}`;
const FINISH_LABELS: Record<Finish, string> = { nonfoil: "Plain", foil: "Foil", etched: "Etched" };

type Props = {
  card: CardSummary;
  rows: OwnedRow[];
  onSet: (changes: { target: OwnedTarget; quantity: number }[]) => void;
  onClose: () => void;
};

export function CollectionSheet({ card, rows, onSet, onClose }: Props) {
  const [picking, setPicking] = useState<null | { assign?: OwnedRow }>(rows.length === 0 ? {} : null);
  const [shown, setShown] = useState<string | null>(null);
  const sorted = [...rows].sort((a, b) => Number(!a.printing_id) - Number(!b.printing_id) || b.quantity - a.quantity);
  const top = sorted.find((r) => rowKey(r) === shown) ?? sorted[0];
  const image = top?.printing_id ? printingImage(top.printing_id) : card.image_normal;
  const copies = rows.reduce((n, r) => n + r.quantity, 0);
  const value = rows.reduce((s, r) => s + r.quantity * rowUnitPrice(r, card.price_usd), 0);

  const setQty = (r: OwnedRow, q: number) => onSet([{ target: r, quantity: q }]);
  /** Moves a row's copies to another finish or printing, joining any row already there. */
  const move = (from: OwnedRow, to: OwnedTarget) => {
    const there = rows.find((r) => rowKey(r) === rowKey(to))?.quantity ?? 0;
    onSet([
      { target: from, quantity: 0 },
      { target: to, quantity: there + from.quantity },
    ]);
  };

  return (
    <GlassOverlay label={`${card.name} in your collection`} paused={false} onClose={onClose}>
      <div className="panel mx-auto max-w-4xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="display text-2xl">{card.name}</h2>
            <p className="text-sm opacity-80">
              {copies ? `${copies} ${copies === 1 ? "copy" : "copies"} · about ${money(value)}` : "Not in your collection yet"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn min-h-11 px-4">
            Done
          </button>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr]">
          <img src={image ?? undefined} alt={card.name} width={244} height={340} draggable={false} className={`block w-full max-w-[260px] rounded-[4.75%/3.5%] ${top && top.finish !== "nonfoil" ? "foil-sheen" : ""}`} />
          <div className="min-w-0">
            {sorted.length > 0 && (
              <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/15">
                {sorted.map((r) => (
                  <OwnedLine
                    key={rowKey(r)}
                    row={r}
                    card={card}
                    onShow={() => setShown(rowKey(r))}
                    onQuantity={(q) => setQty(r, q)}
                    onFinish={(f) => move(r, { ...r, finish: f })}
                    onWhich={() => setPicking({ assign: r })}
                  />
                ))}
              </ul>
            )}
            {!picking && (
              <button type="button" onClick={() => setPicking({})} className="btn mt-3 min-h-11 w-full">
                ＋ Add a printing
              </button>
            )}
          </div>
        </div>

        {picking && (
          <PrintingGrid
            card={card}
            assign={picking.assign}
            onCancel={rows.length ? () => setPicking(null) : undefined}
            onPick={(p, foil) => {
              const target: OwnedTarget = { oracle_id: card.oracle_id, printing_id: p.id, finish: finishFor(p, foil), printing_info: infoOf(p) };
              if (picking.assign) {
                const from = picking.assign;
                move(from, { ...target, finish: finishFor(p, from.finish !== "nonfoil") });
                setPicking(null);
              } else {
                const there = rows.find((r) => rowKey(r) === rowKey(target))?.quantity ?? 0;
                onSet([{ target, quantity: there + 1 }]);
                setShown(rowKey(target));
              }
            }}
          />
        )}
      </div>
    </GlassOverlay>
  );
}

function OwnedLine({
  row,
  card,
  onShow,
  onQuantity,
  onFinish,
  onWhich,
}: {
  row: OwnedRow;
  card: CardSummary;
  onShow: () => void;
  onQuantity: (q: number) => void;
  onFinish: (f: Finish) => void;
  onWhich: () => void;
}) {
  const p = row.printing_info;
  const finishes: Finish[] = p
    ? (["nonfoil", "foil", "etched"] as Finish[]).filter((f) => p.finishes.includes(f) || f === row.finish)
    : ["nonfoil", "foil", "etched"];
  return (
    <li className="flex flex-wrap items-center gap-2 px-2 py-2 text-sm">
      <button type="button" onClick={onShow} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" title="Show this printing">
        {row.printing_id ? (
          <img src={printingImage(row.printing_id, "art_crop")} alt="" width={48} height={35} className="h-9 w-12 shrink-0 rounded object-cover" />
        ) : (
          <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded bg-foreground/10 text-lg opacity-70">?</span>
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{p ? p.set_name : "Printing unknown"}</span>
          <span className="block text-xs opacity-75">
            {p ? `${p.set.toUpperCase()} #${p.number} · ` : ""}
            {money(rowUnitPrice(row, card.price_usd))} each
          </span>
        </span>
      </button>
      {!row.printing_id && (
        <button type="button" onClick={onWhich} className="min-h-10 rounded-md border border-gold px-2 text-xs text-gold">
          Which printing?
        </button>
      )}
      {finishes.length > 1 && (
        <select
          value={row.finish}
          onChange={(e) => onFinish(e.target.value as Finish)}
          aria-label="Finish"
          className="min-h-10 rounded-md border border-foreground/20 bg-background px-1 text-xs"
        >
          {finishes.map((f) => (
            <option key={f} value={f}>
              {FINISH_LABELS[f]}
            </option>
          ))}
        </select>
      )}
      {finishes.length === 1 && row.finish !== "nonfoil" && <span className="text-xs text-gold">✦ {FINISH_LABELS[row.finish]}</span>}
      <span className="flex items-center gap-1">
        <button type="button" aria-label={`One fewer, ${p?.set_name ?? "printing unknown"}`} onClick={() => onQuantity(row.quantity - 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
          −
        </button>
        <span className="w-8 text-center font-semibold tabular-nums">{row.quantity}</span>
        <button type="button" aria-label={`One more, ${p?.set_name ?? "printing unknown"}`} onClick={() => onQuantity(row.quantity + 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
          +
        </button>
      </span>
    </li>
  );
}

/** Every paper printing, newest first; tapping one adds a copy (or, for unknown copies, says which printing they are). */
function PrintingGrid({ card, assign, onPick, onCancel }: { card: CardSummary; assign?: OwnedRow; onPick: (p: ChosenPrinting, foil: boolean) => void; onCancel?: () => void }) {
  const [prints, setPrints] = useState<ChosenPrinting[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foil, setFoil] = useState(false);

  useEffect(() => {
    let live = true;
    fetchPrintings(card.oracle_id)
      .then((p) => {
        if (!live) return;
        setPrints(p.prints);
        setNext(p.next);
      })
      .catch((e: Error) => live && setError(`Couldn't load printings: ${e.message}`));
    return () => {
      live = false;
    };
  }, [card.oracle_id]);

  async function more() {
    if (!next) return;
    try {
      const p = await fetchPrintings(card.oracle_id, next);
      setPrints((old) => [...(old ?? []), ...p.prints]);
      setNext(p.next);
    } catch (e) {
      setError(`Couldn't load more printings: ${(e as Error).message}`);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-foreground/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">
          {assign ? `Which printing are your ${assign.quantity} unknown ${assign.quantity === 1 ? "copy" : "copies"}? Tap it.` : "Tap a printing to add a copy."}
        </p>
        {!assign && (
          <button type="button" aria-pressed={foil} onClick={() => setFoil((f) => !f)} className={`min-h-11 rounded-lg border px-3 text-sm ${foil ? "border-gold text-gold" : "border-foreground/20"}`}>
            ✦ Foil: {foil ? "on" : "off"}
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-11 px-3 text-sm opacity-75">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!prints && !error && <p className="mt-2 text-sm opacity-60">Loading printings…</p>}
      {prints && (
        <ul className="mt-3 grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {prints.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p, foil)}
                title={`${p.set_name} #${p.number}`}
                className="block w-full rounded-lg border border-transparent p-1 text-left text-xs hover:border-foreground/30"
              >
                <img src={printingImage(p.id)} alt={`${card.name}, ${p.set_name}`} loading="lazy" draggable={false} width={244} height={340} className={`block w-full rounded-[4.75%/3.5%] ${foil && hasFoil(p.finishes) ? "foil-sheen" : ""}`} />
                <span className="mt-1 block truncate">{p.set_name}</span>
                <span className="block opacity-70">
                  {p.set.toUpperCase()} #{p.number}
                  {foil && !hasFoil(p.finishes) ? " · no foil" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" onClick={more} className="mt-2 min-h-11 w-full rounded-lg border border-foreground/20 text-sm">
          Show more printings
        </button>
      )}
    </section>
  );
}
