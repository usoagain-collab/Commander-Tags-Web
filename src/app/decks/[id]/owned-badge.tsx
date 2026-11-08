"use client";

/** ✓ when you own every copy the deck needs, "1/4" when only some (collection tracking, v2). A label, not a button. */
export function OwnedBadge({ owned, chip }: { owned: { have: number; need: number }; chip?: boolean }) {
  const all = owned.have >= owned.need;
  const title = all ? "In your collection" : owned.have ? `You own ${owned.have} of ${owned.need}` : "Not in your collection";
  if (!all && owned.have === 0) return chip ? <span title={title} className="shrink-0 text-xs opacity-60">not owned</span> : null;
  return (
    <span
      title={title}
      className={
        chip
          ? `shrink-0 rounded px-1.5 py-0.5 text-xs ${all ? "bg-green-600/15 text-green-700 dark:text-green-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`
          : `rounded px-1.5 py-0.5 text-xs font-semibold text-white ${all ? "bg-green-700" : "bg-amber-600"}`
      }
    >
      {all ? "✓" : `${owned.have}/${owned.need}`}
    </span>
  );
}
