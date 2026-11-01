"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Theme } from "@/lib/supabase/profile";

const OPTIONS: { value: Theme; name: string; about: string }[] = [
  { value: "dark", name: "Dark", about: "Near-black, so card art stands out." },
  { value: "light", name: "Light", about: "Warm paper white, easier in a bright room. The playtest table stays dark." },
];

/** Light or dark, saved to the account (profiles.theme) so it follows the user to every device. */
export function ThemeSetting({ userId, initial }: { userId: string; initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  function show(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  async function choose(next: Theme) {
    const before = theme;
    show(next);
    setMessage(null);
    const { error } = await createClient().from("profiles").update({ theme: next }).eq("id", userId);
    if (error) {
      show(before);
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <fieldset className="mt-8">
      <legend className="display text-xl">Appearance</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`panel flex min-h-14 cursor-pointer items-start gap-3 p-3 ${theme === o.value ? "border-gold" : ""}`}>
            <input type="radio" name="theme" checked={theme === o.value} onChange={() => choose(o.value)} className="mt-1 h-4 w-4 accent-gold" />
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
