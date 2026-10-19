"use client";

// Version history (step 3h). Lists the deck's saved versions (automatic ones at the start of each editing
// session, the latest 10 kept; named ones you save), shows what changed, and restores one as a single
// undoable edit. Restoring saves the current deck as a version first (apply_deck_changes, migration 0010).
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { BOARD_LABELS, type CardSummary, type Plan } from "@/lib/deck/model";
import {
  diffDecks,
  diffSummary,
  planRestore,
  readSnapshot,
  versionDate,
  versionTitle,
  type DeckDiff,
  type DeckState,
  type DiffLine,
  type VersionMeta,
} from "@/lib/deck/versions";
import { Panel } from "./deck-text-panel";

type Version = VersionMeta & { state: DeckState };

type Props = {
  deckId: string;
  current: DeckState;
  cards: Record<string, CardSummary>;
  /** Changes whenever the deck finishes saving, so the list picks up new automatic versions. */
  savedTick: number | null;
  /** Saving a named version only makes sense once every edit is saved. */
  canSnapshot: boolean;
  onRestore: (plan: Plan, newCards: CardSummary[]) => void;
  onClose: () => void;
};

export function HistoryPanel({ deckId, current, cards, savedTick, canSnapshot, onRestore, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string>("now");
  const [extraCards, setExtraCards] = useState<Record<string, CardSummary>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"restore" | "delete" | null>(null);
  const [reload, setReload] = useState(0);
  const asked = useRef(new Set<string>()); // ids already looked up, so a card missing from our data isn't re-asked forever

  useEffect(() => {
    if (savedTick === null) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase
        .from("deck_versions")
        .select("id, created_at, kind, name, card_count, cards")
        .eq("deck_id", deckId)
        .order("created_at", { ascending: false });
      if (!live) return;
      if (error) return setError(`Couldn't load versions: ${error.message}`);
      setVersions(((data ?? []) as (VersionMeta & { cards: unknown })[]).map(({ cards: raw, ...v }) => ({ ...v, state: readSnapshot(raw) })));
    })();
    return () => {
      live = false;
    };
  }, [supabase, deckId, savedTick, reload]);

  // Names for cards that are in old versions but not in the deck any more.
  useEffect(() => {
    if (!versions) return;
    const missing = versions
      .flatMap((v) => Object.keys(v.state.entries).map((k) => k.split("|")[1]))
      .filter((id) => !cards[id] && !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    fetchSummaries(supabase, missing)
      .then((found) => setExtraCards((x) => ({ ...x, ...Object.fromEntries(found.map((c) => [c.oracle_id, c])) })))
      .catch((e: Error) => setError(e.message));
  }, [versions, cards, supabase]);

  const allCards = { ...extraCards, ...cards };
  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const other = compareId === "now" ? null : (versions?.find((v) => v.id === compareId) ?? null);
  // Always read the comparison oldest → newest.
  const [olderState, newerState, olderName, newerName] =
    selected && other && other.created_at < selected.created_at
      ? [other.state, selected.state, label(other), label(selected)]
      : [selected?.state, other?.state ?? current, selected ? label(selected) : "", other ? label(other) : "your deck now"];

  async function saveVersion(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("snapshot_deck", { p_deck: deckId, p_kind: "manual", p_name: name.trim() || null });
    setBusy(false);
    if (error) return setError(`Couldn't save the version: ${error.message}`);
    setName("");
    setReload((n) => n + 1);
  }

  async function remove(v: Version) {
    const { error } = await supabase.from("deck_versions").delete().eq("id", v.id);
    if (error) return setError(`Couldn't delete: ${error.message}`);
    setSelectedId(null);
    setConfirm(null);
    setReload((n) => n + 1);
  }

  function restore(v: Version) {
    const title = label(v);
    const plan = planRestore(current, v.state, `Restore "${title}"`, `Before restoring "${title}"`);
    const needed = Object.keys(v.state.entries).map((k) => k.split("|")[1]);
    onRestore(plan, needed.flatMap((id) => (allCards[id] ? [allCards[id]] : [])));
    setConfirm(null);
  }

  return (
    <Panel title="Version history" onClose={onClose}>
      <p className="text-sm opacity-70">
        A version is saved automatically when you start editing after a 30-minute break (the latest 10 are kept), and
        whenever you save one by name below (kept until you delete it).
      </p>

      <form onSubmit={saveVersion} className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Name this version (optional), e.g. Before the cut"
          aria-label="Version name"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !canSnapshot}
          title={canSnapshot ? undefined : "Waiting for your last edits to save"}
          className="min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save version"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
        <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
          {versions === null ? (
            <li className="text-sm opacity-60">Loading…</li>
          ) : versions.length === 0 ? (
            <li className="text-sm opacity-60">No versions yet. One is saved automatically the next time you edit after a break.</li>
          ) : (
            versions.map((v) => {
              const s = diffSummary(diffDecks(v.state, current));
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(v.id);
                      setCompareId("now");
                      setConfirm(null);
                    }}
                    aria-pressed={selectedId === v.id}
                    className={`min-h-11 w-full rounded-md px-3 py-1.5 text-left text-sm ${
                      selectedId === v.id ? "bg-foreground/10 ring-1 ring-foreground/30" : "hover:bg-foreground/5"
                    }`}
                  >
                    <span className="block font-medium">
                      {v.kind === "manual" && <span aria-label="Named version">★ </span>}
                      {versionTitle(v)}
                    </span>
                    <span className="block text-xs opacity-60">
                      {versionDate(v.created_at)} · {v.card_count} cards ·{" "}
                      {s.plus || s.minus ? (
                        <>
                          <span className="text-green-700 dark:text-green-400">+{s.plus}</span> /{" "}
                          <span className="text-red-600">−{s.minus}</span> since
                        </>
                      ) : (
                        "same as now"
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="min-w-0">
          {!selected ? (
            <p className="text-sm opacity-60">Pick a version to see what changed and restore it.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                <span className="opacity-70">Compare with</span>
                <select
                  value={compareId}
                  onChange={(e) => setCompareId(e.target.value)}
                  className="min-h-11 rounded-md border border-foreground/20 bg-background px-2"
                >
                  <option value="now">Your deck now</option>
                  {versions!
                    .filter((v) => v.id !== selected.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {label(v)}
                      </option>
                    ))}
                </select>
              </label>
              <p className="opacity-70">
                From <strong>{olderName}</strong> to <strong>{newerName}</strong>:
              </p>
              <DiffView diff={diffDecks(olderState!, newerState)} cards={allCards} />

              <div className="flex flex-wrap gap-2 border-t border-foreground/10 pt-3">
                {confirm === "restore" ? (
                  <div className="w-full space-y-2 rounded-md bg-foreground/5 p-3">
                    <p>
                      Restore “{label(selected)}”? Your deck as it is now is saved as a version first, and Ctrl+Z undoes the
                      restore.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => restore(selected)}
                        className="min-h-11 flex-1 rounded-lg bg-foreground px-3 font-medium text-background"
                      >
                        Restore
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-lg border border-foreground/20 px-3">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : confirm === "delete" ? (
                  <div className="w-full space-y-2 rounded-md bg-red-600/10 p-3">
                    <p>Delete “{label(selected)}”? This can&apos;t be undone.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => remove(selected)}
                        className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 font-medium text-white"
                      >
                        Delete
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-lg border border-foreground/20 px-3">
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirm("restore")}
                      className="min-h-11 rounded-lg bg-foreground px-4 font-medium text-background"
                    >
                      Restore this version…
                    </button>
                    <button type="button" onClick={() => setConfirm("delete")} className="min-h-11 rounded-lg px-3 text-red-600">
                      Delete version…
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

const label = (v: Version) => `${versionTitle(v)}, ${versionDate(v.created_at)}`;

function DiffView({ diff, cards }: { diff: DeckDiff; cards: Record<string, CardSummary> }) {
  const none = !diff.added.length && !diff.removed.length && !diff.changed.length;
  if (none && !diff.categorized) return <p className="opacity-60">No differences.</p>;
  const name = (l: DiffLine) => cards[l.oracle_id]?.name ?? "Unknown card";
  const where = (l: DiffLine) => (l.board === "main" ? "" : ` (${BOARD_LABELS[l.board].toLowerCase()})`);
  const byName = (a: DiffLine, b: DiffLine) => name(a).localeCompare(name(b));
  return (
    <div className="space-y-3">
      {diff.added.length > 0 && (
        <DiffList title={`Added (${diff.added.length})`} tone="text-green-700 dark:text-green-400">
          {[...diff.added].sort(byName).map((l) => (
            <li key={`${l.board}|${l.oracle_id}`}>
              + {l.to} {name(l)}
              <span className="opacity-60">{where(l)}</span>
            </li>
          ))}
        </DiffList>
      )}
      {diff.removed.length > 0 && (
        <DiffList title={`Removed (${diff.removed.length})`} tone="text-red-600">
          {[...diff.removed].sort(byName).map((l) => (
            <li key={`${l.board}|${l.oracle_id}`}>
              − {l.from} {name(l)}
              <span className="opacity-60">{where(l)}</span>
            </li>
          ))}
        </DiffList>
      )}
      {diff.changed.length > 0 && (
        <DiffList title={`Copies changed (${diff.changed.length})`} tone="">
          {[...diff.changed].sort(byName).map((l) => (
            <li key={`${l.board}|${l.oracle_id}`}>
              {l.from} → {l.to} {name(l)}
              <span className="opacity-60">{where(l)}</span>
            </li>
          ))}
        </DiffList>
      )}
      {diff.categorized > 0 && (
        <p className="opacity-70">
          {diff.categorized} {diff.categorized === 1 ? "card's" : "cards'"} category changed.
        </p>
      )}
    </div>
  );
}

function DiffList({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h4>
      <ul className="max-h-60 space-y-0.5 overflow-y-auto">{children}</ul>
    </div>
  );
}
