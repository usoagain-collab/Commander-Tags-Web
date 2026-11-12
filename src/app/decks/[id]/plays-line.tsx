"use client";

// The "Plays" line under the deck name and its editor (v2, David, Nov 11, 2026). Logic in src/lib/tags/plays.ts.
import { useState } from "react";
import { archetypeLabel, type DetectedArchetype } from "@/lib/cutter/archetype";
import { GENERAL_KEY } from "@/lib/cutter/archetypes";
import { CUTTER } from "@/lib/cutter/config";
import { prettyTag } from "@/lib/tags/pretty";
import { PLAYS_MAX_TAGS, PLAYS_MAX_TEXT, PLAYS_WEIGHT, cleanText, type Plays } from "@/lib/tags/plays";
import type { TagKey, ThemeTag } from "@/lib/tags/themes";
import { GlassOverlay } from "./glass-overlay";

/** Archetypes listed before "Show all": at most this many, scoring at least the Smart Cutter's floor. */
const LIKELY_MAX = 8;
const LIKELY_SCORE = CUTTER.archetypeFloor;

export type PlaysHeadline = { label: string; /** Read from the cards, not chosen by the builder. */ guessed: boolean };

/** The line itself. For the owner the whole line is one button that opens the editor. */
export function PlaysLine({
  archetype,
  text,
  tags,
  onEdit,
}: {
  archetype: PlaysHeadline | null;
  text: string | null;
  tags: { key: TagKey; label: string }[];
  /** Owner only. */
  onEdit?: () => void;
}) {
  if (!archetype && !text && !tags.length && !onEdit) return null;
  const body = (
    <>
      {archetype && (
        <span
          title={archetype.guessed ? "Guessed from the cards. Tap to set it yourself." : undefined}
          className={`mr-2 inline-flex items-center rounded-md border px-2 py-0.5 font-semibold ${archetype.guessed ? "border-foreground/25 bg-background/50" : "border-gold/60 bg-background/60 text-gold"}`}
        >
          {archetype.label}
        </span>
      )}
      {text && <span className="mr-2 italic">“{text}”</span>}
      {tags.length > 0 && (
        <span>
          <span className="opacity-75">Plays: </span>
          {tags.map((t) => prettyTag(t.label)).join(" · ")}
        </span>
      )}
      {!archetype && !text && !tags.length && <span className="opacity-75">What does this deck play?</span>}
      {onEdit && (
        <span aria-hidden className="ml-2 opacity-60 group-hover:opacity-100">
          ✎
        </span>
      )}
    </>
  );
  const cls = "mt-2 text-sm [text-shadow:0_1px_8px_var(--art-shadow)]";
  return onEdit ? (
    <button type="button" onClick={onEdit} title="Change what this deck plays" className={`${cls} group -ml-1 block min-h-9 rounded-lg px-1 text-left hover:bg-background/40`}>
      {body}
    </button>
  ) : (
    <p className={cls}>{body}</p>
  );
}

/** Full-screen editor: archetype, up to 3 tags, and a short description. */
export function PlaysEditor({
  plays,
  themes,
  ranked,
  labelOf,
  onSave,
  onClose,
}: {
  plays: Plays;
  /** The deck's themes as Top tags lists them (current Gameplay / Flavor mode). */
  themes: ThemeTag[];
  /** Archetypes, most likely first (detectArchetypes). */
  ranked: DetectedArchetype[];
  labelOf: (key: TagKey) => string;
  onSave: (next: Plays) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<TagKey[]>(plays.tags);
  const [text, setText] = useState(plays.text ?? "");
  const [archetype, setArchetype] = useState<string | null>(plays.archetype);
  const [allArchetypes, setAllArchetypes] = useState(false);
  // The likely ones first (a long list of 59 is a wall); the chosen one always shows.
  const likely = ranked.filter((d, i) => i < LIKELY_MAX && d.score >= LIKELY_SCORE && d.archetype.key !== GENERAL_KEY);
  const shownArchetypes = allArchetypes ? ranked : [...likely, ...ranked.filter((d) => d.archetype.key === archetype && !likely.includes(d))];
  const guess = ranked[0] && ranked[0].archetype.key !== GENERAL_KEY ? ranked[0] : null;
  // Picked tags that aren't in the current list (another mode, or the deck changed) stay offered so they can be removed.
  const offered = [...themes.map((t) => ({ key: t.key, label: t.label, pinned: t.pinned })), ...tags.filter((k) => !themes.some((t) => t.key === k)).map((k) => ({ key: k, label: labelOf(k), pinned: false }))];
  const toggle = (key: TagKey) => setTags((list) => (list.includes(key) ? list.filter((k) => k !== key) : list.length >= PLAYS_MAX_TAGS ? list : [...list, key]));
  const full = tags.length >= PLAYS_MAX_TAGS;

  return (
    <GlassOverlay label="What this deck plays" paused={false} onClose={onClose}>
      <div className="mx-auto max-w-3xl space-y-7 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-3xl">What this deck plays</h2>
            <p className="mt-2 max-w-prose text-base opacity-90">
              The line under the deck name. Everyone who can open the deck sees it. Tags you pick also steer suggestions and the Smart Cutter: they count {PLAYS_WEIGHT === 2 ? "double" : `${PLAYS_WEIGHT}×`}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn shrink-0">
            Cancel
          </button>
        </div>

        <section>
          <h3 className="eyebrow">Archetype</h3>
          <p className="mt-1 opacity-75">Also what the Smart Cutter plans around (its curve and what it protects).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Choice on={archetype === null} onClick={() => setArchetype(null)}>
              Automatic{guess ? ` (${archetypeLabel(guess)})` : " (none yet)"}
            </Choice>
            {shownArchetypes.map((d) => (
              <Choice key={d.archetype.key} on={archetype === d.archetype.key} onClick={() => setArchetype(d.archetype.key)}>
                {archetypeLabel(d)}
                {allArchetypes && likely.includes(d) && <span className="ml-1 opacity-60">· likely</span>}
              </Choice>
            ))}
            <button type="button" onClick={() => setAllArchetypes((v) => !v)} className="min-h-10 rounded-lg px-3 underline-offset-2 opacity-80 hover:underline hover:opacity-100">
              {allArchetypes ? "Show likely ones only" : `Show all ${ranked.length}`}
            </button>
          </div>
        </section>

        <section>
          <h3 className="eyebrow">
            Tags ({tags.length} / {PLAYS_MAX_TAGS})
          </h3>
          <p className="mt-1 opacity-75">{tags.length ? "In the order you pick them." : "None picked: the line shows the top 3 from Top tags."} Flavor tags show on the line but can&apos;t steer suggestions.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {offered.map((t) => {
              const on = tags.includes(t.key);
              return (
                <Choice key={t.key} on={on} disabled={!on && full} onClick={() => toggle(t.key)}>
                  {on && <span className="mr-1 tabular-nums">{tags.indexOf(t.key) + 1}.</span>}
                  {t.pinned && <span className="mr-1">★</span>}
                  {prettyTag(t.label)}
                </Choice>
              );
            })}
            {!offered.length && <p className="opacity-75">No themes yet. Add more cards first.</p>}
          </div>
        </section>

        <section>
          <label htmlFor="plays-text" className="eyebrow">
            In your own words (optional)
          </label>
          <input
            id="plays-text"
            value={text}
            maxLength={PLAYS_MAX_TEXT}
            onChange={(e) => setText(e.target.value)}
            placeholder="Drain the table one sacrifice at a time"
            className="mt-2 min-h-11 w-full rounded-lg border border-foreground/20 bg-background/70 px-3 text-base"
          />
          <p className="mt-1 text-right text-xs tabular-nums opacity-60">
            {text.length} / {PLAYS_MAX_TEXT}
          </p>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-gold min-h-11" onClick={() => onSave({ tags, text: cleanText(text), archetype })}>
            Save
          </button>
          <button type="button" className="btn min-h-11" onClick={() => onSave({ tags: [], text: null, archetype: null })}>
            Back to automatic
          </button>
        </div>
      </div>
    </GlassOverlay>
  );
}

function Choice({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-10 rounded-lg border px-3 text-left transition disabled:opacity-40 ${on ? "border-gold bg-gold/15 font-semibold" : "border-foreground/15 bg-background/50 hover:border-foreground/40"}`}
    >
      {children}
    </button>
  );
}
