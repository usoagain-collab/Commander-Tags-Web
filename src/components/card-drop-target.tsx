"use client";

// Drag a card image from a Scryfall tab onto a page that keeps a list of cards (Collection, Wish list).
// While dragging, one big target says where the card goes; dropping anywhere on the page counts.
// The deck page has its own three-zone version (`decks/[id]/drop-overlay.tsx`).
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CardSummary } from "@/lib/deck/model";
import type { ChosenPrinting } from "@/lib/deck/printing";
import { looksDroppable, readDrop } from "@/lib/drop/scryfall-drop";
import { resolveDrop } from "@/lib/drop/resolve";

type Props = {
  /** "Add to your collection" */
  label: string;
  hint?: string;
  onCard: (card: CardSummary, printing?: ChosenPrinting) => void | Promise<void>;
  onMessage: (msg: string) => void;
};

export function CardDropTarget({ label, hint, onCard, onMessage }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0); // dragenter/dragleave fire for every child element, so count them

  async function handle(data: DataTransfer) {
    const ref = readDrop(data);
    if (!ref) return onMessage("That doesn't look like a card. Drag a card image from Scryfall.");
    setBusy(true);
    try {
      const result = await resolveDrop(ref, supabase);
      if (result.ok) await onCard(result.card, result.printing);
      else onMessage(result.reason);
    } finally {
      setBusy(false);
    }
  }
  // The window listeners are added once; this ref lets them call the latest handle().
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setVisible(false);
    };
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer || !looksDroppable(e.dataTransfer.types)) return;
      depth.current++;
      setVisible(true);
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) reset();
    };
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer || !looksDroppable(e.dataTransfer.types)) return;
      e.preventDefault(); // allows dropping here
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer || !looksDroppable(e.dataTransfer.types)) return;
      // Text dropped into a box (the add-card search, the import box) stays plain typing.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return reset();
      e.preventDefault(); // stop the browser opening the dragged link
      reset();
      void handleRef.current(e.dataTransfer);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  if (busy) {
    return (
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gold px-4 py-2 text-sm text-gold-ink shadow-lg">
        Adding card…
      </div>
    );
  }
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="flex h-48 w-full max-w-xl flex-col items-center justify-center rounded-xl border-2 border-dashed border-gold p-4 text-center">
        <span className="text-lg font-semibold">{label}</span>
        <span className="mt-1 text-xs opacity-70">{hint ?? "Drop the card anywhere on the page"}</span>
      </div>
    </div>
  );
}
