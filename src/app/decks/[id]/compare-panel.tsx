"use client";

// Compare decks (V3): this deck against one of your other decks or a precon. Shows the cards both run, the cards
// only one runs, and the two decks' role counts side by side. Reads only what row-level security already lets you
// see (your own decks, plus public ones such as the precons), so it needs no database change. The other deck's
// roles come from its card tags and its manual categories, with this deck's role list and hidden roles.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { compareDecks, compareRoles, type CompareLine, type CompareRow } from "@/lib/deck/compare";
import type { CardSummary } from "@/lib/deck/model";
import { useTagData } from "@/lib/tags/use-tag-data";
import { Panel } from "./deck-text-panel";

type Option = { id: string; name: string; group: "precon-match" | "mine" | "precon"; note?: string };
type OtherRow = CompareRow & { category: string | null };

type Props = {
  deckId: string;
  deckName: string;
  userId: string | null;
  rows: CompareRow[];
  cards: Record<string, CardSummary>;
  commanderIds: string[];
  roles: { key: string; name: string }[];
  roleCounts: Record<string, number>;
  /** The roles a card counts toward from its tags, with this deck's role list and hidden roles. */
  rolesOfCard: (card: CardSummary, slugs: string[] | undefined) => string[];
  onAddToMaybe?: (card: CardSummary) => void;
  maybeIds: Set<string>;
  onClose: () => void;
};

export function ComparePanel({ deckId, deckName, userId, rows, cards, commanderIds, roles, roleCounts, rolesOfCard, onAddToMaybe, maybeIds, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [otherId, setOtherId] = useState("");
  const [otherRows, setOtherRows] = useState<OtherRow[] | null>(null);
  const [extra, setExtra] = useState<Record<string, CardSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const commanderKey = [...commanderIds].sort().join(",");

  // What you can compare against: the precon with this deck's commander first, then your decks, then every precon.
  useEffect(() => {
    let live = true;
    (async () => {
      const [mine, precons, matches] = await Promise.all([
        userId
          ? supabase.from("decks").select("id, name").eq("owner_id", userId).neq("id", deckId).order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase.from("decks").select("id, name, set_name:precon->>set_name, release:precon->>release").not("precon", "is", null).eq("visibility", "public"),
        commanderKey
          ? supabase
              .from("deck_cards")
              .select("deck_id, decks!inner(id)")
              .eq("board", "commander")
              .in("oracle_id", commanderKey.split(","))
              .not("decks.precon", "is", null)
              .limit(50)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!live) return;
      const failed = mine.error ?? precons.error ?? matches.error;
      if (failed) return setError(`Couldn't load decks to compare: ${failed.message}`);
      type P = { id: string; name: string; set_name: string | null; release: string | null };
      const pre = ((precons.data ?? []) as P[]).filter((p) => p.id !== deckId).sort((a, b) => (b.release ?? "").localeCompare(a.release ?? "") || a.name.localeCompare(b.name));
      const matched = new Set(((matches.data ?? []) as { deck_id: string }[]).map((m) => m.deck_id));
      const note = (p: P) => [p.set_name, p.release?.slice(0, 4)].filter(Boolean).join(", ");
      const list: Option[] = [
        ...pre.filter((p) => matched.has(p.id)).map((p) => ({ id: p.id, name: p.name, group: "precon-match" as const, note: note(p) })),
        ...((mine.data ?? []) as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name, group: "mine" as const })),
        ...pre.filter((p) => !matched.has(p.id)).map((p) => ({ id: p.id, name: p.name, group: "precon" as const, note: note(p) })),
      ];
      setOptions(list);
      setOtherId((cur) => cur || (list[0]?.group === "precon-match" ? list[0].id : ""));
    })();
    return () => {
      live = false;
    };
  }, [supabase, deckId, userId, commanderKey]);

  // The picked deck's cards, and details for any card this deck doesn't have.
  useEffect(() => {
    if (!otherId) return setOtherRows(null);
    let live = true;
    setOtherRows(null);
    (async () => {
      const { data, error } = await supabase.from("deck_cards").select("oracle_id, board, quantity, category").eq("deck_id", otherId);
      if (!live) return;
      if (error) return setError(`Couldn't load that deck: ${error.message}`);
      const got = (data ?? []) as OtherRow[];
      const missing = got.map((r) => r.oracle_id).filter((id) => !cards[id]);
      try {
        const found = missing.length ? await fetchSummaries(supabase, missing) : [];
        if (!live) return;
        setExtra((x) => ({ ...x, ...Object.fromEntries(found.map((c) => [c.oracle_id, c])) }));
        setOtherRows(got);
        setError(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
    // Cards change on every edit; the other deck only needs loading again when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, otherId]);

  const all = useMemo(() => ({ ...extra, ...cards }), [extra, cards]);
  const otherIds = useMemo(() => [...new Set((otherRows ?? []).map((r) => r.oracle_id))], [otherRows]);
  const tags = useTagData(otherIds);

  const result = useMemo(() => {
    if (!otherRows) return null;
    const isBasic = (id: string) => /\bBasic\b/.test(all[id]?.type_line ?? "");
    const diff = compareDecks(rows, otherRows, isBasic);
    // The other deck's role counts: a manual category wins, as in the editor; otherwise its tags decide.
    const theirs: Record<string, number> = {};
    for (const r of otherRows) {
      if (r.board === "maybe") continue;
      const card = all[r.oracle_id];
      if (!card) continue;
      const keys = r.category === "none" ? [] : r.category && roles.some((x) => x.key === r.category) ? [r.category] : rolesOfCard(card, tags.oracleTags[r.oracle_id]);
      for (const k of keys) theirs[k] = (theirs[k] ?? 0) + r.quantity;
    }
    return { diff, roleRows: compareRoles(roles, roleCounts, theirs) };
  }, [otherRows, rows, all, roles, roleCounts, rolesOfCard, tags.oracleTags]);

  const picked = options?.find((o) => o.id === otherId);
  const tagsLoading = otherIds.some((id) => !tags.loaded.has(id));
  const name = (l: CompareLine) => all[l.oracle_id]?.name ?? "Unknown card";
  const byName = (a: CompareLine, b: CompareLine) => name(a).localeCompare(name(b));

  return (
    <Panel title="Compare decks" onClose={onClose}>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Compare {deckName} with</span>
        <select
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          disabled={!options}
          className="min-h-11 min-w-0 max-w-full flex-1 rounded-md border border-foreground/20 bg-background px-2"
        >
          <option value="">{options ? "Pick a deck" : "Loading decks…"}</option>
          {(["precon-match", "mine", "precon"] as const).map((g) => {
            const list = options?.filter((o) => o.group === g) ?? [];
            if (!list.length) return null;
            return (
              <optgroup key={g} label={g === "precon-match" ? "Precons with your commander" : g === "mine" ? "Your decks" : "Precons"}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.note ? `${o.name} (${o.note})` : o.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {otherId && !result && !error && <p className="mt-3 text-sm opacity-60">Loading…</p>}
      {result && picked && (
        <div className="mt-4 space-y-5">
          <p className="text-sm">
            {picked.name} runs {Math.round(result.diff.overlap * 100)}% of this deck&rsquo;s cards, not counting basic lands.
          </p>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">Roles</h3>
            {tagsLoading ? (
              <p className="text-sm opacity-60">Reading card tags…</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs opacity-60">
                    <th className="py-1 font-medium">Role</th>
                    <th className="py-1 text-right font-medium">This deck</th>
                    <th className="py-1 text-right font-medium">{picked.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.roleRows.map((r) => {
                    const top = Math.max(r.mine, r.theirs, 1);
                    return (
                      <tr key={r.key} className="border-t border-foreground/10">
                        <td className="py-1.5">{r.name}</td>
                        <td className="py-1.5 text-right">
                          <Bar value={r.mine} top={top} tone="bg-gold" /> {r.mine}
                        </td>
                        <td className="py-1.5 text-right">
                          <Bar value={r.theirs} top={top} tone="bg-foreground/40" /> {r.theirs}
                          {r.theirs !== r.mine && <span className="ml-1 opacity-60">({r.theirs > r.mine ? "+" : "−"}{Math.abs(r.theirs - r.mine)})</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <CardList title={`Only in this deck (${result.diff.onlyMine.length})`}>
              {[...result.diff.onlyMine].sort(byName).map((l) => (
                <li key={l.oracle_id}>
                  {l.mine > 1 && `${l.mine} `}
                  {name(l)}
                </li>
              ))}
            </CardList>
            <CardList title={`In both (${result.diff.both.length})`}>
              {[...result.diff.both].sort(byName).map((l) => (
                <li key={l.oracle_id}>
                  {name(l)}
                  {l.mine !== l.theirs && (
                    <span className="opacity-60">
                      {" "}
                      ({l.mine} here, {l.theirs} there)
                    </span>
                  )}
                </li>
              ))}
            </CardList>
            <CardList title={`Only in ${picked.name} (${result.diff.onlyTheirs.length})`}>
              {[...result.diff.onlyTheirs].sort(byName).map((l) => {
                const card = all[l.oracle_id];
                return (
                  <li key={l.oracle_id} className="flex items-center justify-between gap-2">
                    <span>
                      {l.theirs > 1 && `${l.theirs} `}
                      {name(l)}
                    </span>
                    {card && onAddToMaybe && !/\bBasic\b/.test(card.type_line) &&
                      (maybeIds.has(card.oracle_id) ? (
                        <span className="shrink-0 text-xs opacity-60">On your maybeboard</span>
                      ) : (
                        <button type="button" onClick={() => onAddToMaybe(card)} className="shrink-0 text-xs underline opacity-80 hover:opacity-100">
                          + Maybeboard
                        </button>
                      ))}
                  </li>
                );
              })}
            </CardList>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Bar({ value, top, tone }: { value: number; top: number; tone: string }) {
  return (
    <span className="inline-block h-2 w-16 rounded-full bg-foreground/10 align-middle" aria-hidden>
      <span className={`block h-2 rounded-full ${tone}`} style={{ width: `${(value / top) * 100}%` }} />
    </span>
  );
}

function CardList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">{title}</h4>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto text-sm">{children}</ul>
    </div>
  );
}
