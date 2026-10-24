"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  applyCategories,
  applyChange,
  applyTagCards,
  BOARD_LABELS,
  dropTagFromChanges,
  entryKey,
  keepCategories,
  deckIdentity,
  deckSize,
  linesFor,
  outsideIdentity,
  planAdd,
  planBulk,
  planCategory,
  planMove,
  planSetQuantity,
  planTagCards,
  toSavePayload,
  totalPrice,
  type Board,
  type CardSummary,
  type Categories,
  type Change,
  type DeckLine,
  type Entries,
  type Plan,
  type TagCards,
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
  cardKeys,
  treeCard,
  type ThemeCard,
  type ThemeTag,
} from "@/lib/tags/themes";
import { roleNameFromLabel } from "@/lib/tags/role-settings";
import { assignSubgroups, landSubgroup, subgroupCandidates, subgroupTitle } from "@/lib/tags/role-subgroups";
import { myTagHighlight, tagsOfCard, type MyTag } from "@/lib/tags/my-tags";
import { useMyTags } from "@/lib/tags/use-my-tags";
import { createClient } from "@/lib/supabase/client";
import { CardPanel } from "./card-panel";
import { CardSearch } from "./card-search";
import { CardSheet } from "./card-sheet";
import { ExportPanel, ImportPanel } from "./deck-text-panel";
import { DeckToolbar, useHiddenTags, useTagViewPrefs } from "./deck-toolbar";
import { DeckView, type DeckItem, type ViewSection } from "./deck-views";
import { BulkBar } from "./bulk-bar";
import { DropOverlay } from "./drop-overlay";
import { BracketBadge, BracketBanner, BracketPanel, cardFlag } from "./bracket-panel";
import { estimateBracket, overTarget } from "@/lib/brackets/evaluate";
import { BRACKET_RULES, type BracketNumber } from "@/lib/brackets/rules";
import { useBracketTarget, useCombosWithin } from "@/lib/brackets/use-bracket";
import { HistoryPanel } from "./history-panel";
import { StatsPanel } from "./stats-panel";
import { SuggestPanel, type SuggestSource } from "./suggest-panel";
import { type PoolCard, type SuggestSettings } from "@/lib/suggest/score";
import { useSuggestSettings } from "@/lib/suggest/use-suggest-settings";
import { useDismissed } from "@/lib/suggest/use-dismissed";
import { CategoryPicker, MyTagsPanel, PanelMyTags, SheetMyTags } from "./my-tags-ui";
import { QuickAdd, type QuickAddHandle } from "./quick-add";
import { RoleProfile } from "./role-profile";
import { highlightValue, TopTags } from "./top-tags";
import { SummaryBar } from "./summary-bar";

type State = {
  entries: Entries;
  categories: Categories; // manual category per row (step 3f)
  tagCards: TagCards; // My tags per card (step 3f)
  cards: Record<string, CardSummary>;
  past: Change[]; // undo stack
  future: Change[]; // redo stack
};

type Action =
  | { type: "apply"; change: Change; cards?: CardSummary[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadTagCards"; tagCards: TagCards }
  | { type: "dropTag"; tagId: string };

const HISTORY_LIMIT = 200;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "apply":
      return {
        entries: applyChange(state.entries, action.change),
        categories: applyCategories(state.categories, action.change),
        tagCards: applyTagCards(state.tagCards, action.change),
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
        categories: applyCategories(state.categories, change, "back"),
        tagCards: applyTagCards(state.tagCards, change, "back"),
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
        categories: applyCategories(state.categories, change),
        tagCards: applyTagCards(state.tagCards, change),
        past: [...state.past, change],
        future: state.future.slice(0, -1),
      };
    }
    case "loadTagCards":
      return { ...state, tagCards: action.tagCards };
    case "dropTag": {
      // A deleted tag comes off every card, and undo/redo must not try to put it back.
      const tagCards: TagCards = {};
      for (const [id, tags] of Object.entries(state.tagCards)) {
        const keep = tags.filter((t) => t !== action.tagId);
        if (keep.length) tagCards[id] = keep;
      }
      return { ...state, tagCards, past: dropTagFromChanges(state.past, action.tagId), future: dropTagFromChanges(state.future, action.tagId) };
    }
  }
}

type Props = {
  deck: { id: string; name: string };
  initialEntries: Entries;
  initialCategories: Categories;
  initialCards: Record<string, CardSummary>;
  readOnly: boolean;
  savedTagView: Record<string, unknown>;
  hiddenTags: string[];
  userId: string | null;
  roleTargets: Record<string, number>;
  customRoles: CustomRole[];
  suggestSettings: SuggestSettings;
  dismissedSuggestions: string[];
  playtestFlags: Record<string, number>;
  targetBracket: BracketNumber;
  profileDefaults: { targets: Record<string, number>; custom: CustomRole[] };
};

export function DeckEditor({
  deck,
  initialEntries,
  initialCategories,
  initialCards,
  readOnly,
  savedTagView,
  hiddenTags,
  userId,
  roleTargets,
  customRoles,
  suggestSettings,
  dismissedSuggestions,
  playtestFlags,
  targetBracket,
  profileDefaults,
}: Props) {
  const [state, dispatch] = useReducer(reducer, {
    entries: initialEntries,
    categories: initialCategories,
    tagCards: {},
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
  // Underperformer flags from the playtester (6d); cleared from the card sheet.
  const [flags, setFlags] = useState<Record<string, number>>(playtestFlags);
  const clearFlags = async (oracleId: string) => {
    setFlags((f) => {
      const next = { ...f };
      delete next[oracleId];
      return next;
    });
    const { error } = await createClient().rpc("clear_flag", { p_deck: deck.id, p_oracle: oracleId });
    if (error) setNotice(`Couldn't clear the flag: ${error.message}`);
  };
  // Bulk edit (step 3g): select mode, the selected rows (entry keys), and where a Shift-click range starts.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    anchor.current = null;
  }, []);
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
      const change = keepCategories(plan.change, state.categories);
      dispatch({ type: "apply", change, cards: card ? [card] : undefined });
      save(toSavePayload(change));
      return true;
    },
    [save, say, state.categories],
  );

  const [panel, setPanel] = useState<"search" | "import" | "export" | "history" | "stats" | "suggest" | "bracket" | null>(null);

  /** A whole import is one change: one save call, one undo step. */
  const applyImport = useCallback(
    (plain: Change, newCards: CardSummary[]) => {
      const change = keepCategories(plain, state.categories);
      dispatch({ type: "apply", change, cards: newCards });
      save(toSavePayload(change));
      setPanel(null);
      say(`${change.label}. Ctrl+Z undoes the whole import.`);
    },
    [save, say, state.categories],
  );

  const undo = useCallback(() => {
    const change = state.past.at(-1);
    if (!change) return;
    dispatch({ type: "undo" });
    save(toSavePayload(change, "back"));
    say(`Undid: ${change.label}`);
  }, [state.past, save, say]);

  const redo = useCallback(() => {
    const change = state.future.at(-1);
    if (!change) return;
    dispatch({ type: "redo" });
    save(toSavePayload(change));
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
      if (e.key === "Escape" && selecting && !typing) {
        stopSelecting();
      } else if (e.key === "/" && !typing) {
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
  }, [readOnly, undo, redo, selecting, stopSelecting]);

  const { entries, cards, categories, tagCards } = state;

  // ---------- bracket targeting (Phase 5b) ----------
  const bracket = useBracketTarget(deck.id, targetBracket, readOnly);
  // Combos are checked on the 100-card deck (commander, companion, mainboard), not the maybeboard.
  const deckCardIds = Object.keys(entries).filter((k) => !k.startsWith("maybe|")).map((k) => k.split("|")[1]);
  const combos = useCombosWithin(deckCardIds);

  // ---------- My tags (step 3f) ----------
  const myTags = useMyTags(deck.id, !readOnly && !!userId, (loaded) => dispatch({ type: "loadTagCards", tagCards: loaded }));
  const showMyTags = prefs.showMyTags !== false;
  const myTagsOfCard = (oracleId: string) => tagsOfCard(tagCards, oracleId, myTags.tags);
  const toggleMyTag = (t: MyTag, onCards: CardSummary[], on: boolean) => run(planTagCards(tagCards, t.id, t.name, onCards, on));

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
  /** Roles a deck row counts toward: its manual category when set (step 3f), otherwise its tags. */
  const lineRoleKeys = (l: DeckLine) => {
    const c = categories[entryKey(l.board, l.card.oracle_id)];
    if (c === "none") return [];
    if (c && roles.some((r) => r.key === c)) return [c];
    return roleKeysOf(l.card);
  };
  const matchesHighlight = (line: DeckLine) => {
    const card = line.card;
    if (!highlight) return false;
    if (highlight.startsWith("role:")) return lineRoleKeys(line).includes(highlight.slice(5));
    if (highlight.startsWith("my:")) return (tagCards[card.oracle_id] ?? []).includes(highlight.slice(3));
    if (highlight.startsWith("art:")) return (tags.artTags[card.oracle_id] ?? []).some(([s]) => `art:${s}` === highlight);
    return (tags.oracleTags[card.oracle_id] ?? []).includes(highlight);
  };
  const toggleHighlight = (slug: string) => setHighlight((h) => (h === slug ? null : slug));
  const highlightLabel = highlight
    ? highlight.startsWith("role:")
      ? (roles.find((r) => `role:${r.key}` === highlight)?.name ?? highlight.slice(5))
      : highlight.startsWith("my:")
      ? (myTags.tags.find((t) => myTagHighlight(t.id) === highlight)?.name ?? "a deleted tag")
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

  // Bracket estimate and the cards that go above the target (they get a ⚠ badge like other warnings).
  // The deck as the bracket check sees it (also used to screen suggestions, 5c).
  const bracketDeck = {
    lines: [...commanders, ...companions, ...mainLines],
    tagsOf: (id: string) => tags.oracleTags[id] ?? [],
    massLandDenialTags: tags.tree ? tags.tree.descendants(BRACKET_RULES.tags.massLandDenial) : new Set<string>(),
    extraTurnTags: tags.tree ? tags.tree.descendants(BRACKET_RULES.tags.extraTurn) : new Set<string>(),
  };
  const estimate = tags.tree ? estimateBracket({ ...bracketDeck, combos: combos.combos }) : null;
  const bracketFlags = new Map<string, string[]>();
  for (const f of estimate ? overTarget(estimate, bracket.target) : [])
    for (const id of f.cards) bracketFlags.set(id, [...(bracketFlags.get(id) ?? []), cardFlag(f, id, (x) => cards[x]?.name ?? "another card")]);

  const warningsFor = (line: DeckLine) => {
    const w: string[] = [];
    if (line.board !== "maybe")
      for (const flag of bracketFlags.get(line.card.oracle_id) ?? []) w.push(`Above bracket ${bracket.target}: ${flag}`);
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
      flags: flags[id] ?? 0,
      highlighted: matchesHighlight(line),
      extraRoles: Math.max(0, lineRoleKeys(line).length - 1),
      myTags: showMyTags ? myTagsOfCard(id) : [],
      manual: !!categories[entryKey(line.board, id)],
      selected: selecting ? selected.has(entryKey(line.board, id)) : undefined,
    };
  };
  // Role subgroups (step 3e): for each role, which subgroup each card that fills it goes in.
  const subgroupMaps = new Map<string, Map<string, string | null>>();
  if (tags.tree && view.group === "role") {
    for (const r of roles) {
      if (r.land || !r.tagSet) continue;
      const items = mainLines
        .filter((l) => lineRoleKeys(l).includes(r.key))
        .map((l) => ({ id: l.card.oracle_id, candidates: subgroupCandidates(tags.oracleTags[l.card.oracle_id] ?? [], r, tags.tree!) }));
      subgroupMaps.set(r.key, assignSubgroups(items));
    }
  }
  const roleContext = {
    rolesOf: lineRoleKeys,
    myTagsOf: (l: DeckLine) =>
      myTagsOfCard(l.card.oracle_id).map((t) => ({ key: t.id, title: t.name, order: myTags.tags.indexOf(t) })),
    roleOrder: roles.map((r) => ({ key: r.key, name: r.name })),
    subgroupOf: (l: DeckLine, roleKey: string) => {
      if (roles.find((r) => r.key === roleKey)?.land) return landSubgroup(l.card);
      const slug = subgroupMaps.get(roleKey)?.get(l.card.oracle_id);
      return slug && tags.tree ? { key: slug, title: subgroupTitle(slug, tags.tree) } : null;
    },
  };
  // Role counts cover the 100-card deck: commander(s) plus mainboard.
  const counts = roleCounts([...commanders, ...mainLines], lineRoleKeys);
  // How many cards in the deck (commander + mainboard) carry each My tag.
  const myTagCounts: Record<string, number> = {};
  for (const l of [...commanders, ...companions, ...mainLines])
    for (const id of tagCards[l.card.oracle_id] ?? []) myTagCounts[id] = (myTagCounts[id] ?? 0) + l.quantity;
  const renderMyTags = (hideTitle = false) => (
    <MyTagsPanel
      hideTitle={hideTitle}
      tags={myTags.tags}
      counts={myTagCounts}
      highlight={highlight}
      show={showMyTags}
      readOnly={readOnly}
      loading={!myTags.loaded}
      onShow={(show) => updatePrefs({ showMyTags: show })}
      onHighlight={(t) => toggleHighlight(myTagHighlight(t.id))}
      onUpdate={myTags.update}
      onDelete={async (t) => {
        const problem = await myTags.remove(t.id);
        if (!problem) {
          dispatch({ type: "dropTag", tagId: t.id });
          if (highlight === myTagHighlight(t.id)) setHighlight(null);
          say(`Deleted the tag "${t.name}".`);
        }
        return problem;
      }}
    />
  );
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

  // ---------- suggestions (Phase 4) ----------
  // Scored against the deck's top 15 GAMEPLAY themes (pool cards have oracle tags only), Specific or Broad as set.
  const suggestThemes: ThemeTag[] = trees
    ? themeTags(themeCards, { settings: { ...themeSettings, mode: "gameplay", sortBy: "relevance" }, trees, roleTags: roleTagSet, hidden }).slice(0, 15)
    : [];
  const [suggestFor, setSuggestFor] = useState<SuggestSource | null>(null);
  const suggestStyle = useSuggestSettings(deck.id, suggestSettings, readOnly);
  const dismissed = useDismissed(deck.id, dismissedSuggestions, readOnly);
  const openSuggest = (source: SuggestSource) => {
    setSuggestFor(source);
    setPanel("suggest");
    requestAnimationFrame(() => document.getElementById("suggest-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const suggestForRole = (key: string) => {
    const r = roles.find((x) => x.key === key);
    if (!r) return;
    openSuggest({ label: r.name, slugs: r.tagSet ? [...r.tagSet] : [], lands: !!r.land, roleKey: r.key });
  };
  const suggestForTag = (t: ThemeTag) => {
    if (!tags.tree || t.kind !== "o") return;
    openSuggest({ label: t.label, slugs: [...tags.tree.descendants([t.slug])] });
  };
  const suggestOverall = () => {
    if (!tags.tree) return;
    if (!suggestThemes.length) return say("Add a few more cards first: overall suggestions follow the deck's shared themes.");
    // Specific mode scores exact tags only, so ask for exactly those; Broad also matches every sub-tag. (Sub-tags of
    // broad themes like "triggered ability" made the pool huge and slow without changing the scores.)
    const slugs = suggestThemes.map((t) => t.slug);
    openSuggest({ label: "this deck", slugs: themeSettings.specific ? slugs : [...tags.tree.descendants(slugs)] });
  };
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
      onSuggest={readOnly ? undefined : suggestForTag}
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
      onSuggest={readOnly ? undefined : suggestForRole}
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
  const previewLine = preview ? [...commanders, ...companions, ...mainLines].find((l) => l.card.oracle_id === preview.oracle_id) : undefined;
  const openLine = (l: DeckLine) => setSheet({ oracle_id: l.card.oracle_id, board: l.board });
  /**
   * A click on a card. While selecting (or with Ctrl/Cmd) it toggles the card; Shift selects everything between
   * the last clicked card and this one, in screen order. Otherwise it opens the card sheet.
   */
  const clickLine = (l: DeckLine, e?: React.MouseEvent) => {
    const key = entryKey(l.board, l.card.oracle_id);
    if (readOnly || !(selecting || e?.shiftKey || e?.ctrlKey || e?.metaKey)) return openLine(l);
    e?.preventDefault();
    setSelecting(true);
    const keys = order.map((o) => entryKey(o.board, o.card.oracle_id));
    if (e?.shiftKey && anchor.current && keys.includes(anchor.current)) {
      const [a, b] = [keys.indexOf(anchor.current), keys.indexOf(key)].sort((x, y) => x - y);
      setSelected((s) => new Set([...s, ...keys.slice(a, b + 1)]));
    } else {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    anchor.current = key;
  };
  const selectedLines = selecting ? order.filter((o) => selected.has(entryKey(o.board, o.card.oracle_id))) : [];
  /** Runs a bulk plan and says what happened, including cards that were skipped and why. */
  const runBulk = (r: { plan: Plan; done: number; skipped: string[] }) => {
    if (!r.plan.ok) {
      say(r.plan.reason);
      return null;
    }
    run(r.plan);
    const skip = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped[0]}${r.skipped.length > 1 ? " …" : ""}` : "";
    say(`${r.plan.change.label}.${skip} Ctrl+Z undoes it.`);
    return r.plan.change;
  };
  const plural = (n: number) => (n === 1 ? "1 card" : `${n} cards`);
  const bulkMove = (to: Board) => {
    const change = runBulk(
      planBulk(entries, selectedLines, (e, l) => planMove(e, l.card, l.board, to), (n) => `Moved ${plural(n)} to the ${BOARD_LABELS[to].toLowerCase()}`),
    );
    if (!change) return;
    // Keep the moved cards selected on their new board.
    const after = applyChange(entries, change);
    setSelected(
      new Set(
        selectedLines.map((l) =>
          after[entryKey(to, l.card.oracle_id)] ? entryKey(to, l.card.oracle_id) : entryKey(l.board, l.card.oracle_id),
        ),
      ),
    );
  };
  const bulkCopies = (n: number) =>
    runBulk(
      planBulk(
        entries,
        selectedLines.filter((l) => l.card.max_copies > 1),
        (e, l) => planSetQuantity(e, l.card, l.board, n),
        (done) => `Set ${plural(done)} to ${n} ${n === 1 ? "copy" : "copies"}`,
      ),
    );
  const bulkRemove = () => {
    if (runBulk(planBulk(entries, selectedLines, (e, l) => planSetQuantity(e, l.card, l.board, 0), (n) => `Removed ${plural(n)}`)))
      setSelected(new Set());
  };
  const bulkTag = (t: MyTag, on: boolean) => {
    const unique = [...new Map(selectedLines.map((l) => [l.card.oracle_id, l.card])).values()];
    const plan = planTagCards(tagCards, t.id, t.name, unique, on);
    if (!plan.ok) say(on ? `All selected cards already have "${t.name}".` : `None of the selected cards have "${t.name}".`);
    else if (run(plan)) say(`${plan.change.label}. Ctrl+Z undoes it.`);
  };
  const step = (by: number) => {
    if (!order.length || sheetIndex < 0) return;
    openLine(order[(sheetIndex + by + order.length) % order.length]);
  };

  /**
   * Drag-to-category (Group by Role, desktop): dropping a mainboard card on a role group puts it there. Dropping
   * it on the group its tags already give it clears the override; "Other" means no role.
   */
  const dropOnRole = (ref: { oracle_id: string; board: string }, sectionKey: string) => {
    const line = mainLines.find((l) => l.card.oracle_id === ref.oracle_id);
    if (!line) return;
    const groupKey = sectionKey.replace(/^main:/, "").split("/")[0];
    const target = groupKey === "other" ? "none" : groupKey;
    if (target !== "none" && !roles.some((r) => r.key === target)) return;
    const auto = roleKeysOf(line.card);
    const autoGroup = auto.find((k) => k !== "lands") ?? auto[0] ?? "none";
    const to = target === autoGroup ? null : target;
    const name = to === "none" ? "no role" : (roles.find((r) => r.key === to)?.name ?? "automatic");
    if (run(planCategory(categories, line.card, "main", to, name)))
      say(to ? `Put ${line.card.name} in ${name}. Ctrl+Z undoes it.` : `${line.card.name} is back to automatic.`);
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
            <HeaderButton active={panel === "suggest"} onClick={() => (panel === "suggest" ? setPanel(null) : suggestOverall())}>
              Suggest
            </HeaderButton>
          )}
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
          <BracketBadge
            target={bracket.target}
            estimate={estimate}
            active={panel === "bracket"}
            onClick={() => setPanel(panel === "bracket" ? null : "bracket")}
          />
          <Link
            href={`/decks/${deck.id}/playtest`}
            title="Goldfish this deck: shuffle, draw, mulligan and play (needs a tablet or computer)"
            className="hidden min-h-9 items-center rounded-md border border-foreground/20 px-3 md:inline-flex"
          >
            Playtest
          </Link>
          <HeaderButton active={panel === "stats"} onClick={() => setPanel(panel === "stats" ? null : "stats")}>
            Stats
          </HeaderButton>
          {!readOnly && (
            <HeaderButton active={panel === "history"} onClick={() => setPanel(panel === "history" ? null : "history")}>
              History
            </HeaderButton>
          )}
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
      {panel === "suggest" && suggestFor && !readOnly && (
        <div id="suggest-panel" className="scroll-mt-4">
          <SuggestPanel
            source={suggestFor}
            identity={identity ? [...identity] : ["W", "U", "B", "R", "G"]}
            deckIds={[...new Set(Object.keys(entries).map((k) => k.split("|")[1]))]}
            isInDeck={(id) => Object.keys(entries).some((k) => k.endsWith(`|${id}`))}
            hasCommander={commanders.length > 0}
            roleNames={Object.fromEntries(roles.map((r) => [r.key, r.name]))}
            score={{
              themes: suggestThemes,
              keysOf: (c: PoolCard) => (trees ? cardKeys({ oracle: c.tags, art: [], commander: false, land: false }, themeSettings.specific, trees) : []),
              rolesOf: (c: PoolCard) => rolesOf(c, c.tags, roles),
              under: new Set(roles.filter((r) => !r.land && (counts[r.key] ?? 0) < r.target).map((r) => r.key)),
              settings: suggestStyle.settings,
            }}
            onSettings={suggestStyle.setSettings}
            saveError={suggestStyle.saveError ?? dismissed.saveError}
            dismissed={dismissed.dismissed}
            onDismiss={(card) => {
              dismissed.dismiss(card.oracle_id);
              say(`${card.name} won't be suggested for this deck. "Show dismissed" at the bottom brings it back.`);
            }}
            onRestore={dismissed.restore}
            bracket={{ target: bracket.target, deck: bracketDeck, deckIds: deckCardIds }}
            onAdd={addWithNotice}
            onPreview={setPreview}
            onClose={() => setPanel(null)}
          />
        </div>
      )}
      {panel === "bracket" && (
        <BracketPanel
          target={bracket.target}
          estimate={estimate}
          readOnly={readOnly}
          saveError={bracket.saveError}
          comboError={combos.error}
          onTarget={bracket.setTarget}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "stats" && (
        <StatsPanel
          lines={[...commanders, ...companions, ...mainLines]}
          identity={identity}
          isRamp={(l) => lineRoleKeys(l).includes("ramp")}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "history" && !readOnly && (
        <HistoryPanel
          deckId={deck.id}
          current={{ entries, categories }}
          cards={cards}
          savedTick={status.state === "saved" ? state.past.length + state.future.length * 10000 : null}
          canSnapshot={status.state === "saved"}
          onRestore={(plan, newCards) => {
            if (!plan.ok) return say(plan.reason);
            dispatch({ type: "apply", change: plan.change, cards: newCards });
            save(toSavePayload(plan.change));
            say(`${plan.change.label}: done. Your previous deck was saved as a version; Ctrl+Z undoes the restore.`);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "export" && <ExportPanel deckName={deck.name} entries={entries} cards={cards} onClose={() => setPanel(null)} />}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_300px]">
        {/* Wide screens: the role profile gets its own column on the left. */}
        <aside className="hidden xl:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 pr-1">
            {renderProfile()}
            <div className="mt-6 border-t border-foreground/10 pt-4">{renderTopTags()}</div>
            {!readOnly && <div className="mt-6 border-t border-foreground/10 pt-4">{renderMyTags()}</div>}
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
            <details className="group mb-4 rounded-lg border border-foreground/15 xl:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium">
                <span>
                  My tags
                  {myTags.tags.length > 0 && <span className="ml-2 text-xs font-normal opacity-60">{myTags.tags.length}</span>}
                </span>
                <span aria-hidden className="transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <div className="px-3 pb-3">{renderMyTags(true)}</div>
            </details>
          )}
          {!readOnly && (
            <QuickAdd ref={quickAdd} onAdd={(card, board) => run(planAdd(entries, card, board), card)} onPreview={setPreview} />
          )}
          <p aria-live="polite" className="mt-2 min-h-5 text-sm text-amber-700 dark:text-amber-400">
            {notice}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <DeckToolbar settings={view} onChange={setView} />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                  aria-pressed={selecting}
                  title="Select several cards to move, tag or remove them at once (or Ctrl/Shift-click cards)"
                  className={`min-h-9 rounded-md border px-3 text-sm ${selecting ? "border-blue-500 bg-blue-500 text-white" : "border-foreground/20"}`}
                >
                  {selecting ? "Done selecting" : "Select"}
                </button>
              )}
            </div>
            {tags.error && <span className="text-xs text-amber-700 dark:text-amber-400">{tags.error}</span>}
          </div>

          {estimate && panel !== "bracket" && (
            <BracketBanner target={bracket.target} estimate={estimate} onDetails={() => setPanel("bracket")} />
          )}
          {highlight && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-400/15 px-3 py-2 text-sm">
              {highlight.startsWith("role:") ? "Highlighting cards that fill" : "Highlighting cards tagged"}{" "}
              <strong>{highlightLabel}</strong> (
              {order.filter((l) => matchesHighlight(l)).length} in this deck)
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
          <div className={`mt-4 ${selecting ? "select-none" : ""}`}>
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
                onOpen={clickLine}
                onHover={(l) => setPreview(l.card)}
                onQuantity={(l, n) => run(planSetQuantity(entries, l.card, l.board, n))}
                onCardDrop={view.group === "role" && !readOnly && roles.length > 0 ? dropOnRole : undefined}
              />
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
            <CardPanel
              card={preview}
              roleKeys={previewLine ? lineRoleKeys(previewLine) : preview ? roleKeysOf(preview) : []}
              extra={
                preview && (
                  <PanelMyTags
                    tags={myTagsOfCard(preview.oracle_id)}
                    highlight={highlight}
                    onHighlight={(t) => toggleHighlight(myTagHighlight(t.id))}
                  />
                )
              }
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

      {selecting && !readOnly && (
        <>
          {/* Room so the bar never covers the last cards. */}
          <div aria-hidden className="h-40" />
          <BulkBar
            count={selectedLines.length}
            total={order.length}
            tags={userId ? myTags.tags : []}
            canSetCopies={selectedLines.some((l) => l.card.max_copies > 1)}
            onMove={bulkMove}
            onTag={bulkTag}
            onCopies={bulkCopies}
            onRemove={bulkRemove}
            onSelectAll={() => setSelected(new Set(order.map((o) => entryKey(o.board, o.card.oracle_id))))}
            onClear={() => setSelected(new Set())}
            onDone={stopSelecting}
          />
        </>
      )}

      {sheetLine && (
        <CardSheet
          deckId={deck.id}
          line={sheetLine}
          index={sheetIndex}
          total={order.length}
          warnings={warningsFor(sheetLine)}
          roleKeys={lineRoleKeys(sheetLine)}
          flags={flags[sheetLine.card.oracle_id] ?? 0}
          onClearFlags={() => clearFlags(sheetLine.card.oracle_id)}
          extra={
            readOnly ? null : (
              <>
                {(sheetLine.board === "main" || sheetLine.board === "commander") && roles.length > 0 && (
                  <CategoryPicker
                    value={categories[entryKey(sheetLine.board, sheetLine.card.oracle_id)] ?? null}
                    automatic={roleKeysOf(sheetLine.card).map((k) => roles.find((r) => r.key === k)?.name ?? k)}
                    roles={roles.map((r) => ({ key: r.key, name: r.name }))}
                    onChange={(key, name) => run(planCategory(categories, sheetLine.card, sheetLine.board, key, name))}
                  />
                )}
                {userId && (
                  <SheetMyTags
                    tags={myTags.tags}
                    onCard={new Set(tagCards[sheetLine.card.oracle_id] ?? [])}
                    onToggle={(t, on) => toggleMyTag(t, [sheetLine.card], on)}
                    onCreate={async (name, scope) => {
                      const made = await myTags.create(name, scope);
                      if (typeof made === "string") return made;
                      toggleMyTag(made, [sheetLine.card], true);
                      return null;
                    }}
                  />
                )}
              </>
            )
          }
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
