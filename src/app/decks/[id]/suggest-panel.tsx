"use client";

// Suggestions (Phase 4a). Asks suggestion_pool() (migration 0012) for candidates, scores them in the browser
// against the deck's theme tags and under-target roles (src/lib/suggest/score.ts), and shows why each card fits.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Board, CardSummary } from "@/lib/deck/model";
import {
  scorePool,
  STYLE_LABELS,
  type PoolCard,
  type ScoreContext,
  type Scored,
  type SuggestSettings,
  type SuggestStyle,
} from "@/lib/suggest/score";
import { Panel } from "./deck-text-panel";

/** What the suggestions are for: a role, a tag, or the deck overall. */
export type SuggestSource = {
  label: string;
  /** Oracle tag slugs, each with its descendants. Empty with `lands`. */
  slugs: string[];
  lands?: boolean;
  /** Set for a role: only cards that really fill it are kept (Targeted removal leaves out board wipes). */
  roleKey?: string;
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
};

export function SuggestPanel(props: Props) {
  const { source, identity, deckIds, isInDeck, score, roleNames, hasCommander, onAdd, onPreview, onClose } = props;
  const supabase = useMemo(() => createClient(), []);
  const [pool, setPool] = useState<PoolCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${source.label}|${source.lands ? "lands" : source.slugs.join(",")}|${identity.join("")}`;

  useEffect(() => {
    let live = true;
    setPool(null);
    setError(null);
    (async () => {
      const { data, error } = await supabase.rpc("suggestion_pool", {
        p_slugs: source.slugs,
        p_identity: identity,
        p_exclude: deckIds,
        p_lands: !!source.lands,
      });
      if (!live) return;
      if (error) setError(`Couldn't load suggestions: ${error.message}`);
      else setPool((data ?? []) as PoolCard[]);
    })();
    return () => {
      live = false;
    };
    // Re-ask only when what we're suggesting for changes; cards added meanwhile are filtered out below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, supabase]);

  const rows: Scored[] = pool
    ? scorePool(
        pool.filter((c) => !isInDeck(c.oracle_id) && (!source.roleKey || score.rolesOf(c).includes(source.roleKey))),
        score,
      )
    : [];

  return (
    <Panel title={`Suggestions: ${source.label}`} onClose={onClose}>
      <StyleControls settings={score.settings} onChange={props.onSettings} />
      {props.saveError && <p className="mt-1 text-sm text-red-600">{props.saveError}</p>}
      {!hasCommander && <p className="mt-2 text-sm opacity-70">No commander yet, so every color is allowed.</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {!error && pool === null && <p className="mt-3 text-sm opacity-60">Finding cards…</p>}
      {pool !== null && rows.length === 0 && (
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
          {rows.map((r) => (
            <SuggestionCard key={r.card.oracle_id} row={r} roleNames={roleNames} onAdd={onAdd} onPreview={onPreview} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SuggestionCard({
  row,
  roleNames,
  onAdd,
  onPreview,
}: {
  row: Scored;
  roleNames: Record<string, string>;
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary) => void;
}) {
  const { card } = row;
  return (
    <li className="flex flex-col gap-2" onMouseEnter={() => onPreview(card)}>
      <button type="button" onClick={() => onPreview(card)} onFocus={() => onPreview(card)} title={`Show ${card.name} in the card panel`} className="block">
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
        <p className="text-xs tabular-nums opacity-60">
          {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : "no price"} ·{" "}
          {card.edhrec_rank ? `EDHREC #${card.edhrec_rank.toLocaleString()}` : "unranked"}
        </p>
        <p className="text-[11px] tabular-nums opacity-50" title="How well it fits this deck, and how often it's played (0-100)">
          fit {Math.round(row.fit * 100)} · played {Math.round(row.pop * 100)}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.fills.map((k) => (
            <span key={k} className="rounded-full bg-green-700/15 px-2 py-0.5 text-[11px] text-green-800 dark:text-green-300">
              fills {roleNames[k] ?? k}
            </span>
          ))}
          {row.shared.slice(0, 4).map((t) => (
            <span key={t.key} className="rounded-full border border-foreground/20 px-2 py-0.5 text-[11px]" title="A theme tag this deck already has">
              {t.label}
            </span>
          ))}
          {!row.fills.length && !row.shared.length && <span className="text-[11px] opacity-60">matches the tag, no shared themes</span>}
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onAdd(card, "main")} className="min-h-11 whitespace-nowrap rounded-lg bg-foreground px-1 text-sm font-medium text-background">
          + Main
        </button>
        <button type="button" onClick={() => onAdd(card, "maybe")} className="min-h-11 whitespace-nowrap rounded-lg border border-foreground/20 px-1 text-sm">
          + Maybe
        </button>
      </div>
    </li>
  );
}

const STYLE_HELP: Record<SuggestStyle, string> = {
  best: "Cards that fit your themes, proven ones first.",
  gems: "Cards that fit your themes that few decks play.",
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
              settings.style === st ? "border-foreground bg-foreground font-medium text-background" : "border-foreground/20 hover:bg-foreground/10"
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
            className="h-8 min-w-0 flex-1 accent-foreground"
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
        className="h-8 accent-foreground"
      />
      <span />
      <span className="-mt-1 flex justify-between text-[11px] opacity-60">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </span>
    </label>
  );
}
