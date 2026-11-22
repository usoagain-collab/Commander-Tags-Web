// Admin-only feedback inbox (David, Nov 21, 2026): every message from the site's Feedback button, newest first, so
// reading them doesn't need the Supabase dashboard. Not linked anywhere; everyone but an admin gets "page not found".
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin/access";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return {
    title: isAdmin(user?.id) ? "Feedback · Deck Genome" : "Page not found · Deck Genome",
    robots: { index: false, follow: false, nocache: true },
  };
}

const SHOWN = 200;

type Row = { id: number; user_id: string | null; page: string | null; message: string; email: string | null; created_at: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Pacific/Honolulu", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** A page the message was sent from, as a same-site link; anything else stays plain text. */
const pagePath = (page: string | null) => (page && page.startsWith("/") && !page.startsWith("//") ? page : null);

export default async function AdminFeedbackPage() {
  await requireAdmin();
  let rows: Row[] = [];
  let names = new Map<string, string>();
  let problem: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("feedback").select("id, user_id, page, message, email, created_at").order("created_at", { ascending: false }).limit(SHOWN);
    if (error) throw error;
    rows = (data ?? []) as Row[];
    const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
    if (ids.length) {
      const people = await admin.from("profiles").select("id, display_name").in("id", ids);
      names = new Map((people.data ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? "Unnamed account"]));
    }
  } catch {
    problem = "Couldn't read the feedback table.";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Feedback</h1>
      <p className="mt-1 opacity-80">
        Messages from the Feedback button, newest first{rows.length === SHOWN ? ` (the latest ${SHOWN})` : ""}. Times are Hawaii time.
      </p>
      {problem && <p className="panel mt-6 p-4">{problem}</p>}
      {!problem && rows.length === 0 && <p className="mt-6 opacity-80">No feedback yet.</p>}
      <ul className="mt-6 space-y-3">
        {rows.map((r) => {
          const who = r.user_id ? (names.get(r.user_id) ?? "Deleted or unknown account") : "Signed out";
          const path = pagePath(r.page);
          return (
            <li key={r.id} className="panel p-4">
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-75">
                <span>{when(r.created_at)}</span>
                <span>{who}</span>
                {r.email && (
                  <a href={`mailto:${r.email}`} className="underline">
                    {r.email}
                  </a>
                )}
                {path ? (
                  <a href={path} className="underline">
                    {path}
                  </a>
                ) : (
                  r.page && <span>{r.page}</span>
                )}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
