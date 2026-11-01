"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PreviewMode } from "@/lib/tags/layout-prefs";

const OPTIONS: { value: PreviewMode; name: string; about: string }[] = [
  { value: "float", name: "Floating", about: "Appears while your mouse is on a card, on the far side of the screen. The cards use the full width." },
  { value: "docked", name: "Docked", about: "Always on the right, with tags you can click. Takes a column of its own." },
  { value: "off", name: "Off", about: "No preview. The cards use the full width; click a card to see it and its tags." },
];

/** Card preview in the deck editor (wide screens; phones open the card instead). Saved in profiles.tag_view. */
export function PreviewSetting({ userId, initial }: { userId: string; initial: PreviewMode }) {
  const router = useRouter();
  const [mode, setMode] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(next: PreviewMode) {
    const before = mode;
    setMode(next);
    setMessage(null);
    // tag_view holds other choices too, so read the latest copy and change only this one.
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("profiles").select("tag_view").eq("id", userId).single();
    const { error } = readError
      ? { error: readError }
      : await supabase.from("profiles").update({ tag_view: { ...(data.tag_view as object | null), previewMode: next } }).eq("id", userId);
    if (error) {
      setMode(before);
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setMessage("Saved.");
    // Decks opened earlier in this visit must not come back with the old choice.
    router.refresh();
  }

  return (
    <fieldset className="mt-6">
      <legend className="display text-xl">Card preview</legend>
      <p className="mt-1 text-sm opacity-80">How the deck editor shows the card under your mouse. Phones open the card instead.</p>
      <div className="mt-3 space-y-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`panel flex min-h-14 cursor-pointer items-start gap-3 p-3 ${mode === o.value ? "border-gold" : ""}`}>
            <input type="radio" name="preview" checked={mode === o.value} onChange={() => choose(o.value)} className="mt-1 h-4 w-4 accent-gold" />
            <span>
              <span className="block font-medium">{o.name}</span>
              <span className="block text-sm opacity-80">{o.about}</span>
            </span>
          </label>
        ))}
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>
    </fieldset>
  );
}
