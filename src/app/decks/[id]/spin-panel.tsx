"use client";

// Spin the wheel (v2): five random commanders on the frosted overlay, each with its full card, its tags and the
// archetypes those tags point to. Choosing one makes it the commander; Spin again deals five new ones.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { archetypesFor, shownTags, spinCommanders, SPIN_COUNT } from "@/lib/commanders/spin";
import type { CardSummary } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";
import { prettyTag } from "@/lib/tags/pretty";
import type { TagTree } from "@/lib/tags/tree";
import { GlassOverlay } from "./glass-overlay";

export function SpinPanel({ tree, onChoose, onClose }: { tree: TagTree | null; onChoose: (card: CardSummary) => void; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [tags, setTags] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [spins, setSpins] = useState(0);
  // Commanders already dealt this visit, so a re-spin shows new faces.
  const dealt = useRef(new Set<string>());

  const spin = useCallback(async () => {
    setCards(null);
    setError(null);
    try {
      const picked = await spinCommanders(supabase, { exclude: dealt.current });
      picked.forEach((c) => dealt.current.add(c.oracle_id));
      const res = picked.length ? await supabase.rpc("card_tags_for", { oracle_ids: picked.map((c) => c.oracle_id) }) : { data: null };
      setTags(((res.data as { o?: Record<string, string[]> } | null)?.o ?? {}) as Record<string, string[]>);
      setCards(picked);
      setSpins((n) => n + 1);
    } catch (e) {
      setError(`Couldn't spin: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [supabase]);

  // Once per opening (React's development mode runs effects twice).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void spin();
  }, [spin]);

  return (
    <GlassOverlay label="Spin the wheel" paused={false} onClose={onClose}>
      <div className="mx-auto max-w-7xl space-y-6 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">Spin the wheel</h2>
            <p className="mt-1 max-w-prose text-base opacity-90">
              {SPIN_COUNT} random Commander-legal commanders. Pick one to lead this deck, or spin again.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void spin()} disabled={cards === null && !error} className="btn btn-gold min-h-11 px-4">
              ↻ Spin again
            </button>
            <button type="button" autoFocus onClick={onClose} className="btn min-h-11">
              Close
            </button>
          </div>
        </div>

        {error && <p className="text-red-400">{error}</p>}
        <ul key={spins} className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {cards === null && !error
            ? Array.from({ length: SPIN_COUNT }, (_, i) => <li key={i} className="aspect-[63/88] animate-pulse rounded-xl bg-foreground/10" />)
            : (cards ?? []).map((c, i) => {
                const own = tags[c.oracle_id] ?? [];
                const shown = tree ? shownTags(own, tree) : [];
                const kinds = tree ? archetypesFor(own, tree) : [];
                return (
                  <li key={c.oracle_id} className="fresh flex flex-col gap-2" style={{ animationDelay: `${i * 90}ms` }}>
                    {c.image_normal ? (
                      <img src={c.image_normal} alt={c.name} className="w-full rounded-[4.75%/3.5%] shadow-2xl" />
                    ) : (
                      <div className="panel flex aspect-[63/88] items-center justify-center p-3 text-center font-medium">{c.name}</div>
                    )}
                    <button type="button" onClick={() => onChoose(c)} className="btn btn-gold min-h-11 w-full">
                      Lead with {c.name.split(" // ")[0].split(",")[0]}
                    </button>
                    {kinds.length > 0 && (
                      <p>
                        <span className="eyebrow">Built for </span>
                        {kinds.join(" · ")}
                      </p>
                    )}
                    {shown.length > 0 && (
                      <ul className="flex flex-wrap gap-1">
                        {shown.map((s) => (
                          <li key={s} className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs">
                            {prettyTag(tree?.label(s) ?? s)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {tree && shown.length === 0 && <p className="text-xs opacity-60">No tags yet (new cards get them with the nightly update).</p>}
                  </li>
                );
              })}
        </ul>
        <p className="text-xs opacity-70">&ldquo;Built for&rdquo; reads the commander&apos;s own tags against the starter archetypes; it isn&apos;t a count of what players build.</p>
      </div>
    </GlassOverlay>
  );
}
