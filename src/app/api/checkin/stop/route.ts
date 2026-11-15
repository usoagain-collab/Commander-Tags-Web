// One-click unsubscribe for the monthly check-in email (V3, migration 0063). Mail apps POST here from the email's
// List-Unsubscribe header. A plain visit (GET, which mail scanners also make) only shows the page with the button.
import { NextResponse } from "next/server";
import { checkinSecret, checkLink } from "@/lib/checkin/checkin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const who = await checkLink(checkinSecret(), "stop", url.searchParams.get("u"), url.searchParams.get("t"));
  if (!who || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const { error } = await createAdminClient().from("profiles").update({ checkin_emails: false }).eq("id", who);
  if (error) return NextResponse.json({ error: "Try again later." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/checkin/stop";
  return NextResponse.redirect(url, 303);
}
