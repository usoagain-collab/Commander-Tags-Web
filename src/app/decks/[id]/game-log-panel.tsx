"use client";

// Game log (V3): record a game with this deck (date, result, pod, opponents, which cards stood out or flopped),
// see the record so far, and how each card has done. Flopped cards count as playtest flags.
import { useState } from "react";
import { CARD_PICKS_MAX, GAME_NOTE_MAX, OPPONENTS_MAX, cardRecord, localToday, summarize, type GameLog, type GameResult } from "@/lib/deck/game-log";
import { Panel } from "./deck-text-panel";

type Props = { log: GameLog; deckCards: { oracle_id: string; name: string }[]; nameOf: (id: string) => string; onClose: () => void };

const RESULTS: { key: GameResult; label: string }[] = [
  { key: "win", label: "Win" },
  { key: "loss", label: "Loss" },
  { key: "draw", label: "Draw" },
];

function CardPicker({ label, list, picked, onChange }: { label: string; list: { oracle_id: string; name: string }[]; picked: string[]; onChange: (ids: string[]) => void }) {
  const [text, setText] = useState("");
  const id = `pick-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const add = (name: string) => {
    const hit = list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!hit || picked.includes(hit.oracle_id) || picked.length >= CARD_PICKS_MAX) return false;
    onChange([...picked, hit.oracle_id]);
    setText("");
    return true;
  };
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {picked.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(picked.filter((x) => x !== p))}
            className="min-h-9 rounded-full bg-foreground/10 px-2.5 text-sm"
            title="Remove"
          >
            {list.find((c) => c.oracle_id === p)?.name ?? "A card"} ✕
          </button>
        ))}
        <input
          id={id}
          list={`${id}-cards`}
          value={text}
          placeholder="Type a card from this deck"
          onChange={(e) => {
            setText(e.target.value);
            // Picking from the list fills the whole name, so add it straight away.
            if (list.some((c) => c.name === e.target.value)) add(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            }
          }}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-2"
        />
        <datalist id={`${id}-cards`}>
          {list.map((c) => (
            <option key={c.oracle_id} value={c.name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

export function GameLogPanel({ log, deckCards, nameOf, onClose }: Props) {
  const today = localToday();
  const blank = { played_on: today, result: "win" as GameResult, pod_size: 4 as number | null, opponents: "", note: "", standouts: [] as string[], flops: [] as string[] };
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const sum = summarize(log.games);
  const record = cardRecord(log.games).slice(0, 8);

  return (
    <Panel title="Game log" onClose={onClose}>
      {log.available === null && <p className="text-sm opacity-60">Loading your games…</p>}
      {log.available === false && <p className="text-sm opacity-80">The game log isn&rsquo;t switched on yet. It&rsquo;ll appear here soon.</p>}
      {log.available && (
        <div className="space-y-5">
          <p className="text-sm">
            {sum.games === 0
              ? "No games logged yet."
              : `${sum.games} ${sum.games === 1 ? "game" : "games"}: ${sum.wins} ${sum.wins === 1 ? "win" : "wins"}, ${sum.losses} ${sum.losses === 1 ? "loss" : "losses"}${sum.draws ? `, ${sum.draws} ${sum.draws === 1 ? "draw" : "draws"}` : ""} (${Math.round((sum.winRate ?? 0) * 100)}% won).`}
          </p>

          {!adding ? (
            <button type="button" className="btn btn-gold min-h-11" onClick={() => setAdding(true)}>
              + Log a game
            </button>
          ) : (
            <form
              className="space-y-3 rounded-md border border-foreground/10 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const error = await log.log({ ...form, opponents: form.opponents || null, note: form.note || null });
                setBusy(false);
                if (error) return setNote(error);
                setNote(form.flops.length ? "Game saved. Its flopped cards count as playtest flags (⚑)." : "Game saved.");
                setForm(blank);
                setAdding(false);
              }}
            >
              <div className="flex flex-wrap items-end gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Played</span>
                  <input type="date" value={form.played_on} max={today} onChange={(e) => setForm({ ...form, played_on: e.target.value })} className="min-h-11 rounded-md border border-foreground/20 bg-background px-2" />
                </label>
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 font-medium">Result</legend>
                  <div className="flex gap-1">
                    {RESULTS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        aria-pressed={form.result === r.key}
                        onClick={() => setForm({ ...form, result: r.key })}
                        className={`min-h-11 rounded-md border px-3 ${form.result === r.key ? "border-gold bg-gold/15 font-medium" : "border-foreground/20"}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Players</span>
                  <select
                    value={form.pod_size ?? ""}
                    onChange={(e) => setForm({ ...form, pod_size: e.target.value ? Number(e.target.value) : null })}
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-2"
                  >
                    <option value="">Not saying</option>
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-medium">Against</span>
                <input
                  value={form.opponents}
                  maxLength={OPPONENTS_MAX}
                  placeholder="Their commanders or names, if you like"
                  onChange={(e) => setForm({ ...form, opponents: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-2"
                />
              </label>
              <CardPicker label="Stood out" list={deckCards.filter((c) => !form.flops.includes(c.oracle_id))} picked={form.standouts} onChange={(ids) => setForm({ ...form, standouts: ids })} />
              <CardPicker label="Flopped" list={deckCards.filter((c) => !form.standouts.includes(c.oracle_id))} picked={form.flops} onChange={(ids) => setForm({ ...form, flops: ids })} />
              <label className="block text-sm">
                <span className="font-medium">Note</span>
                <textarea
                  value={form.note}
                  maxLength={GAME_NOTE_MAX}
                  rows={2}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5"
                />
              </label>
              <div className="flex gap-2">
                <button className="btn btn-gold min-h-11" disabled={busy}>
                  {busy ? "Saving…" : "Save game"}
                </button>
                <button type="button" className="min-h-11 px-2 text-sm opacity-75" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {note && (
            <p aria-live="polite" className="text-sm opacity-80">
              {note}
            </p>
          )}

          {record.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">How cards have done</h3>
              <ul className="space-y-1 text-sm">
                {record.map((r) => (
                  <li key={r.oracle_id} className="flex justify-between gap-3">
                    <span className="truncate">{nameOf(r.oracle_id)}</span>
                    <span className="shrink-0 opacity-75">
                      {[r.stood ? `stood out ${r.stood}×` : "", r.flopped ? `flopped ${r.flopped}×` : ""].filter(Boolean).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {log.games.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">Games</h3>
              <ul className="space-y-2">
                {log.games.map((g) => (
                  <li key={g.id} className="rounded-md border border-foreground/10 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`font-medium ${g.result === "win" ? "text-green-400" : g.result === "loss" ? "text-red-400" : ""}`}>
                        {g.result === "win" ? "Win" : g.result === "loss" ? "Loss" : "Draw"}
                      </span>
                      <span className="opacity-75">{new Date(`${g.played_on}T12:00:00`).toLocaleDateString()}</span>
                      {g.pod_size && <span className="opacity-75">{g.pod_size} players</span>}
                      {g.opponents && <span className="opacity-75">against {g.opponents}</span>}
                      <span className="ml-auto">
                        {confirm === g.id ? (
                          <>
                            <button
                              type="button"
                              className="min-h-9 px-1.5 text-red-400"
                              onClick={async () => {
                                setNote(await log.remove(g.id));
                                setConfirm(null);
                              }}
                            >
                              Delete game
                            </button>
                            <button type="button" className="min-h-9 px-1.5 opacity-75" onClick={() => setConfirm(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button type="button" className="min-h-9 px-1.5 text-red-400 opacity-80" onClick={() => setConfirm(g.id)}>
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    {g.standouts.length > 0 && <p className="opacity-80">Stood out: {g.standouts.map(nameOf).join(", ")}</p>}
                    {g.flops.length > 0 && <p className="opacity-80">Flopped: {g.flops.map(nameOf).join(", ")}</p>}
                    {g.note && <p className="opacity-80">{g.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
