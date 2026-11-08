"use client";

import { useState } from "react";
import { AddRole } from "@/app/decks/[id]/role-profile";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { roleColor } from "@/lib/tags/pretty";
import { customKey, hiddenRoleKeys, TUTORS_KEY, withoutBracketTargets, withRoleHidden, type CustomRole } from "@/lib/tags/role-settings";
import { STANDARD_ROLES } from "@/lib/tags/roles";

/**
 * Default roles (v2): the targets, hidden roles and custom roles new decks start with, edited without opening a
 * deck. Same values "Save as my defaults" writes from a deck (profiles.default_role_targets / custom_roles).
 * Existing decks keep their own settings.
 */
export function RolesSetting({ userId, initialTargets, initialCustom }: { userId: string; initialTargets: Record<string, number>; initialCustom: CustomRole[] }) {
  const [targets, setTargets] = useState(initialTargets);
  const [custom, setCustom] = useState(initialCustom);
  const [saved, setSaved] = useState(JSON.stringify([initialTargets, initialCustom]));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hidden = hiddenRoleKeys(targets);
  const dirty = JSON.stringify([targets, custom]) !== saved;

  async function save() {
    setBusy(true);
    setMessage(null);
    const clean = withoutBracketTargets(targets);
    const { error } = await createClient().from("profiles").update({ default_role_targets: clean, custom_roles: custom }).eq("id", userId);
    setBusy(false);
    if (error) {
      setMessage(`Couldn't save that: ${error.message}`);
      return;
    }
    setTargets(clean);
    setSaved(JSON.stringify([clean, custom]));
    setMessage("Saved. New decks start with these roles; your existing decks keep their own.");
  }

  const row = (key: string, name: string, target: number | null, onTarget: (n: number) => void, extra: React.ReactNode) => {
    const max = key === "lands" ? 50 : 30;
    const off = hidden.has(key);
    return (
      <li key={key} className="py-2">
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: roleColor(name) }} />
          <span className={`min-w-0 flex-1 truncate font-medium ${off ? "opacity-50" : ""}`}>{name}</span>
          {target !== null && !off && <span className="w-8 text-right tabular-nums">{target}</span>}
          {extra}
        </div>
        {target === null && !off && <p className="mt-1 pl-4.5 text-xs opacity-75">The target follows each deck&apos;s bracket (0, 1, 3, 6 or 10 for brackets 1 to 5).</p>}
        {target !== null && !off && (
          <input
            type="range"
            min={0}
            max={Math.max(max, target)}
            value={target}
            onChange={(e) => onTarget(Number(e.target.value))}
            aria-label={`${name} target`}
            className="mt-1 h-8 w-full accent-gold"
          />
        )}
      </li>
    );
  };

  const hideButton = (key: string, name: string) => {
    const off = hidden.has(key);
    return (
      <button
        type="button"
        onClick={() => setTargets((t) => withRoleHidden(t, key, !off))}
        aria-label={`${off ? "Show" : "Hide"} the ${name} role`}
        title={off ? "Track this role in new decks" : "Leave this role out of new decks"}
        className="min-h-9 shrink-0 rounded border border-foreground/20 px-2.5 text-xs"
      >
        {off ? "Show" : "Hide"}
      </button>
    );
  };

  return (
    <section className="mt-8">
      <h2 className="display text-xl">Default roles</h2>
      <p className="mt-1 text-sm opacity-80">What new decks track and aim for. Each deck can still change its own from its role profile.</p>
      <ul className="panel mt-3 divide-y divide-foreground/10 px-3">
        {STANDARD_ROLES.map((r) =>
          row(
            r.key,
            r.name,
            r.key === TUTORS_KEY ? null : (targets[r.key] ?? r.target),
            (n) => setTargets((t) => ({ ...t, [r.key]: n })),
            hideButton(r.key, r.name),
          ),
        )}
        {custom.map((c) =>
          row(
            customKey(c.slug),
            c.name,
            c.target,
            (n) => setCustom((cs) => cs.map((x) => (x.slug === c.slug ? { ...x, target: n } : x))),
            <button
              type="button"
              onClick={() => setCustom((cs) => cs.filter((x) => x.slug !== c.slug))}
              aria-label={`Remove the ${c.name} role`}
              className="min-h-9 shrink-0 rounded border border-foreground/20 px-2.5 text-xs text-red-400"
            >
              Remove
            </button>,
          ),
        )}
      </ul>
      <div className="mt-3">
        {adding ? (
          <AddRole
            existing={[...STANDARD_ROLES.map((r) => r.key), ...custom.map((c) => customKey(c.slug))]}
            onAdd={(role) => {
              setCustom((cs) => [...cs, role]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 w-full rounded-md border border-dashed border-foreground/25 text-sm">
            + Add a role from a tag
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
          Save defaults
        </button>
        <button
          type="button"
          onClick={() => {
            setTargets({ ...DEFAULT_ROLE_TARGETS });
            setCustom([]);
            setMessage("Back to the app's defaults. Save to keep them.");
          }}
          className="btn min-h-11 px-4"
        >
          Use the app&apos;s defaults
        </button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm opacity-80">
        {message ?? (dirty ? "Unsaved changes." : null)}
      </p>
    </section>
  );
}
