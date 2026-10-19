"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover, useAnchoredPopover } from "@/components/anchored-popover";
import { createClient } from "@/lib/supabase/client";
import { rankTags } from "@/lib/search/query";
import { roleNameFromLabel, roleStatus, statusText, type CustomRole } from "@/lib/tags/role-settings";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagTree } from "@/lib/tags/tree";

type Props = {
  roles: ResolvedRole[];
  tree: TagTree | null;
  counts: Record<string, number>;
  readOnly: boolean;
  highlight: string | null;
  saveError: string | null;
  onTarget: (key: string, target: number) => void;
  onHighlight: (key: string) => void;
  /** Phase 4: open suggestions for this role. */
  onSuggest?: (key: string) => void;
  onAddCustom: (role: CustomRole) => void;
  onRemoveCustom: (key: string) => void;
  onSaveDefaults: () => Promise<string>;
  onResetDefaults: () => void;
  /** Hidden when the profile sits inside a section that already has the title (narrow screens). */
  hideTitle?: boolean;
};

const BAR: Record<string, string> = {
  under: "bg-amber-500",
  met: "bg-green-600",
  over: "bg-foreground/35",
};
const TEXT: Record<string, string> = {
  under: "text-amber-700 dark:text-amber-400",
  met: "text-green-700 dark:text-green-400",
  over: "opacity-60",
};

/**
 * One bar per role: count against target, green when met, amber when under, grey when over (spec).
 * Sliders set the targets; clicking a role's name highlights its cards in the deck.
 */
export function RoleProfile(props: Props) {
  const { roles, counts, readOnly } = props;
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {!props.hideTitle && <h2 className="text-xs font-semibold uppercase tracking-wide opacity-60">Role profile</h2>}
      {roles.length === 0 && <p className="text-sm opacity-60">Loading roles…</p>}
      <ul className="space-y-3">
        {roles.map((r) => {
          const count = counts[r.key] ?? 0;
          const status = roleStatus(count, r.target);
          const max = r.land ? 50 : 30; // David, Oct 19, 2026
          const active = props.highlight === `role:${r.key}`;
          return (
            <li key={r.key} className="relative">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => props.onHighlight(r.key)}
                    aria-pressed={active}
                    title="Highlight the cards that fill this role"
                    className={`min-h-8 truncate text-left font-medium hover:underline ${active ? "underline decoration-amber-500 decoration-2" : ""}`}
                  >
                    {r.name}
                  </button>
                  <InfoTip role={r} tree={props.tree} />
                </span>
                <span className="flex shrink-0 items-center gap-1 tabular-nums">
                  {count} / {r.target} <span className={`text-xs ${TEXT[status]}`}>{statusText(count, r.target)}</span>
                  {props.onSuggest && (
                    <button
                      type="button"
                      onClick={() => props.onSuggest!(r.key)}
                      aria-label={`Suggest cards for ${r.name}`}
                      title={`Suggest cards for ${r.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded opacity-60 hover:bg-foreground/10 hover:opacity-100"
                    >
                      💡
                    </button>
                  )}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <div className={`h-full ${BAR[status]}`} style={{ width: `${Math.min(100, r.target ? (count / r.target) * 100 : 100)}%` }} />
              </div>
              {!readOnly && (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(max, r.target)}
                    value={r.target}
                    onChange={(e) => props.onTarget(r.key, Number(e.target.value))}
                    aria-label={`${r.name} target`}
                    className="h-8 min-w-0 flex-1 accent-foreground"
                  />
                  {r.custom && (
                    <button
                      type="button"
                      onClick={() => props.onRemoveCustom(r.key)}
                      aria-label={`Remove the ${r.name} role`}
                      title="Remove this role"
                      className="min-h-8 min-w-8 rounded border border-foreground/15 text-xs text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
              {r.missing.length > 0 && r.tagSet?.size === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">None of these tags exist on Scryfall: {r.missing.join(", ")}</p>
              )}
            </li>
          );
        })}
      </ul>

      {props.saveError && <p className="text-xs text-red-600">{props.saveError}</p>}

      {!readOnly && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          {adding ? (
            <AddRole
              existing={roles.map((r) => r.key)}
              onAdd={(role) => {
                props.onAddCustom(role);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="min-h-9 w-full rounded-md border border-dashed border-foreground/25 text-sm">
              + Add a role from a tag
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => setMessage(await props.onSaveDefaults())}
              className="min-h-9 flex-1 rounded-md border border-foreground/20 text-xs"
              title="New decks will start with these targets and custom roles"
            >
              Save as my defaults
            </button>
            <button
              type="button"
              onClick={() => {
                props.onResetDefaults();
                setMessage("Reset to your defaults.");
              }}
              className="min-h-9 flex-1 rounded-md border border-foreground/20 text-xs"
            >
              Reset to defaults
            </button>
          </div>
          {message && (
            <p aria-live="polite" className="text-xs opacity-70">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** "a", "a or b", "a, b or c" */
const orList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/**
 * The ⓘ next to a role: what it counts and which tags it uses. Hover on desktop; tap on a phone (there's no
 * hover there). The tap area is 32px even though the icon is small (CLAUDE.md: Mobile matters). The text is an
 * AnchoredPopover so the scrolling role column can't clip it.
 */
function InfoTip({ role, tree }: { role: ResolvedRole; tree: TagTree | null }) {
  const button = useRef<HTMLButtonElement>(null);
  const { pos, open, show, hide } = useAnchoredPopover(256, 180);
  const id = `role-info-${role.key}`;
  const label = (s: string) => tree?.label(s) ?? s;

  const roots = (role.slugs ?? []).filter((s) => tree?.has(s) ?? true);
  const subtags = role.tagSet ? [...role.tagSet].filter((s) => !roots.includes(s)) : [];
  const examples = tree
    ? [...subtags].sort((a, b) => (tree.info(b)?.size ?? 0) - (tree.info(a)?.size ?? 0)).slice(0, 4).map(label)
    : [];
  const about = role.about ?? (role.custom ? `A role you made from the ${label(roots[0] ?? "")} tag.` : "");

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`How ${role.name} is counted`}
        aria-expanded={open}
        aria-controls={id}
        onPointerEnter={(e) => e.pointerType === "mouse" && show(button.current)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onClick={() => (open ? hide() : show(button.current))}
        onBlur={hide}
        onKeyDown={(e) => e.key === "Escape" && hide()}
        className="flex h-8 w-8 shrink-0 items-center justify-center"
      >
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/40 text-[10px] font-semibold italic leading-none opacity-70"
        >
          i
        </span>
      </button>
      <AnchoredPopover pos={pos} id={id}>
        {about && <span className="block">{about}</span>}
        {!role.land && roots.length > 0 && (
          <span className="mt-2 block opacity-80">
            Counts cards tagged <strong>{orList(roots.map(label))}</strong> on Scryfall Tagger
            {subtags.length > 0 && (
              <>
                , plus the {subtags.length} tag{subtags.length === 1 ? "" : "s"} under {roots.length === 1 ? "it" : "them"}
                {examples.length > 0 && <> (such as {examples.join(", ")})</>}
              </>
            )}
            .
          </span>
        )}
        {role.exclude && (
          <span className="mt-2 block opacity-80">
            Cards that are also {role.exclude === "wipes" ? "board wipes" : role.exclude} don&apos;t count here.
          </span>
        )}
      </AnchoredPopover>
    </>
  );
}

type Tag = { slug: string; label: string; size: number; description: string | null };

/** Pick any oracle tag, name the role, set a target: e.g. "Sac outlets: 6" (spec). */
function AddRole({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (r: CustomRole) => void; onCancel: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [picked, setPicked] = useState<Tag | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(5);
  const latest = useRef(0);

  useEffect(() => {
    const q = text.trim().toLowerCase().replace(/\s+/g, "-");
    if (picked || q.length < 2) {
      setTags([]);
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("tags")
        .select("slug, label, size, description")
        .eq("kind", "oracle")
        .ilike("slug", `%${q.replace(/[^a-z0-9-]/g, "")}%`)
        .order("size", { ascending: false })
        .limit(40);
      if (id === latest.current) setTags(rankTags((data ?? []) as Tag[], q).slice(0, 8));
    }, 120);
    return () => clearTimeout(timer);
  }, [text, picked, supabase]);

  const duplicate = picked ? existing.includes(`c:${picked.slug}`) : false;

  return (
    <div className="space-y-2 rounded-md border border-foreground/15 p-2 text-sm">
      {!picked ? (
        <>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search tags, e.g. sacrifice outlet"
            aria-label="Search tags for the new role"
            className="min-h-9 w-full rounded border border-foreground/20 bg-transparent px-2"
          />
          {tags.length > 0 && (
            <ul className="max-h-56 overflow-auto">
              {tags.map((t) => (
                <li key={t.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(t);
                      setName(roleNameFromLabel(t.label));
                    }}
                    title={t.description ?? undefined}
                    className="flex min-h-9 w-full items-center justify-between gap-2 rounded px-2 text-left hover:bg-foreground/10"
                  >
                    <span className="truncate font-mono text-xs">{t.slug}</span>
                    <span className="shrink-0 text-xs opacity-60">{t.size.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="text-xs opacity-70">
            Tag: <span className="font-mono">{picked.slug}</span> and everything under it{" "}
            <button type="button" onClick={() => setPicked(null)} className="underline">
              change
            </button>
          </p>
          <label className="block">
            <span className="text-xs opacity-70">Role name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="min-h-9 w-full rounded border border-foreground/20 bg-transparent px-2"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs opacity-70">Target</span>
            <input
              type="number"
              min={0}
              max={99}
              value={target}
              onChange={(e) => setTarget(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              className="min-h-9 w-20 rounded border border-foreground/20 bg-transparent px-2"
            />
          </label>
          {duplicate && <p className="text-xs text-amber-700 dark:text-amber-400">This deck already has a role for that tag.</p>}
        </>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!picked || duplicate || !name.trim()}
          onClick={() => picked && onAdd({ slug: picked.slug, name: name.trim(), target })}
          className="min-h-9 flex-1 rounded bg-foreground text-background disabled:opacity-40"
        >
          Add role
        </button>
        <button type="button" onClick={onCancel} className="min-h-9 px-3 opacity-70">
          Cancel
        </button>
      </div>
    </div>
  );
}
