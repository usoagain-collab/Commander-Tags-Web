"use client";

// Design refresh (option E, Nov 20, 2026): the deck's genome, one thin stripe per card, colored by the role it fills.
// Stripes are grouped by role, so each group is a button that lights up that role's cards.

export type GenomeGroup = {
  /** Role key, or "other" for cards that fill no role. */
  key: string;
  label: string;
  color: string;
  count: number;
};

export function GenomeStrip({
  groups,
  height = 12,
  slots,
  active,
  onPick,
  className = "",
}: {
  groups: GenomeGroup[];
  height?: number;
  /** A deck has room for this many cards: the empty ones show as a faint track, so a half-built deck looks half full. */
  slots?: number;
  /** The highlighted group's key, if any. */
  active?: string | null;
  onPick?: (key: string) => void;
  className?: string;
}) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (!total) return null;
  const empty = slots ? Math.max(0, slots - total) : 0;
  return (
    <div className={`flex w-full gap-px overflow-hidden rounded-[3px] ${className}`} style={{ height }}>
      {groups
        .filter((g) => g.count > 0)
        .map((g) => {
          const stripes = Array.from({ length: g.count }, (_, i) => (
            <span key={i} className="h-full flex-1" style={{ background: g.color }} />
          ));
          const dim = active && active !== g.key ? "opacity-35" : "";
          const style = { flexGrow: g.count, flexBasis: 0 };
          const label = `${g.label}: ${g.count} card${g.count === 1 ? "" : "s"}`;
          return onPick ? (
            <button
              key={g.key}
              type="button"
              title={label}
              aria-label={`${label}. Highlight them`}
              aria-pressed={active === g.key}
              onClick={() => onPick(g.key)}
              className={`flex h-full gap-px transition-opacity ${dim}`}
              style={style}
            >
              {stripes}
            </button>
          ) : (
            <span key={g.key} title={label} className={`flex h-full gap-px ${dim}`} style={style}>
              {stripes}
            </span>
          );
        })}
      {empty > 0 && (
        <span
          aria-hidden
          className="h-full rounded-r-[3px]"
          style={{ flexGrow: empty, flexBasis: 0, background: "color-mix(in srgb, var(--foreground) 9%, transparent)" }}
        />
      )}
    </div>
  );
}
