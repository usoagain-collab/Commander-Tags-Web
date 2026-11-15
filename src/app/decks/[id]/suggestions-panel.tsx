"use client";

// Suggest changes (V3, migration 0061). A visitor picks cards to add and cut and sends them with a note; the owner
// sees open suggestions and applies them (one change, one undo), sends the adds to the maybeboard, or dismisses them.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/deck/change-log";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { parseKey, type CardSummary, type Entries } from "@/lib/deck/model";
import { SUGGEST_CARDS_MAX, SUGGEST_NOTE_MAX, suggestionSummary, type ChangeSuggestion, type Suggestions } from "@/lib/deck/suggestions";
import { Panel } from "./deck-text-panel";
import { QuickAdd } from "./quick-add";

const STATUS_LABEL = { open: "Waiting", applied: "Applied", maybe: "Added to the maybeboard", dismissed: "Not used" } as const;

export function SuggestionsPanel({
  owner,
  suggestions,
  entries,
  cards,
  identity,
  onPreview,
  onUse,
  onClose,
}: {
  owner: boolean;
  suggestions: Suggestions;
  entries: Entries;
  cards: Record<string, CardSummary>;
  identity: Set<string> | null;
  onPreview: (card: CardSummary | null) => void;
  /** Makes the deck change; returns false when nothing could be applied (the editor says why). */
  onUse: (adds: CardSummary[], cuts: CardSummary[], how: "apply" | "maybe") => boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  // Card details for every card named in a suggestion that isn't already loaded with the deck.
  const [extra, setExtra] = useState<Record<string, CardSummary>>({});
  const missing = useMemo(() => {
    const ids = new Set(suggestions.list.flatMap((s) => [...s.adds, ...s.cuts]));
    return [...ids].filter((id) => !cards[id]).sort();
  }, [suggestions.list, cards]);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    fetchSummaries(supabase, missingKey.split(","))
      .then((list) => live && setExtra((m) => ({ ...m, ...Object.fromEntries(list.map((c) => [c.oracle_id, c])) })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [supabase, missingKey]);
  const card = (id: string) => cards[id] ?? extra[id];

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<string | null>) {
    setBusy(true);
    const problem = await fn();
    setBusy(false);
    setError(problem);
    return problem;
  }

  if (suggestions.available === null) {
    return (
      <Panel title="Suggestions" onClose={onClose}>
        <p className="text-sm opacity-75">Loading…</p>
      </Panel>
    );
  }
  if (!suggestions.available) {
    return (
      <Panel title="Suggestions" onClose={onClose}>
        <p className="text-sm opacity-80">Suggestions aren&apos;t switched on yet.</p>
      </Panel>
    );
  }

  return (
    <Panel title={owner ? "Suggestions from other players" : "Suggest changes"} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {!owner && <Compose suggestions={suggestions} entries={entries} cards={cards} identity={identity} onPreview={onPreview} />}

        {owner && suggestions.list.length === 0 && (
          <p className="opacity-80">No suggestions yet. When someone who can open this deck suggests cards to add or cut, they show here.</p>
        )}

        {suggestions.list.length > 0 && (
          <ul className="space-y-3">
            {!owner && <li className="font-semibold">Your suggestions</li>}
            {suggestions.list.map((s) => (
              <SuggestionItem
                key={s.id}
                s={s}
                owner={owner}
                busy={busy}
                card={card}
                onPreview={onPreview}
                onUse={async (how) => {
                  const adds = s.adds.map(card).filter((c): c is CardSummary => !!c);
                  const cuts = s.cuts.map(card).filter((c): c is CardSummary => !!c);
                  if (adds.length < s.adds.length || cuts.length < s.cuts.length) return setError("Still loading the cards. Try again in a moment.");
                  if (onUse(adds, cuts, how)) await act(() => suggestions.decide(s.id, how === "apply" ? "applied" : "maybe"));
                }}
                onDismiss={() => act(() => suggestions.decide(s.id, "dismissed"))}
                onWithdraw={() => act(() => suggestions.withdraw(s.id))}
              />
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

function SuggestionItem({
  s,
  owner,
  busy,
  card,
  onPreview,
  onUse,
  onDismiss,
  onWithdraw,
}: {
  s: ChangeSuggestion;
  owner: boolean;
  busy: boolean;
  card: (id: string) => CardSummary | undefined;
  onPreview: (card: CardSummary | null) => void;
  onUse: (how: "apply" | "maybe") => void;
  onDismiss: () => void;
  onWithdraw: () => void;
}) {
  const names = (ids: string[]) =>
    ids.map((id) => {
      const c = card(id);
      return (
        <li key={id} onMouseEnter={() => c && onPreview(c)} onMouseLeave={() => onPreview(null)}>
          {c?.name ?? "…"}
        </li>
      );
    });
  return (
    <li className={`rounded-lg border border-foreground/15 p-3 ${s.status === "open" ? "" : "opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {owner && <Avatar url={s.avatar_url} name={s.author} size={28} />}
        <span className="font-semibold">{owner ? (s.author ?? "A Deck Genome player") : suggestionSummary(s)}</span>
        {owner && <span className="opacity-75">{suggestionSummary(s)}</span>}
        <span className="text-xs opacity-70">{timeAgo(s.created_at)}</span>
        {s.status !== "open" && <span className="rounded bg-foreground/10 px-1.5 text-xs">{STATUS_LABEL[s.status]}</span>}
      </div>
      {s.note && <p className="mt-2 whitespace-pre-line">{s.note}</p>}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {s.adds.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide opacity-70">Add</p>
            <ul className="mt-1 space-y-0.5">{names(s.adds)}</ul>
          </div>
        )}
        {s.cuts.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide opacity-70">Cut</p>
            <ul className="mt-1 space-y-0.5">{names(s.cuts)}</ul>
          </div>
        )}
      </div>
      {s.status === "open" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {owner ? (
            <>
              <button type="button" disabled={busy} onClick={() => onUse("apply")} className="btn btn-gold min-h-11 px-4">
                Apply to the deck
              </button>
              {s.adds.length > 0 && (
                <button type="button" disabled={busy} onClick={() => onUse("maybe")} className="btn min-h-11 px-4">
                  Adds to the maybeboard
                </button>
              )}
              <button type="button" disabled={busy} onClick={onDismiss} className="btn min-h-11 px-4">
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={onWithdraw} className="btn min-h-11 px-4">
              Withdraw
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Compose({
  suggestions,
  entries,
  cards,
  identity,
  onPreview,
}: {
  suggestions: Suggestions;
  entries: Entries;
  cards: Record<string, CardSummary>;
  identity: Set<string> | null;
  onPreview: (card: CardSummary | null) => void;
}) {
  const [adds, setAdds] = useState<CardSummary[]>([]);
  const [cuts, setCuts] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // The deck's mainboard, by name, for the Cut list.
  const mainboard = useMemo(
    () =>
      Object.entries(entries)
        .map(([k, n]) => ({ ...parseKey(k), n }))
        .filter((r) => r.board === "main" && r.n > 0 && cards[r.oracle_id])
        .map((r) => cards[r.oracle_id])
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries, cards],
  );
  const inDeck = (id: string) => Object.entries(entries).some(([k, n]) => n > 0 && parseKey(k).oracle_id === id);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const problem = await suggestions.send(
          adds.map((c) => c.oracle_id),
          cuts,
          note,
        );
        setBusy(false);
        if (problem) return setMessage({ text: problem, ok: false });
        setAdds([]);
        setCuts([]);
        setNote("");
        setMessage({ text: "Sent. The builder sees it next time they open the deck.", ok: true });
      }}
    >
      <p className="opacity-85">Pick cards you&apos;d add and cards you&apos;d cut. The builder decides what to use; nothing changes in their deck until they do.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="font-semibold">Add</p>
          <QuickAdd
            identity={identity}
            onPreview={onPreview}
            onAdd={(c) => {
              if (inDeck(c.oracle_id)) return `${c.name} is already in the deck.`;
              if (adds.some((a) => a.oracle_id === c.oracle_id)) return `${c.name} is already on your list.`;
              if (adds.length >= SUGGEST_CARDS_MAX) return `Suggest up to ${SUGGEST_CARDS_MAX} cards at a time.`;
              setAdds((l) => [...l, c]);
            }}
          />
          <ul className="space-y-1">
            {adds.map((c) => (
              <li key={c.oracle_id} className="flex items-center justify-between gap-2">
                <span onMouseEnter={() => onPreview(c)} onMouseLeave={() => onPreview(null)}>
                  {c.name}
                </span>
                <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setAdds((l) => l.filter((x) => x.oracle_id !== c.oracle_id))} className="btn min-h-9 px-2 text-xs">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Cut</p>
          <select
            aria-label="Pick a card to cut"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id && !cuts.includes(id) && cuts.length < SUGGEST_CARDS_MAX) setCuts((l) => [...l, id]);
            }}
            className="min-h-11 w-full rounded-md border border-foreground/20 bg-background px-2"
          >
            <option value="">Pick a card in the deck…</option>
            {mainboard
              .filter((c) => !cuts.includes(c.oracle_id))
              .map((c) => (
                <option key={c.oracle_id} value={c.oracle_id}>
                  {c.name}
                </option>
              ))}
          </select>
          <ul className="space-y-1">
            {cuts.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span>{cards[id]?.name ?? "…"}</span>
                <button type="button" aria-label={`Remove ${cards[id]?.name ?? "card"}`} onClick={() => setCuts((l) => l.filter((x) => x !== id))} className="btn min-h-9 px-2 text-xs">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <label className="block">
        <span className="font-semibold">Why (optional)</span>
        <textarea
          value={note}
          maxLength={SUGGEST_NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. cheaper draw, and these two were slow in our games"
          className="mt-1 w-full rounded-lg border border-foreground/20 bg-transparent p-3"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || (!adds.length && !cuts.length)} className="btn btn-gold min-h-11 px-4">
          Send suggestion
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "" : "text-red-400"}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
