"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover, useAnchoredPopover } from "@/components/anchored-popover";
import { createClient } from "@/lib/supabase/client";
import { rankTags } from "@/lib/search/query";
import { roleNameFromLabel, roleStatus, statusText, type CustomRole } from "@/lib/tags/role-settings";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagTree } from "@/lib/tags/tree";
import { roleColor } from "@/lib/tags/pretty";

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
  /** Roles left out of the profile and the deck's groups; listed only while adjusting. */
  hiddenRoles: { key: string; name: string }[];
  onHideRole: (key: string, hidden: boolean) => void;
  /** Hidden when the profile sits inside a section that already has the title (narrow screens). */
  hideTitle?: boolean;
};

const TEXT: Record<string, string> = {
  under: "text-amber-700 dark:text-amber-400",
  met: "text-green-700 dark:text-green-400",
  over: "opacity-75",
};

/**
 * One bar per role: count against target, green when met, amber when under, grey when over (spec).
 * Sliders set the targets; clicking a role's name highlights its cards in the deck.
 */
export function RoleProfile(props: Props) {
  const { roles, counts, readOnly } = props;
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Sliders stay out of the way until asked for; where the panel is opened as "Targets" they show at once.
  const [adjust, setAdjust] = useState(!!props.hideTitle);

  return (
    <div className="space-y-3">
      {!props.hideTitle && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="display text-lg">What this deck needs</h2>
          {!readOnly && (
            <button type="button" onClick={() => setAdjust(!adjust)} aria-expanded={adjust} className="min-h-8 shrink-0 text-[13px] underline opacity-80 hover:opacity-100">
              {adjust ? "Done" : "Adjust targets"}
            </button>
          )}
        </div>
      )}
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
                <span className="flex min-w-0 items-center gap-0.5">
                  <span aria-hidden className="mr-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: roleColor(r.name) }} />
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
                  {props.onSuggest && (
                    <button
                      type="button"
                      onClick={() => props.onSuggest!(r.key)}
                      aria-label={`Suggest cards for ${r.name}`}
                      title={`Suggest cards for ${r.name}`}
                      className="flex min-h-8 items-center rounded px-1.5 text-[13px] opacity-85 hover:bg-foreground/10 hover:text-gold hover:opacity-100"
                    >
                      ✦ Suggest
                    </button>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, r.target ? (count / r.target) * 100 : 100)}%`, background: roleColor(r.name) }} />
              </div>
              <p className="mt-1 flex justify-between text-[13px] tabular-nums">
                <span>
                  {count} of {r.target}
                </span>
                <span className={TEXT[status]}>{status === "over" ? `${count - r.target} over` : status === "met" ? "✓ on target" : statusText(count, r.target)}</span>
              </p>
              {!readOnly && adjust && (
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onHideRole(r.key, true)}
                    aria-label={`Hide the ${r.name} role`}
                    title="Stop tracking this role in this deck. Bring it back from the list below."
                    className="order-last min-h-8 shrink-0 rounded border border-foreground/15 px-2 text-xs"
                  >
                    Hide
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(max, r.target)}
                    value={r.target}
                    onChange={(e) => props.onTarget(r.key, Number(e.target.value))}
                    aria-label={`${r.name} target`}
                    className="h-8 min-w-0 flex-1 accent-gold"
                  />
                  {r.custom && (
                    <button
                      type="button"
                      onClick={() => props.onRemoveCustom(r.key)}
                      aria-label={`Remove the ${r.name} role`}
                      title="Remove this role"
                      className="min-h-8 min-w-8 rounded border border-foreground/15 text-xs text-red-400"
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

      {props.saveError && <p className="text-xs text-red-400">{props.saveError}</p>}

      {!readOnly && adjust && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          {props.hiddenRoles.length > 0 && (
            <div>
              <h3 className="eyebrow mb-1">Hidden roles</h3>
              <ul className="space-y-1">
                {props.hiddenRoles.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate opacity-80">{r.name}</span>
                    <button type="button" onClick={() => props.onHideRole(r.key, false)} className="min-h-8 shrink-0 rounded border border-foreground/20 px-2 text-xs">
                      Show
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

/** The narrow left column: each role's count and bar, and the deck's top tags. Editing means expanding it. */
export function RoleRail({
  roles,
  counts,
  highlight,
  tags,
  onHighlightRole,
  onHighlightTag,
  onExpand,
  compact,
}: {
  roles: ResolvedRole[];
  counts: Record<string, number>;
  highlight: string | null;
  tags: { key: string; label: string; count: number; value: string }[];
  onHighlightRole: (key: string) => void;
  onHighlightTag: (value: string) => void;
  onExpand: () => void;
  /** The narrowest size: only each role and its numbers. */
  compact?: boolean;
}) {
  return (
    <div className="space-y-4 text-[13px]">
      <button type="button" onClick={onExpand} className="btn w-full" title="Show the full panel to edit targets and tags">
        Edit ›
      </button>
      <ul className="space-y-1">
        {roles.map((r) => {
          const n = counts[r.key] ?? 0;
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onHighlightRole(r.key)}
                aria-pressed={highlight === `role:${r.key}`}
                title={`Highlight the ${r.name} cards`}
                className={`block ${compact ? "min-h-8" : "min-h-10"} w-full rounded px-1 py-0.5 text-left hover:bg-foreground/5 ${highlight === `role:${r.key}` ? "bg-amber-400/20" : ""}`}
              >
                <span className="flex justify-between gap-1">
                  <span className={compact ? "min-w-0" : "truncate"}>{r.name}</span>
                  <span className={`shrink-0 tabular-nums ${n < r.target ? "text-amber-400" : "text-green-400"}`}>
                    {n}/{r.target}
                  </span>
                </span>
                {!compact && (
                  <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10">
                    <span className="block h-full" style={{ width: `${Math.min(100, r.target ? (n / r.target) * 100 : 100)}%`, background: roleColor(r.name) }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!compact && tags.length > 0 && (
        <div className="border-t border-foreground/10 pt-3">
          <h3 className="eyebrow mb-1">Top tags</h3>
          <ul>
            {tags.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => onHighlightTag(t.value)}
                  aria-pressed={highlight === t.value}
                  title={`Highlight the cards tagged ${t.label}`}
                  className={`flex min-h-8 w-full items-center justify-between gap-1 rounded px-1 text-left hover:bg-foreground/5 ${highlight === t.value ? "bg-amber-400/20" : ""}`}
                >
                  <span className="truncate">{t.label}</span>
                  <span className="shrink-0 tabular-nums opacity-60">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
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
          className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/60 text-[11px] font-semibold italic leading-none"
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
export function AddRole({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (r: CustomRole) => void; onCancel: () => void }) {
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
          className="min-h-9 flex-1 rounded bg-gold text-gold-ink disabled:opacity-40"
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
