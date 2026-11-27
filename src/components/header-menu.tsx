"use client";

// A small dropdown for the site header. Phones (stress test round 2, Nov 10, 2026): at 390 px the signed-in links were
// 417 px wide, so every page scrolled sideways; under 768 px they fold into this menu. Since the design refresh (option E,
// Nov 20, 2026) wide screens use it too, as the account menu under the profile picture. The panel stays mounted and is
// only hidden, so the Feedback dialog inside it (a portal) survives the menu closing.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function HeaderMenu({
  label,
  children,
  menuLabel = "Menu",
  burger = true,
  className = "relative",
  id = "header-menu",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Read by screen readers on the button. */
  menuLabel?: string;
  /** Show the ☰ / ✕ next to the label. */
  burger?: boolean;
  className?: string;
  id?: string;
}) {
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
    <div ref={box} className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1"
      >
        {label}
        {burger && <span aria-hidden className="text-xl leading-none">{open ? "✕" : "☰"}</span>}
        <span className="sr-only">{menuLabel}</span>
      </button>
      <div
        id={id}
        hidden={!open}
        // A click on a link or button inside closes the menu (Feedback then opens its own dialog).
        onClick={(e) => (e.target as HTMLElement).closest("a,button") && setOpen(false)}
        className="absolute right-0 top-full z-50 mt-1 w-60 rounded-2xl border border-line bg-panel p-2 shadow-xl"
      >
        <div className="flex flex-col text-base [&>*]:flex [&>*]:min-h-12 [&>*]:w-full [&>*]:items-center [&>*]:rounded-xl [&>*]:px-3 [&>a:hover]:bg-foreground/5">
          {children}
        </div>
      </div>
    </div>
  );
}
