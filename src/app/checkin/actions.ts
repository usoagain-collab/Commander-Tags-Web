"use server";

// Monthly check-in (V3, migration 0063): save this month's answers, or turn the emails off. Both work from the
// signed link in the email (no sign-in needed) or for whoever is signed in. Writes use the service-role key because
// the check-in tables have no grants for the browser.
import { checkinSecret, checkLink, cleanAnswer, monthKey } from "@/lib/checkin/checkin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";

export type CheckinState = { ok: boolean; error: string | null };

const NOT_READY = "Check-ins aren't switched on yet. Thanks for trying!";

async function whoFrom(form: FormData, purpose: "answer" | "stop"): Promise<string | null> {
  const fromLink = await checkLink(checkinSecret(), purpose, form.get("u"), form.get("t"));
  if (fromLink) return fromLink;
  return (await getCurrentUser())?.id ?? null;
}

export async function saveCheckin(_prev: CheckinState, form: FormData): Promise<CheckinState> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: NOT_READY };
  const who = await whoFrom(form, "answer");
  if (!who) return { ok: false, error: "This link doesn't work any more. Sign in and open the check-in from Settings." };
  const { answer, problem } = cleanAnswer(Object.fromEntries(form.entries()));
  if (!answer) return { ok: false, error: problem };
  const { error } = await createAdminClient()
    .from("checkin_answers")
    .upsert({ user_id: who, month: monthKey(), ...answer, updated_at: new Date().toISOString() }, { onConflict: "user_id,month" });
  if (error) return { ok: false, error: /checkin_answers/.test(error.message) ? NOT_READY : "Couldn't save that just now. Try again in a minute." };
  return { ok: true, error: null };
}

export async function stopCheckins(_prev: CheckinState, form: FormData): Promise<CheckinState> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Couldn't do that just now. Email usoagain@gmail.com and we'll stop them." };
  const who = await whoFrom(form, "stop");
  if (!who) return { ok: false, error: "This link doesn't work. Sign in and switch check-in emails off in Settings." };
  const { error } = await createAdminClient().from("profiles").update({ checkin_emails: false }).eq("id", who);
  if (error) return { ok: false, error: "Couldn't do that just now. Email usoagain@gmail.com and we'll stop them." };
  return { ok: true, error: null };
}
