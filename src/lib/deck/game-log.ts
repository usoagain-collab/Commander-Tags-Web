// Game log (V3, migration 0058): games recorded for one of your decks. Until the migration runs, loading fails
// quietly and the Game log panel says it isn't switched on yet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type GameResult = "win" | "loss" | "draw";
export type DeckGame = {
  id: string;
  played_on: string;
  result: GameResult;
  pod_size: number | null;
  opponents: string | null;
  note: string | null;
  standouts: string[];
  flops: string[];
};
export type NewGame = Omit<DeckGame, "id">;

export const OPPONENTS_MAX = 200;
export const GAME_NOTE_MAX = 500;
export const CARD_PICKS_MAX = 20;

const fold = (s: string | null | undefined, max: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t || null;
};

/** A game ready to save: text trimmed, pod 2 to 8 or none, a card can't both stand out and flop. */
export function cleanGame(g: NewGame, today: string): NewGame {
  const pod = Number(g.pod_size);
  const standouts = [...new Set(g.standouts)].slice(0, CARD_PICKS_MAX);
  const flops = [...new Set(g.flops)].filter((id) => !standouts.includes(id)).slice(0, CARD_PICKS_MAX);
  return {
    played_on: /^\d{4}-\d{2}-\d{2}$/.test(g.played_on) && g.played_on <= today ? g.played_on : today,
    result: g.result === "win" || g.result === "draw" ? g.result : "loss",
    pod_size: Number.isInteger(pod) && pod >= 2 && pod <= 8 ? pod : null,
    opponents: fold(g.opponents, OPPONENTS_MAX),
    note: fold(g.note, GAME_NOTE_MAX),
    standouts,
    flops,
  };
}

export type GameSummary = { games: number; wins: number; losses: number; draws: number; winRate: number | null };

export function summarize(games: DeckGame[]): GameSummary {
  const wins = games.filter((g) => g.result === "win").length;
  const draws = games.filter((g) => g.result === "draw").length;
  const losses = games.length - wins - draws;
  return { games: games.length, wins, losses, draws, winRate: games.length ? wins / games.length : null };
}

/**
 * How each card did across the logged games: times it stood out and times it flopped, most mentioned first.
 * Only cards mentioned at least once appear.
 */
export function cardRecord(games: DeckGame[]): { oracle_id: string; stood: number; flopped: number }[] {
  const m = new Map<string, { stood: number; flopped: number }>();
  for (const g of games) {
    for (const id of g.standouts) m.set(id, { ...(m.get(id) ?? { stood: 0, flopped: 0 }), stood: (m.get(id)?.stood ?? 0) + 1 });
    for (const id of g.flops) m.set(id, { ...(m.get(id) ?? { stood: 0, flopped: 0 }), flopped: (m.get(id)?.flopped ?? 0) + 1 });
  }
  return [...m]
    .map(([oracle_id, r]) => ({ oracle_id, ...r }))
    .sort((a, b) => b.stood + b.flopped - (a.stood + a.flopped) || b.flopped - a.flopped);
}

/** Today in the browser's own time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const off = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}

export type GameLog = {
  available: boolean | null;
  games: DeckGame[];
  log: (g: NewGame) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
};

/** Loads and writes the deck's games. `onFlops` hears which cards flopped, to count them as playtest flags. */
export function useGameLog(deckId: string, owner: boolean, onFlops: (ids: string[]) => void): GameLog {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState<boolean | null>(owner ? null : false);
  const [games, setGames] = useState<DeckGame[]>([]);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    supabase
      .from("deck_games")
      .select("id, played_on, result, pod_size, opponents, note, standouts, flops")
      .eq("deck_id", deckId)
      .order("played_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setAvailable(false);
        setGames((data ?? []) as DeckGame[]);
        setAvailable(true);
      });
    return () => {
      live = false;
    };
  }, [supabase, deckId, owner]);

  const log = useCallback(
    async (raw: NewGame) => {
      const g = cleanGame(raw, localToday());
      const { data, error } = await supabase.from("deck_games").insert({ deck_id: deckId, ...g }).select("id").single();
      if (error) return `Couldn't save the game: ${error.message}`;
      setGames((list) => [{ id: data.id as string, ...g }, ...list].sort((a, b) => b.played_on.localeCompare(a.played_on)));
      if (g.flops.length) onFlops(g.flops);
      return null;
    },
    [supabase, deckId, onFlops],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("deck_games").delete().eq("id", id);
      if (error) return `Couldn't delete the game: ${error.message}`;
      setGames((list) => list.filter((g) => g.id !== id));
      return null;
    },
    [supabase],
  );

  return { available, games, log, remove };
}
