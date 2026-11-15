"use client";

// Card notes (V3): the note box in the card sheet. Saves when you leave the box; only you see it.
import { useState } from "react";
import { cleanNote, NOTE_MAX } from "@/lib/deck/card-notes";

export function CardNoteField({ note, onSave }: { note: string; onSave: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState(note);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  const commit = async () => {
    if (cleanNote(text) === note) return;
    setState("saving");
    const error = await onSave(text);
    setState(error ?? "saved");
  };

  return (
    <label className="block text-sm">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Note</span>
        <span className="text-xs opacity-60">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "idle" ? "Only you see this" : ""}
        </span>
      </span>
      <textarea
        value={text}
        maxLength={NOTE_MAX}
        rows={2}
        placeholder="Why it's here, or what to swap it for"
        onChange={(e) => {
          setText(e.target.value);
          if (state === "saved") setState("idle");
        }}
        onBlur={commit}
        className="mt-1 w-full rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-base sm:text-sm"
      />
      {state !== "idle" && state !== "saving" && state !== "saved" && <span className="text-xs text-red-400">{state}</span>}
    </label>
  );
}
