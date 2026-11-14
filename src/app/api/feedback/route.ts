// Open feedback (Nov 14, 2026): the Feedback button posts here, signed in or not. Writes use the server-only key,
// so the feedback table needs no policy for anonymous visitors and stays unreadable through the API.
// Spam protection, all free and built in: a hidden spam trap and a too-fast check (checkFeedback), a check that the
// post comes from this site, then a limit per visitor (hashed IP address) and a site-wide cap per hour, both counted
// in the feedback table itself (migration 0054).
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";
import { checkFeedback, clientIp, crossSite, FEEDBACK, hashIp } from "@/lib/feedback/validate";

const TRY_EMAIL = "Couldn't send it just now. Email usoagain@gmail.com instead.";

export async function POST(request: Request) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return NextResponse.json({ error: TRY_EMAIL }, { status: 503 });

  const check = checkFeedback(await request.json().catch(() => null));
  if (check.kind === "drop") return NextResponse.json({ ok: true }); // looks sent, saves nothing
  if (check.kind === "invalid") return NextResponse.json({ error: check.error }, { status: 400 });

  const ip = clientIp(request.headers);
  const ipHash = ip ? await hashIp(ip, secret) : null;
  const admin = createAdminClient();
  const now = Date.now();

  const [visitor, site] = await Promise.all([
    ipHash
      ? admin
          .from("feedback")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", new Date(now - FEEDBACK.visitorWindowMs).toISOString())
      : Promise.resolve({ count: 0, error: null }),
    admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(now - 60 * 60 * 1000).toISOString()),
  ]);
  if (visitor.error || site.error) return NextResponse.json({ error: TRY_EMAIL }, { status: 500 });
  if ((visitor.count ?? 0) >= FEEDBACK.perVisitor)
    return NextResponse.json({ error: "Thanks, that's plenty for now. Try again in a few minutes." }, { status: 429 });
  if ((site.count ?? 0) >= FEEDBACK.perHourSiteWide)
    return NextResponse.json({ error: "Lots of feedback right now. Try again in a little while." }, { status: 429 });

  const user = await getCurrentUser();
  const { error } = await admin.from("feedback").insert({
    message: check.value.message,
    page: check.value.page,
    email: check.value.email,
    ip_hash: ipHash,
    user_id: user?.id ?? null,
  });
  if (error) return NextResponse.json({ error: TRY_EMAIL }, { status: 500 });
  return NextResponse.json({ ok: true });
}
