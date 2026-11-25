// Settings sections (v2, Nov 25, 2026): the page used to be one long list of 11 settings. These group them, with a
// side menu on wide screens and a row of jump links on phones.

export const SETTINGS_GROUPS = [
  { id: "profile", title: "Profile" },
  { id: "look", title: "Look" },
  { id: "deck-building", title: "Deck building" },
  { id: "prices", title: "Prices" },
  { id: "account", title: "Email and account" },
] as const;

export function SettingsNav() {
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-24 lg:self-start">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {SETTINGS_GROUPS.map((g) => (
          <li key={g.id} className="shrink-0">
            <a
              href={`#${g.id}`}
              className="flex min-h-10 items-center rounded-lg border border-line px-3 text-sm whitespace-nowrap hover:bg-foreground/10 lg:border-transparent"
            >
              {g.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SettingsGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-foreground/10 pt-6 pb-4 first:border-t-0 first:pt-2">
      <h2 id={`${id}-title`} className="eyebrow">
        {title}
      </h2>
      {children}
    </section>
  );
}
