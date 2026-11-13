// Admin-only site stats (David, Nov 13, 2026): are people signing up and building decks?
// Not linked anywhere on the site; David bookmarks /admin/stats. Everyone else gets "page not found" (requireAdmin).
// Reads with the service-role key on the server only; the page sends nothing but the numbers to the browser.
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin/access";
import { requireAdmin } from "@/lib/admin/require-admin";
import { buildStats, STATS_TIME_ZONE, type StatDeck, type StatUser } from "@/lib/admin/stats";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";

export const dynamic = "force-dynamic";

// Everyone but an admin gets the same title as any missing page, so the 404 doesn't give away that this page exists.
export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return {
    title: isAdmin(user?.id) ? "Site stats · Deck Genome" : "Page not found · Deck Genome",
    robots: { index: false, follow: false, nocache: true },
  };
}

async function loadUsers(admin: ReturnType<typeof createAdminClient>): Promise<StatUser[]> {
  const out: StatUser[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null })));
    if (data.users.length < 1000) return out;
  }
}

// PostgREST returns at most 1,000 rows per request, so read in pages.
async function loadDecks(admin: ReturnType<typeof createAdminClient>): Promise<StatDeck[]> {
  const out: StatDeck[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("decks").select("owner_id, created_at, updated_at").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: STATS_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "Never";
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T00:00:00Z`));

export default async function AdminStatsPage() {
  const me = await requireAdmin();
  const admin = createAdminClient();

  let stats: ReturnType<typeof buildStats>;
  let names = new Map<string, string>();
  try {
    const [users, decks] = await Promise.all([loadUsers(admin), loadDecks(admin)]);
    stats = buildStats(users, decks, new Date());
    const ids = stats.recent.map((r) => r.id);
    if (ids.length) {
      const { data } = await admin.from("profiles").select("id, display_name").in("id", ids);
      names = new Map((data ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? ""]));
    }
  } catch (e) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="display text-3xl">Site stats</h1>
        <p className="mt-4 text-red-400">Couldn&apos;t load the numbers: {e instanceof Error ? e.message : "unknown error"}</p>
      </main>
    );
  }

  const t = stats.totals;
  const cards: [string, number, string][] = [
    ["Accounts", t.users, `${t.newUsers7} new this week`],
    ["Signed in, last 7 days", t.active7, `${t.active30} in the last 30 days`],
    ["Accounts with a deck", t.usersWithDecks, `of ${t.users}`],
    ["Decks", t.decks, `${t.newDecks7} new, ${t.editedDecks7} edited this week`],
  ];
  const peak = Math.max(1, ...stats.daily.map((d) => Math.max(d.signUps, d.decks)));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Admin</p>
      <h1 className="display text-3xl">Site stats</h1>
      <p className="mt-2 text-sm opacity-75">
        Live from the database. Days are Hawaii time. The Precons and test accounts aren&apos;t counted.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value, note]) => (
          <div key={label} className="panel p-4">
            <div className="text-xs opacity-75">{label}</div>
            <div className="display mt-1 text-3xl">{value}</div>
            <div className="mt-1 text-xs opacity-75">{note}</div>
          </div>
        ))}
      </div>

      <h2 className="display mt-10 text-xl">Last 30 days</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left opacity-75">
            <th className="py-1 font-normal">Day</th>
            <th className="py-1 font-normal">Sign-ups</th>
            <th className="py-1 font-normal">New decks</th>
          </tr>
        </thead>
        <tbody>
          {stats.daily.map((d) => (
            <tr key={d.day} className="border-t border-foreground/10">
              <td className="py-1.5 pr-3 whitespace-nowrap">{shortDay(d.day)}</td>
              <td className="w-2/5 py-1.5 pr-3">
                <Bar value={d.signUps} peak={peak} className="bg-gold" />
              </td>
              <td className="w-2/5 py-1.5">
                <Bar value={d.decks} peak={peak} className="bg-foreground/50" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="display mt-10 text-xl">Newest accounts</h2>
      {stats.recent.length === 0 ? (
        <p className="mt-3 opacity-75">No sign-ups yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left opacity-75">
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 font-normal">Joined</th>
              <th className="py-1 font-normal">Last sign-in</th>
              <th className="py-1 text-right font-normal">Decks</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent.map((r) => (
              <tr key={r.id} className="border-t border-foreground/10">
                <td className="py-1.5 pr-3">
                  {names.get(r.id) || "No name"}
                  {r.id === me.id ? <span className="opacity-60"> (you)</span> : null}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.joined)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.lastSignIn)}</td>
                <td className="py-1.5 text-right">{r.decks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function Bar({ value, peak, className }: { value: number; peak: number; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right tabular-nums">{value}</span>
      <span className="h-2 flex-1 rounded bg-foreground/5">
        {value > 0 ? <span className={`block h-2 rounded ${className}`} style={{ width: `${(value / peak) * 100}%` }} /> : null}
      </span>
    </div>
  );
}
