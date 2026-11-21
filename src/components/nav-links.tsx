"use client";

// Design refresh (option E, Nov 20, 2026): the header's main links are pills, and the page you're on is filled in.
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; title?: string };

/** True when `path` is the link's page or a page under it ("/decks/abc" is under "/decks"). */
export function isCurrent(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

export function NavLinks({ items, className = "" }: { items: NavItem[]; className?: string }) {
  const path = usePathname() ?? "";
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {items.map((item) => {
        const current = isCurrent(path, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.title}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full px-3 text-sm transition-colors ${
              current ? "bg-panel-raised font-semibold text-foreground" : "text-foreground/75 hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The logo mark: five stripes in role colors, the deck's genome in miniature. */
export function GenomeMark({ size = 20 }: { size?: number }) {
  const colors = ["#c9a26b", "#5fbf7f", "#5aa9e6", "#ef6a4f", "#b08be0"];
  return (
    <svg aria-hidden viewBox="0 0 19 20" width={(size * 19) / 20} height={size}>
      {colors.map((c, i) => (
        <rect key={c} x={i * 4} y="0" width="3" height="20" rx="1" fill={c} />
      ))}
    </svg>
  );
}
