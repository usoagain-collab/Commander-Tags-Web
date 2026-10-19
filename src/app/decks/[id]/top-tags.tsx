"use client";

import { useRef, useState } from "react";
import { AnchoredPopover, useAnchoredPopover } from "@/components/anchored-popover";
import type { ThemeSettings, ThemeTag, TreeCard } from "@/lib/tags/themes";

type Props = {
  themes: ThemeTag[];
  settings: ThemeSettings;
  loading: boolean;
  readOnly: boolean;
  highlight: string | null;
  hidden: { key: string; label: string }[];
  roleSlugs: Set<string>;
  treeCardFor: (key: string) => TreeCard | null;
  onSettings: (s: ThemeSettings) => void;
  onHighlight: (tag: ThemeTag) => void;
  onToggleHidden: (key: string) => void;
  onMakeRole: (tag: ThemeTag) => void;
  hideTitle?: boolean;
};

/** "o:landfall" -> the highlight value the editor uses ("landfall"), "a:frog" -> "art:frog". */
export const highlightValue = (tag: { kind: "o" | "a"; slug: string }) => (tag.kind === "a" ? `art:${tag.slug}` : tag.slug);

/**
 * The deck's top theme tags (prototype: renderTags). Gameplay / Flavor, Specific / Broad and Relevance / Count
 * switches; the commander's tags pinned first; click to highlight; hover (or tap ⑂) for the tag's tree; hide
 * any tag; turn any card tag into a role.
 */
export function TopTags(props: Props) {
  const { themes, settings, loading, readOnly } = props;
  const [showHidden, setShowHidden] = useState(false);

  return (
    <div className="space-y-3">
      {!props.hideTitle && <h2 className="text-xs font-semibold uppercase tracking-wide opacity-60">Top tags</h2>}

      <div className="space-y-1.5">
        <Switch
          label="Show"
          value={settings.mode}
          options={[
            ["gameplay", "Gameplay"],
            ["flavor", "Flavor"],
          ]}
          onChange={(v) => props.onSettings({ ...settings, mode: v as ThemeSettings["mode"] })}
          help="Gameplay: what cards do. Flavor: how they look (art tags) plus name and wording tags."
        />
        <Switch
          label="Tags"
          value={settings.specific ? "specific" : "broad"}
          options={[
            ["specific", "Specific"],
            ["broad", "Broad"],
          ]}
          onChange={(v) => props.onSettings({ ...settings, specific: v === "specific" })}
          help="Specific: tags exactly as applied, deepest first. Broad: also counts each tag's parents."
        />
        <Switch
          label="Sort"
          value={settings.sortBy}
          options={[
            ["relevance", "Relevance"],
            ["count", "Count"],
          ]}
          onChange={(v) => props.onSettings({ ...settings, sortBy: v as ThemeSettings["sortBy"] })}
          help="Relevance: rare tags count more than common ones. Count: raw number of cards."
        />
      </div>

      {loading ? (
        <p className="text-sm opacity-60">Loading tags…</p>
      ) : themes.length === 0 ? (
        <p className="text-sm opacity-60">
          No shared {settings.mode} themes yet. A tag shows up here once two or more cards share it.
        </p>
      ) : (
        <>
          {/* A visible key, since phones can't hover the ★ to see its tooltip. */}
          {themes.some((t) => t.pinned) && (
            <p className="text-xs opacity-60">
              <span className="text-amber-600" aria-hidden>
                ★
              </span>{" "}
              = your commander&apos;s tags, listed first and counted double
            </p>
          )}
          <ul className="space-y-0.5">
          {themes.map((t) => (
            <TagRow key={t.key} tag={t} {...props} />
          ))}
          </ul>
        </>
      )}

      {props.hidden.length > 0 && (
        <div className="border-t border-foreground/10 pt-2 text-xs">
          <button type="button" onClick={() => setShowHidden((s) => !s)} className="min-h-8 underline opacity-70">
            {showHidden ? "Hide the list" : `Show ${props.hidden.length} hidden tag${props.hidden.length === 1 ? "" : "s"}`}
          </button>
          {showHidden && (
            <ul className="mt-1 space-y-1">
              {props.hidden.map((h) => (
                <li key={h.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {h.label}
                    {h.key.startsWith("a:") && <span className="ml-1 opacity-60">(art)</span>}
                  </span>
                  {!readOnly && (
                    <button type="button" onClick={() => props.onToggleHidden(h.key)} className="min-h-8 shrink-0 rounded border border-foreground/20 px-2">
                      Unhide
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TagRow({ tag, ...props }: { tag: ThemeTag } & Props) {
  const row = useRef<HTMLLIElement>(null);
  const { pos, open, show, hide } = useAnchoredPopover(260, 260);
  const active = props.highlight === highlightValue(tag);
  const card = open ? props.treeCardFor(tag.key) : null;
  const isRole = tag.kind === "o" && props.roleSlugs.has(tag.slug);

  return (
    <li
      ref={row}
      onPointerEnter={(e) => e.pointerType === "mouse" && show(row.current)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
      className={`flex items-center gap-1 rounded text-sm ${active ? "bg-amber-400/20" : "hover:bg-foreground/5"}`}
    >
      <button
        type="button"
        onClick={() => props.onHighlight(tag)}
        aria-pressed={active}
        title={`Highlight the ${tag.count === 1 ? "card" : "cards"} with this tag`}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left"
      >
        {tag.pinned && (
          <span title="Your commander has this tag" aria-label="Commander tag" className="text-amber-600">
            ★
          </span>
        )}
        <span className="truncate">{tag.label}</span>
        {tag.kind === "a" && <span className="shrink-0 rounded border border-dashed border-foreground/30 px-1 text-[10px] opacity-70">art</span>}
        <span className="ml-auto shrink-0 text-xs tabular-nums opacity-60">{tag.count}</span>
      </button>

      <button
        type="button"
        aria-label={`Show where ${tag.label} sits in the tag tree`}
        aria-expanded={open}
        onClick={() => (open ? hide() : show(row.current))}
        onBlur={hide}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-xs opacity-50 hover:opacity-100"
      >
        ⑂
      </button>
      {!props.readOnly && tag.kind === "o" && !isRole && (
        <button
          type="button"
          onClick={() => props.onMakeRole(tag)}
          aria-label={`Make ${tag.label} a role`}
          title="Make this a role with its own target"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-sm opacity-50 hover:opacity-100"
        >
          +
        </button>
      )}
      {!props.readOnly && (
        <button
          type="button"
          onClick={() => props.onToggleHidden(tag.key)}
          aria-label={`Hide ${tag.label}`}
          title="Hide this tag (saved to your profile)"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-sm opacity-50 hover:opacity-100"
        >
          ×
        </button>
      )}

      <AnchoredPopover pos={pos} id={`tree-${tag.key}`}>
        {card && (
          <>
            <span className="mb-1 block font-semibold">{card.kind === "a" ? "Art tag" : "Card tag"} tree</span>
            {card.rows.map((r) => (
              <span
                key={r.key}
                style={{ paddingLeft: r.depth * 12 }}
                className={`flex items-center justify-between gap-2 ${r.self ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}
              >
                <span className="truncate">
                  {r.depth > 0 ? "› " : ""}
                  {r.label}
                </span>
                {r.count > 0 && <span className="shrink-0 rounded bg-foreground/10 px-1 tabular-nums">{r.count}</span>}
              </span>
            ))}
            {card.moreChildren > 0 && <span className="block opacity-60">+{card.moreChildren} more sub-tags</span>}
            {card.rows.length === 1 && card.moreChildren === 0 && <span className="block opacity-60">No parent or sub-tags</span>}
            <span className="mt-2 block opacity-60">
              Numbers are cards in this deck · on {card.size.toLocaleString()} {card.kind === "a" ? "illustrations" : "cards"} overall
            </span>
          </>
        )}
      </AnchoredPopover>
    </li>
  );
}

function Switch({
  label,
  value,
  options,
  onChange,
  help,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  help: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs" title={help}>
      <span className="w-9 shrink-0 opacity-60">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-1 overflow-hidden rounded-md border border-foreground/20">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-h-8 flex-1 px-2 ${value === v ? "bg-foreground text-background" : "hover:bg-foreground/5"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
