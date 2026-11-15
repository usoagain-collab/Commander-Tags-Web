"use server";

// Admin only (V3 monthly check-in, migration 0063). Nothing here runs by itself: David presses Send on /admin/checkin.
// Each press emails at most SEND_BATCH people who haven't had this month's email, then stops; press again for more.
import { isAdmin } from "@/lib/admin/access";
import { buildCheckinEmail, checkinLinks, checkinSecret, monthKey, SEND_BATCH, siteOrigin } from "@/lib/checkin/checkin";
import { emailReady, sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAudience } from "@/lib/checkin/audience";
import { getCurrentUser } from "@/lib/supabase/user";

export type SendState = { message: string | null; error: string | null };

async function gate(): Promise<{ error: string } | { admin: ReturnType<typeof createAdminClient>; secret: string; me: string }> {
  const me = await getCurrentUser();
  if (!me || !isAdmin(me.id)) return { error: "Not allowed." };
  const secret = checkinSecret();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !secret) return { error: "The service-role key isn't set on this server." };
  if (!emailReady()) return { error: "No email service is set up yet (EMAIL_API_KEY and EMAIL_FROM)." };
  return { admin: createAdminClient(), secret, me: me.id };
}

/** Sends this month's check-in to the next batch. Needs the confirm box ticked. */
export async function sendCheckinBatch(_prev: SendState, form: FormData): Promise<SendState> {
  if (form.get("confirm") !== "yes") return { message: null, error: "Tick the box to confirm first." };
  const g = await gate();
  if ("error" in g) return { message: null, error: g.error };
  const month = monthKey();
  let people;
  try {
    people = (await loadAudience(g.admin, month)).slice(0, SEND_BATCH);
  } catch {
    return { message: null, error: "Couldn't read the list of players. Has migration 0063 been run?" };
  }
  if (!people.length) return { message: "Everyone has this month's email already.", error: null };

  const origin = siteOrigin();
  let sent = 0;
  let failed = 0;
  let lastError = "";
  for (const p of people) {
    // Claim the row first, so a second press at the same time can't email the same person twice.
    const { error: claim } = await g.admin.from("checkin_sends").insert({ user_id: p.id, month });
    if (claim) continue;
    const mail = buildCheckinEmail({ name: p.name, month, links: await checkinLinks(origin, g.secret, p.id) });
    const result = await sendEmail({ to: p.email, ...mail });
    if (result.ok) sent++;
    else {
      failed++;
      lastError = result.error;
      await g.admin.from("checkin_sends").delete().eq("user_id", p.id).eq("month", month);
    }
    await new Promise((r) => setTimeout(r, 600)); // stay under the service's rate limit (about 2 a second)
  }
  const more = people.length === SEND_BATCH ? " Press Send again for the next batch." : "";
  return {
    message: `Sent ${sent} email${sent === 1 ? "" : "s"}.${failed ? ` ${failed} failed (${lastError}).` : ""}${more}`,
    error: null,
  };
}

/** Sends the email to the admin's own address only, without recording anything. */
export async function sendCheckinTest(): Promise<SendState> {
  const g = await gate();
  if ("error" in g) return { message: null, error: g.error };
  const { data, error } = await g.admin.auth.admin.getUserById(g.me);
  const email = data?.user?.email;
  if (error || !email) return { message: null, error: "Couldn't find your own email address." };
  const { data: prof } = await g.admin.from("profiles").select("display_name").eq("id", g.me).maybeSingle();
  const mail = buildCheckinEmail({ name: prof?.display_name ?? null, month: monthKey(), links: await checkinLinks(siteOrigin(), g.secret, g.me) });
  const result = await sendEmail({ to: email, ...mail });
  return result.ok ? { message: "Test sent to your own address.", error: null } : { message: null, error: result.error };
}
