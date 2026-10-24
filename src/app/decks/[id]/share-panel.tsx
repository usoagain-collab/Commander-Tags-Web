"use client";

// Share links (Phase 7a): the owner picks who can open the deck and copies its link. Viewers see it read-only.
// Unlisted = anyone with the link (served by shared_deck(), migration 0020); public = anyone, and listable later.
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "./deck-text-panel";
import type { Visibility } from "./deck-editor";

const OPTIONS: { value: Visibility; title: string; blurb: string }[] = [
  { value: "private", title: "Private", blurb: "Only you can open it." },
  { value: "unlisted", title: "Anyone with the link", blurb: "Not listed anywhere; people need the link. Read-only for them." },
  { value: "public", title: "Public", blurb: "Anyone can open it. Read-only for others." },
];

export function SharePanel({
  deckId,
  visibility,
  onChange,
  onClose,
}: {
  deckId: string;
  visibility: Visibility;
  onChange: (v: Visibility) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/decks/${deckId}` : `/decks/${deckId}`;

  async function choose(v: Visibility) {
    const before = visibility;
    onChange(v);
    const { error } = await supabase.from("decks").update({ visibility: v }).eq("id", deckId);
    if (error) {
      onChange(before);
      setError(`Couldn't save: ${error.message}`);
    } else setError(null);
  }

  return (
    <Panel title="Share" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who can open this deck">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={visibility === o.value}
              onClick={() => choose(o.value)}
              className={`min-h-11 rounded-lg border px-3 py-2 text-left ${
                visibility === o.value ? "border-foreground bg-foreground text-background" : "border-foreground/20 hover:bg-foreground/10"
              }`}
            >
              <span className="block font-semibold">{o.title}</span>
              <span className="block text-xs opacity-80">{o.blurb}</span>
            </button>
          ))}
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={link} aria-label="Deck link" className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            disabled={visibility === "private"}
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="min-h-11 rounded-lg bg-foreground px-4 font-medium text-background disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {visibility === "private" && <p className="opacity-70">Choose “Anyone with the link” or “Public” to share it.</p>}
      </div>
    </Panel>
  );
}
