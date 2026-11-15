"use client";

// Co-build (V3, migration 0064): the editor's Build together panel calls the co-build functions through this hook.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cobuildError, readCobuild, type CobuildInfo } from "./cobuild";

export type Cobuild = {
  /** null while loading; false before migration 0064 runs, when signed out, or with no access. */
  available: boolean | null;
  info: CobuildInfo | null;
  newLink: () => Promise<string | null>;
  stopLink: () => Promise<string | null>;
  remove: (userId: string) => Promise<string | null>;
  leave: () => Promise<string | null>;
  /** Asks again who builds the deck. */
  reload: () => Promise<void>;
};

export function useCobuild(deckId: string, enabled: boolean): Cobuild {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState<boolean | null>(enabled ? null : false);
  const [info, setInfo] = useState<CobuildInfo | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("deck_cobuild", { p_deck: deckId });
    const read = error ? null : readCobuild(data);
    setInfo(read);
    setAvailable(!!read);
  }, [supabase, deckId]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const manage = useCallback(
    async (action: "new_link" | "stop_link" | "remove", user: string | null, fallback: string) => {
      const { error } = await supabase.rpc("manage_cobuild", { p_deck: deckId, p_action: action, p_user: user });
      if (error) return cobuildError(error.message, fallback);
      await reload();
      return null;
    },
    [supabase, deckId, reload],
  );

  const leave = useCallback(async () => {
    const { data, error } = await supabase.rpc("leave_cobuild", { p_deck: deckId });
    if (error || data !== true) return "Couldn't take you off this deck.";
    return null;
  }, [supabase, deckId]);

  return {
    available,
    info,
    newLink: () => manage("new_link", null, "Couldn't make a new link."),
    stopLink: () => manage("stop_link", null, "Couldn't turn the link off."),
    remove: (userId: string) => manage("remove", userId, "Couldn't take them off this deck."),
    leave,
    reload,
  };
}
