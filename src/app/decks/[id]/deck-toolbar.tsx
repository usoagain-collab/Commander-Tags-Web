"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  GROUP_LABELS,
  SORT_LABELS,
  VIEW_LABELS,
  type GroupBy,
  type SortBy,
  type ViewMode,
  type ViewSettings,
} from "@/lib/deck/grouping";

/**
 * Everything remembered in profiles.tag_view: View / Group / Sort and the top-tags switches. One writer for the
 * whole object, so changing one setting can't overwrite another that was changed a moment earlier.
 */
export function useTagViewPrefs(savedTagView: Record<string, unknown>, userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [prefs, setPrefs] = useState<Record<string, unknown>>(savedTagView);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!userId) return;
    // Supabase only sends a query once something awaits it, so the await here is what makes the save happen.
    const timer = setTimeout(async () => {
      await supabase.from("profiles").update({ tag_view: prefs }).eq("id", userId);
    }, 400);
    return () => clearTimeout(timer);
  }, [prefs, supabase, userId]);

  const update = useCallback((patch: Record<string, unknown>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update] as const;
}

/** Hidden tags ("o:<slug>" / "a:<slug>"), saved to profiles.hidden_tags. */
export function useHiddenTags(initial: string[], userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!userId) return;
    const timer = setTimeout(async () => {
      await supabase.from("profiles").update({ hidden_tags: [...hidden] }).eq("id", userId);
    }, 400);
    return () => clearTimeout(timer);
  }, [hidden, supabase, userId]);

  const toggle = useCallback(
    (key: string) =>
      setHidden((h) => {
        const next = new Set(h);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  return [hidden, toggle] as const;
}

export function DeckToolbar({ settings, onChange }: { settings: ViewSettings; onChange: (s: ViewSettings) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Select label="View" value={settings.view} options={VIEW_LABELS} onChange={(v) => onChange({ ...settings, view: v as ViewMode })} />
      <Select label="Group" value={settings.group} options={GROUP_LABELS} onChange={(v) => onChange({ ...settings, group: v as GroupBy })} />
      <Select label="Sort" value={settings.sort} options={SORT_LABELS} onChange={(v) => onChange({ ...settings, sort: v as SortBy })} />
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="opacity-70">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-9 rounded-md border border-foreground/20 bg-background px-2"
      >
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
