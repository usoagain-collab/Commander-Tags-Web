"use client";

// Welcome tour (V3): rings the part of the editor each step is about and explains it in a card at the bottom of the
// screen, so it works the same on a phone. Next, Back and Skip; Escape skips. Finishing or skipping calls onDone,
// which remembers it (profiles.tag_view.tourSeen) so it shows once.
import { useEffect, useLayoutEffect, useState } from "react";
import { findTarget, TOUR_STEPS } from "@/lib/tour/steps";

type Box = { top: number; left: number; width: number; height: number };

export function WelcomeTour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;

  // Bring the step's target into view, then keep the ring on it while the page scrolls or resizes.
  useLayoutEffect(() => {
    const el = findTarget(document, step.target);
    if (!el) return setBox(null);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const place = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <>
      {box && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-xl ring-4 ring-gold transition-all duration-200"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.35)" }}
        />
      )}
      <div role="dialog" aria-modal="false" aria-labelledby="tour-title" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <div className="panel w-full max-w-md bg-background p-4 shadow-xl">
          <p className="text-xs opacity-60">
            Quick tour · {i + 1} of {TOUR_STEPS.length}
          </p>
          <h2 id="tour-title" className="display mt-1 text-lg">
            {step.title}
          </h2>
          <p className="mt-1 text-sm opacity-90">{step.text}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={onDone} className="min-h-11 px-2 text-sm underline opacity-70 hover:opacity-100">
              Skip tour
            </button>
            <div className="flex gap-2">
              {i > 0 && (
                <button type="button" onClick={() => setI(i - 1)} className="btn min-h-11">
                  Back
                </button>
              )}
              <button type="button" onClick={() => (last ? onDone() : setI(i + 1))} className="btn btn-gold min-h-11" autoFocus>
                {last ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
