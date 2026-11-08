"use client";

// Multiplayer playtesting (v2): one Supabase Realtime channel per room code. Presence says who is seated (and in
// which order they joined); broadcast carries each player's view of their game and whose turn it is. Nothing is
// stored. The room code and this tab's player id live in session storage, so a refresh rejoins the same seat.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GameState } from "./game";
import { activeSeat, MAX_PLAYERS, nextSeat, turnOrder, viewOf, type PlayerView, type Seat } from "./room";

const ROOM_KEY = "playtest-room";
const ID_KEY = "playtest-player";

function tabId(): string {
  try {
    const saved = sessionStorage.getItem(ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export type Room = ReturnType<typeof useRoom>;

export function useRoom(game: GameState | null, me: { name: string; deck: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [id] = useState(() => (typeof window === "undefined" ? "server" : tabId()));
  const [code, setCode] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : sessionStorage.getItem(ROOM_KEY);
    } catch {
      return null;
    }
  });
  const [seats, setSeats] = useState<Seat[]>([]);
  const [views, setViews] = useState<Record<string, PlayerView>>({});
  const [announced, setAnnounced] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "joining" | "joined" | "full" | "error">("idle");
  const [damage, setDamage] = useState<Record<string, number>>({});
  const channel = useRef<RealtimeChannel | null>(null);
  const joinedAt = useRef(Date.now());
  const latest = useRef<PlayerView | null>(null);

  const myView = game ? viewOf(game, { id, ...me }, damage) : null;
  latest.current = myView;

  const send = useCallback((view: PlayerView | null) => {
    if (view && channel.current) void channel.current.send({ type: "broadcast", event: "state", payload: view });
  }, []);

  useEffect(() => {
    if (!code) return;
    setStatus("joining");
    joinedAt.current = Date.now();
    const ch = supabase.channel(`playtest-room:${code}`, { config: { broadcast: { self: false }, presence: { key: id } } });
    channel.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; joinedAt: number }>();
      const list = Object.entries(state).map(([key, metas]) => ({ id: key, name: metas[0]?.name ?? "Player", joinedAt: metas[0]?.joinedAt ?? 0 }));
      setSeats(list);
      // Too many at the table: the latest arrivals step back out.
      const order = turnOrder(list);
      if (order.length > MAX_PLAYERS && order.findIndex((s) => s.id === id) >= MAX_PLAYERS) {
        setStatus("full");
        void ch.untrack();
      }
    })
      .on("presence", { event: "join" }, () => send(latest.current))
      .on("presence", { event: "leave" }, ({ key }) => setViews((v) => {
        const next = { ...v };
        delete next[key];
        return next;
      }))
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const view = payload as PlayerView;
        if (view?.id && view.id !== id) setViews((v) => ({ ...v, [view.id]: view }));
      })
      .on("broadcast", { event: "turn" }, ({ payload }) => setAnnounced((payload as { active: string }).active))
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          await ch.track({ name: me.name, joinedAt: joinedAt.current });
          setStatus("joined");
          send(latest.current);
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("error");
      });
    return () => {
      void supabase.removeChannel(ch);
      channel.current = null;
      setSeats([]);
      setViews({});
      setAnnounced(null);
    };
    // The name is read once on joining; a rename shows after rejoining.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, id, supabase, send]);

  // Share my game a moment after it changes (a burst of clicks sends once).
  const viewKey = myView ? JSON.stringify(myView) : "";
  useEffect(() => {
    if (status !== "joined" || !viewKey) return;
    const t = setTimeout(() => send(latest.current), 250);
    return () => clearTimeout(t);
  }, [viewKey, status, send]);

  const join = useCallback((next: string) => {
    try {
      sessionStorage.setItem(ROOM_KEY, next);
    } catch {
      // storage blocked: the room still works until a refresh
    }
    setCode(next);
  }, []);
  const leave = useCallback(() => {
    try {
      sessionStorage.removeItem(ROOM_KEY);
    } catch {
      // nothing to clear
    }
    setCode(null);
    setStatus("idle");
    setDamage({});
  }, []);

  const active = activeSeat(seats, announced);
  const passTurn = useCallback(() => {
    const next = nextSeat(seats, active);
    setAnnounced(next);
    if (next && channel.current) void channel.current.send({ type: "broadcast", event: "turn", payload: { active: next } });
    return next;
  }, [seats, active]);

  const order = turnOrder(seats);
  return {
    id,
    code,
    status,
    seats: order,
    opponents: order.filter((s) => s.id !== id).map((s) => ({ seat: s, view: views[s.id] ?? null })),
    active,
    myTurn: active === id,
    damage,
    setDamage: (from: string, n: number) => setDamage((d) => ({ ...d, [from]: Math.max(0, Math.min(99, n)) })),
    join,
    leave,
    passTurn,
  };
}
