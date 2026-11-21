// One public deck as a tile (Browse and the home page): commander art, name, colors, bracket, and the commanders,
// each linking to its Commander page. The whole top half opens the deck.
import Link from "next/link";
import { ManaSymbol } from "@/components/mana-cost";
import { ArtCredit } from "@/components/art-credit";
import { BRACKETS } from "@/lib/brackets/rules";
import type { DeckTile } from "@/lib/browse/public-decks";

/** "3 days ago", so the home page shows the site is in use. */
export function editedAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PublicDeckTile({ deck, showAge = false }: { deck: DeckTile; showAge?: boolean }) {
  const art = deck.commanders.find((c) => c.art);
  const bracket = BRACKETS.find((b) => b.n === deck.bracket);
  return (
    <li className="panel card-lift overflow-hidden">
      <Link href={`/decks/${deck.id}`} className="block hover:opacity-90">
        <div className="relative aspect-[16/9] bg-foreground/10">
          {art?.art && <img src={art.art} alt="" className="h-full w-full object-cover" loading="lazy" />}
        </div>
        <div className="p-3">
          <p className="font-medium">{deck.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
            <span className="flex gap-0.5">
              {(deck.identity.length ? deck.identity : ["C"]).map((c) => (
                <ManaSymbol key={c} symbol={c} size={14} />
              ))}
            </span>
            {bracket && <span>Bracket {bracket.n}</span>}
            {deck.precon && <span>Precon</span>}
            {showAge && !deck.precon && <span>Edited {editedAgo(deck.updated_at)}</span>}
            {deck.needsHelp && <span className="rounded bg-gold px-1.5 text-gold-ink">Wants feedback</span>}
          </p>
        </div>
      </Link>
      <p className="px-3 pb-1 text-sm opacity-80">
        {deck.commanders.map((c, i) => (
          <span key={c.oracle_id}>
            {i > 0 && " & "}
            <Link href={`/commanders/${c.oracle_id}`} className="hover:underline">
              {c.name}
            </Link>
          </span>
        ))}
      </p>
      {art?.art && <ArtCredit artists={[art.artist]} className="px-3 pb-2 text-[11px] opacity-60" />}
    </li>
  );
}
