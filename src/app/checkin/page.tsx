// Monthly check-in (V3, migration 0063): the page the email links to. Works from the signed link without signing in,
// or for whoever is signed in. Not in the sitemap, and search engines are asked not to index it.
import type { Metadata } from "next";
import Link from "next/link";
import { checkinSecret, checkLink, monthKey, monthName, type CheckinAnswer } from "@/lib/checkin/checkin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";
import { CheckinForm } from "./checkin-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Monthly check-in · Deck Genome", robots: { index: false, follow: false } };

type Search = Promise<{ u?: string; t?: string }>;

export default async function CheckinPage({ searchParams }: { searchParams: Search }) {
  const { u = "", t = "" } = await searchParams;
  const who = (await checkLink(checkinSecret(), "answer", u, t)) ?? (await getCurrentUser())?.id ?? null;
  const month = monthKey();

  let initial: CheckinAnswer | null = null;
  if (who && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createAdminClient()
      .from("checkin_answers")
      .select("liked, easy, better, note")
      .eq("user_id", who)
      .eq("month", month)
      .maybeSingle();
    initial = data ?? null;
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Monthly check-in</h1>
      <p className="mt-2 opacity-80">Three quick questions for {monthName(month)}. They help decide what to fix and what to build next.</p>
      {who ? (
        <CheckinForm u={u} t={t} initial={initial} />
      ) : (
        <div className="panel mt-6 p-5">
          <p>This link doesn&apos;t work any more. Sign in to answer this month&apos;s check-in.</p>
          <Link href="/login?next=/checkin" className="btn mt-4 inline-flex min-h-11 items-center px-4">
            Sign in
          </Link>
        </div>
      )}
    </main>
  );
}
