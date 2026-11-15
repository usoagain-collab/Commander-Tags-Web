// Who gets this month's check-in email (V3, migration 0063). Server-only: reads sign-in emails with the service role.
import "server-only";
import { pickRecipients } from "./checkin";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export async function loadAudience(admin: Admin, month: string) {
  const users: { id: string; email: string | null; email_confirmed_at: string | null }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null, email_confirmed_at: u.email_confirmed_at ?? null })));
    if (data.users.length < 1000) break;
  }
  const profiles = new Map<string, { checkin_emails: boolean; display_name: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("profiles").select("id, checkin_emails, display_name").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) profiles.set(p.id, { checkin_emails: p.checkin_emails === true, display_name: p.display_name ?? null });
    if (!data || data.length < 1000) break;
  }
  const sent = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("checkin_sends").select("user_id").eq("month", month).order("user_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) sent.add(s.user_id);
    if (!data || data.length < 1000) break;
  }
  return pickRecipients(users, profiles, sent);
}

