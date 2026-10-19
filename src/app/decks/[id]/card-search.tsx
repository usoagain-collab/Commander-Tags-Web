"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryKey, type Board, type CardSummary, type Entries } from "@/lib/deck/model";
import {
  buildQuery,
  insertTag,
  rankTags,
  scryfallSearchUrl,
  tagTokenAt,
  type TagToken,
} from "@/lib/search/query";

/** The few fields we use from a Scryfall card object. */
type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  image_uris?: { normal?: string };
  card_faces?: { oracle_id?: string; image_uris?: { normal?: string } }[];
};
type ScryfallList = {
  data: ScryfallCard[];
  has_more: boolean;
  next_page?: string;
  total_cards: number;
  warnings?: string[]; // e.g. "Invalid expression “foo:bar” was ignored."
};
type Tag = { slug: string; label: string; size: number; description: string | null };

const oracleIdOf = (c: ScryfallCard) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
const imageOf = (c: ScryfallCard) => c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;

type Props = {
  entries: Entries;
  identity: Set<string> | null;
  commanderName: string | null;
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary | null) => void;
  onClose: () => void;
};

export function CardSearch({ entries, identity, commanderName, onAdd, onPreview, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [inIdentity, setInIdentity] = useState(true);
  const [legalOnly, setLegalOnly] = useState(true);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [sentQuery, setSentQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Tag autocomplete state
  const [token, setToken] = useState<TagToken | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTag, setActiveTag] = useState(0);
  const tagRequest = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  // ---------- Scryfall search ----------

  async function fetchPage(url: string, append: boolean) {
    setLoading(true);
    setError(null);
    if (!append) setWarnings([]);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = await res.json();
      if (res.status === 404) {
        // Scryfall answers "no results" with a 404; that's an empty list, not an error.
        if (!append) {
          setWarnings(body.warnings ?? []);
          setResults([]);
          setTotal(0);
          setNextPage(null);
        }
        return;
      }
      if (!res.ok) {
        setError(body.details ?? `Scryfall returned an error (${res.status}).`);
        return;
      }
      const list = body as ScryfallList;
      if (!append) setWarnings(list.warnings ?? []);
      await loadSummaries(list.data);
      setResults((prev) => (append ? [...prev, ...list.data] : list.data));
      setTotal(list.total_cards);
      setNextPage(list.has_more ? (list.next_page ?? null) : null);
    } catch {
      setError("Couldn't reach Scryfall. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Match Scryfall's results to our card table (copy limits, commander flag, prices, tags later). */
  async function loadSummaries(cards: ScryfallCard[]) {
    const ids = [...new Set(cards.map(oracleIdOf).filter((id): id is string => !!id))].filter((id) => !summaries[id]);
    const found: Record<string, CardSummary> = {};
    for (let i = 0; i < ids.length; i += 60) {
      const { data } = await supabase.from("card_summaries").select("*").in("oracle_id", ids.slice(i, i + 60));
      for (const c of (data ?? []) as CardSummary[]) found[c.oracle_id] = c;
    }
    setSummaries((prev) => ({ ...prev, ...found }));
  }

  function search() {
    const q = buildQuery(text, { identity, inIdentity, legalOnly });
    if (!text.trim()) return;
    setSentQuery(q);
    setToken(null);
    void fetchPage(scryfallSearchUrl(q), false);
  }

  // ---------- tag autocomplete ----------

  function updateToken() {
    const el = inputRef.current;
    if (!el) return;
    setToken(tagTokenAt(el.value, el.selectionStart ?? el.value.length));
  }

  useEffect(() => {
    if (!token) {
      setTags([]);
      return;
    }
    const id = ++tagRequest.current;
    const timer = setTimeout(async () => {
      let query = supabase.from("tags").select("slug, label, size, description").eq("kind", token.kind);
      if (token.partial) query = query.ilike("slug", `%${token.partial}%`);
      const { data } = await query.order("size", { ascending: false }).limit(40);
      if (id !== tagRequest.current) return;
      setTags(rankTags((data ?? []) as Tag[], token.partial).slice(0, 8));
      setActiveTag(0);
    }, 100);
    return () => clearTimeout(timer);
  }, [token, supabase]);

  function pickTag(tag: Tag) {
    if (!token) return;
    const { text: next, caret } = insertTag(text, token, tag.slug);
    setText(next);
    setToken(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const open = token && tags.length > 0;
    if (open && e.key === "ArrowDown") {
      e.preventDefault();
      setActiveTag((i) => Math.min(i + 1, tags.length - 1));
    } else if (open && e.key === "ArrowUp") {
      e.preventDefault();
      setActiveTag((i) => Math.max(i - 1, 0));
    } else if (open && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      pickTag(tags[activeTag]);
    } else if (e.key === "Escape") {
      setToken(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  }

  // ---------- render ----------

  const inDeck = (id: string) =>
    (entries[entryKey("commander", id)] ?? 0) + (entries[entryKey("main", id)] ?? 0) + (entries[entryKey("companion", id)] ?? 0);

  return (
    <section className="mt-6 rounded-lg border border-foreground/15 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Search cards</h2>
        <button onClick={onClose} aria-label="Close search" className="opacity-60 hover:opacity-100">
          ✕
        </button>
      </div>

      <div className="relative flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            requestAnimationFrame(updateToken);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && updateToken()}
          onClick={updateToken}
          onBlur={() => setTimeout(() => setToken(null), 150)}
          placeholder="Scryfall search, e.g. otag:ramp t:creature mv<=3"
          aria-label="Scryfall search"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={search}
          disabled={loading || !text.trim()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Search
        </button>

        {token && tags.length > 0 && (
          <ul
            role="listbox"
            aria-label={token.kind === "oracle" ? "Oracle tags" : "Art tags"}
            className="absolute left-0 top-full z-20 mt-1 max-h-80 w-full max-w-xl overflow-auto rounded-md border border-foreground/15 bg-background text-sm shadow-lg"
          >
            {tags.map((t, i) => (
              <li
                key={t.slug}
                role="option"
                aria-selected={i === activeTag}
                title={t.description ?? undefined}
                onMouseEnter={() => setActiveTag(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickTag(t);
                }}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 ${
                  i === activeTag ? "bg-foreground/10" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono">{t.slug}</span>
                  {t.description && <span className="ml-2 text-xs opacity-60">{t.description}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums opacity-60">{t.size.toLocaleString()} cards</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
        {identity && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={inIdentity} onChange={(e) => setInIdentity(e.target.checked)} />
            Only {commanderName ? `${commanderName}'s` : "commander"} colors
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} />
          Commander-legal paper cards
        </label>
        <span className="opacity-70">
          Type <code>otag:</code> or <code>art:</code> for tag suggestions ·{" "}
          <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer" className="underline">
            syntax guide
          </a>
        </span>
      </div>

      {sentQuery && (
        <p className="mt-3 text-xs opacity-60">
          Searched <code className="font-mono">{sentQuery}</code>
          {total !== null &&
            ` · ${total.toLocaleString()} ${total === 1 ? "card" : "cards"}${total > 1 ? ", most played first" : ""}`}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Scryfall: {w}
        </p>
      ))}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {total === 0 && !error && <p className="mt-3 text-sm opacity-70">No cards match that search.</p>}

      {results.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {results.map((sf) => {
            const id = oracleIdOf(sf);
            const card = id ? summaries[id] : undefined;
            const have = id ? inDeck(id) : 0;
            return (
              <li key={sf.id} className="flex flex-col gap-1.5" onMouseEnter={() => card && onPreview(card)}>
                <div className="relative">
                  {imageOf(sf) ? (
                    <img
                      src={imageOf(sf)}
                      alt={sf.name}
                      loading="lazy"
                      width={244}
                      height={340}
                      className="w-full rounded-[4.75%/3.5%]"
                    />
                  ) : (
                    <div className="flex aspect-[63/88] items-center justify-center rounded-lg border border-foreground/15 p-2 text-center text-xs">
                      {sf.name}
                    </div>
                  )}
                  {have > 0 && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-green-700 px-1.5 py-0.5 text-xs font-medium text-white">
                      In deck{have > 1 ? ` ×${have}` : ""}
                    </span>
                  )}
                </div>
                {card ? (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <button
                      onClick={() => onAdd(card, "main")}
                      title={`Add ${card.name} to the mainboard`}
                      className="rounded border border-foreground/20 px-1.5 py-0.5 hover:bg-foreground/10"
                    >
                      + Main
                    </button>
                    <button
                      onClick={() => onAdd(card, "maybe")}
                      title={`Add ${card.name} to the maybeboard`}
                      className="rounded border border-foreground/20 px-1.5 py-0.5 hover:bg-foreground/10"
                    >
                      + Maybe
                    </button>
                    {card.can_be_commander && (
                      <button
                        onClick={() => onAdd(card, "commander")}
                        title={`Make ${card.name} your commander`}
                        className="rounded border border-foreground/20 px-1.5 py-0.5 hover:bg-foreground/10"
                      >
                        ♛
                      </button>
                    )}
                    <span className="ml-auto tabular-nums opacity-60">
                      {card.price_usd != null ? `$${Number(card.price_usd).toFixed(2)}` : ""}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs opacity-60" title="Our card data refreshes daily; new cards appear the next day.">
                    Not in our card data yet
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextPage && (
        <button
          onClick={() => fetchPage(nextPage, true)}
          disabled={loading}
          className="mt-4 rounded-md border border-foreground/20 px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Loading…" : `Show more (${results.length} of ${total?.toLocaleString()})`}
        </button>
      )}
      {loading && !nextPage && <p className="mt-3 text-sm opacity-60">Searching Scryfall…</p>}
    </section>
  );
}
