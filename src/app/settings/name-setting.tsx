"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const MAX_NAME = 40;

/** The name others see as "Built by …" on decks you share (profiles.display_name; starts as your sign-in name). */
export function NameSetting({ userId, initial }: { userId: string; initial: string | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial ?? "");
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const trimmed = text.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || trimmed === saved) return;
    setBusy(true);
    setMessage(null);
    const { error } = await createClient().from("profiles").update({ display_name: trimmed }).eq("id", userId);
    setBusy(false);
    if (error) {
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setSaved(trimmed);
    setText(trimmed);
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-8">
      <h2 className="display text-xl">Your name</h2>
      <p className="mt-1 text-sm opacity-80">Shown as &ldquo;Built by &hellip;&rdquo; to people who open a deck you share.</p>
      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_NAME}
          aria-label="Your name"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3"
        />
        <button type="submit" disabled={busy || !trimmed || trimmed === saved} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
          Save
        </button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message ?? (!trimmed ? "A name can't be empty." : null)}
      </p>
    </form>
  );
}
