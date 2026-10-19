"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/** View / Group / Sort, remembered per user in profiles.tag_view (merged, so later panels can add keys). */
export function useViewSettings(initial: ViewSettings, savedTagView: Record<string, unknown>, userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState(initial);
  const saved = useRef(savedTagView);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!userId) return;
    const timer = setTimeout(async () => {
      saved.current = { ...saved.current, ...settings };
      await supabase.from("profiles").update({ tag_view: saved.current }).eq("id", userId);
    }, 400);
    return () => clearTimeout(timer);
  }, [settings, supabase, userId]);

  return [settings, setSettings] as const;
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
