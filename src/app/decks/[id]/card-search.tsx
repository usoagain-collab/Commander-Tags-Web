"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryKey, type Board, type CardSummary, type Entries } from "@/lib/deck/model";
import { importCard } from "@/lib/scryfall/import-card";
import {
  buildQuery,
  isPlainWords,
  widenPlainWords,
  insertTag,
  rankTags,
  scryfallSearchUrl,
  tagTokenAt,
  type TagToken,
} from "@/lib/search/query";
import {
  appendSyntax,
  CHEAT_SHEET,
  EMPTY_FILTERS,
  EXAMPLES,
  filterSyntax,
  quote,
  SORTS,
  sortNote,
  type FilterForm,
  type SearchOrder,
  type SortDir,
} from "@/lib/search/filters";
import { loadCatalog, matchCatalog } from "@/lib/scryfall/catalog";
import { wordingQuery } from "@/lib/search/wording";
import { WordingChips } from "./wording-ui";
import { FiltersBox } from "./filters-box";
import { HiddenNote, RESULT_GRID, ResultCard, ShowingChip, type HiddenReason } from "./result-card";

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
/** An autocomplete choice: a tag from our data, or (size 0) a type, keyword or set from Scryfall's catalogs. */
type Tag = { slug: string; label: string; size: number; description: string | null };

const oracleIdOf = (c: ScryfallCard) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
const imageOf = (c: ScryfallCard) => c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;

type Props = {
  entries: Entries;
  identity: Set<string> | null;
  commanderName: string | null;
  onAdd: (card: CardSummary, board: Board) => void;
  /** Wish list (v2): mark and toggle cards on your list. */
  wish?: { has: (oracleId: string) => boolean; toggle: (oracleId: string) => void };
  /** Not for this deck: hidden from search results too, unless shown; the same list Suggested uses. */
  dismissed?: { has: (oracleId: string) => boolean; toggle: (card: CardSummary) => void };
  /** Collection tracking (v2): copies you own of a card, when you track a collection. */
  ownedOf?: (oracleId: string) => number;
  onPreview: (card: CardSummary | null) => void;
  /** Opens the card sheet on one result; Prev / Next step through `list`. */
  onOpen: (list: CardSummary[], index: number) => void;
  /** "Hide cards in deck" (remembered with the other view settings). */
  hideInDeck: boolean;
  onHideInDeck: (hide: boolean) => void;
  /** "Include banned and preview cards" (remembered; the commander picker shares it). */
  withBanned: boolean;
  onWithBanned: (on: boolean) => void;
  /** Text handed over from quick add's "See all results", a phrase chip or an angle: filled in and searched on opening. */
  initialText?: string;
  /** What that search is, in words ("Cards that say …"), for the Showing line. */
  initialLabel?: string;
  /** Search by wording (v2): phrases from the commander's rules text, shown as tap-to-search chips. */
  wording?: string[];
};

export function CardSearch({ entries, identity, commanderName, onAdd, onPreview, onOpen, hideInDeck, onHideInDeck, withBanned, onWithBanned, initialText, initialLabel, wording = [], wish, dismissed, ownedOf }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText ?? "");
  const [inIdentity, setInIdentity] = useState(true);
  const [legalOnly, setLegalOnly] = useState(true);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [sentQuery, setSentQuery] = useState<string | null>(null);
  // What the box held when it was sent, and a label for it when the search came from a chip or example.
  const [sentText, setSentText] = useState("");
  const [label, setLabel] = useState<{ text: string; label: string } | null>(initialText && initialLabel ? { text: initialText.trim(), label: initialLabel } : null);
  // Plain words were widened to names or rules text: say that in words rather than showing the syntax.
  const [sentPlain, setSentPlain] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // v2 (Nov 8, 2026): sort order, and the Filters drawer that writes syntax into the box.
  const [order, setOrder] = useState<SearchOrder>("edhrec");
  const [dir, setDir] = useState<SortDir>("auto");
  const [sentOrder, setSentOrder] = useState<{ order: SearchOrder; dir: SortDir }>({ order: "edhrec", dir: "auto" });
  const [filters, setFilters] = useState<FilterForm>(EMPTY_FILTERS);

  // Tag autocomplete state
  const [token, setToken] = useState<TagToken | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTag, setActiveTag] = useState(0);
  const tagRequest = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialText?.trim()) search();
    // Only on opening: later searches start from the Search button or Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // An odd number of quotes is the usual reason a query finds nothing, and Scryfall doesn't say so.
          const quotes = (decodeURIComponent(url).match(/"/g) ?? []).length;
          setWarnings([...(body.warnings ?? []), ...(quotes % 2 ? ["Your search has an unmatched quote mark."] : [])]);
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
      // Show Scryfall's results right away; the add buttons appear as each card is matched to our data.
      setResults((prev) => (append ? [...prev, ...list.data] : list.data));
      setTotal(list.total_cards);
      setNextPage(list.has_more ? (list.next_page ?? null) : null);
      setLoading(false);
      setMatching(true);
      await loadSummaries(list.data);
    } catch {
      setError("Couldn't reach Scryfall. Check your connection and try again.");
    } finally {
      setLoading(false);
      setMatching(false);
    }
  }

  /** Match Scryfall's results to our card table (copy limits, commander flag, prices, tags later). */
  async function loadSummaries(cards: ScryfallCard[]) {
    const ids = [...new Set(cards.map(oracleIdOf).filter((id): id is string => !!id))].filter((id) => !summaries[id]);
    const found: Record<string, CardSummary> = {};
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 60) batches.push(ids.slice(i, i + 60));
    // A page has up to 175 cards: the batches go out together rather than one after another.
    const results = await Promise.all(batches.map((b) => supabase.from("card_summaries").select("*").in("oracle_id", b)));
    for (const { data } of results) for (const c of (data ?? []) as CardSummary[]) found[c.oracle_id] = c;
    setSummaries((prev) => ({ ...prev, ...found }));
  }

  function search(typed = text, sort = { order, dir }) {
    const q = buildQuery(widenPlainWords(typed), { identity, inIdentity, legalOnly, withBanned });
    if (!typed.trim()) return;
    setSentQuery(q);
    setSentText(typed.trim());
    setSentPlain(isPlainWords(typed) ? typed.trim() : null);
    setSentOrder(sort);
    setToken(null);
    void fetchPage(scryfallSearchUrl(q, sort.order, sort.dir), false);
  }

  /** A new sort re-runs the last search straight away. */
  function changeSort(next: { order: SearchOrder; dir: SortDir }) {
    setOrder(next.order);
    setDir(next.dir);
    if (sentQuery && text.trim()) search(text, next);
  }

  /** Filters drawer: put the built syntax after what's typed, and search. */
  function addFilters() {
    const next = appendSyntax(text, filterSyntax(filters));
    setText(next);
    setFilters(EMPTY_FILTERS);
    search(next);
  }

  /** A chip or example: search it, and say what it is in words. */
  function runExample(query: string, named?: string) {
    setText(query);
    setLabel(named ? { text: query.trim(), label: named } : null);
    search(query);
  }

  /** ✕ on the Showing line: back to an empty box. */
  function clearSearch() {
    setText("");
    setLabel(null);
    setSentQuery(null);
    setSentText("");
    setResults([]);
    setTotal(null);
    setNextPage(null);
    setWarnings([]);
    setError(null);
    inputRef.current?.focus();
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
      if (token.kind === "type" || token.kind === "keyword" || token.kind === "set") {
        const items = await loadCatalog(token.kind).catch(() => []);
        if (id !== tagRequest.current) return;
        setTags(matchCatalog(items, token.partial).map((it) => ({ slug: it.value, label: it.value, size: 0, description: it.hint ?? null })));
        setActiveTag(0);
        return;
      }
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
    // Types and keywords with spaces need quotes (t:"time lord"); set codes and tag slugs go in as they are.
    const value = token.kind === "type" || token.kind === "keyword" ? quote(tag.slug) : tag.slug;
    const { text: next, caret } = insertTag(text, token, value);
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
  // Moxfield's #3 request: optionally hide results that are already in the deck. Filtered here rather than
  // in the Scryfall query, which can't know what's in this deck.
  const isInDeck = (sf: ScryfallCard) => {
    const id = oracleIdOf(sf);
    return !!id && inDeck(id) > 0;
  };
  const [onlyOwned, setOnlyOwned] = useState(false);
  const isOwned = (sf: ScryfallCard) => {
    const id = oracleIdOf(sf);
    return !!id && !!ownedOf && ownedOf(id) > 0;
  };
  const [showDismissed, setShowDismissed] = useState(false);
  const isDismissed = (sf: ScryfallCard) => {
    const id = oracleIdOf(sf);
    return !!id && !!dismissed?.has(id);
  };
  const shown = results.filter(
    (sf) => (!hideInDeck || !isInDeck(sf)) && (!onlyOwned || !ownedOf || isOwned(sf)) && (showDismissed || !isDismissed(sf)),
  );
  const hiddenCount = results.length - shown.length;
  // What the list leaves out, each with its own way back (counted per reason, so a card can count twice).
  const plural = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;
  const nDismissed = results.filter(isDismissed).length;
  const nInDeck = hideInDeck ? results.filter(isInDeck).length : 0;
  const nUnowned = onlyOwned && ownedOf ? results.filter((sf) => !isOwned(sf)).length : 0;
  const hiddenReasons: HiddenReason[] = [
    ...(nDismissed && !showDismissed
      ? [{ text: `${plural(nDismissed)} you marked Not for this deck`, action: { label: "Show", onClick: () => setShowDismissed(true) } }]
      : nDismissed
        ? [{ text: `Showing ${plural(nDismissed)} you marked Not for this deck`, action: { label: "Hide", onClick: () => setShowDismissed(false) } }]
        : []),
    ...(nInDeck ? [{ text: `${plural(nInDeck)} already in your deck`, action: { label: "Show", onClick: () => onHideInDeck(false) } }] : []),
    ...(nUnowned ? [{ text: `${plural(nUnowned)} you don't own`, action: { label: "Show", onClick: () => setOnlyOwned(false) } }] : []),
  ];

  // The cards the sheet steps through: results we've matched to our data, in screen order.
  const openable = shown.map((sf) => oracleIdOf(sf)).flatMap((id) => (id && summaries[id] ? [summaries[id]] : []));
  const showingLabel =
    label && label.text === sentText ? (
      label.label
    ) : sentPlain ? (
      <span title={sentQuery ?? undefined}>cards whose name or rules text has “{sentPlain}”</span>
    ) : (
      <code className="break-all font-mono text-[13px]">{sentQuery}</code>
    );

  return (
    <div>
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
          placeholder="A name, words from the rules, or otag:ramp t:creature"
          aria-label="Search all cards"
          spellCheck={false}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3"
        />
        <button type="button" onClick={() => search()} disabled={loading || !text.trim()} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
          Search
        </button>

        {token && tags.length > 0 && (
          <ul
            role="listbox"
            aria-label={{ oracle: "Oracle tags", art: "Art tags", type: "Card types", keyword: "Keywords", set: "Sets" }[token.kind]}
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
                {t.size > 0 && <span className="shrink-0 text-xs tabular-nums opacity-60">{t.size.toLocaleString()} cards</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="opacity-70">Sort</span>
          <select
            value={order}
            onChange={(e) => changeSort({ order: e.target.value as SearchOrder, dir })}
            aria-label="Sort results by"
            className="min-h-11 rounded-lg border border-foreground/20 bg-background px-2"
          >
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => changeSort({ order, dir: dir === "auto" ? "desc" : dir === "desc" ? "asc" : "auto" })}
          title="Change the direction"
          className="min-h-11 rounded-lg border border-foreground/20 px-3 hover:bg-foreground/10"
        >
          ⇅ {sortNote(order, dir)}
        </button>
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-foreground/20 px-3 hover:bg-foreground/10" title="Search syntax cheat sheet">
            ? Syntax
          </summary>
          <div className="absolute right-0 top-full z-20 mt-1 w-[min(26rem,calc(100vw-3rem))] rounded-lg border border-foreground/15 bg-background p-3 text-xs shadow-lg sm:left-0 sm:right-auto">
            <table className="w-full">
              <tbody>
                {CHEAT_SHEET.map((r) => (
                  <tr key={r.syntax} className="align-top">
                    <td className="whitespace-nowrap py-1 pr-3 font-mono">{r.syntax}</td>
                    <td className="py-1 opacity-80">{r.means}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 opacity-80">
              Type <code>otag:</code>, <code>art:</code>, <code>t:</code>, <code>kw:</code> or <code>s:</code> in the box for suggestions.
            </p>
            <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline opacity-80">
              Full syntax guide on Scryfall
            </a>
          </div>
        </details>
      </div>

      <FiltersBox
        fields={["types", "colors", "text", "mv", "price", "keyword", "set", "since", "instantSpeed", "noReserved"]}
        draft={filters}
        onDraft={(next) => setFilters(next)}
        applyLabel="Add to search"
        hint="build a search without the syntax"
        onApply={addFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
        {identity && (
          <label className="flex min-h-9 items-center gap-1.5">
            <input type="checkbox" checked={inIdentity} onChange={(e) => setInIdentity(e.target.checked)} />
            Only {commanderName ? `${commanderName}${commanderName.endsWith("s") ? "'" : "'s"}` : "commander"} colors
          </label>
        )}
        <label className="flex min-h-9 items-center gap-1.5">
          <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} />
          Commander-legal paper cards
        </label>
        {legalOnly && (
          <label className="flex min-h-9 items-center gap-1.5" title="Also show cards banned in Commander, and new cards that aren't released yet">
            <input type="checkbox" checked={withBanned} onChange={(e) => onWithBanned(e.target.checked)} />
            Include banned and preview cards
          </label>
        )}
        <label className="flex min-h-9 items-center gap-1.5">
          <input type="checkbox" checked={hideInDeck} onChange={(e) => onHideInDeck(e.target.checked)} />
          Hide cards in deck
        </label>
        {ownedOf && (
          <label className="flex min-h-9 items-center gap-1.5" title="Only cards in your collection">
            <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} />
            Hide cards I don&apos;t own
          </label>
        )}
      </div>

      {wording.length > 0 && (!text.trim() || wording.some((p) => wordingQuery(p) === text.trim())) && (
        <div className="mt-3 space-y-1.5 text-sm">
          <p className="text-xs opacity-60">
            Wording from {commanderName ?? "your commander"}: find cards that say the same thing (~ means the card&apos;s own name)
          </p>
          <WordingChips phrases={wording} active={text.trim()} onSearch={(q, phrase) => runExample(q, `cards that say “${phrase}”`)} />
        </div>
      )}

      {!sentQuery && !text.trim() && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs opacity-60">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.query}
              type="button"
              onClick={() => runExample(ex.query, ex.label.toLowerCase())}
              title={ex.query}
              className="min-h-11 rounded-full border border-foreground/20 px-3 hover:bg-foreground/10"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}

      {sentQuery && (
        <ShowingChip
          label={showingLabel}
          detail={
            total !== null
              ? `${total.toLocaleString()} ${total === 1 ? "card" : "cards"}${total > 1 ? `, ${sortNote(sentOrder.order, sentOrder.dir)}` : ""}`
              : loading
                ? "searching…"
                : undefined
          }
          onClear={clearSearch}
          clearLabel="Clear the search"
        />
      )}
      {sentQuery && (
        <HiddenNote reasons={hiddenReasons}>
          {shown.length === 0 && nextPage && hiddenCount > 0 && <p className="pb-1 text-xs opacity-75">Everything on this page is hidden. Show more loads the next page.</p>}
        </HiddenNote>
      )}
      {warnings.map((w) => (
        <p key={w} className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Scryfall: {w}
        </p>
      ))}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {total === 0 && !error && !loading && <p className="mt-3 text-sm opacity-70">No cards match that search.</p>}

      {shown.length > 0 && (
        <ul className={`mt-3 ${RESULT_GRID}`}>
          {shown.map((sf) => {
            const id = oracleIdOf(sf);
            const card = id ? summaries[id] : undefined;
            return (
              <ResultCard
                key={sf.id}
                name={sf.name}
                image={imageOf(sf)}
                card={card}
                inDeck={id ? inDeck(id) : 0}
                onPreview={() => card && onPreview(card)}
                onOpen={() => card && onOpen(openable, Math.max(0, openable.indexOf(card)))}
                onAdd={(board) => card && onAdd(card, board)}
                wish={wish && card ? { on: wish.has(card.oracle_id), toggle: () => wish.toggle(card.oracle_id) } : undefined}
                dismiss={dismissed && card ? { on: dismissed.has(card.oracle_id), toggle: () => dismissed.toggle(card) } : undefined}
                pending={
                  matching ? (
                    <p className="min-h-6 text-xs opacity-50">Matching…</p>
                  ) : (
                    <FetchNewCard
                      scryfallId={sf.id}
                      onFetched={(fetched) => {
                        setSummaries((s) => ({ ...s, [fetched.oracle_id]: fetched }));
                        onAdd(fetched, "main");
                      }}
                    />
                  )
                }
              />
            );
          })}
        </ul>
      )}

      {nextPage && (
        <button
          type="button"
          onClick={() => fetchPage(nextPage, true)}
          disabled={loading}
          className="mt-4 min-h-11 rounded-lg border border-foreground/20 px-4 text-sm disabled:opacity-50"
        >
          {loading ? "Loading…" : `Show more (${results.length} of ${total?.toLocaleString()})`}
        </button>
      )}
      {loading && !nextPage && <p className="mt-3 text-sm opacity-60">Searching Scryfall…</p>}
    </div>
  );
}

/**
 * A card that's on Scryfall but not in our nightly data yet (new spoilers): fetch it now and add it (Phase 7b).
 * Its tags come with the next nightly import.
 */
function FetchNewCard({ scryfallId, onFetched }: { scryfallId: string; onFetched: (card: CardSummary) => void }) {
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  return (
    <div className="text-xs">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await importCard(scryfallId);
          if (r.ok) {
            setState("idle");
            onFetched(r.card);
          } else setState(r.reason);
        }}
        title="This card is newer than our nightly card data. Fetch it from Scryfall and add it to the mainboard."
        className="min-h-10 w-full rounded-lg border border-foreground/20 px-2 hover:bg-foreground/10 disabled:opacity-50"
      >
        {state === "busy" ? "Fetching…" : "New card: fetch + add"}
      </button>
      {state !== "idle" && state !== "busy" && <p className="mt-1 text-red-400">{state}</p>}
    </div>
  );
}

