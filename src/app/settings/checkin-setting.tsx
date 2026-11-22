"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Monthly check-in email on or off (V3, migration 0063). Hidden until the migration adds profiles.checkin_emails. */
export function CheckinSetting({ userId, initial }: { userId: string; initial: boolean | null }) {
  const [on, setOn] = useState(initial === true);
  const [message, setMessage] = useState<string | null>(null);
  if (initial === null) return null;

  async function toggle(next: boolean) {
    setOn(next);
    setMessage(null);
    const { error } = await createClient().from("profiles").update({ checkin_emails: next }).eq("id", userId);
    if (error) {
      setOn(!next);
      setMessage("Couldn't save that. Try again in a minute.");
      return;
    }
    setMessage("Saved.");
  }

  return (
    // id="email": the check-in email's "email settings" link lands here.
    <fieldset id="email" className="mt-6 scroll-mt-24">
      <legend className="display text-xl">Email</legend>
      <label className="panel mt-3 flex min-h-14 cursor-pointer items-start gap-3 p-3">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} className="mt-1 h-4 w-4 accent-gold" />
        <span>
          <span className="block font-medium">Email me three quick questions once a month</span>
          <span className="block text-sm opacity-80">
            How your decks are going and what to improve. <Link href="/checkin" className="underline">Answer this month&apos;s now</Link>.
          </span>
        </span>
      </label>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message}
      </p>
    </fieldset>
  );
}
