"use client";

// My tags (step 3f) and the manual category picker. Every control here is at least 44px tall on phones
// (CLAUDE.md: Mobile matters), and nothing is placed on top of card images.
import { useState } from "react";
import {
  MY_TAG_CHIP,
  MY_TAG_COLORS,
  MY_TAG_SWATCH,
  myTagHighlight,
  scopeOf,
  type MyTag,
  type MyTagColor,
  type MyTagScope,
} from "@/lib/tags/my-tags";
import type { MyTagPatch } from "@/lib/tags/use-my-tags";

const SCOPE_LABEL: Record<MyTagScope, string> = { deck: "This deck only", account: "All my decks" };

/** Small labels for Text view rows and tiles. Not buttons: the row or tile itself is the tap target. */
export function MyTagChips({ tags, className = "" }: { tags: MyTag[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={`flex min-w-0 shrink flex-wrap gap-1 ${className}`}>
      {tags.map((t) => (
        <span key={t.id} className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-none ${MY_TAG_CHIP[t.color]}`}>
          {t.name}
        </span>
      ))}
    </span>
  );
}

/** Card panel: the hovered card's My tags; click one to highlight its cards. */
export function PanelMyTags({ tags, highlight, onHighlight }: { tags: MyTag[]; highlight: string | null; onHighlight: (t: MyTag) => void }) {
  if (!tags.length) return null;
  return (
    <div className="text-sm">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">My tags</h4>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onHighlight(t)}
            aria-pressed={highlight === myTagHighlight(t.id)}
            className={`min-h-7 rounded-full px-2 text-xs ${MY_TAG_CHIP[t.color]} ${highlight === myTagHighlight(t.id) ? "ring-2 ring-amber-500" : ""}`}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Card sheet: every tag as a big on/off button, plus "New tag". Turning a tag on or off is a deck edit
 * (Ctrl+Z undoes it); creating a tag saves straight away and puts it on this card.
 */
export function SheetMyTags({
  tags,
  onCard,
  onToggle,
  onCreate,
}: {
  tags: MyTag[];
  onCard: Set<string>;
  onToggle: (t: MyTag, on: boolean) => void;
  onCreate: (name: string, scope: MyTagScope) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<MyTagScope>("deck");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const problem = await onCreate(name, scope);
    setBusy(false);
    if (problem) setMessage(problem);
    else {
      setName("");
      setMessage(null);
      setAdding(false);
    }
  }

  return (
    <div className="text-sm">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">My tags</h4>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => {
          const on = onCard.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggle(t, !on)}
              aria-pressed={on}
              title={`${on ? "Remove" : "Add"} "${t.name}" (${SCOPE_LABEL[scopeOf(t)].toLowerCase()})`}
              className={`min-h-11 rounded-lg border px-3 ${
                on ? `${MY_TAG_CHIP[t.color]} border-transparent font-medium` : "border-dashed border-foreground/25 opacity-70 hover:opacity-100"
              }`}
            >
              {on ? "✓ " : "+ "}
              {t.name}
            </button>
          );
        })}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 rounded-lg border border-foreground/20 px-3">
            New tag…
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-foreground/15 p-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Tag name, e.g. Combo"
            aria-label="New tag name"
            className="min-h-11 w-full rounded-md border border-foreground/20 bg-background px-3"
          />
          <ScopeChoice value={scope} onChange={setScope} />
          {message && <p className="text-amber-700 dark:text-amber-400">{message}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-lg bg-foreground px-3 font-medium text-background disabled:opacity-50">
              {busy ? "Adding…" : "Add tag to this card"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-lg border border-foreground/20 px-3">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ScopeChoice({ value, onChange }: { value: MyTagScope; onChange: (s: MyTagScope) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Where this tag applies">
      {(["deck", "account"] as MyTagScope[]).map((s) => (
        <label key={s} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-foreground/15 px-3">
          <input type="radio" checked={value === s} onChange={() => onChange(s)} />
          {SCOPE_LABEL[s]}
        </label>
      ))}
    </div>
  );
}

/**
 * Card sheet: which role group the card sits in. "Automatic" follows its tags; picking a role moves the card
 * there AND counts it only toward that role (David, Oct 19, 2026). "No role" puts it in Other.
 */
export function CategoryPicker({
  value,
  automatic,
  roles,
  onChange,
}: {
  value: string | null;
  automatic: string[];
  roles: { key: string; name: string }[];
  onChange: (key: string | null, name: string) => void;
}) {
  const autoText = automatic.length ? automatic.join(", ") : "no role";
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">Category</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const key = e.target.value || null;
          onChange(key, key === "none" ? "no role" : (roles.find((r) => r.key === key)?.name ?? "automatic"));
        }}
        className="min-h-11 w-full rounded-lg border border-foreground/20 bg-background px-3"
      >
        <option value="">Automatic, from its tags ({autoText})</option>
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
        <option value="none">No role (Other)</option>
      </select>
      {value && <span className="mt-1 block text-xs opacity-60">Set by you: counts only toward this in the role profile.</span>}
    </label>
  );
}

/**
 * Left column: all tags usable in this deck, with how many cards in the deck carry each. Click to highlight;
 * Edit to rename, recolor, change scope or delete. "Show on cards" puts chips on Text rows and tiles.
 */
export function MyTagsPanel({
  tags,
  counts,
  highlight,
  show,
  readOnly,
  loading,
  hideTitle,
  onShow,
  onHighlight,
  onUpdate,
  onDelete,
}: {
  tags: MyTag[];
  counts: Record<string, number>;
  highlight: string | null;
  show: boolean;
  readOnly: boolean;
  loading: boolean;
  hideTitle?: boolean;
  onShow: (show: boolean) => void;
  onHighlight: (t: MyTag) => void;
  onUpdate: (id: string, patch: MyTagPatch) => Promise<string | null>;
  onDelete: (t: MyTag) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="text-sm">
      {!hideTitle && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">My tags</h3>}
      <label className="mb-2 flex min-h-9 items-center gap-2">
        <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} />
        Show on cards
      </label>
      {loading ? (
        <p className="opacity-60">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="opacity-60">No tags yet. Open a card and choose “New tag…” to label it (Combo, Win con, Staple…).</p>
      ) : (
        <ul className="space-y-1">
          {tags.map((t) =>
            editing === t.id ? (
              <li key={t.id}>
                <TagEditor tag={t} onSave={onUpdate} onDelete={onDelete} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onHighlight(t)}
                  aria-pressed={highlight === myTagHighlight(t.id)}
                  title={`Highlight cards tagged "${t.name}"`}
                  className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-foreground/5 ${
                    highlight === myTagHighlight(t.id) ? "bg-amber-400/20" : ""
                  }`}
                >
                  <span className={`truncate rounded px-1.5 py-0.5 text-xs ${MY_TAG_CHIP[t.color]}`}>{t.name}</span>
                  <span className="text-xs opacity-60">{counts[t.id] ?? 0}</span>
                  {t.deck_id === null && (
                    <span title="Account-wide: follows its cards into every deck" className="ml-auto text-xs opacity-50">
                      all decks
                    </span>
                  )}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setEditing(t.id)}
                    aria-label={`Edit tag ${t.name}`}
                    className="min-h-9 rounded-md px-2 text-xs opacity-60 hover:bg-foreground/10 hover:opacity-100"
                  >
                    Edit
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function TagEditor({
  tag,
  onSave,
  onDelete,
  onDone,
}: {
  tag: MyTag;
  onSave: (id: string, patch: MyTagPatch) => Promise<string | null>;
  onDelete: (t: MyTag) => Promise<string | null>;
  onDone: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<MyTagColor>(tag.color);
  const [scope, setScope] = useState<MyTagScope>(scopeOf(tag));
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: MyTagPatch = {};
    if (name.trim() !== tag.name) patch.name = name;
    if (color !== tag.color) patch.color = color;
    if (scope !== scopeOf(tag)) patch.scope = scope;
    const problem = Object.keys(patch).length ? await onSave(tag.id, patch) : null;
    if (problem) setMessage(problem);
    else onDone();
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-lg border border-foreground/15 p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        aria-label="Tag name"
        className="min-h-11 w-full rounded-md border border-foreground/20 bg-background px-2"
      />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
        {MY_TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`h-8 w-8 rounded-full ${MY_TAG_SWATCH[c]} ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
          />
        ))}
      </div>
      <ScopeChoice value={scope} onChange={setScope} />
      {scope !== scopeOf(tag) && (
        <p className="text-xs opacity-70">
          {scope === "account"
            ? "Its cards will carry this tag in every deck."
            : "It will only show in this deck (its cards in other decks lose it there)."}
        </p>
      )}
      {message && <p className="text-amber-700 dark:text-amber-400">{message}</p>}
      {confirming ? (
        <div className="space-y-2 rounded-md bg-red-600/10 p-2">
          <p>
            Delete “{tag.name}”? It comes off every card{tag.deck_id === null ? " in every deck" : ""}. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                const problem = await onDelete(tag);
                if (problem) setMessage(problem);
                else onDone();
              }}
              className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 font-medium text-white"
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-foreground/20 px-3">
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="submit" className="min-h-11 flex-1 rounded-lg bg-foreground px-3 font-medium text-background">
            Save
          </button>
          <button type="button" onClick={onDone} className="min-h-11 rounded-lg border border-foreground/20 px-3">
            Cancel
          </button>
          <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg px-3 text-red-600">
            Delete…
          </button>
        </div>
      )}
    </form>
  );
}
