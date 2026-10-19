"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BOARD_LABELS, type Board, type CardSummary } from "@/lib/deck/model";
import { looksDroppable, readDrop } from "@/lib/drop/scryfall-drop";
import { resolveDrop } from "@/lib/drop/resolve";

type Props = {
  onCard: (card: CardSummary, board: Board) => void;
  onMessage: (msg: string) => void;
};

const ZONES: { board: Board; hint: string }[] = [
  { board: "main", hint: "Drop here, or anywhere outside the boxes" },
  { board: "maybe", hint: "Cards you're considering" },
  { board: "commander", hint: "Legendary creatures and backgrounds" },
];

/**
 * Drag a card image from a Scryfall tab onto the deck page: while dragging, three drop targets appear.
 * Dropping anywhere else on the page adds to the mainboard.
 */
export function DropOverlay({ onCard, onMessage }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [visible, setVisible] = useState(false);
  const [over, setOver] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0); // dragenter/dragleave fire for every child element, so count them

  async function handle(data: DataTransfer, board: Board) {
    const ref = readDrop(data);
    if (!ref) {
      onMessage("That doesn't look like a card. Drag a card image from Scryfall.");
      return;
    }
    setBusy(true);
    const result = await resolveDrop(ref, supabase);
    setBusy(false);
    if (result.ok) onCard(result.card, board);
    else onMessage(result.reason);
  }
  // The window listeners below are added once; this ref lets them call the latest handle(), which sees
  // the current deck (an old copy would check copy limits against the deck as it was at page load).
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setVisible(false);
      setOver(null);
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
      e.preventDefault(); // stop the browser opening the dragged link
      reset();
      void handleRef.current(e.dataTransfer, "main");
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
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
        Adding card…
      </div>
    );
  }
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {ZONES.map(({ board, hint }) => (
          <div
            key={board}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(board);
            }}
            onDragLeave={() => setOver((b) => (b === board ? null : b))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation(); // the window handler would otherwise add it to the mainboard too
              depth.current = 0;
              setVisible(false);
              setOver(null);
              void handle(e.dataTransfer, board);
            }}
            className={`flex h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
              over === board ? "border-foreground bg-foreground/10" : "border-foreground/30"
            }`}
          >
            <span className="text-lg font-semibold">Add to {BOARD_LABELS[board].toLowerCase()}</span>
            <span className="mt-1 text-xs opacity-60">{hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
