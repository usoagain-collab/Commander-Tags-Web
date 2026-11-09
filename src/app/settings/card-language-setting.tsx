"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CARD_LANGS, type CardLang } from "@/lib/deck/card-language";
import { createClient } from "@/lib/supabase/client";

/** Card language (v2): pictures in this language where the printing exists in it. Saved in profiles.tag_view. */
export function CardLanguageSetting({ userId, initial }: { userId: string; initial: CardLang }) {
  const router = useRouter();
  const [lang, setLang] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(next: CardLang) {
    const before = lang;
    setLang(next);
    setMessage(null);
    // tag_view holds other choices too, so read the latest copy and change only this one.
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("profiles").select("tag_view").eq("id", userId).single();
    const { error } = readError
      ? { error: readError }
      : await supabase.from("profiles").update({ tag_view: { ...(data.tag_view as object | null), cardLang: next } }).eq("id", userId);
    if (error) {
      setLang(before);
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <fieldset className="mt-6">
      <legend className="display text-xl">Card language</legend>
      <p className="mt-1 text-sm opacity-80">
        Card pictures in your decks, precons, collection and playtests show this language when that printing was made in it, otherwise English. Names, search
        and tags stay in English. The first visit to a deck in a new language takes a few seconds while the pictures are found.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <span className="sr-only">Card language</span>
        <select value={lang} onChange={(e) => choose(e.target.value as CardLang)} className="min-h-11 rounded-md border border-foreground/20 bg-background px-3">
          {(Object.keys(CARD_LANGS) as CardLang[]).map((l) => (
            <option key={l} value={l}>
              {CARD_LANGS[l]}
            </option>
          ))}
        </select>
      </label>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>
    </fieldset>
  );
}
