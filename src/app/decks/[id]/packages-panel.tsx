"use client";

// Packages (V3): save a group of this deck's cards (picked cards, a role, or one of your tags) and add any saved
// package to this deck in one go.
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { CardSummary } from "@/lib/deck/model";
import { PACKAGE_NAME_MAX, packageFromLines, usePackages, type CardPackage, type PackageCard } from "@/lib/deck/packages";
import { Panel } from "./deck-text-panel";

export type PackageSource = { key: string; label: string; lines: Parameters<typeof packageFromLines>[0] };

type Props = {
  userId: string | null;
  readOnly: boolean;
  sources: PackageSource[];
  cards: Record<string, CardSummary>;
  /** Adds the cards as one edit; resolves to what to tell the person. */
  onAdd: (items: { card: CardSummary; quantity: number }[], board: "main" | "maybe", name: string) => void;
  onClose: () => void;
};

export function PackagesPanel({ userId, readOnly, sources, cards, onAdd, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const packages = usePackages(userId);
  const [source, setSource] = useState(sources[0]?.key ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, CardSummary>>({});
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "delete" } | null>(null);
  const all = { ...extra, ...cards };
  const picked = sources.find((s) => s.key === source) ?? sources[0];
  const toSave: PackageCard[] = picked ? packageFromLines(picked.lines) : [];

  const ensureCards = async (p: CardPackage) => {
    const missing = p.cards.map((c) => c.oracle_id).filter((id) => !all[id]);
    if (!missing.length) return all;
    const found = await fetchSummaries(supabase, missing);
    const got = Object.fromEntries(found.map((c) => [c.oracle_id, c]));
    setExtra((x) => ({ ...x, ...got }));
    return { ...all, ...got };
  };

  const add = async (p: CardPackage, board: "main" | "maybe") => {
    setBusy(p.id);
    try {
      const known = await ensureCards(p);
      onAdd(
        p.cards.flatMap((c) => (known[c.oracle_id] ? [{ card: known[c.oracle_id], quantity: c.quantity }] : [])),
        board,
        p.name,
      );
    } catch (e) {
      setNote(`Couldn't read the package's cards: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (p: CardPackage) => {
    if (open === p.id) return setOpen(null);
    setOpen(p.id);
    try {
      await ensureCards(p);
    } catch {}
  };

  if (!userId)
    return (
      <Panel title="Packages" onClose={onClose}>
        <p className="text-sm opacity-80">Sign in to save groups of cards as packages and add them to any deck.</p>
      </Panel>
    );

  return (
    <Panel title="Packages" onClose={onClose}>
      {packages.available === null && <p className="text-sm opacity-60">Loading your packages…</p>}
      {packages.available === false && <p className="text-sm opacity-80">Packages aren&rsquo;t switched on yet. They&rsquo;ll appear here soon.</p>}
      {packages.available && (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">Save cards from this deck</h3>
            {sources.length === 0 ? (
              <p className="text-sm opacity-70">Add some cards first, or pick cards with Select.</p>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy("new");
                  const error = await packages.create(name, toSave);
                  setBusy(null);
                  setNote(error ?? `Saved ${name.trim()} with ${toSave.length === 1 ? "1 card" : `${toSave.length} cards`}.`);
                  if (!error) setName("");
                }}
              >
                <select
                  value={picked?.key}
                  onChange={(e) => setSource(e.target.value)}
                  aria-label="Which cards"
                  className="min-h-11 min-w-0 max-w-full rounded-md border border-foreground/20 bg-background px-2"
                >
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({packageFromLines(s.lines).length})
                    </option>
                  ))}
                </select>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={PACKAGE_NAME_MAX}
                  required
                  placeholder="Package name, like Ramp suite"
                  aria-label="Package name"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-2"
                />
                <button className="btn btn-gold min-h-11" disabled={busy === "new" || !toSave.length}>
                  {busy === "new" ? "Saving…" : "Save package"}
                </button>
              </form>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">Your packages</h3>
            {packages.list.length === 0 && <p className="text-sm opacity-70">None yet. Save one above, and it&rsquo;s ready for every deck.</p>}
            <ul className="space-y-2">
              {packages.list.map((p) => (
                <li key={p.id} className="rounded-md border border-foreground/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggle(p)} className="min-h-11 min-w-0 flex-1 text-left" aria-expanded={open === p.id}>
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="text-sm opacity-60">{p.cards.length === 1 ? "1 card" : `${p.cards.length} cards`}</span>
                    </button>
                    {!readOnly && (
                      <>
                        <button type="button" className="btn min-h-11" disabled={busy === p.id} onClick={() => add(p, "main")}>
                          Add to deck
                        </button>
                        <button type="button" className="btn min-h-11" disabled={busy === p.id} onClick={() => add(p, "maybe")}>
                          To maybeboard
                        </button>
                      </>
                    )}
                  </div>
                  {open === p.id && (
                    <div className="mt-2 text-sm">
                      <p className="opacity-80">
                        {p.cards
                          .map((c) => `${c.quantity > 1 ? `${c.quantity} ` : ""}${all[c.oracle_id]?.name ?? "…"}`)
                          .sort()
                          .join(", ")}
                      </p>
                      {editing?.id === p.id && editing.mode === "rename" ? (
                        <form
                          className="mt-2 flex flex-wrap gap-2"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const error = await packages.rename(p.id, String(new FormData(e.currentTarget).get("name") ?? ""));
                            setNote(error);
                            if (!error) setEditing(null);
                          }}
                        >
                          <input name="name" defaultValue={p.name} maxLength={PACKAGE_NAME_MAX} required autoFocus aria-label="Package name" className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-2" />
                          <button className="btn btn-gold min-h-11">Save</button>
                          <button type="button" className="min-h-11 px-2 opacity-75" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : editing?.id === p.id && editing.mode === "delete" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span>Delete {p.name}? Decks you added it to keep their cards.</span>
                          <button
                            type="button"
                            className="min-h-10 rounded-lg bg-red-600 px-3 font-medium text-white"
                            onClick={async () => {
                              const error = await packages.remove(p.id);
                              setNote(error);
                              setEditing(null);
                            }}
                          >
                            Delete package
                          </button>
                          <button type="button" className="min-h-10 px-2 opacity-80" onClick={() => setEditing(null)}>
                            Keep it
                          </button>
                        </div>
                      ) : (
                        <div className="mt-1 flex gap-1">
                          <button type="button" className="min-h-10 px-1.5 opacity-75 hover:opacity-100" onClick={() => setEditing({ id: p.id, mode: "rename" })}>
                            Rename
                          </button>
                          <button type="button" className="min-h-10 px-1.5 text-red-400" onClick={() => setEditing({ id: p.id, mode: "delete" })}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {note && (
            <p aria-live="polite" className="text-sm opacity-80">
              {note}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
