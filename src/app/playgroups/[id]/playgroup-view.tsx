"use client";

// One playgroup (V3, migration 0062). Every change goes through the playgroup functions, then the page reloads its
// data from the database so everyone's view matches what was saved.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/avatar";
import {
  cleanSeats,
  deckStandings,
  GUEST_NAME_MAX,
  inviteLink,
  localToday,
  percent,
  PLAYGROUP_NAME_MAX,
  playerStandings,
  playgroupError,
  readPlaygroup,
  SEATS_MAX,
  type Playgroup,
  type SeatDraft,
} from "@/lib/playgroups/playgroups";

const emptySeat = (user_id = ""): SeatDraft => ({ user_id, guest: false, guest_name: "", deck_id: "", deck_name: "", won: false });

export function PlaygroupView({ initial, myDecks }: { initial: Playgroup; myDecks: { id: string; name: string }[] }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [group, setGroup] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const me = group.members.find((m) => m.me);

  async function reload() {
    const { data } = await supabase.rpc("playgroup_view", { p_id: group.id });
    const next = readPlaygroup(data);
    if (next) setGroup(next);
    else router.push("/playgroups");
  }

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, fallback: string, done?: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setError(playgroupError(error.message, fallback));
      return false;
    }
    setError(null);
    setNote(done ?? null);
    await reload();
    return true;
  }

  const manage = (action: string, value?: string) => supabase.rpc("manage_playgroup", { p_id: group.id, p_action: action, p_value: value ?? null });

  const players = useMemo(() => playerStandings(group.games), [group.games]);
  const decks = useMemo(() => deckStandings(group.games).slice(0, 15), [group.games]);

  // Invite link
  const link = typeof window !== "undefined" ? inviteLink(window.location.origin, group.invite_code) : `/playgroups/join/${group.invite_code}`;
  const [copied, setCopied] = useState(false);

  // Rename and delete (owner)
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link href="/playgroups" className="text-sm opacity-75 hover:underline">
          ← Playgroups
        </Link>
        {renaming !== null ? (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => manage("rename", renaming), "Couldn't rename the playgroup.")) setRenaming(null);
            }}
          >
            <input
              value={renaming}
              maxLength={PLAYGROUP_NAME_MAX}
              autoFocus
              aria-label="Playgroup name"
              onChange={(e) => setRenaming(e.target.value)}
              className="min-h-11 flex-1 rounded-md border border-foreground/20 bg-background px-3 text-lg"
            />
            <button disabled={busy} className="btn btn-gold min-h-11 px-4">
              Save
            </button>
            <button type="button" onClick={() => setRenaming(null)} className="btn min-h-11 px-4">
              Cancel
            </button>
          </form>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="display text-3xl">{group.name}</h1>
            {group.is_owner && (
              <button type="button" onClick={() => setRenaming(group.name)} className="btn min-h-11 px-3 text-sm">
                Rename
              </button>
            )}
          </div>
        )}
      </div>

      {(error || note) && (
        <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-red-400" : ""}`}>
          {error ?? note}
        </p>
      )}

      <section className="panel space-y-3 p-4 text-sm">
        <h2 className="font-semibold">Invite your playgroup</h2>
        <p className="opacity-80">Anyone with this link and a Deck Genome account can join. Members see each other&apos;s names and every game logged here.</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3" />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                setError("Couldn't copy. Select the link and copy it yourself.");
              }
            }}
            className="btn btn-gold min-h-11 px-4"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {group.is_owner && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => manage("new_invite"), "Couldn't make a new link.", "New link made. The old one no longer works.")}
              className="btn min-h-11 px-4"
            >
              New link
            </button>
          )}
        </div>
      </section>

      <LogGame group={group} myDecks={myDecks} myId={me?.user_id ?? ""} busy={busy} onLog={(played_on, text, seats) =>
        act(() => supabase.rpc("log_playgroup_game", { p_group: group.id, p_played_on: played_on, p_note: text || null, p_players: seats }), "Couldn't save the game.", "Game saved.")
      } />

      {group.games.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel p-4 text-sm">
            <h2 className="mb-2 font-semibold">Players</h2>
            <table className="w-full">
              <thead className="text-left text-xs opacity-70">
                <tr>
                  <th className="py-1 font-normal">Player</th>
                  <th className="py-1 text-right font-normal">Games</th>
                  <th className="py-1 text-right font-normal">Wins</th>
                  <th className="py-1 text-right font-normal">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.key} className="border-t border-foreground/10">
                    <td className="py-1.5">{p.name}</td>
                    <td className="py-1.5 text-right">{p.games}</td>
                    <td className="py-1.5 text-right">{p.wins}</td>
                    <td className="py-1.5 text-right">{percent(p.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel p-4 text-sm">
            <h2 className="mb-2 font-semibold">Decks</h2>
            {decks.length === 0 ? (
              <p className="opacity-75">Add which deck each player used when you log a game, and decks show here.</p>
            ) : (
              <table className="w-full">
                <thead className="text-left text-xs opacity-70">
                  <tr>
                    <th className="py-1 font-normal">Deck</th>
                    <th className="py-1 text-right font-normal">Games</th>
                    <th className="py-1 text-right font-normal">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {decks.map((d) => (
                    <tr key={d.key} className="border-t border-foreground/10">
                      <td className="py-1.5">
                        {d.name} <span className="opacity-65">· {d.player}</span>
                      </td>
                      <td className="py-1.5 text-right">{d.games}</td>
                      <td className="py-1.5 text-right">{percent(d.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <section className="panel p-4 text-sm">
        <h2 className="mb-2 font-semibold">Games{group.games.length ? ` (${group.games.length})` : ""}</h2>
        {group.games.length === 0 ? (
          <p className="opacity-75">No games yet. Log your first one above.</p>
        ) : (
          <ul className="space-y-3">
            {group.games.map((g) => (
              <li key={g.id} className="border-t border-foreground/10 pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{g.played_on}</span>
                  <span className="opacity-75">
                    {((w) => (w ? `${w} won` : "No winner"))(g.players.filter((p) => p.won).map((p) => p.name ?? p.guest_name).join(" & "))}
                  </span>
                  {(g.mine || group.is_owner) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => supabase.rpc("delete_playgroup_game", { p_id: g.id }).then((r) => ({ error: r.error ?? (r.data === true ? null : { message: "" }) })), "Couldn't delete that game.", "Game deleted.")}
                      className="btn ml-auto min-h-9 px-3 text-xs"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {g.players.map((p, i) => (
                    <li key={i} className={p.won ? "font-semibold" : "opacity-85"}>
                      {p.won && "🏆 "}
                      {p.name ?? p.guest_name}
                      {p.deck_name && <span className="font-normal opacity-70"> ({p.deck_name})</span>}
                    </li>
                  ))}
                </ul>
                {g.note && <p className="mt-1 whitespace-pre-line opacity-80">{g.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel space-y-3 p-4 text-sm">
        <h2 className="font-semibold">Members ({group.members.length})</h2>
        <ul className="space-y-2">
          {group.members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3">
              <Avatar url={m.avatar_url} name={m.name} size={28} />
              <span className="flex-1">
                {m.name ?? "A Deck Genome player"}
                {m.me && <span className="opacity-65"> (you)</span>}
                {m.owner && <span className="opacity-65"> · made the playgroup</span>}
              </span>
              {group.is_owner && !m.me && (
                <button type="button" disabled={busy} onClick={() => act(() => manage("remove", m.user_id), "Couldn't take them out.", `${m.name ?? "They"} left the playgroup.`)} className="btn min-h-9 px-3 text-xs">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-foreground/10 pt-3">
          {group.is_owner ? (
            confirmDelete ? (
              <>
                <span className="self-center">Delete {group.name} and all its games for everyone?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const { error } = await manage("delete");
                    setBusy(false);
                    if (error) return setError(playgroupError(error.message, "Couldn't delete the playgroup."));
                    router.push("/playgroups");
                    router.refresh();
                  }}
                  className="btn min-h-11 border-red-400 px-4 text-red-400"
                >
                  Delete it
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn min-h-11 px-4">
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="btn min-h-11 px-4">
                Delete playgroup
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { data, error } = await supabase.rpc("leave_playgroup", { p_id: group.id });
                setBusy(false);
                if (error || data !== true) return setError("Couldn't leave the playgroup.");
                router.push("/playgroups");
                router.refresh();
              }}
              className="btn min-h-11 px-4"
            >
              Leave playgroup
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function LogGame({
  group,
  myDecks,
  myId,
  busy,
  onLog,
}: {
  group: Playgroup;
  myDecks: { id: string; name: string }[];
  myId: string;
  busy: boolean;
  onLog: (played_on: string, note: string, seats: SeatDraft[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState<SeatDraft[]>(() => [emptySeat(myId), emptySeat(), emptySeat(), emptySeat()]);
  const [playedOn, setPlayedOn] = useState(() => localToday());
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const set = (i: number, change: Partial<SeatDraft>) => setSeats((l) => l.map((s, j) => (j === i ? { ...s, ...change } : s)));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-gold min-h-11 px-5">
        Log a game
      </button>
    );
  }

  return (
    <form
      className="panel space-y-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const { seats: clean, problem } = cleanSeats(seats);
        if (problem) return setProblem(problem);
        setProblem(null);
        const ok = await onLog(playedOn, text.trim().slice(0, 500), clean);
        if (ok) {
          setSeats([emptySeat(myId), emptySeat(), emptySeat(), emptySeat()]);
          setText("");
          setOpen(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Log a game</h2>
        <label className="flex items-center gap-2">
          Played on
          <input type="date" value={playedOn} max={localToday()} onChange={(e) => setPlayedOn(e.target.value)} className="min-h-11 rounded-md border border-foreground/20 bg-background px-2" />
        </label>
      </div>
      <ol className="space-y-2">
        {seats.map((s, i) => {
          const taken = new Set(seats.filter((x, j) => j !== i && x.user_id).map((x) => x.user_id));
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/10 p-2">
              <select
                aria-label={`Player ${i + 1}`}
                value={s.user_id || (s.guest ? "guest" : "")}
                onChange={(e) => {
                  const v = e.target.value;
                  set(i, v === "guest" ? { user_id: "", guest: true, deck_id: "" } : { user_id: v, guest: false, guest_name: "", deck_id: "" });
                }}
                className="min-h-11 rounded-md border border-foreground/20 bg-background px-2"
              >
                <option value="">Empty seat</option>
                {group.members
                  .filter((m) => !taken.has(m.user_id))
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name ?? "A Deck Genome player"}
                      {m.me ? " (you)" : ""}
                    </option>
                  ))}
                <option value="guest">Someone else…</option>
              </select>
              {s.guest && (
                <input
                  aria-label={`Player ${i + 1} name`}
                  value={s.guest_name}
                  maxLength={GUEST_NAME_MAX}
                  autoFocus
                  placeholder="Their name"
                  onChange={(e) => set(i, { guest_name: e.target.value })}
                  className="min-h-11 w-36 rounded-md border border-foreground/20 bg-background px-2"
                />
              )}
              {s.user_id === myId && myDecks.length > 0 ? (
                <select
                  aria-label="Your deck"
                  value={s.deck_id}
                  onChange={(e) => set(i, { deck_id: e.target.value, deck_name: myDecks.find((d) => d.id === e.target.value)?.name ?? "" })}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2"
                >
                  <option value="">Which deck?</option>
                  {myDecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={`Player ${i + 1} deck`}
                  value={s.deck_name}
                  maxLength={120}
                  placeholder="Deck or commander (optional)"
                  onChange={(e) => set(i, { deck_name: e.target.value })}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2"
                />
              )}
              <label className="flex min-h-11 items-center gap-1">
                <input type="checkbox" checked={s.won} onChange={(e) => set(i, { won: e.target.checked })} className="h-4 w-4 accent-gold" />
                Won
              </label>
            </li>
          );
        })}
      </ol>
      {seats.length < SEATS_MAX && (
        <button type="button" onClick={() => setSeats((l) => [...l, emptySeat()])} className="btn min-h-11 px-3">
          + Seat
        </button>
      )}
      <label className="block">
        <span className="opacity-80">Note (optional)</span>
        <textarea value={text} maxLength={500} rows={2} onChange={(e) => setText(e.target.value)} placeholder="How it went, the play of the game" className="mt-1 w-full rounded-lg border border-foreground/20 bg-transparent p-2" />
      </label>
      {problem && (
        <p role="alert" className="text-red-400">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <button disabled={busy} className="btn btn-gold min-h-11 px-5">
          Save game
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn min-h-11 px-4">
          Cancel
        </button>
      </div>
    </form>
  );
}
