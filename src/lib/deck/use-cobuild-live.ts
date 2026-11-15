"use client";

// Co-build live updates (V3): everyone with a co-built deck open joins one Supabase Realtime channel for it.
// After a save, the editor sends a bare "changed" ping on it, with no cards or names in it. Whoever else has
// the deck open fetches it again through the normal page load, where row-level security decides what they see.
// No table is published to Realtime and nothing is stored, so this needs no migration.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cobuildChannel } from "./cobuild";

/** `enabled`: this deck is built by more than one person. `onChanged` runs when someone else saved. */
export function useCobuildLive(deckId: string, enabled: boolean, onChanged: () => void) {
  const supabase = useMemo(() => createClient(), []);
  const channel = useRef<RealtimeChannel | null>(null);
  const ready = useRef(false);
  const handler = useRef(onChanged);
  handler.current = onChanged;

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel(cobuildChannel(deckId), { config: { broadcast: { self: false } } });
    channel.current = ch;
    ch.on("broadcast", { event: "changed" }, () => handler.current()).subscribe((s) => {
      ready.current = s === "SUBSCRIBED";
    });
    return () => {
      ready.current = false;
      channel.current = null;
      void supabase.removeChannel(ch);
    };
  }, [enabled, deckId, supabase]);

  // A burst of saves sends one ping.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ping = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (ready.current && channel.current) void channel.current.send({ type: "broadcast", event: "changed", payload: {} });
    }, 400);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { ping };
}
