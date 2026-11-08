"use client";

// Drag to reorder a list with pointer events, so a mouse and a finger work the same way (HTML5 drag only starts
// after a long press on touch screens). The whole row is the handle; the list reorders live as the pointer passes
// over other rows. Sliders and anything marked data-no-drag keep their own gestures.
//
// Touch (David, Nov 8, 2026: dragging on a phone was too easy and blocked scrolling): a row picks up only after
// the finger rests on it for HOLD_MS without moving, like rearranging apps on a phone. Until then the row lets the
// page scroll (touch-action pan-y), and any movement first means a scroll. A mouse drags after a few pixels.
import { useEffect, useRef, useState } from "react";
import { moveKey } from "@/lib/tags/order";

export const HOLD_MS = 400;
/** A finger that moves this far before the hold ends is scrolling, not picking up. */
const HOLD_SLOP = 8;

type Drag = { key: string; moved: boolean; x: number; y: number; touch: boolean; armed: boolean; timer?: number };

export function useDragReorder(group: string, keys: string[], onReorder: (keys: string[]) => void, enabled: boolean) {
  const drag = useRef<Drag | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [dragging, setDragging] = useState<string | null>(null);
  // Set while the click that follows a drag's pointerup is still on its way.
  const justDragged = useRef(false);

  // While a touch drag is armed, stop the page from scrolling under the finger. React's touch handlers are
  // passive, so this has to be a native listener.
  useEffect(() => {
    const stop = (e: TouchEvent) => {
      if (drag.current?.armed) e.preventDefault();
    };
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, []);

  const end = () => {
    const d = drag.current;
    if (d?.timer) clearTimeout(d.timer);
    // After a drag, or a hold that picked a row up, the click that follows mustn't press the row's button.
    if (d?.moved || (d?.touch && d.armed)) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
    }
    drag.current = null;
    setDragging(null);
  };

  const moveTo = (d: Drag, x: number, y: number) => {
    const over = document
      .elementFromPoint(x, y)
      ?.closest(`[data-reorder^="${group}:"]`)
      ?.getAttribute("data-reorder")
      ?.slice(group.length + 1);
    if (over && over !== d.key) onReorder(moveKey(keysRef.current, d.key, over));
  };

  return {
    dragging,
    rowProps(key: string) {
      if (!enabled) return {};
      return {
        "data-reorder": `${group}:${key}`,
        style: {
          // Touch rows let the page scroll until a hold picks one up; the picked-up row keeps the finger.
          touchAction: dragging === key ? ("none" as const) : ("pan-y" as const),
          cursor: dragging === key ? "grabbing" : "grab",
          WebkitUserSelect: "none" as const,
          userSelect: "none" as const,
          WebkitTouchCallout: "none" as const,
        },
        onContextMenu(e: React.MouseEvent) {
          // A long press would otherwise open the phone's own menu.
          if (drag.current?.touch) e.preventDefault();
        },
        onPointerDown(e: React.PointerEvent<HTMLElement>) {
          if (e.button !== 0 || (e.target as HTMLElement).closest("input, [data-no-drag]")) return;
          const touch = e.pointerType !== "mouse";
          const d: Drag = { key, moved: false, x: e.clientX, y: e.clientY, touch, armed: !touch };
          drag.current = d;
          if (touch) {
            d.timer = window.setTimeout(() => {
              if (drag.current !== d) return;
              d.armed = true;
              setDragging(key);
              navigator.vibrate?.(10);
            }, HOLD_MS);
          } else {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Capture is a nicety (keeps moves coming when the pointer leaves the row); the drag works without it.
            }
          }
        },
        onPointerMove(e: React.PointerEvent<HTMLElement>) {
          const d = drag.current;
          if (!d) return;
          const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
          if (!d.armed) {
            // A finger moving before the hold ends is a scroll: let it go.
            if (d.touch && far > HOLD_SLOP) end();
            return;
          }
          if (!d.moved) {
            if (!d.touch && far < 6) return;
            d.moved = true;
            setDragging(d.key);
          }
          moveTo(d, e.clientX, e.clientY);
        },
        onPointerUp: end,
        // The browser cancels the pointer when it takes the touch for a scroll.
        onPointerCancel: end,
        // A drag that ends over a button must not also press it; neither does a hold that picked a row up.
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
