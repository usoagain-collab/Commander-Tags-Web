"use client";

// A small popover drawn on top of the whole page, next to the element that opened it. Drawing it in a portal
// with fixed position means scrolling columns can't clip it (the side panels scroll on their own).
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Pos = { left: number; top: number; above: boolean; width: number };

/** Open/close state plus a position measured from the anchor. Closes on scroll or resize so it never drifts. */
export function useAnchoredPopover(width = 256, expectedHeight = 200) {
  const [pos, setPos] = useState<Pos | null>(null);

  const show = useCallback(
    (anchor: HTMLElement | null) => {
      const r = anchor?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      // Below the anchor if there's room, otherwise above it.
      const above = r.bottom + expectedHeight > window.innerHeight && r.top > expectedHeight;
      setPos({ left, top: above ? r.top - 4 : r.bottom + 4, above, width: w });
    },
    [width, expectedHeight],
  );
  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos, hide]);

  return { pos, open: pos !== null, show, hide };
}

export function AnchoredPopover({ pos, id, children }: { pos: Pos | null; id: string; children: React.ReactNode }) {
  if (!pos) return null;
  return createPortal(
    <span
      id={id}
      role="tooltip"
      style={{ left: pos.left, top: pos.top, width: pos.width, transform: pos.above ? "translateY(-100%)" : undefined }}
      className="pointer-events-none fixed z-[60] block rounded-md border border-foreground/15 bg-background p-3 text-xs leading-relaxed shadow-lg"
    >
      {children}
    </span>,
    document.body,
  );
}
