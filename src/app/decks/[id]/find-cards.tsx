"use client";

// Find cards (David, Nov 11, 2026): Suggest and Search were two drawers that looked and worked differently, and the
// phrase chips, angles and 💡 buttons each opened one or the other in its own way. Now there is one drawer with two
// tabs; every way in lands on one of them with a "Showing …" line that says what the list is.
import type { ReactNode } from "react";

export type FindTab = "suggest" | "search";

const ABOUT: Record<FindTab, string> = {
  suggest: "Cards picked for this deck by what they do: your roles, themes and your commander's wording.",
  search: "Every Commander card. Type a name, words from the rules text, or any Scryfall search.",
};

export function FindCards({ tab, onTab, onClose, children }: { tab: FindTab; onTab: (tab: FindTab) => void; onClose: () => void; children: ReactNode }) {
  return (
    <section aria-label="Find cards" className="mt-6 rounded-lg border border-foreground/15 p-4 lg:mt-0 lg:rounded-none lg:border-0 lg:px-0 lg:pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="display text-xl">Find cards</h2>
        <button type="button" onClick={onClose} aria-label="Close Find cards (Esc)" title="Close (Esc)" className="min-h-11 min-w-11 rounded-lg opacity-70 hover:bg-foreground/10 hover:opacity-100">
          ✕
        </button>
      </div>
      <div role="tablist" aria-label="How to find cards" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1">
        <TabButton on={tab === "suggest"} onClick={() => onTab("suggest")}>
          ✦ Suggested for this deck
        </TabButton>
        <TabButton on={tab === "search"} onClick={() => onTab("search")}>
          ⌕ Search all cards
        </TabButton>
      </div>
      <p className="mt-2 text-[13px] opacity-75">{ABOUT[tab]}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`min-h-11 rounded-lg px-2 text-sm font-medium ${on ? "bg-gold text-gold-ink shadow" : "opacity-80 hover:bg-foreground/10 hover:opacity-100"}`}
    >
      {children}
    </button>
  );
}
