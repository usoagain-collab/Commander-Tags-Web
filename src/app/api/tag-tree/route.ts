// The oracle tag tree for the browser (Phase 3 plan: one cached daily file, shared by every deck).
// Public data, so it uses the publishable key with no user session, and Vercel's CDN caches it for a day.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // built per request (then CDN-cached), so builds never need the database

export async function GET() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("oracle_tag_tree");
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "No tag data" }, { status: 502 });
  }
  return NextResponse.json(data, {
    headers: {
      // The daily import refreshes tags once a day: cache for a day, then serve stale while refreshing.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
