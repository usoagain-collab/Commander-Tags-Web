"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const OPTIONS: { value: boolean; name: string; about: string }[] = [
  {
    value: true,
    name: "Use a printing I own",
    about: "A card you add shows the printing you own most copies of, unless you picked a default printing for it yourself.",
  },
  { value: false, name: "Use the default printing", about: "Cards you add show your default printing, or the card's usual one." },
];

/** Use the printings I own (V3): which printing a newly added card shows. Saved in profiles.tag_view.ownedPrintings. */
export function OwnedPrintingSetting({ userId, initial }: { userId: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(next: boolean) {
    const before = on;
    setOn(next);
    setMessage(null);
    // tag_view holds other choices too, so read the latest copy and change only this one.
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("profiles").select("tag_view").eq("id", userId).single();
    const { error } = readError
      ? { error: readError }
      : await supabase.from("profiles").update({ tag_view: { ...(data.tag_view as object | null), ownedPrintings: next } }).eq("id", userId);
    if (error) {
      setOn(before);
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <fieldset className="mt-6">
      <legend className="display text-xl">Printings you own</legend>
      <p className="mt-1 text-sm opacity-80">Which printing a card shows when you add or import it into a deck.</p>
      <div className="mt-3 space-y-2">
        {OPTIONS.map((o) => (
          <label key={String(o.value)} className={`panel flex min-h-14 cursor-pointer items-start gap-3 p-3 ${on === o.value ? "border-gold" : ""}`}>
            <input type="radio" name="owned-printings" checked={on === o.value} onChange={() => choose(o.value)} className="mt-1 h-4 w-4 accent-gold" />
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
