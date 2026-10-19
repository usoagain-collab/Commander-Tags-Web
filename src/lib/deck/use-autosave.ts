"use client";

// Autosave: every edit (card counts, categories and My tags: one SavePayload) is queued and sent to the database in order, one call per edit.
// The screen updates immediately (optimistic); if a save fails, the queue stops, keeps the unsaved edits,
// and shows an error with a Retry button, so nothing is silently lost or applied out of order.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SavePayload } from "./model";

export type SaveStatus = { state: "saved" | "saving" | "error"; error?: string; pending: number };

export function useAutosave(deckId: string) {
  const supabase = useMemo(() => createClient(), []);
  const queue = useRef<SavePayload[]>([]);
  const running = useRef(false);
  const failed = useRef(false);
  const [status, setStatus] = useState<SaveStatus>({ state: "saved", pending: 0 });

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    failed.current = false;
    while (queue.current.length > 0) {
      setStatus({ state: "saving", pending: queue.current.length });
      const next = queue.current[0];
      const { error } = await supabase.rpc("apply_deck_changes", {
        p_deck: deckId,
        p_changes: next.rows,
        p_categories: next.categories,
        p_tag_cards: next.tag_cards,
        p_snapshot_name: next.snapshot_name ?? null,
      });
      if (error) {
        running.current = false;
        failed.current = true;
        setStatus({ state: "error", error: error.message, pending: queue.current.length });
        return;
      }
      queue.current.shift();
    }
    running.current = false;
    setStatus({ state: "saved", pending: 0 });
  }, [deckId, supabase]);

  const save = useCallback(
    (payload: SavePayload) => {
      queue.current.push(payload);
      if (failed.current) {
        // While a save is failing, keep queueing but wait for Retry, so edits stay in order.
        setStatus((s) => ({ ...s, pending: queue.current.length }));
      } else {
        void flush();
      }
    },
    [flush],
  );

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queue.current.length > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { status, save, retry: flush };
}
