// Admin-only monthly check-in page (V3, migration 0063): send this month's email by hand and read the answers.
// Not linked anywhere; everyone but an admin gets "page not found" (requireAdmin). Nothing is sent automatically.
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin/access";
import { requireAdmin } from "@/lib/admin/require-admin";
import { monthKey, monthName, SEND_BATCH, summarize, type MonthSummary } from "@/lib/checkin/checkin";
import { emailReady } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";
import { loadAudience } from "@/lib/checkin/audience";
import { SendPanel } from "./send-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return {
    title: isAdmin(user?.id) ? "Check-ins · Deck Genome" : "Page not found · Deck Genome",
    robots: { index: false, follow: false, nocache: true },
  };
}

type Note = { month: string; note: string; liked: number; easy: number; better: number; updated_at: string };

export default async function AdminCheckinPage() {
  await requireAdmin();
  const month = monthKey();
  let waiting = 0;
  let months: MonthSummary[] = [];
  let notes: Note[] = [];
  let problem: string | null = null;
  try {
    const admin = createAdminClient();
    const [audience, sends, answers, recent] = await Promise.all([
      loadAudience(admin, month),
      admin.from("checkin_sends").select("month").limit(10000),
      admin.from("checkin_answers").select("month, liked, easy, better").limit(10000),
      admin.from("checkin_answers").select("month, note, liked, easy, better, updated_at").not("note", "is", null).order("updated_at", { ascending: false }).limit(30),
    ]);
    if (sends.error || answers.error || recent.error) throw new Error("tables");
    waiting = audience.length;
    months = summarize(sends.data ?? [], answers.data ?? []);
    notes = (recent.data ?? []) as Note[];
  } catch {
    problem = "Couldn't read the check-in tables. Has migration 0063 been run?";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Monthly check-ins</h1>
      <p className="mt-1 opacity-80">This month: {monthName(month)}. Scores are averages from 1 to 5.</p>
      {problem ? <p className="panel mt-6 p-4">{problem}</p> : <SendPanel ready={emailReady()} waiting={waiting} batch={SEND_BATCH} />}

      <section className="mt-8">
        <h2 className="display text-xl">Answers by month</h2>
        {months.length === 0 ? (
          <p className="mt-2 text-sm opacity-80">No check-ins yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="opacity-70">
                <tr>
                  <th className="py-1 pr-3">Month</th>
                  <th className="py-1 pr-3">Sent</th>
                  <th className="py-1 pr-3">Answers</th>
                  <th className="py-1 pr-3">Happy with decks</th>
                  <th className="py-1 pr-3">Easy to use</th>
                  <th className="py-1 pr-3">Decks better</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-t border-foreground/10">
                    <td className="py-1 pr-3">{monthName(m.month)}</td>
                    <td className="py-1 pr-3">{m.sent}</td>
                    <td className="py-1 pr-3">{m.answers}</td>
                    <td className="py-1 pr-3">{m.answers ? m.liked : "–"}</td>
                    <td className="py-1 pr-3">{m.answers ? m.easy : "–"}</td>
                    <td className="py-1 pr-3">{m.answers ? m.better : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="display text-xl">Latest notes</h2>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm opacity-80">No notes yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="panel p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-1 text-xs opacity-70">
                  {monthName(n.month)} · {n.liked} / {n.easy} / {n.better}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
