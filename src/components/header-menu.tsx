"use client";

// Phone header (stress test round 2, Nov 10, 2026): at 390 px the signed-in links were 417 px wide, so every page
// scrolled sideways and Sign out sat off-screen. Under 640 px they fold into this menu. The panel stays mounted and is
// only hidden, so the Feedback dialog inside it (a portal) survives the menu closing.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function HeaderMenu({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="header-menu"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 hover:text-gold"
      >
        {label}
        <span aria-hidden className="text-xl leading-none">{open ? "✕" : "☰"}</span>
        <span className="sr-only">Menu</span>
      </button>
      <div
        id="header-menu"
        hidden={!open}
        // A click on a link or button inside closes the menu (Feedback then opens its own dialog).
        onClick={(e) => (e.target as HTMLElement).closest("a,button") && setOpen(false)}
        className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-foreground/15 bg-background p-2 shadow-xl"
      >
        <div className="flex flex-col text-base [&>*]:flex [&>*]:min-h-12 [&>*]:w-full [&>*]:items-center [&>*]:rounded-lg [&>*]:px-3 [&>a:hover]:bg-foreground/5">
          {children}
        </div>
      </div>
    </div>
  );
}
