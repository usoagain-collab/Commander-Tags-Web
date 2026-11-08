"use client";

// Drag to reorder a list with pointer events, so a mouse and a finger work the same way (HTML5 drag only starts
// after a long press on touch screens). The whole row is the handle; the list reorders live as the pointer passes
// over other rows. Sliders and anything marked data-no-drag keep their own gestures.
import { useRef, useState } from "react";
import { moveKey } from "@/lib/tags/order";

export function useDragReorder(group: string, keys: string[], onReorder: (keys: string[]) => void, enabled: boolean) {
  const drag = useRef<{ key: string; moved: boolean; x: number; y: number } | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [dragging, setDragging] = useState<string | null>(null);
  // Set while the click that follows a drag's pointerup is still on its way.
  const justDragged = useRef(false);

  const end = () => {
    if (drag.current?.moved) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
    }
    drag.current = null;
    setDragging(null);
  };

  return {
    dragging,
    rowProps(key: string) {
      if (!enabled) return {};
      return {
        "data-reorder": `${group}:${key}`,
        style: { touchAction: "none" as const, cursor: dragging === key ? "grabbing" : "grab" },
        onPointerDown(e: React.PointerEvent<HTMLElement>) {
          if (e.button !== 0 || (e.target as HTMLElement).closest("input, [data-no-drag]")) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Capture is a nicety (keeps moves coming when the pointer leaves the row); the drag works without it.
          }
          drag.current = { key, moved: false, x: e.clientX, y: e.clientY };
        },
        onPointerMove(e: React.PointerEvent<HTMLElement>) {
          const d = drag.current;
          if (!d) return;
          if (!d.moved) {
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
            d.moved = true;
            setDragging(d.key);
          }
          const over = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest(`[data-reorder^="${group}:"]`)
            ?.getAttribute("data-reorder")
            ?.slice(group.length + 1);
          if (over && over !== d.key) onReorder(moveKey(keysRef.current, d.key, over));
        },
        onPointerUp: end,
        onPointerCancel: end,
        // A drag that ends over a button must not also press it.
        onClickCapture(e: React.MouseEvent) {
          if (justDragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
      };
    },
  };
}
