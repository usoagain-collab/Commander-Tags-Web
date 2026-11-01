"use client";

import { useRef } from "react";
import { clampRail, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN } from "@/lib/tags/layout-prefs";

/** The bar between the left column and the cards. Drag to resize, arrow keys too, double-click for the standard size. */
export function RailHandle({ onDrag, onDone }: { onDrag: (px: number) => void; onDone: (px: number) => void }) {
  const start = useRef<{ x: number; width: number; last: number } | null>(null);
  const widthNow = (el: HTMLElement) => el.parentElement?.getBoundingClientRect().width ?? RAIL_DEFAULT;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Left column width"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      tabIndex={0}
      title="Drag to resize. Double-click for the standard size."
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const width = widthNow(e.currentTarget);
        start.current = { x: e.clientX, width, last: width };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        start.current.last = clampRail(start.current.width + e.clientX - start.current.x);
        onDrag(start.current.last);
      }}
      onPointerUp={() => {
        if (start.current && start.current.last !== start.current.width) onDone(start.current.last);
        start.current = null;
      }}
      onDoubleClick={() => onDone(RAIL_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onDone(clampRail(widthNow(e.currentTarget) + (e.key === "ArrowLeft" ? -20 : 20)));
      }}
      className="group absolute -right-5 bottom-0 top-0 z-10 w-4 cursor-col-resize touch-none"
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-foreground/10 group-hover:bg-gold group-focus-visible:bg-gold" />
      <span aria-hidden className="sticky top-[50vh] mx-auto block h-12 w-1.5 rounded-full bg-foreground/30 group-hover:bg-gold" />
    </div>
  );
}
