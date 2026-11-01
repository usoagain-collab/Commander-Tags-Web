"use client";

// The full-screen frosted glass pane behind Bracket and Stats: locks the page behind it, Esc and a click on the
// empty glass close it.
import { useEffect, type ReactNode } from "react";

export function GlassOverlay({
  label,
  paused,
  onClose,
  onEscape,
  children,
}: {
  label: string;
  /** A card is open on top, so Esc belongs to it. */
  paused: boolean;
  onClose: () => void;
  /** Esc does this instead of closing, e.g. to step back out of a selection first. */
  onEscape?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !paused) (onEscape ?? onClose)();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [paused, onClose, onEscape]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 overflow-y-auto bg-background/70 p-4 backdrop-blur-xl sm:p-8"
    >
      {children}
    </div>
  );
}
