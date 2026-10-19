"use client";

import type { CardSummary } from "@/lib/deck/model";
import type { ResolvedRole } from "@/lib/tags/roles";
import type { TagData } from "@/lib/tags/use-tag-data";

type Props = {
  card: CardSummary;
  roleKeys: string[];
  roles: ResolvedRole[];
  tags: TagData;
  highlight: string | null;
  onTag: (slug: string) => void;
};

/**
 * A card's roles and tags, in place of the buy links other sites show (Phase 3 plan).
 * Oracle tags are listed exactly as applied, deepest first; hover one for its place in the tree.
 */
export function CardTags({ card, roleKeys, roles, tags, highlight, onTag }: Props) {
  const loaded = tags.loaded.has(card.oracle_id);
  const oracle = tags.oracleTags[card.oracle_id] ?? [];
  const art = tags.artTags[card.oracle_id] ?? [];
  const sorted = tags.tree ? tags.tree.sortDeepestFirst(oracle) : oracle;

  if (!loaded) return <p className="text-sm opacity-60">Loading tags…</p>;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Fills</h4>
        {roleKeys.length ? (
          <div className="flex flex-wrap gap-1.5">
            {roleKeys.map((k) => (
              <span key={k} className="rounded-full bg-green-700/15 px-2 py-0.5 text-xs text-green-800 dark:text-green-300">
                {roles.find((r) => r.key === k)?.name ?? k}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs opacity-60">No role</p>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Card tags</h4>
        {sorted.length === 0 ? (
          <p className="text-xs opacity-60">
            Untagged. Scryfall&apos;s Tagger has no tags for this card yet, so suggestions won&apos;t find it.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((slug) => (
              <TagChip
                key={slug}
                label={tags.tree?.label(slug) ?? slug}
                title={`${tags.tree?.path(slug) ?? slug} · ${tags.tree?.info(slug)?.size.toLocaleString() ?? "?"} cards`}
                active={highlight === slug}
                onClick={() => onTag(slug)}
              />
            ))}
          </div>
        )}
      </div>

      {art.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Art tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {art.map(([slug, label, size]) => (
              <TagChip
                key={slug}
                label={label}
                title={`Art tag · on ${size.toLocaleString()} illustrations`}
                active={highlight === `art:${slug}`}
                onClick={() => onTag(`art:${slug}`)}
                art
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TagChip({
  label,
  title,
  active,
  onClick,
  art,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
  art?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title}. Click to highlight deck cards with this tag.`}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3 py-1 text-xs sm:min-h-7 sm:px-2.5 sm:py-0.5 ${
        active
          ? "border-amber-500 bg-amber-400/25"
          : art
            ? "border-dashed border-foreground/25 hover:bg-foreground/5"
            : "border-foreground/20 hover:bg-foreground/5"
      }`}
    >
      {label}
    </button>
  );
}
