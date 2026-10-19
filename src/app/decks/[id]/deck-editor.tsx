"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  applyChange,
  BOARD_LABELS,
  deckIdentity,
  deckSize,
  linesFor,
  outsideIdentity,
  planAdd,
  planMove,
  planSetQuantity,
  toSaveRows,
  totalPrice,
  type Board,
  type CardSummary,
  type Change,
  type DeckLine,
  type Entries,
  type Plan,
} from "@/lib/deck/model";
import { groupLines, readViewSettings, sortLines, type ViewSettings } from "@/lib/deck/grouping";
import { useAutosave, type SaveStatus } from "@/lib/deck/use-autosave";
import { buildRoleDefs, customKey, roleCounts, roleStatus, type CustomRole } from "@/lib/tags/role-settings";
import { isLand, resolveRoles, rolesOf } from "@/lib/tags/roles";
import { useRoleSettings } from "@/lib/tags/use-role-settings";
import { useTagData } from "@/lib/tags/use-tag-data";
import { useArtTree } from "@/lib/tags/use-art-tree";
import {
  aKey,
  deckKeyCounts,
  readThemeSettings,
  splitKey,
  themeSettingsToSaved,
  themeTags,
  treeCard,
  type ThemeCard,
  type ThemeTag,
} from "@/lib/tags/themes";
import { roleNameFromLabel } from "@/lib/tags/role-settings";
import { assignSubgroups, landSubgroup, subgroupCandidates, subgroupTitle } from "@/lib/tags/role-subgroups";
import { createClient } from "@/lib/supabase/client";
import { CardPanel } from "./card-panel";
import { CardSearch } from "./card-search";
import { CardSheet } from "./card-sheet";
import { ExportPanel, ImportPanel } from "./deck-text-panel";
import { DeckToolbar, useHiddenTags, useTagViewPrefs } from "./deck-toolbar";
import { DeckView, type DeckItem, type ViewSection } from "./deck-views";
import { DropOverlay } from "./drop-overlay";
import { QuickAdd, type QuickAddHandle } from "./quick-add";
import { RoleProfile } from "./role-profile";
import { highlightValue, TopTags } from "./top-tags";
import { SummaryBar } from "./summary-bar";

type State = {
  entries: Entries;
  cards: Record<string, CardSummary>;
  past: Change[]; // undo stack
  future: Change[]; // redo stack
};

type Action =
  | { type: "apply"; change: Change; cards?: CardSummary[] }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 200;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "apply":
      return {
        entries: applyChange(state.entries, action.change),
        cards: action.cards
          ? { ...state.cards, ...Object.fromEntries(action.cards.map((c) => [c.oracle_id, c])) }
          : state.cards,
        past: [...state.past, action.change].slice(-HISTORY_LIMIT),
        future: [], // a new edit clears redo, like any editor
      };
    case "undo": {
      const change = state.past.at(-1);
      if (!change) return state;
      return {
        ...state,
        entries: applyChange(state.entries, change, "back"),
        past: state.past.slice(0, -1),
        future: [...state.future, change],
      };
    }
    case "redo": {
      const change = state.future.at(-1);
      if (!change) return state;
      return {
        ...state,
        entries: applyChange(state.entries, change),
        past: [...state.past, change],
        future: state.future.slice(0, -1),
      };
    }
  }
}

type Props = {
  deck: { id: string; name: string };
  initialEntries: Entries;
  initialCards: Record<string, CardSummary>;
  readOnly: boolean;
  savedTagView: Record<string, unknown>;
  hiddenTags: string[];
  userId: string | null;
  roleTargets: Record<string, number>;
  customRoles: CustomRole[];
  profileDefaults: { targets: Record<string, number>; custom: CustomRole[] };
};

export function DeckEditor({
  deck,
  initialEntries,
  initialCards,
  readOnly,
  savedTagView,
  hiddenTags,
  userId,
  roleTargets,
  customRoles,
  profileDefaults,
}: Props) {
  const [state, dispatch] = useReducer(reducer, {
    entries: initialEntries,
    cards: initialCards,
    past: [],
    future: [],
  });
  const { status, save, retry } = useAutosave(deck.id);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSummary | null>(null);
  const [sheet, setSheet] = useState<{ oracle_id: string; board: Board } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Remembered per user: View / Group / Sort and the top-tags switches (one writer), plus hidden tags.
  const [prefs, updatePrefs] = useTagViewPrefs(savedTagView, userId);
  const view = readViewSettings(prefs);
  const setView = (v: ViewSettings) => updatePrefs(v);
  const themeSettings = readThemeSettings(prefs);
  const [hidden, toggleHidden] = useHiddenTags(hiddenTags, userId);
  const quickAdd = useRef<QuickAddHandle>(null);

  const say = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 4000);
  }, []);

  /** Run a planned edit: update the screen, remember it for undo, queue it for saving. */
  const run = useCallback(
    (plan: Plan, card?: CardSummary): boolean => {
      if (!plan.ok) {
        if (plan.reason !== "No change.") say(plan.reason);
        return false;
      }
      dispatch({ type: "apply", change: plan.change, cards: card ? [card] : undefined });
      save(toSaveRows(plan.change));
      return true;
    },
    [save, say],
  );

  const [panel, setPanel] = useState<"search" | "import" | "export" | null>(null);

  /** A whole import is one change: one save call, one undo step. */
  const applyImport = useCallback(
    (change: Change, newCards: CardSummary[]) => {
      dispatch({ type: "apply", change, cards: newCards });
      save(toSaveRows(change));
      setPanel(null);
      say(`${change.label}. Ctrl+Z undoes the whole import.`);
    },
    [save, say],
  );

  const undo = useCallback(() => {
    const change = state.past.at(-1);
    if (!change) return;
    dispatch({ type: "undo" });
    save(toSaveRows(change, "back"));
    say(`Undid: ${change.label}`);
  }, [state.past, save, say]);

  const redo = useCallback(() => {
    const change = state.future.at(-1);
    if (!change) return;
    dispatch({ type: "redo" });
    save(toSaveRows(change));
    say(`Redid: ${change.label}`);
  }, [state.future, save, say]);

  // Keyboard: Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, "/" jumps to quick add.
  // Skipped while typing in a text box, so Ctrl+Z there still undoes typing.
  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        quickAdd.current?.focus();
      } else if (mod && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && !typing && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, undo, redo]);

  const { entries, cards } = state;

  // ---------- tags and roles ----------
  // Tags for every card we know about, plus whatever is being previewed (a search result, say).
  const tagIds = useMemo(
    () => [...new Set([...Object.keys(cards), ...(preview ? [preview.oracle_id] : [])])],
    [cards, preview],
  );
  const tags = useTagData(tagIds);

  // Roles: the standard ones with this deck's targets, plus its custom roles (Phase 3c).
  const roleSettings = useRoleSettings(deck.id, roleTargets, customRoles, readOnly);
  const [defaults, setDefaults] = useState(profileDefaults);
  const roleDefs = useMemo(() => buildRoleDefs(roleSettings.targets, roleSettings.custom), [roleSettings.targets, roleSettings.custom]);
  const roles = useMemo(() => (tags.tree ? resolveRoles(roleDefs, tags.tree) : []), [tags.tree, roleDefs]);
  const roleKeysOf = useCallback(
    (card: CardSummary) => rolesOf(card, tags.oracleTags[card.oracle_id], roles),
    [tags.oracleTags, roles],
  );
  const matchesHighlight = (card: CardSummary) => {
    if (!highlight) return false;
    if (highlight.startsWith("role:")) return roleKeysOf(card).includes(highlight.slice(5));
    if (highlight.startsWith("art:")) return (tags.artTags[card.oracle_id] ?? []).some(([s]) => `art:${s}` === highlight);
    return (tags.oracleTags[card.oracle_id] ?? []).includes(highlight);
  };
  const toggleHighlight = (slug: string) => setHighlight((h) => (h === slug ? null : slug));
  const highlightLabel = highlight
    ? highlight.startsWith("role:")
      ? (roles.find((r) => `role:${r.key}` === highlight)?.name ?? highlight.slice(5))
      : highlight.startsWith("art:")
      ? (Object.values(tags.artTags).flat().find(([s]) => `art:${s}` === highlight)?.[1] ?? highlight.slice(4))
      : (tags.tree?.label(highlight) ?? highlight)
    : null;

  // ---------- what's on screen ----------
  const identity = deckIdentity(entries, cards);
  const size = deckSize(entries);
  const commanders = linesFor(entries, cards, "commander");
  const companions = linesFor(entries, cards, "companion");
  const mainLines = linesFor(entries, cards, "main");
  const maybeLines = linesFor(entries, cards, "maybe");

  const warningsFor = (line: DeckLine) => {
    const w: string[] = [];
    if (!line.card.commander_legal) w.push("Not legal in Commander");
    if (outsideIdentity(line.card, identity)) w.push("Outside your commander's colors");
    if (line.board === "commander" && !line.card.can_be_commander) w.push("Can't normally be a commander");
    return w;
  };
  const decorate = (line: DeckLine): DeckItem => {
    const id = line.card.oracle_id;
    return {
      line,
      warnings: warningsFor(line),
      // Basic lands and most lands have no function tags; only flag spells.
      untagged: tags.loaded.has(id) && !tags.oracleTags[id]?.length && !isLand(line.card.type_line),
      highlighted: matchesHighlight(line.card),
      extraRoles: Math.max(0, roleKeysOf(line.card).length - 1),
    };
  };
  // Role subgroups (step 3e): for each role, which subgroup each card that fills it goes in.
  const subgroupMaps = new Map<string, Map<string, string | null>>();
  if (tags.tree && view.group === "role") {
    for (const r of roles) {
      if (r.land || !r.tagSet) continue;
      const items = mainLines
        .filter((l) => roleKeysOf(l.card).includes(r.key))
        .map((l) => ({ id: l.card.oracle_id, candidates: subgroupCandidates(tags.oracleTags[l.card.oracle_id] ?? [], r, tags.tree!) }));
      subgroupMaps.set(r.key, assignSubgroups(items));
    }
  }
  const roleContext = {
    rolesOf: (l: DeckLine) => roleKeysOf(l.card),
    roleOrder: roles.map((r) => ({ key: r.key, name: r.name })),
    subgroupOf: (l: DeckLine, roleKey: string) => {
      if (roles.find((r) => r.key === roleKey)?.land) return landSubgroup(l.card);
      const slug = subgroupMaps.get(roleKey)?.get(l.card.oracle_id);
      return slug && tags.tree ? { key: slug, title: subgroupTitle(slug, tags.tree) } : null;
    },
  };
  // Role counts cover the 100-card deck: commander(s) plus mainboard.
  const counts = roleCounts([...commanders, ...mainLines], (l) => roleKeysOf(l.card));
  const underTarget = roles.filter((r) => roleStatus(counts[r.key] ?? 0, r.target) === "under").length;

  // ---------- top tags (Phase 3d) ----------
  const themeCards: ThemeCard[] = [...commanders, ...mainLines].map((l) => ({
    oracle: tags.oracleTags[l.card.oracle_id] ?? [],
    art: (tags.artTags[l.card.oracle_id] ?? []).map(([s]) => s),
    commander: l.board === "commander",
    land: isLand(l.card.type_line),
  }));
  const artTree = useArtTree(
    themeCards.flatMap((c) => c.art),
    tags.tree?.artN,
    themeSettings.mode === "flavor",
  );
  const trees = tags.tree ? { oracle: tags.tree, art: artTree } : null;
  const roleTagSet = new Set(roles.flatMap((r) => (r.tagSet ? [...r.tagSet] : [])));
  const themes: ThemeTag[] = trees ? themeTags(themeCards, { settings: themeSettings, trees, roleTags: roleTagSet, hidden }) : [];
  const keyCounts = deckKeyCounts(themeCards);
  const hiddenList = [...hidden].map((key) => {
    const { kind, slug } = splitKey(key);
    const fromArt = Object.values(tags.artTags).flat().find(([s]) => aKey(s) === key)?.[1];
    return { key, label: kind === "o" ? (tags.tree?.label(slug) ?? slug) : (artTree?.label(slug) ?? fromArt ?? slug) };
  });
  const renderTopTags = (hideTitle = false) => (
    <TopTags
      hideTitle={hideTitle}
      themes={themes}
      settings={themeSettings}
      loading={!tags.tree || (themeSettings.mode === "flavor" && !artTree && themeCards.some((c) => c.art.length > 0))}
      readOnly={readOnly}
      highlight={highlight}
      hidden={hiddenList}
      roleSlugs={new Set(roleSettings.custom.map((c) => c.slug))}
      treeCardFor={(key) => (trees ? treeCard(key, trees, keyCounts) : null)}
      onSettings={(t) => updatePrefs(themeSettingsToSaved(t))}
      onHighlight={(t) => toggleHighlight(highlightValue(t))}
      onToggleHidden={(key) => {
        toggleHidden(key);
        if (highlight && highlightValue(splitKey(key)) === highlight) setHighlight(null);
      }}
      onMakeRole={(t) => {
        roleSettings.setCustom((cs) => [...cs, { slug: t.slug, name: roleNameFromLabel(t.label), target: Math.max(1, t.count) }]);
        say(`Added a "${roleNameFromLabel(t.label)}" role with a target of ${Math.max(1, t.count)}. Adjust it in the role profile.`);
      }}
    />
  );

  const saveDefaults = async () => {
    if (!userId) return "Sign in to save defaults.";
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ default_role_targets: roleSettings.targets, custom_roles: roleSettings.custom })
      .eq("id", userId);
    if (error) return `Couldn't save: ${error.message}`;
    setDefaults({ targets: roleSettings.targets, custom: roleSettings.custom });
    return "Saved. New decks will start with these targets.";
  };
  const renderProfile = (hideTitle = false) => (
    <RoleProfile
      hideTitle={hideTitle}
      tree={tags.tree}
      roles={roles}
      counts={counts}
      readOnly={readOnly}
      highlight={highlight}
      saveError={roleSettings.saveError}
      onTarget={(key, n) => {
        if (key.startsWith("c:")) roleSettings.setCustom((cs) => cs.map((c) => (customKey(c.slug) === key ? { ...c, target: n } : c)));
        else roleSettings.setTargets((t) => ({ ...t, [key]: n }));
      }}
      onHighlight={(key) => toggleHighlight(`role:${key}`)}
      onAddCustom={(role) => roleSettings.setCustom((cs) => [...cs, role])}
      onRemoveCustom={(key) => {
        roleSettings.setCustom((cs) => cs.filter((c) => customKey(c.slug) !== key));
        if (highlight === `role:${key}`) setHighlight(null);
      }}
      onSaveDefaults={saveDefaults}
      onResetDefaults={() => {
        roleSettings.setTargets(defaults.targets);
        roleSettings.setCustom(defaults.custom);
      }}
    />
  );
  const sections: ViewSection[] = [
    ...(commanders.length ? [{ key: "commander", title: BOARD_LABELS.commander, lines: sortLines(commanders, "name") }] : []),
    ...(companions.length ? [{ key: "companion", title: BOARD_LABELS.companion, lines: companions }] : []),
    ...groupLines(mainLines, view.group, view.sort, roleContext).map((s) => ({
      ...s,
      key: `main:${s.key}`,
      parent: s.parent ? { ...s.parent, key: `main:${s.parent.key}` } : undefined,
    })),
    ...(maybeLines.length ? [{ key: "maybe", title: BOARD_LABELS.maybe, lines: sortLines(maybeLines, view.sort) }] : []),
  ].map((s: { key: string; title: string; lines: DeckLine[]; parent?: ViewSection["parent"] }) => ({
    key: s.key,
    title: s.title,
    count: s.lines.reduce((n, l) => n + l.quantity, 0),
    items: s.lines.map(decorate),
    parent: s.parent,
  }));

  // The card sheet steps through cards in screen order.
  const order = sections.flatMap((s) => s.items.map((i) => i.line));
  const sheetIndex = sheet ? order.findIndex((l) => l.card.oracle_id === sheet.oracle_id && l.board === sheet.board) : -1;
  const sheetLine = sheetIndex >= 0 ? order[sheetIndex] : null;
  useEffect(() => {
    if (sheet && sheetIndex < 0) setSheet(null); // the card was removed
  }, [sheet, sheetIndex]);
  const openLine = (l: DeckLine) => setSheet({ oracle_id: l.card.oracle_id, board: l.board });
  const step = (by: number) => {
    if (!order.length || sheetIndex < 0) return;
    openLine(order[(sheetIndex + by + order.length) % order.length]);
  };

  /** Adds a card found outside the deck list (search results, drag from Scryfall) and confirms it. */
  const addWithNotice = (card: CardSummary, board: Board) => {
    if (run(planAdd(entries, card, board), card)) say(`Added ${card.name} to the ${BOARD_LABELS[board].toLowerCase()}.`);
  };

  return (
    <main className="mx-auto max-w-7xl px-6 pt-6">
      {!readOnly && <DropOverlay onCard={addWithNotice} onMessage={say} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/decks" className="text-sm opacity-70 hover:underline">
            ← My decks
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{deck.name}</h1>
          {identity && (
            <p className="mt-1 text-sm opacity-70">Color identity: {identity.size ? [...identity].join("") : "colorless"}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {!readOnly && (
            <HeaderButton active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
              Search
            </HeaderButton>
          )}
          {!readOnly && (
            <HeaderButton active={panel === "import"} onClick={() => setPanel(panel === "import" ? null : "import")}>
              Import
            </HeaderButton>
          )}
          <HeaderButton active={panel === "export"} onClick={() => setPanel(panel === "export" ? null : "export")}>
            Export
          </HeaderButton>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3 text-sm">
            <SaveIndicator status={status} onRetry={retry} />
            <HeaderButton onClick={undo} disabled={state.past.length === 0} title="Undo (Ctrl+Z)">
              Undo
            </HeaderButton>
            <HeaderButton onClick={redo} disabled={state.future.length === 0} title="Redo (Ctrl+Shift+Z)">
              Redo
            </HeaderButton>
          </div>
        )}
      </div>

      {panel === "search" && !readOnly && (
        <CardSearch
          entries={entries}
          identity={identity}
          commanderName={commanders.length === 1 ? commanders[0].card.name : commanders.length ? "your commanders" : null}
          onAdd={addWithNotice}
          onPreview={setPreview}
          onClose={() => setPanel(null)}
          hideInDeck={prefs.searchHideInDeck === true}
          onHideInDeck={(hide) => updatePrefs({ searchHideInDeck: hide })}
        />
      )}
      {panel === "import" && !readOnly && <ImportPanel entries={entries} onApply={applyImport} onClose={() => setPanel(null)} />}
      {panel === "export" && <ExportPanel deckName={deck.name} entries={entries} cards={cards} onClose={() => setPanel(null)} />}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_300px]">
        {/* Wide screens: the role profile gets its own column on the left. */}
        <aside className="hidden xl:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 pr-1">
            {renderProfile()}
            <div className="mt-6 border-t border-foreground/10 pt-4">{renderTopTags()}</div>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Narrower screens: the same profile, folded above the deck. */}
          <details className="group mb-4 rounded-lg border border-foreground/15 xl:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium">
              <span>
                Role profile
                {roles.length > 0 && (
                  <span className={`ml-2 text-xs font-normal ${underTarget ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
                    {underTarget ? `${underTarget} under target` : "all targets met"}
                  </span>
                )}
              </span>
              <span aria-hidden className="transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="px-3 pb-3">{renderProfile(true)}</div>
          </details>
          <details className="group mb-4 rounded-lg border border-foreground/15 xl:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium">
              <span>
                Top tags
                {themes.length > 0 && (
                  <span className="ml-2 text-xs font-normal opacity-60">
                    {themes
                      .slice(0, 3)
                      .map((t) => t.label)
                      .join(", ")}
                  </span>
                )}
              </span>
              <span aria-hidden className="transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="px-3 pb-3">{renderTopTags(true)}</div>
          </details>
          {!readOnly && (
            <QuickAdd ref={quickAdd} onAdd={(card, board) => run(planAdd(entries, card, board), card)} onPreview={setPreview} />
          )}
          <p aria-live="polite" className="mt-2 min-h-5 text-sm text-amber-700 dark:text-amber-400">
            {notice}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-3">
            <DeckToolbar settings={view} onChange={setView} />
            {tags.error && <span className="text-xs text-amber-700 dark:text-amber-400">{tags.error}</span>}
          </div>

          {highlight && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-400/15 px-3 py-2 text-sm">
              {highlight.startsWith("role:") ? "Highlighting cards that fill" : "Highlighting cards tagged"}{" "}
              <strong>{highlightLabel}</strong> (
              {order.filter((l) => matchesHighlight(l.card)).length} in this deck)
              <button onClick={() => setHighlight(null)} className="ml-auto min-h-8 rounded border border-foreground/20 px-2 text-xs">
                Clear
              </button>
            </div>
          )}

          {commanders.length === 0 && (
            <p className="mt-4 px-1.5 text-sm opacity-60">
              No commander yet. Add a legendary creature with Ctrl+Enter, or open a card and choose “Make commander”.
            </p>
          )}
          <div className="mt-4">
            {sections.length === 0 ? (
              <p className="px-1.5 text-sm opacity-60">Empty. Add cards above, import a list, or drag cards in from Scryfall.</p>
            ) : (
              <DeckView
                sections={sections}
                view={view.view}
                collapsed={collapsed}
                readOnly={readOnly}
                onToggle={(k) =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
                onOpen={openLine}
                onHover={(l) => setPreview(l.card)}
                onQuantity={(l, n) => run(planSetQuantity(entries, l.card, l.board, n))}
              />
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
            <CardPanel
              card={preview}
              roleKeys={preview ? roleKeysOf(preview) : []}
              roles={roles}
              tags={tags}
              highlight={highlight}
              onTag={toggleHighlight}
              onOpen={() => {
                const line = preview && order.find((l) => l.card.oracle_id === preview.oracle_id);
                if (line) openLine(line);
              }}
            />
          </div>
        </aside>
      </div>

      <SummaryBar deckLines={[...commanders, ...mainLines]} size={size} price={totalPrice(entries, cards)} />

      {sheetLine && (
        <CardSheet
          deckId={deck.id}
          line={sheetLine}
          index={sheetIndex}
          total={order.length}
          warnings={warningsFor(sheetLine)}
          roleKeys={roleKeysOf(sheetLine.card)}
          roles={roles}
          tags={tags}
          highlight={highlight}
          readOnly={readOnly}
          onTag={(slug) => {
            toggleHighlight(slug);
            setSheet(null); // show the highlighted cards
          }}
          onMove={(to) => {
            if (run(planMove(entries, sheetLine.card, sheetLine.board, to))) setSheet({ oracle_id: sheetLine.card.oracle_id, board: to });
          }}
          onQuantity={(n) => run(planSetQuantity(entries, sheetLine.card, sheetLine.board, n))}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

function HeaderButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`min-h-9 rounded-md border px-3 disabled:opacity-40 ${
        active ? "border-foreground bg-foreground text-background" : "border-foreground/20"
      }`}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <span className="flex items-center gap-2 text-red-600" title={status.error}>
        Not saved ({status.pending} {status.pending === 1 ? "change" : "changes"})
        <button onClick={onRetry} className="rounded border border-red-600/40 px-2 py-0.5">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="opacity-60" aria-live="polite">
      {status.state === "saving" ? "Saving…" : "All changes saved"}
    </span>
  );
}
