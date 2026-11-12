"use client";

import { useEffect, useState } from "react";
import type { CardSummary } from "@/lib/deck/model";
import { foilFor, hasFoil, printingIdFromImage, printingImage, type ChosenPrinting } from "@/lib/deck/printing";
import { fetchPrinting, fetchPrintings } from "@/lib/scryfall/printings";

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`);

/**
 * Pick which printing a deck row uses, and whether it is foil. A grid of printings where the whole tile is the tap
 * target, a big Foil button, and a way back to the default printing. Loaded live from Scryfall when opened.
 */
export function PrintingPicker({
  card,
  printing,
  pickedHere,
  myDefault,
  onPick,
  onSetDefault,
  onDone,
}: {
  card: CardSummary;
  printing: ChosenPrinting | null;
  pickedHere: boolean;
  myDefault: ChosenPrinting | null;
  onPick: (to: ChosenPrinting | null) => void;
  onSetDefault: (to: ChosenPrinting | null) => void;
  onDone: () => void;
}) {
  const [prints, setPrints] = useState<ChosenPrinting[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the card shows now, even with nothing chosen: turning foil on pins this printing.
  const shownId = printing?.id ?? printingIdFromImage(card.image_normal);
  const [shown, setShown] = useState<ChosenPrinting | null>(printing);

  useEffect(() => {
    let live = true;
    setPrints(null);
    setError(null);
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

  useEffect(() => {
    if (printing) return setShown(printing);
    if (!shownId) return setShown(null);
    let live = true;
    fetchPrinting(shownId)
      .then((p) => live && setShown(p))
      .catch(() => live && setShown(null));
    return () => {
      live = false;
    };
  }, [printing, shownId]);

  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const p = await fetchPrintings(card.oracle_id, next);
      setPrints((old) => [...(old ?? []), ...p.prints]);
      setNext(p.next);
    } catch (e) {
      setError(`Couldn't load more printings: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  const foil = !!printing?.foil;
  const foilLocked = shown ? foilFor(shown.finishes, !foil) === foil : true;

  return (
    <div className="rounded-lg border border-foreground/15 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">
          Printing &amp; foil <span className="font-normal opacity-60">· TCGplayer prices</span>
        </p>
        <button type="button" onClick={onDone} className="min-h-11 px-3 text-sm opacity-70">
          Back
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={foil}
          disabled={foilLocked}
          onClick={() => shown && onPick({ ...shown, foil: !foil })}
          className={`min-h-11 rounded-lg border px-3 text-sm font-medium disabled:opacity-50 ${foil ? "border-gold text-gold" : "border-foreground/20 hover:bg-foreground/10"}`}
        >
          ✦ Foil: {foil ? "on" : "off"}
        </button>
        <button
          type="button"
          disabled={!pickedHere}
          onClick={() => onPick(null)}
          className="min-h-11 rounded-lg border border-foreground/20 px-3 text-sm font-medium hover:bg-foreground/10 disabled:opacity-50"
        >
          {myDefault ? "Use my default" : "Back to default"}
        </button>
        {shown && shown.id === myDefault?.id ? (
          <button
            type="button"
            onClick={() => onSetDefault(null)}
            className="col-span-2 min-h-11 rounded-lg border border-gold px-3 text-sm font-medium text-gold"
          >
            ★ My default in all decks: clear it
          </button>
        ) : (
          <button
            type="button"
            disabled={!shown}
            onClick={() => shown && onSetDefault(shown)}
            className="col-span-2 min-h-11 rounded-lg border border-foreground/20 px-3 text-sm font-medium hover:bg-foreground/10 disabled:opacity-50"
          >
            ★ Make this my default in all decks
          </button>
        )}
      </div>
      {shown && foilLocked && (
        <p className="mt-1 text-xs opacity-70">{hasFoil(shown.finishes) ? "This printing only comes in foil." : "This printing has no foil. Pick one that does."}</p>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!prints && !error && <p className="mt-2 text-sm opacity-60">Loading printings…</p>}
      {prints?.length === 0 && <p className="mt-2 text-sm opacity-60">Scryfall lists no paper printings of this card.</p>}

      {prints && prints.length > 0 && (
        <ul className="mt-3 grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {prints.map((p) => {
            const chosen = p.id === shownId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  title={`Use ${p.set_name} #${p.number}`}
                  onClick={() => onPick({ ...p, foil: foilFor(p.finishes, foil) })}
                  className={`block w-full rounded-lg border p-1 text-left text-xs ${chosen ? "border-gold ring-2 ring-gold" : "border-transparent hover:border-foreground/30"}`}
                >
                  <img
                    src={printingImage(p.id)}
                    alt={`${card.name}, ${p.set_name}`}
                    loading="lazy"
                    draggable={false}
                    width={244}
                    height={340}
                    className="block w-full rounded-[4.75%/3.5%]"
                  />
                  <span className="mt-1 block truncate">{p.set_name}</span>
                  {p.id === myDefault?.id && <span className="block text-gold">★ Your default</span>}
                  <span className="block opacity-70">
                    {p.set.toUpperCase()} #{p.number}
                  </span>
                  <span className="block tabular-nums opacity-90">
                    {[money(p.usd), (p.usd_foil ?? p.usd_etched) != null ? `✦ ${money(p.usd_foil ?? p.usd_etched)}` : hasFoil(p.finishes) ? "✦" : null]
                      .filter(Boolean)
                      .join(" · ") || "No price"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <button type="button" onClick={more} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-foreground/20 text-sm disabled:opacity-50">
          {busy ? "Loading…" : "Show more printings"}
        </button>
      )}
    </div>
  );
}
