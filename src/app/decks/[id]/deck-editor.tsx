"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  applyCategories,
  applyChange,
  applyPrintings,
  applyTagCards,
  BOARD_LABELS,
  statusLabel,
  dropTagFromChanges,
  effectivePrintings,
  entryKey,
  keepCategories,
  keepPrintings,
  deckIdentity,
  deckSize,
  linesFor,
  outsideIdentity,
  planAdd,
  planBulk,
  planCategory,
  planMove,
  planPrinting,
  planSetQuantity,
  planTagCards,
  toSavePayload,
  type Board,
  type CardSummary,
  type Categories,
  type Change,
  type DeckLine,
  type Entries,
  type Plan,
  type PreferredPrintings,
  type Printings,
  type TagCards,
} from "@/lib/deck/model";
import { groupLines, readViewSettings, sortLines, type ViewSettings } from "@/lib/deck/grouping";
import { useAutosave, type SaveStatus } from "@/lib/deck/use-autosave";
import {
  buildRoleDefs,
  customKey,
  hiddenRoleKeys,
  roleCounts,
  roleStatus,
  TUTORS_KEY,
  withoutBracketTargets,
  withRoleHidden,
  type CustomRole,
} from "@/lib/tags/role-settings";
import { isLand, resolveRoles, rolesOf } from "@/lib/tags/roles";
import { BASIC_NAMES, isBasicLand, landBaseChange, type LandBasePlan } from "@/lib/deck/land-base";
import { COLORS, pipsOf, type Color } from "@/lib/deck/stats";
import { LandBasePanel, landBaseAbout } from "./land-base-panel";
import { useRoleSettings } from "@/lib/tags/use-role-settings";
import { useTagData, type InitialTags } from "@/lib/tags/use-tag-data";
import { useArtTree } from "@/lib/tags/use-art-tree";
import { usePreferredPrintings } from "@/lib/deck/use-preferred-printings";
import { useChosenArtTags } from "@/lib/tags/use-chosen-art-tags";
import { printingIdFromImage, type ChosenPrinting } from "@/lib/deck/printing";
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
import { CardPanel, FloatingPreview } from "./card-panel";
import { CardSearch } from "./card-search";
import { ActionButton, CardSheet } from "./card-sheet";
import { FindCards, type FindTab } from "./find-cards";
import { useCommanderWording } from "./wording-ui";
import { ExportPanel, ImportPanel } from "./deck-text-panel";
import { DeckToolbar, useHiddenTags, useTagViewPrefs } from "./deck-toolbar";
import { DeckView, type DeckItem, type ViewSection } from "./deck-views";
import { BulkBar } from "./bulk-bar";
import { DropOverlay } from "./drop-overlay";
import { BracketBadge, BracketPanel, cardFlag } from "./bracket-panel";
import { estimateBracket, overTarget, type ComboRow } from "@/lib/brackets/evaluate";
import { BRACKET_RULES, type BracketNumber } from "@/lib/brackets/rules";
import { useBracketTarget, useCombosWithin } from "@/lib/brackets/use-bracket";
import { HistoryPanel } from "./history-panel";
import { SharePanel } from "./share-panel";
import { StatsPanel } from "./stats-panel";
import { SuggestPanel, type SuggestSource } from "./suggest-panel";
import { themeGroups, type PoolCard, type SuggestSettings } from "@/lib/suggest/score";
import { useSuggestSettings } from "@/lib/suggest/use-suggest-settings";
import { useDismissed } from "@/lib/suggest/use-dismissed";
import { CategoryPicker, MyTagsPanel, PanelMyTags, SheetMyTags } from "./my-tags-ui";
import { QuickAdd, type QuickAddHandle } from "./quick-add";
import { RoleProfile, RoleRail } from "./role-profile";
import { RailHandle } from "./rail-handle";
import { RAIL_COLLAPSED, RAIL_DEFAULT, railStage, railWidthOf, readPreviewMode, type RailStage } from "@/lib/tags/layout-prefs";
import { highlightValue, TopTags } from "./top-tags";
import { SummaryBar } from "./summary-bar";
import { prettyTag, roleColor } from "@/lib/tags/pretty";
import { Avatar } from "@/components/avatar";
import { DeckHero, MoreMenu, Toast } from "./deck-hero";
import { SpinPanel } from "./spin-panel";
import type { Builder } from "./load-deck";
import { copyDeck } from "../actions";
import { deckAccentVars } from "@/lib/ui/deck-colors";
import { bracketRolesOf, estimatePower } from "@/lib/brackets/power";
import { applyManaValues, withManaValue, type ManaValues } from "@/lib/deck/mana-values";
import { useWishlist } from "@/lib/deck/use-wishlist";
import { isFoilFinish, ownedCopies, ownedMatch, unownedPrice } from "@/lib/deck/collection";
import { markOwnedChanges, shownParts, targetFor, type ShownPart } from "@/lib/deck/collection-targets";
import { useCollection } from "@/lib/deck/use-collection";
import { readCardLang } from "@/lib/deck/card-language";
import { useLocalized } from "@/lib/deck/use-localized";
import { artCount, totalPriceWithSplits, type SplitPart, type Splits } from "@/lib/deck/splits";
import { priceCards, pricePrintings, readPriceSource } from "@/lib/deck/store-prices";
import { priceSplits } from "@/lib/deck/deck-totals";
import { applyOrder, mergeOrder, readOrder } from "@/lib/tags/order";
import { CutterPanel, type AddItem, type CutItem } from "./cutter-panel";
import { belowTargetText, belowTargetWarning } from "@/lib/cutter/score";
import type { CutterCard } from "@/lib/cutter/archetype";
import type { CutterPrefs, CutterState } from "@/lib/cutter/state";
import { useCutterPrefs, useCutterState } from "@/lib/cutter/use-cutter";
import { archetypeLabel, detectArchetypes } from "@/lib/cutter/archetype";
import { ARCHETYPES, GENERAL_KEY } from "@/lib/cutter/archetypes";
import { NO_PLAYS, playsTags, playsToSave, steerThemes, type Plays } from "@/lib/tags/plays";
import { PlaysEditor, PlaysLine, type PlaysHeadline } from "./plays-line";

type State = {
  entries: Entries;
  categories: Categories; // manual category per row (step 3f)
  printings: Printings; // chosen printing and foil per row
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
        printings: applyPrintings(state.printings, action.change),
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
        printings: applyPrintings(state.printings, change, "back"),
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
        printings: applyPrintings(state.printings, change),
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

/** Who can open a deck (decks.visibility). */
export type Visibility = "private" | "unlisted" | "public";

type Props = {
  deck: { id: string; name: string; visibility: Visibility; cover_oracle_id?: string | null; mana_values?: ManaValues; plays?: Plays };
  initialEntries: Entries;
  initialCategories: Categories;
  initialPrintings: Printings;
  /** Mixed copies (v2): printings for some copies of a row, by entry key. */
  initialSplits?: Splits;
  initialPreferred: PreferredPrintings;
  initialCards: Record<string, CardSummary>;
  /** The deck's tags, loaded with the page (undefined if that failed: the editor then fetches them). */
  initialTags?: InitialTags;
  /** Two-card combos in the deck, loaded with the page. */
  initialCombos?: ComboRow[];
  readOnly: boolean;
  /** Who built the deck, for a deck shared with you (null for your own). */
  builder?: Builder | null;
  savedTagView: Record<string, unknown>;
  hiddenTags: string[];
  userId: string | null;
  roleTargets: Record<string, number>;
  customRoles: CustomRole[];
  suggestSettings: SuggestSettings;
  dismissedSuggestions: string[];
  playtestFlags: Record<string, number>;
  /** Smart Cutter: this deck's state (decks.cutter) and your settings (profiles.cutter_prefs). */
  cutterState: CutterState;
  cutterPrefs: CutterPrefs;
  targetBracket: BracketNumber;
  profileDefaults: { targets: Record<string, number>; custom: CustomRole[] };
};

/** Written out whole so Tailwind sees each class. --rail is the width the user dragged; the cards always keep some room. */
const EDITOR_COLUMNS = {
  none: "xl:grid-cols-[min(var(--rail),calc(100vw_-_500px))_minmax(0,1fr)]",
  docked: "lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[min(var(--rail),calc(100vw_-_740px))_minmax(0,1fr)_240px]",
};

export function DeckEditor({
  deck,
  initialEntries,
  initialCategories,
  initialPrintings,
  initialSplits,
  initialPreferred,
  initialCards,
  initialTags,
  initialCombos,
  readOnly,
  builder,
  savedTagView,
  hiddenTags,
  userId,
  roleTargets,
  customRoles,
  suggestSettings,
  dismissedSuggestions,
  playtestFlags,
  cutterState,
  cutterPrefs,
  targetBracket,
  profileDefaults,
}: Props) {
  const [state, dispatch] = useReducer(reducer, {
    entries: initialEntries,
    categories: initialCategories,
    printings: initialPrintings,
    tagCards: {},
    cards: initialCards,
    past: [],
    future: [],
  });
  const { status, save, retry } = useAutosave(deck.id);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSummary | null>(null);
  const [previewSide, setPreviewSide] = useState<"left" | "right">("right");
  const [sheet, setSheet] = useState<{ oracle_id: string; board: Board } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Underperformer flags from the playtester (6d); cleared from the card sheet.
  const [flags, setFlags] = useState<Record<string, number>>(playtestFlags);
  const [coverId, setCoverId] = useState(deck.cover_oracle_id ?? null);
  const chooseCover = async (oracleId: string | null) => {
    const before = coverId;
    setCoverId(oracleId);
    const { error } = await createClient().from("decks").update({ cover_oracle_id: oracleId }).eq("id", deck.id);
    if (error) {
      setCoverId(before);
      setNotice(`Couldn't change the deck image: ${error.message}`);
    }
  };
  // Change mana cost (v2): saved directly to decks.mana_values, like the deck image.
  const [manaValues, setManaValues] = useState<ManaValues>(deck.mana_values ?? {});
  const setManaValue = async (oracleId: string, value: number | null, own: number) => {
    const before = manaValues;
    const next = withManaValue(manaValues, oracleId, value, own);
    setManaValues(next);
    const { error } = await createClient().from("decks").update({ mana_values: next }).eq("id", deck.id);
    if (error) {
      setManaValues(before);
      setNotice(`Couldn't change the mana value: ${error.message}`);
    }
  };
  // The Plays line (v2): saved directly to decks.plays, like the deck image. Picked tags steer Suggest and the Cutter.
  const [plays, setPlaysState] = useState<Plays>(deck.plays ?? NO_PLAYS);
  const [editingPlays, setEditingPlays] = useState(false);
  const savePlays = async (next: Plays) => {
    const before = plays;
    setPlaysState(next);
    const { error } = await createClient().from("decks").update({ plays: playsToSave(next) }).eq("id", deck.id);
    if (error) {
      setPlaysState(before);
      setNotice(`Couldn't save what this deck plays: ${error.message}`);
    }
  };
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
  // A friend opening a shared deck sees the cards first, whatever they last used themselves.
  const [prefs, updatePrefs] = useTagViewPrefs(readOnly ? { ...savedTagView, view: "grid" } : savedTagView, userId);
  const view = readViewSettings(prefs);
  const setView = (v: ViewSettings) => updatePrefs(v);
  // The left column: dragging changes the width directly (no re-render of the deck); the stage only when it crosses a size.
  const editorGrid = useRef<HTMLDivElement>(null);
  const railWidth = railWidthOf(prefs);
  const [dragStage, setDragStage] = useState<RailStage | null>(null);
  const stage = dragStage ?? railStage(railWidth);
  const dragRail = (px: number) => {
    editorGrid.current?.style.setProperty("--rail", `${px}px`);
    setDragStage(railStage(px));
  };
  const setRail = (px: number) => {
    editorGrid.current?.style.setProperty("--rail", `${px}px`);
    setDragStage(null);
    updatePrefs({ railWidth: px });
  };
  const previewMode = readPreviewMode(prefs);
  // The floating preview sits on the side away from the mouse, and goes away as soon as the mouse is off a card.
  useEffect(() => {
    if (previewMode !== "float") return;
    let x = -1;
    let y = -1;
    const clear = () => setPreview(null);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      setPreviewSide(x < window.innerWidth / 2 ? "right" : "left");
      if (!(e.target instanceof Element && e.target.closest("[data-preview-card]"))) clear();
    };
    // Scrolling moves the cards without moving the mouse.
    const onScroll = () => {
      if (x >= 0 && !document.elementFromPoint(x, y)?.closest("[data-preview-card]")) clear();
    };
    const root = document.documentElement;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("blur", clear);
    root.addEventListener("mouseleave", clear);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("blur", clear);
      root.removeEventListener("mouseleave", clear);
    };
  }, [previewMode]);
  const themeSettings = readThemeSettings(prefs);
  const [hidden, toggleHidden] = useHiddenTags(hiddenTags, userId);
  const quickAdd = useRef<QuickAddHandle>(null);

  // The toast offers Undo only for messages that confirm the edit just made.
  const [noticeUndo, setNoticeUndo] = useState(false);
  const say = useCallback((msg: string, canUndo = false) => {
    setNotice(msg);
    setNoticeUndo(canUndo);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 5000);
  }, []);
  // Narrow screens: the role profile, top tags and My tags fold behind one row of tabs, so the deck comes first.
  const [fold, setFold] = useState<"roles" | "tags" | "mine" | null>(null);
  // The card just added flashes once.
  const [fresh, setFresh] = useState<string | null>(null);
  const flash = useCallback((id: string) => {
    setFresh(id);
    window.setTimeout(() => setFresh((f) => (f === id ? null : f)), 1600);
  }, []);

  /** Run a planned edit: update the screen, remember it for undo, queue it for saving. */
  const run = useCallback(
    (plan: Plan, card?: CardSummary): boolean => {
      if (!plan.ok) {
        if (plan.reason !== "No change.") say(plan.reason);
        return false;
      }
      const change = keepPrintings(keepCategories(plan.change, state.categories), state.printings);
      dispatch({ type: "apply", change, cards: card ? [card] : undefined });
      save(toSavePayload(change));
      return true;
    },
    [save, say, state.categories, state.printings],
  );

  // What the Search tab opens with (quick add's "See all results", a phrase chip, an angle). `n` restarts it.
  const [searchSeed, setSearchSeed] = useState<{ text: string; label?: string; n: number } | undefined>(undefined);
  // Find cards (Nov 11, 2026): a search result or suggestion open in the card sheet, and the list it steps through.
  const [found, setFound] = useState<{ list: CardSummary[]; index: number; from: FindTab } | null>(null);
  // The Suggested tab stays mounted once shown, so switching tabs doesn't ask the database again.
  const [suggestShown, setSuggestShown] = useState(false);
  const [panel, setPanel] = useState<"search" | "import" | "export" | "history" | "stats" | "suggest" | "bracket" | "share" | "cutter" | "lands" | "spin" | null>(null);
  useEffect(() => {
    // Closing the drawer starts it fresh next time.
    if (panel !== "search" && panel !== "suggest") {
      setSuggestShown(false);
      setSearchSeed(undefined);
    }
  }, [panel]);
  const [visibility, setVisibility] = useState<Visibility>(deck.visibility);
  const [copying, setCopying] = useState(false);
  const wishlist = useWishlist(userId);
  const collection = useCollection(userId);
  // Mixed copies (v2): saved straight to the row (deck_cards.printing_split), not through Ctrl+Z.
  const [splits, setSplits] = useState<Splits>(initialSplits ?? {});
  const saveSplit = async (board: Board, oracleId: string, parts: SplitPart[]) => {
    const key = entryKey(board, oracleId);
    const before = splits;
    setSplits((s) => {
      const next = { ...s };
      if (parts.length) next[key] = parts;
      else delete next[key];
      return next;
    });
    const { error } = await createClient()
      .from("deck_cards")
      .update({ printing_split: parts.length ? parts : null })
      .eq("deck_id", deck.id)
      .eq("oracle_id", oracleId)
      .eq("board", board);
    if (error) {
      setSplits(before);
      setNotice(`Couldn't save the printings: ${error.message}`);
    }
  };
  const [editingTargets, setEditingTargets] = useState(false);

  /** A whole import is one change: one save call, one undo step. */
  const applyImport = useCallback(
    (plain: Change, newCards: CardSummary[]) => {
      const change = keepPrintings(keepCategories(plain, state.categories), state.printings);
      dispatch({ type: "apply", change, cards: newCards });
      save(toSavePayload(change));
      setPanel(null);
      say(`${change.label}. Ctrl+Z undoes the whole import.`);
    },
    [save, say, state.categories, state.printings],
  );

  /** Auto build land base (v2): one Change, so one Ctrl+Z takes every added land back. */
  const applyLandBase = useCallback(
    (plan: LandBasePlan, basicCards: Record<string, CardSummary>, newCards: CardSummary[]) => {
      const change = keepPrintings(keepCategories(landBaseChange(state.entries, plan, basicCards), state.categories), state.printings);
      if (change.rows.length === 0) return;
      dispatch({ type: "apply", change, cards: newCards });
      save(toSavePayload(change));
      setPanel(null);
      say(`${change.label}. Ctrl+Z takes them all back.`, true);
    },
    [save, say, state.entries, state.categories, state.printings],
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
      // An empty box has no typing to undo (quick add keeps focus after adding), so the shortcut means the deck.
      const blank = el instanceof HTMLInputElement && el.value === "";
      if (e.key === "Escape" && (panel === "search" || panel === "suggest") && !sheet && !found) {
        setPanel(null);
      } else if (e.key === "Escape" && selecting && !typing) {
        stopSelecting();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        quickAdd.current?.focus();
      } else if (mod && (!typing || blank) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && (!typing || blank) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, undo, redo, selecting, stopSelecting, panel, sheet, found]);

  const { entries, cards, categories, tagCards, printings } = state;
  // What each row shows: its own pick, else your default. Edits and undo work on the picks alone.
  const { preferred, setDefault } = usePreferredPrintings(initialPreferred);
  const shownPrintings = useMemo(() => effectivePrintings(entries, printings, preferred), [entries, printings, preferred]);
  // Prices from your chosen store (v2, Settings → Prices). Everything priced below reads these; edits keep the
  // printings' own prices, so nothing priced here is ever saved.
  const priceSource = readPriceSource(prefs);
  const pricedCards = useMemo(() => priceCards(cards, priceSource), [cards, priceSource]);
  const pricedPrintings = useMemo(() => pricePrintings(shownPrintings, priceSource), [shownPrintings, priceSource]);
  const pricedSplits = useMemo(() => priceSplits(splits, priceSource), [splits, priceSource]);

  // ---------- bracket targeting (Phase 5b) ----------
  const bracket = useBracketTarget(deck.id, targetBracket, readOnly);
  // Combos are checked on the 100-card deck (commander, companion, mainboard), not the maybeboard.
  const deckCardIds = Object.keys(entries).filter((k) => !k.startsWith("maybe|")).map((k) => k.split("|")[1]);
  const combos = useCombosWithin(deckCardIds, initialCombos);

  // ---------- My tags (step 3f) ----------
  const myTags = useMyTags(deck.id, !readOnly && !!userId, (loaded) => dispatch({ type: "loadTagCards", tagCards: loaded }));
  const showMyTags = prefs.showMyTags !== false;
  const myTagsOfCard = (oracleId: string) => tagsOfCard(tagCards, oracleId, myTags.tags);
  const toggleMyTag = (t: MyTag, onCards: CardSummary[], on: boolean) => run(planTagCards(tagCards, t.id, t.name, onCards, on));

  // ---------- tags and roles ----------
  // Tags for every card we know about, plus whatever is being previewed (a search result, say).
  const tagIds = useMemo(
    () => [...new Set([...Object.keys(cards), ...(preview ? [preview.oracle_id] : []), ...(found ? [found.list[found.index].oracle_id] : [])])],
    [cards, preview, found],
  );
  const tags = useChosenArtTags(useTagData(tagIds, initialTags), shownPrintings);

  // Roles: the standard ones with this deck's targets, plus its custom roles (Phase 3c).
  const roleSettings = useRoleSettings(deck.id, roleTargets, customRoles, readOnly);
  const [defaults, setDefaults] = useState(profileDefaults);
  // Tutors follows the target bracket until its slider is moved (C1b).
  const roleDefs = useMemo(
    () => buildRoleDefs(roleSettings.targets, roleSettings.custom, bracket.target),
    [roleSettings.targets, roleSettings.custom, bracket.target],
  );
  const allRoles = useMemo(() => (tags.tree ? resolveRoles(roleDefs, tags.tree) : []), [tags.tree, roleDefs]);
  const hiddenRoles = useMemo(() => hiddenRoleKeys(roleSettings.targets), [roleSettings.targets]);
  const roles = useMemo(() => allRoles.filter((r) => !hiddenRoles.has(r.key)), [allRoles, hiddenRoles]);
  // Worked out against every role, then filtered: a card that is a board wipe stays out of Targeted removal
  // even while Board wipes is hidden.
  const visibleRoleKeys = useCallback(
    (card: Parameters<typeof rolesOf>[0], slugs: string[] | undefined) => rolesOf(card, slugs, allRoles).filter((k) => !hiddenRoles.has(k)),
    [allRoles, hiddenRoles],
  );
  const roleKeysOf = useCallback((card: CardSummary) => visibleRoleKeys(card, tags.oracleTags[card.oracle_id]), [tags.oracleTags, visibleRoleKeys]);
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
      : prettyTag(tags.tree?.label(highlight) ?? highlight)
    : null;

  // ---------- what's on screen ----------
  const identity = deckIdentity(entries, cards);
  const size = deckSize(entries);
  const countedCards = useMemo(() => applyManaValues(pricedCards, manaValues), [pricedCards, manaValues]);
  const rawLines = (["commander", "companion", "main", "maybe"] as Board[]).map((b) => linesFor(entries, countedCards, b, pricedPrintings));
  // Card language (v2): pictures in your language where that printing exists in it.
  // Your setting, also on decks shared with you and precons (prefs are the viewer's own).
  const cardLang = readCardLang(prefs);
  const localize = useLocalized(cardLang, rawLines.flat().map((l) => printingIdFromImage(l.card.image_normal)));
  const [commanders, companions, mainLines, maybeLines] = rawLines.map((ls) => (cardLang === "en" ? ls : ls.map((l) => ({ ...l, card: localize(l.card) }))));

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
    if (!line.card.commander_legal)
      w.push(
        line.card.commander_status === "banned"
          ? "Banned in Commander"
          : line.card.commander_status === "preview"
            ? "Not released yet (legal from its release day)"
            : "Not legal in Commander",
      );
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
      tutor: lineRoleKeys(line).includes(TUTORS_KEY),
      locked: line.board === "main" && locked.has(id),
      highlighted: matchesHighlight(line),
      fresh: fresh === id,
      // In Group by Role the heading already names the first role.
      roleNames: lineRoleKeys(line)
        .slice(view.group === "role" ? 1 : 0)
        .map((k) => roles.find((r) => r.key === k)?.name ?? k),
      myTags: showMyTags ? myTagsOfCard(id) : [],
      manual: !!categories[entryKey(line.board, id)],
      selected: selecting ? selected.has(entryKey(line.board, id)) : undefined,
      owned: collection.tracking ? ownedMatch(collection.owned, id, shownParts(line, splits, cards[id])) : undefined,
      arts: (() => {
        const n = splits[entryKey(line.board, id)] ? artCount(line.quantity, line.printing, splits[entryKey(line.board, id)]) : 0;
        return n > 1 ? n : undefined;
      })(),
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
  const commanderWording = useCommanderWording(commanders.map((l) => l.card));
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
  const complete = size === 100 && roles.length > 0 && underTarget === 0;
  // Finishing the deck is the big moment. Only an edit in this visit counts, not opening a finished deck.
  const [celebrate, setCelebrate] = useState(false);
  const wasComplete = useRef(complete);
  const editCount = state.past.length;
  useEffect(() => {
    if (complete && !wasComplete.current && editCount > 0) {
      setCelebrate(true);
      say("100 cards, every role covered. Deck complete!");
      window.setTimeout(() => setCelebrate(false), 1600);
    }
    wasComplete.current = complete;
  }, [complete, editCount, say]);

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
  // Only standard role tags are left out: a custom role is made from a theme (Lifegain, Pridemate), and dropping its
  // tags left a life gain deck scored on +1/+1 counters alone (David, Nov 8, 2026: Cosmogrand Zenith, Herald of War).
  const suggestRoleTags = new Set(roles.flatMap((r) => (r.tagSet && !r.custom ? [...r.tagSet] : [])));
  // Tags picked in the Plays line always count, at double weight (steerThemes). Only oracle tags: the pool has no art tags.
  const playsOracle = plays.tags.filter((k) => k.startsWith("o:"));
  const steeredThemes = (cards: ThemeCard[], roleTags: Set<string>): ThemeTag[] => {
    if (!trees) return [];
    const opts = { settings: { ...themeSettings, mode: "gameplay" as const, sortBy: "relevance" as const }, trees, roleTags, hidden };
    const top = themeTags(cards, opts).slice(0, 15);
    return playsOracle.length ? steerThemes(top, themeTags(cards, { ...opts, limit: Infinity }), playsOracle) : top;
  };
  const suggestThemes: ThemeTag[] = steeredThemes(themeCards, suggestRoleTags);
  // Themes that mark mostly the same deck cards count once in a suggestion's fit (themeGroups in score.ts).
  const suggestGroups = (() => {
    if (!trees || !suggestThemes.length) return undefined;
    const lineKeys = [...commanders, ...mainLines]
      .filter((l) => !isLand(l.card.type_line))
      .map((l) => ({ id: l.card.oracle_id, keys: new Set(cardKeys({ oracle: tags.oracleTags[l.card.oracle_id] ?? [], art: [], commander: false, land: false }, themeSettings.specific, trees)) }));
    return themeGroups(suggestThemes, (key) => new Set(lineKeys.filter((l) => l.keys.has(key)).map((l) => l.id)));
  })();
  // Refined bracket estimate (v2): how the deck plays, on top of the rules floor. Shown on the Bracket screen.
  const power =
    estimate && trees && tags.tree
      ? estimatePower({
          lines: [...commanders, ...companions, ...mainLines],
          // Standard roles from the cards' tags, not this deck's role settings (hidden roles, categories).
          rolesOf: bracketRolesOf(tags.tree, (id) => tags.oracleTags[id] ?? []),
          tagsOf: (id) => tags.oracleTags[id] ?? [],
          counterTags: tags.tree.descendants(["counterspell"].filter((t) => tags.tree!.has(t))),
          // The commander's pinned tags lead the theme list but often only the commander has them.
          topThemes: new Set(suggestThemes.filter((t) => !t.pinned).slice(0, 5).map((t) => t.key)),
          themeKeysOf: (l) => cardKeys({ oracle: tags.oracleTags[l.card.oracle_id] ?? [], art: [], commander: false, land: false }, themeSettings.specific, trees),
          estimate,
        })
      : null;
  const [suggestFor, setSuggestFor] = useState<SuggestSource | null>(null);
  const suggestStyle = useSuggestSettings(deck.id, suggestSettings, readOnly);
  const dismissed = useDismissed(deck.id, dismissedSuggestions, readOnly);

  // ---------- Smart Cutter (v2) ----------
  const cutter = useCutterState(deck.id, cutterState, readOnly);
  const cutterSettings = useCutterPrefs(readOnly ? null : userId, cutterPrefs);
  const locked = new Set(cutter.state.locks);
  const toggleLock = (card: CardSummary, on: boolean) => {
    cutter.setState((st) => ({ ...st, locks: on ? [...new Set([...st.locks, card.oracle_id])] : st.locks.filter((x) => x !== card.oracle_id) }));
    say(on ? `${card.name} is locked: the Smart Cutter will never suggest cutting it.` : `${card.name} is unlocked.`);
  };
  const cutterCards = (): CutterCard[] =>
    [...commanders, ...mainLines].map((l) => ({
      card: l.card,
      quantity: l.quantity,
      commander: l.board === "commander",
      tags: tags.oracleTags[l.card.oracle_id] ?? [],
      roles: lineRoleKeys(l),
    }));
  // The Plays line's archetype (v2): what the builder set (Plays or the Cutter's Yes / pick), else a guess from
  // the cards. Detection is the Cutter's own, a few ms, so it only reruns when the deck or its tags change.
  const allArchetypes = useMemo(() => [...ARCHETYPES, ...cutterSettings.prefs.archetypes], [cutterSettings.prefs.archetypes]);
  // The line lists are rebuilt each render, so the memo keys on what detection reads: cards, copies, roles.
  const archetypeInput = [...commanders, ...mainLines].map((l) => `${l.board[0]}${l.card.oracle_id}:${l.quantity}:${lineRoleKeys(l).join(",")}`).join("|");
  const ranked = useMemo(
    () => (tags.tree ? detectArchetypes({ cards: cutterCards(), tree: tags.tree, combos: combos.combos.length, archetypes: allArchetypes }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cutterCards reads exactly what archetypeInput spells out
    [archetypeInput, tags.oracleTags, tags.tree, combos.combos.length, allArchetypes],
  );
  const cutterArchetype = cutter.state.archetype;
  const settledArchetype = plays.archetype ?? (cutterArchetype.status !== "auto" ? cutterArchetype.key : null);
  const playsHeadline: PlaysHeadline | null = (() => {
    const set = settledArchetype ? ranked.find((d) => d.archetype.key === settledArchetype) : undefined;
    if (set) return { label: archetypeLabel(set), guessed: false };
    const guess = ranked[0];
    return guess && guess.archetype.key !== GENERAL_KEY ? { label: archetypeLabel(guess), guessed: true } : null;
  })();
  // Answering Yes or picking an archetype in the Smart Cutter updates the Plays line too, so the two always agree.
  const lastCutterArchetype = useRef(cutterArchetype);
  useEffect(() => {
    const before = lastCutterArchetype.current;
    lastCutterArchetype.current = cutterArchetype;
    if (readOnly || (before.key === cutterArchetype.key && before.status === cutterArchetype.status)) return;
    const key = cutterArchetype.status === "auto" ? null : cutterArchetype.key;
    if (key !== plays.archetype) void savePlays({ ...plays, archetype: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change to the Cutter's answer should save
  }, [cutterArchetype]);
  /** Saving the Plays editor: an archetype set there becomes the Cutter's picked one (or back to its own guess). */
  const savePlaysFromEditor = (next: Plays) => {
    void savePlays(next);
    if (next.archetype !== settledArchetype) {
      cutter.setState((st) => ({
        ...st,
        archetype: next.archetype ? { key: next.archetype, status: "picked", rejected: st.archetype.rejected } : { key: null, status: "auto", rejected: st.archetype.rejected },
      }));
    }
    setEditingPlays(false);
    say("Saved what this deck plays.");
  };
  const tagLabel = (key: string) => {
    const { kind, slug } = splitKey(key);
    return kind === "o" ? (tags.tree?.label(slug) ?? slug) : (artTree?.label(slug) ?? Object.values(tags.artTags).flat().find(([s]) => aKey(s) === key)?.[1] ?? slug);
  };
  /** Asks first when a manual removal would put a role below target (David, Nov 7, 2026); otherwise just does it. */
  const [belowTarget, setBelowTarget] = useState<{ lines: string[]; proceed: () => void } | null>(null);
  const guardRemoval = (plan: Plan, proceed: () => void) => {
    if (readOnly || !plan.ok || !cutterSettings.prefs.belowTargetWarning) return proceed();
    const net: Record<string, number> = {};
    for (const r of plan.change.rows) if (r.board === "main" || r.board === "commander") net[r.oracle_id] = (net[r.oracle_id] ?? 0) + r.from - r.to;
    const removing = Object.fromEntries(Object.entries(net).filter(([, n]) => n > 0));
    const rows = Object.keys(removing).length ? belowTargetWarning(cutterCards(), roles, removing) : [];
    if (!rows.length) return proceed();
    setBelowTarget({ lines: belowTargetText(rows), proceed });
  };
  /** Smart Cutter Apply: every cut and swap as one edit, with a reason per card for the Timeline. */
  const applyCuts = (cuts: CutItem[], adds: AddItem[], toMaybe: boolean): boolean => {
    type Item = { cut: true; c: CutItem } | { cut: false; a: AddItem };
    const items: Item[] = [...cuts.map((c) => ({ cut: true as const, c })), ...adds.map((a) => ({ cut: false as const, a }))];
    const n = cuts.reduce((x, c) => x + c.quantity, 0);
    const label = `Smart Cutter: cut ${n === 1 ? "1 card" : `${n} cards`}${adds.length ? `, added ${adds.length}` : ""}${toMaybe ? " (to the maybeboard)" : ""}`;
    const { plan, skipped } = planBulk(
      entries,
      items,
      (e, it) => {
        if (!it.cut) return planAdd(e, it.a.card, "main");
        if (toMaybe) return planMove(e, it.c.card, "main", "maybe");
        return planSetQuantity(e, it.c.card, "main", Math.max(0, (e[entryKey("main", it.c.card.oracle_id)] ?? 0) - it.c.quantity));
      },
      () => label,
    );
    if (!plan.ok) {
      say(plan.reason);
      return false;
    }
    const notes = Object.fromEntries([...cuts.map((c) => [c.card.oracle_id, c.reason]), ...adds.map((a) => [a.card.oracle_id, a.reason])]);
    const change = keepPrintings(keepCategories({ ...plan.change, notes: { label: "Smart Cutter", cards: notes } }, state.categories), state.printings);
    dispatch({ type: "apply", change, cards: adds.map((a) => a.card) });
    save(toSavePayload(change));
    say(`${label}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped[0]}` : ""} Ctrl+Z undoes it.`, true);
    return true;
  };
  const openSuggest = (source: SuggestSource) => {
    setSuggestFor(source);
    setSuggestShown(true);
    setPanel("suggest");
    requestAnimationFrame(() => document.getElementById("suggest-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const suggestForRole = (key: string) => {
    const r = roles.find((x) => x.key === key);
    if (!r) return;
    openSuggest({ label: r.name, slugs: r.tagSet ? [...r.tagSet] : [], lands: !!r.land, roleKey: r.key });
  };
  /** The Search tab, with a query to run (and what it is in words), or as it was. */
  const openSearch = (text?: string, label?: string) => {
    if (text !== undefined) setSearchSeed((s) => ({ text, label, n: (s?.n ?? 0) + 1 }));
    setPanel("search");
    requestAnimationFrame(() => document.getElementById("suggest-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
    // Staples come from the roles the deck is short on (lands aside: they have their own 💡).
    const short = roles.filter((r) => !r.land && r.tagSet && (counts[r.key] ?? 0) < r.target);
    const landsRole = roles.find((r) => r.land);
    openSuggest({
      label: "this deck",
      slugs: themeSettings.specific ? slugs : [...tags.tree.descendants(slugs)],
      staples: short.flatMap((r) => [...r.tagSet!]),
      // Under the Lands target, lands join the suggestions (v2); a hidden Lands role asks for none.
      landsShort: Math.max(0, (landsRole ? landsRole.target - (counts[landsRole.key] ?? 0) : 0)) || undefined,
      // Wording matches (v2): the commander's wording and what feeds it, once its text has loaded.
      wording: commanderWording.plan?.phrases.length ? commanderWording.plan : undefined,
    });
  };
  const keyCounts = deckKeyCounts(themeCards);
  const hiddenList = [...hidden].map((key) => {
    const { kind, slug } = splitKey(key);
    const fromArt = Object.values(tags.artTags).flat().find(([s]) => aKey(s) === key)?.[1];
    return { key, label: kind === "o" ? (tags.tree?.label(slug) ?? slug) : (artTree?.label(slug) ?? fromArt ?? slug) };
  });
  // Your own order for the left column (v2), saved in tag_view and used in every deck. Only the left column
  // follows it; the hero, suggestions and grouping keep their usual order.
  const roleOrder = readOrder(prefs.roleOrder);
  const tagOrder = readOrder(prefs.tagOrder);
  const shownRoles = applyOrder(roles, (r) => r.key, roleOrder);
  const shownThemes = applyOrder(themes, (t) => t.key, tagOrder);
  const renderTopTags = (hideTitle = false) => (
    <TopTags
      hideTitle={hideTitle}
      editing={editingTargets}
      onReorder={(keys) => updatePrefs({ tagOrder: mergeOrder(keys, tagOrder) })}
      themes={shownThemes}
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

  const landRole = allRoles.find((r) => r.land);
  const landRoleKey = landRole?.key ?? "lands";
  const landTarget = landRole?.target ?? 37;
  /** What Auto build land base needs from the deck: nonbasic lands, basics by color, and spell pips. */
  const landStats = () => {
    const basicCounts: Partial<Record<Color | "C", number>> = {};
    const pips: Partial<Record<Color, number>> = {};
    let nonbasicCount = 0;
    for (const l of [...commanders, ...mainLines]) {
      if (isLand(l.card.type_line)) {
        const color = (Object.keys(BASIC_NAMES) as (Color | "C")[]).find((c) => BASIC_NAMES[c] === l.card.name);
        if (isBasicLand(l.card) && color) basicCounts[color] = (basicCounts[color] ?? 0) + l.quantity;
        else if (!isBasicLand(l.card)) nonbasicCount += l.quantity;
      } else {
        for (const [c, n] of Object.entries(pipsOf(l.card.mana_cost)) as [Color, number][]) pips[c] = (pips[c] ?? 0) + n * l.quantity;
      }
    }
    return { basicCounts, pips, nonbasicCount };
  };

  const saveDefaults = async () => {
    if (!userId) return "Sign in to save defaults.";
    const supabase = createClient();
    // Tutors stays out: each deck follows its own bracket for it.
    const targets = withoutBracketTargets(roleSettings.targets);
    const { error } = await supabase.from("profiles").update({ default_role_targets: targets, custom_roles: roleSettings.custom }).eq("id", userId);
    if (error) return `Couldn't save: ${error.message}`;
    setDefaults({ targets, custom: roleSettings.custom });
    return "Saved. New decks will start with these targets.";
  };
  const renderProfile = (hideTitle = false) => (
    <RoleProfile
      hideTitle={hideTitle}
      tree={tags.tree}
      roles={shownRoles}
      counts={counts}
      editing={editingTargets}
      onEditing={setEditingTargets}
      onReorder={(keys) => updatePrefs({ roleOrder: mergeOrder(keys, roleOrder) })}
      onResetOrder={() => updatePrefs({ roleOrder: [], tagOrder: [] })}
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
      onBuildLands={readOnly ? undefined : () => setPanel("lands")}
      buildLandsAbout={landBaseAbout(landTarget)}
      hiddenRoles={allRoles.filter((r) => hiddenRoles.has(r.key)).map((r) => ({ key: r.key, name: r.name }))}
      onHideRole={(key, hide) => {
        roleSettings.setTargets((t) => withRoleHidden(t, key, hide));
        if (highlight === `role:${key}`) setHighlight(null);
      }}
      onResetDefaults={() => {
        roleSettings.setTargets(withoutBracketTargets(defaults.targets));
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
  // The deck image: a card's art, following its chosen printing. A card no longer in the deck falls back to the commander.
  const coverCard = coverId
    ? (["commander", "companion", "main", "maybe"] as Board[]).flatMap((b) => linesFor(entries, cards, b, shownPrintings)).find((l) => l.card.oracle_id === coverId)?.card
    : null;
  const coverArt = coverCard?.image_art_crop;
  const sheetIndex = sheet ? order.findIndex((l) => l.card.oracle_id === sheet.oracle_id && l.board === sheet.board) : -1;
  const sheetLine = sheetIndex >= 0 ? order[sheetIndex] : null;
  useEffect(() => {
    if (sheet && sheetIndex < 0) setSheet(null); // the card was removed
  }, [sheet, sheetIndex]);
  // The card panel rests on the commander until a card is hovered.
  const shown = preview ?? commanders[0]?.card ?? null;
  const shownLine = shown ? [...commanders, ...companions, ...mainLines].find((l) => l.card.oracle_id === shown.oracle_id) : undefined;
  const closePanel = useCallback(() => setPanel(null), []);
  const openLine = (l: DeckLine) => setSheet({ oracle_id: l.card.oracle_id, board: l.board });

  /** Not for this deck, from Suggested, Search or the card sheet: hides the card from both tabs for this deck, or brings it back. */
  const toggleDismissed = (card: CardSummary) => {
    if (dismissed.dismissed.has(card.oracle_id)) {
      dismissed.restore(card.oracle_id);
      say(`${card.name} is back in this deck's suggestions and searches.`);
    } else {
      dismissed.dismiss(card.oracle_id);
      say(`${card.name} is hidden from this deck's suggestions and searches. The note at the top of the list brings it back.`);
    }
  };

  /** The card sheet's collection box for one printing of a card (a deck row's, or a search result's default). */
  const collectionBox = (id: string, part: ShownPart) => {
    if (!userId || !collection.loaded) return undefined;
    const mine = collection.owned.get(id) ?? [];
    const isShown = (r: (typeof mine)[number]) => !!part.printingId && r.printing_id === part.printingId && isFoilFinish(r.finish) === part.foil;
    const p = part.printing;
    return {
      exact: mine.filter(isShown).reduce((n, r) => n + r.quantity, 0),
      total: ownedCopies(collection.owned, id),
      shownLabel: (() => {
        const info = p ?? mine.find(isShown)?.printing_info;
        return info ? `${info.set_name} #${info.number}${part.foil ? ", foil" : ""}` : "The printing shown";
      })(),
      others: mine
        .filter((r) => !isShown(r))
        .map((r) => ({
          quantity: r.quantity,
          label: `${r.printing_info ? `${r.printing_info.set.toUpperCase()} #${r.printing_info.number}` : "printing unknown"}${r.finish === "nonfoil" ? "" : ` ${r.finish}`}`,
        })),
      onAdd: async (delta: number) => {
        try {
          const target = await targetFor(id, part);
          if (!target) return say("Couldn't tell which printing this is.");
          const failed = await collection.add(target, delta);
          if (failed) say(failed);
        } catch (e) {
          say(`Couldn't look up this printing on Scryfall: ${(e as Error).message}`);
        }
      },
    };
  };

  /**
   * Find cards: a search result or suggestion in the card sheet. Same sheet as a deck card (both faces, rules text,
   * tags), with add buttons in place of the deck-row ones. Prev / Next step through the list it came from.
   */
  const renderFoundSheet = (f: NonNullable<typeof found>) => {
    const card = f.list[f.index];
    if (!card) return null;
    const id = card.oracle_id;
    const n = (b: Board) => entries[entryKey(b, id)] ?? 0;
    const status =
      n("commander") > 0
        ? "Your commander"
        : n("main") > 0
          ? `In your mainboard${n("main") > 1 ? ` ×${n("main")}` : ""}${n("maybe") ? ", and on your maybeboard" : ""}`
          : n("maybe") > 0
            ? "On your maybeboard"
            : "Not in this deck yet";
    const shownStatus = dismissed.dismissed.has(id) ? `${status} · marked Not for this deck` : status;
    const move = (by: number) => setFound({ ...f, index: (f.index + by + f.list.length) % f.list.length });
    return (
      <CardSheet
        deckId={deck.id}
        line={{ board: "main", quantity: 0, card }}
        index={f.index}
        total={f.list.length}
        warnings={statusLabel(card) === "Banned" ? ["Banned in Commander"] : statusLabel(card) === "Preview" ? ["Not released yet"] : []}
        roleKeys={roleKeysOf(card)}
        roles={roles}
        tags={tags}
        highlight={null}
        readOnly={false}
        onTag={(slug) => {
          // A tag on a card you're browsing: the picks with that tag, in the Suggested tab.
          if (!tags.tree) return;
          setFound(null);
          openSuggest({ label: tags.tree.label(slug), slugs: [...tags.tree.descendants([slug])] });
        }}
        onMove={() => undefined}
        onQuantity={() => undefined}
        onPrinting={() => undefined}
        pickedHere={false}
        myDefault={preferred[id] ?? null}
        onSetDefault={() => undefined}
        isCover={false}
        onCover={() => undefined}
        onPrev={() => move(-1)}
        onNext={() => move(1)}
        onClose={() => setFound(null)}
        wish={userId ? { on: wishlist.has(id), onToggle: async () => say(await wishlist.toggle(id)) } : undefined}
        collection={collectionBox(id, { printingId: printingIdFromImage(card.image_normal), foil: false, quantity: 1 })}
        onSearchWording={(query, label) => {
          setFound(null);
          openSearch(query, label);
        }}
        candidate={{
          context: f.from === "search" ? "Search result" : "Suggestion",
          status: shownStatus,
          actions: (
            <>
              <ActionButton gold onClick={() => addWithNotice(card, "main")}>
                + Add to mainboard
              </ActionButton>
              <ActionButton onClick={() => addWithNotice(card, "maybe")}>+ Add to maybeboard</ActionButton>
              {card.can_be_commander && n("commander") === 0 && (
                <ActionButton onClick={() => addWithNotice(card, "commander")}>♛ Make commander</ActionButton>
              )}
              <ActionButton onClick={() => toggleDismissed(card)}>{dismissed.dismissed.has(id) ? "Bring back (not hidden)" : "Not for this deck"}</ActionButton>
            </>
          ),
        }}
      />
    );
  };
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
  // Select all leaves the commander and companion alone, so bulk removal can't take them by accident.
  const selectable = order.filter((o) => o.board === "main" || o.board === "maybe");
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
  /** Bulk "Mark owned" (collection, v2): tops your collection up to every selected copy, in the printing shown. */
  const bulkMarkOwned = async () => {
    const rows = selectedLines.map((l) => ({ oracleId: l.card.oracle_id, parts: shownParts(l, splits, cards[l.card.oracle_id]) }));
    try {
      const changes = await markOwnedChanges(collection.owned, rows);
      if (!changes.length) return say("You already own all of these, in the printings shown.");
      const copies = changes.reduce((n, c) => n + c.quantity - (collection.rowOf(c.target)?.quantity ?? 0), 0);
      const failed = await collection.setMany(changes);
      say(failed ?? `Added ${copies === 1 ? "1 copy" : `${copies} copies`} to your collection.`);
    } catch (e) {
      say(`Couldn't look up those printings on Scryfall: ${(e as Error).message}`);
    }
  };
  const bulkMove = (to: Board) => {
    const planned = planBulk(entries, selectedLines, (e, l) => planMove(e, l.card, l.board, to), () => "");
    guardRemoval(planned.plan, () => bulkMoveNow(to));
  };
  const bulkMoveNow = (to: Board) => {
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
    const planned = planBulk(entries, selectedLines, (e, l) => planSetQuantity(e, l.card, l.board, 0), (n) => `Removed ${plural(n)}`);
    guardRemoval(planned.plan, () => {
      if (runBulk(planned)) setSelected(new Set());
    });
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
  const addWithNotice = (card: CardSummary, board: Board, printing?: ChosenPrinting) => {
    const plan = planAdd(entries, card, board);
    // A dragged printing applies when this adds the row; extra copies of a card already here share its printing.
    const pinned =
      plan.ok && printing && !entries[entryKey(board, card.oracle_id)]
        ? { ...plan, change: { ...plan.change, printings: [{ oracle_id: card.oracle_id, board, from: null, to: printing }] } }
        : plan;
    if (run(pinned, card)) {
      flash(card.oracle_id);
      say(`Added ${card.name} to the ${BOARD_LABELS[board].toLowerCase()}.`, true);
    }
  };

  /** Copy to my decks (v2): the server makes the copy and opens it; a signed-out viewer goes to sign in first. */
  function copy() {
    if (copying) return;
    if (!userId) {
      window.location.href = `/login?next=${encodeURIComponent(`/decks/${deck.id}`)}`;
      return;
    }
    if (!readOnly && status.state !== "saved") {
      say("Wait a moment: your last edits are still saving.");
      return;
    }
    setCopying(true);
    copyDeck(deck.id).catch((e: unknown) => {
      // A redirect to the new deck also lands here in some Next versions; only real errors carry a message we show.
      if (e instanceof Error && !/NEXT_REDIRECT/.test(e.message)) say(e.message);
      setCopying(false);
    });
  }

  return (
    <main className="deck-colors" style={deckAccentVars(commanders.length ? identity : null) as React.CSSProperties | undefined}>
      {!readOnly && <DropOverlay onCard={addWithNotice} onMessage={say} />}
      <DeckHero
        coverArt={coverArt}
        coverArtist={coverCard?.artist}
        wide={previewMode !== "docked"}
        name={deck.name}
        commanders={commanders.map((l) => l.card)}
        identity={identity}
        size={size}
        price={totalPriceWithSplits(entries, pricedCards, pricedPrintings, pricedSplits)}
        backLink={!readOnly}
        complete={complete}
        celebrate={celebrate}
        plays={
          <PlaysLine
            archetype={playsHeadline}
            text={plays.text}
            tags={playsTags(plays, themes, tagLabel)}
            onEdit={readOnly ? undefined : () => setEditingPlays(true)}
          />
        }
        onOpenCommander={(i) => openLine(commanders[i])}
        note={
          readOnly &&
          (builder?.precon ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm [text-shadow:0_1px_8px_var(--art-shadow)]">
              <span className="rounded bg-gold/90 px-1.5 py-0.5 text-xs font-semibold text-black">Precon</span>
              <span className="font-semibold">{builder.precon.set_name}</span>
              {builder.precon.release && (
                <span className="opacity-80">
                  {new Date(`${builder.precon.release}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                </span>
              )}
              <Link href="/precons" className="underline opacity-80 hover:opacity-100">
                All precons
              </Link>
              <span className="text-xs opacity-60">
                List from{" "}
                <a href="https://mtgjson.com" target="_blank" rel="noreferrer" className="underline">
                  MTGJSON
                </a>
              </span>
            </p>
          ) : builder?.name ? (
            <p className="mt-1.5 flex items-center gap-2 text-sm [text-shadow:0_1px_8px_var(--art-shadow)]">
              <Avatar url={builder.avatarUrl} name={builder.name} size={24} />
              <span>
                <span className="opacity-80">Built by </span>
                <span className="font-semibold">{builder.name}</span>
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm opacity-90">A deck shared with you.</p>
          ))
        }
        status={
          <>
            <BracketBadge
              target={bracket.target}
              estimate={estimate}
              size={size}
              active={panel === "bracket"}
              onClick={() => setPanel(panel === "bracket" ? null : "bracket")}
            />
          </>
        }
        actions={
          <>
            {readOnly && (
              <button type="button" className="btn btn-gold" disabled={copying} onClick={copy} title="A private copy in your decks, to change as you like">
                {copying ? "Copying…" : builder?.precon ? "⧉ Start a deck from this" : "⧉ Copy to my decks"}
              </button>
            )}
            {readOnly && (
              <Link href={userId ? "/decks" : `/login?next=${encodeURIComponent("/decks")}`} className="btn">
                ✦ Build your own
              </Link>
            )}
            {!readOnly && (commanders.length > 0 || size > 0) && (
              <button
                type="button"
                className="btn btn-gold"
                aria-pressed={panel === "suggest"}
                onClick={() => (panel === "suggest" ? setPanel(null) : suggestOverall())}
              >
                ✦ Suggest<span className="hidden sm:inline"> cards</span>
              </button>
            )}
            {!readOnly && (
              <HeaderButton
                active={panel === "search"}
                title="Search every Commander card by name, rules text or Scryfall syntax"
                onClick={() => (panel === "search" ? setPanel(null) : openSearch())}
              >
                ⌕ Search
              </HeaderButton>
            )}
            <Link
              href={`/decks/${deck.id}/playtest`}
              title="Goldfish this deck: shuffle, draw, mulligan and play"
              className="btn"
            >
              ▶ Playtest
            </Link>
            {!readOnly && size > 100 && (
              <button type="button" className="btn btn-gold" aria-pressed={panel === "cutter"} onClick={() => setPanel("cutter")} title="Smart Cutter: what to cut, and why">
                ✂ Cut {size - 100}
              </button>
            )}
            {!readOnly && (
              <HeaderButton active={panel === "share"} onClick={() => setPanel(panel === "share" ? null : "share")} title="Share a read-only link">
                ↗ Share{visibility !== "private" && <span className="text-xs opacity-75">({visibility === "public" ? "public" : "link"})</span>}
              </HeaderButton>
            )}
            <MoreMenu
              items={[
                ...(readOnly ? [] : [{ key: "import", label: "Import a list", active: panel === "import", onPick: () => setPanel("import") }]),
                { key: "export", label: "Export", active: panel === "export", onPick: () => setPanel("export") },
                { key: "stats", label: "Stats", active: panel === "stats", onPick: () => setPanel("stats") },
                ...(readOnly ? [] : [{ key: "history", label: "History", active: panel === "history", onPick: () => setPanel("history") }]),
                ...(readOnly ? [] : [{ key: "cutter", label: "Smart Cutter", active: panel === "cutter", onPick: () => setPanel("cutter") }]),
                ...(readOnly ? [] : [{ key: "lands", label: "Auto build land base", active: panel === "lands", onPick: () => setPanel("lands") }]),
                ...(readOnly ? [] : [{ key: "copy", label: copying ? "Copying…" : "Make a copy", active: false, onPick: copy }]),
              ]}
            />
          </>
        }
      />
      <div className={`mx-auto ${previewMode === "docked" ? "max-w-[1500px]" : ""} px-4 sm:px-6`}>

      {(panel === "search" || panel === "suggest") && !readOnly && (
        <div id="suggest-panel" className="drawer scroll-mt-4">
          <FindCards
            tab={panel}
            onTab={(t) => (t === "search" ? openSearch() : suggestFor && suggestShown ? setPanel("suggest") : suggestOverall())}
            onClose={() => setPanel(null)}
          >
            <div hidden={panel !== "search"}>
          <CardSearch
            priceSource={priceSource}
            // A new "See all results" while Search is already open starts it over with that text.
            key={searchSeed?.n ?? 0}
            entries={entries}
            identity={identity}
            commanderName={commanders.length === 1 ? commanders[0].card.name : commanders.length ? "your commanders" : null}
            onAdd={addWithNotice}
            onPreview={setPreview}
            onOpen={(list, index) => setFound({ list, index, from: "search" })}
            hideInDeck={prefs.searchHideInDeck === true}
            onHideInDeck={(hide) => updatePrefs({ searchHideInDeck: hide })}
            withBanned={prefs.allowBanned === true}
            onWithBanned={(on) => updatePrefs({ allowBanned: on })}
            initialText={searchSeed?.text}
            initialLabel={searchSeed?.label}
            wording={commanderWording.phrases}
            dismissed={{ has: (id) => dismissed.dismissed.has(id), toggle: (card) => toggleDismissed(card) }}
            wish={userId ? { has: wishlist.has, toggle: async (id) => say(await wishlist.toggle(id)) } : undefined}
            ownedOf={collection.tracking ? (id) => ownedCopies(collection.owned, id) : undefined}
          />
            </div>
            {suggestFor && suggestShown && (
              <div hidden={panel !== "suggest"}>
              <SuggestPanel
                priceSource={priceSource}
                source={suggestFor}
                identity={identity ? [...identity] : ["W", "U", "B", "R", "G"]}
                deckIds={[...new Set(Object.keys(entries).map((k) => k.split("|")[1]))]}
                isInDeck={(id) => Object.keys(entries).some((k) => k.endsWith(`|${id}`))}
                hasCommander={commanders.length > 0}
                roleNames={Object.fromEntries(roles.map((r) => [r.key, r.name]))}
                score={{
                  themes: suggestThemes,
                  keysOf: (c: PoolCard) => (trees ? cardKeys({ oracle: c.tags, art: [], commander: false, land: false }, themeSettings.specific, trees) : []),
                  rolesOf: (c: PoolCard) => visibleRoleKeys(c, c.tags),
                  under: new Set(roles.filter((r) => !r.land && (counts[r.key] ?? 0) < r.target).map((r) => r.key)),
                  settings: suggestStyle.settings,
                  groups: suggestGroups,
                }}
                onSettings={suggestStyle.setSettings}
                saveError={suggestStyle.saveError ?? dismissed.saveError}
                dismissed={dismissed.dismissed}
                onDismiss={(card) => toggleDismissed(card)}
                onRestore={dismissed.restore}
                bracket={{ target: bracket.target, deck: bracketDeck, deckIds: deckCardIds }}
                onAdd={addWithNotice}
                onPreview={setPreview}
                onOpen={(list, index) => setFound({ list, index, from: "suggest" })}
                onOverall={suggestFor && !(suggestFor.staples && !suggestFor.roleKey && !suggestFor.lands) ? suggestOverall : undefined}
                onSearch={openSearch}
                wish={userId ? { has: wishlist.has, toggle: async (id) => say(await wishlist.toggle(id)) } : undefined}
              />
              </div>
            )}
          </FindCards>
        </div>
      )}
      {panel === "import" && !readOnly && <ImportPanel entries={entries} printings={printings} deckCards={cards} onApply={applyImport} onClose={() => setPanel(null)} />}
      {panel === "share" && !readOnly && (
        <SharePanel
          deckId={deck.id}
          visibility={visibility}
          onChange={setVisibility}
          onClose={() => setPanel(null)}
          preview={{
            name: deck.name,
            art: commanders.find((l) => l.card.image_art_crop)?.card.image_art_crop ?? null,
            line: `${commanders.map((l) => l.card.name).join(" & ") || "Commander deck"} · ${size} cards · Bracket ${bracket.target}`,
          }}
        />
      )}
      {panel === "lands" && !readOnly && (
        <LandBasePanel
          priceSource={priceSource}
          identity={identity ? COLORS.filter((c) => identity.has(c)) : null}
          target={landTarget}
          landCount={counts[landRoleKey] ?? 0}
          {...landStats()}
          inDeck={(id) => Object.keys(entries).some((k) => k.endsWith(`|${id}`))}
          onApply={applyLandBase}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "spin" && !readOnly && (
        <SpinPanel
          tree={tags.tree}
          onClose={() => setPanel(null)}
          onChoose={(card) => {
            if (run(planAdd(entries, card, "commander"), card)) {
              setPanel(null);
              say(`${card.name} leads this deck.`, true);
            }
          }}
        />
      )}
      {panel === "bracket" && (
        <BracketPanel
          target={bracket.target}
          estimate={estimate}
          lines={[...commanders, ...companions, ...mainLines]}
          readOnly={readOnly}
          saveError={bracket.saveError}
          comboError={combos.error}
          paused={!!sheet}
          power={power}
          onTarget={bracket.setTarget}
          onOpenCard={openLine}
          onClose={closePanel}
        />
      )}
      {panel === "stats" && (
        <StatsPanel
          history={readOnly ? undefined : { deckId: deck.id, source: priceSource, total: totalPriceWithSplits(entries, pricedCards, pricedPrintings, pricedSplits) }}
          lines={[...commanders, ...companions, ...mainLines]}
          identity={identity}
          roles={roles}
          roleCounts={counts}
          roleKeysOf={lineRoleKeys}
          paused={!!sheet}
          onOpenCard={openLine}
          onClose={closePanel}
        />
      )}
      {editingPlays && !readOnly && (
        <PlaysEditor plays={plays} themes={themes} ranked={ranked} labelOf={tagLabel} onSave={savePlaysFromEditor} onClose={() => setEditingPlays(false)} />
      )}
      {panel === "cutter" && !readOnly && tags.tree && (
        <CutterPanel
          deckId={deck.id}
          lines={[...commanders, ...mainLines]}
          roleKeysOf={lineRoleKeys}
          tagsOf={(id) => tags.oracleTags[id] ?? []}
          roles={roles}
          tree={tags.tree}
          themesFor={(list) =>
            steeredThemes(
              list.map((c) => ({ oracle: c.tags, art: [], commander: c.commander, land: isLand(c.card.type_line) })),
              roleTagSet,
            )
          }
          keysOf={(t) => (trees ? cardKeys({ oracle: t, art: [], commander: false, land: false }, themeSettings.specific, trees) : [])}
          rolesFor={(c, t) => visibleRoleKeys(c, t)}
          combos={combos.combos}
          bracketFindings={estimate ? overTarget(estimate, bracket.target) : []}
          bracket={{ target: bracket.target, deck: bracketDeck }}
          identity={identity}
          dismissedSuggestions={dismissed.dismissed}
          state={cutter.state}
          setState={cutter.setState}
          prefs={cutterSettings.prefs}
          setPrefs={cutterSettings.setPrefs}
          saveError={cutter.saveError ?? cutterSettings.saveError}
          paused={!!sheet}
          onApply={applyCuts}
          onOpenCard={openLine}
          onSuggestRole={(key) => {
            setPanel(null);
            suggestForRole(key);
          }}
          onClose={closePanel}
        />
      )}
      {belowTarget && (
        <BelowTargetDialog
          lines={belowTarget.lines}
          onCancel={() => setBelowTarget(null)}
          onRemove={(stopWarning) => {
            if (stopWarning) cutterSettings.setPrefs((pr) => ({ ...pr, belowTargetWarning: false }));
            belowTarget.proceed();
            setBelowTarget(null);
          }}
        />
      )}
      {panel === "history" && !readOnly && (
        <HistoryPanel
          deckId={deck.id}
          current={{ entries, categories, printings }}
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
      {panel === "export" && <ExportPanel deckName={deck.name} entries={entries} printings={shownPrintings} cards={cards} splits={splits} onClose={() => setPanel(null)} />}

      <div ref={editorGrid} style={{ "--rail": `${railWidth}px` } as React.CSSProperties} className={`mt-6 grid gap-6 ${EDITOR_COLUMNS[previewMode === "docked" ? "docked" : "none"]}`}>
        {/* Wide screens: the role profile gets its own column on the left, as wide as the user drags it. */}
        <aside className="relative hidden min-w-0 xl:block">
          <RailHandle onDrag={dragRail} onDone={setRail} />
          {stage !== "full" ? (
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 pr-1">
              <RoleRail
                compact={stage === "compact"}
                roles={shownRoles}
                counts={counts}
                highlight={highlight}
                tags={shownThemes.slice(0, 6).map((t) => ({ key: t.key, label: prettyTag(t.label), count: t.count, value: highlightValue(t) }))}
                onHighlightRole={(key) => toggleHighlight(`role:${key}`)}
                onHighlightTag={toggleHighlight}
                onExpand={() => setRail(RAIL_DEFAULT)}
              />
            </div>
          ) : (
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 pr-1">
            <button type="button" onClick={() => setRail(RAIL_COLLAPSED)} className="mb-2 min-h-8 text-[13px] underline opacity-80 hover:opacity-100" title="Shrink this column so the cards get the room">
              ‹ Collapse
            </button>
            {/* Dragged wider, the panel flows into more columns, so more of it shows at once. */}
            <div className="gap-x-6 [column-width:250px] [&_h2]:break-after-avoid [&_li]:break-inside-avoid">
              {renderProfile()}
              <div className="mt-6 border-t border-foreground/10 pt-4">{renderTopTags()}</div>
              {!readOnly && <div className="mt-6 border-t border-foreground/10 pt-4">{renderMyTags()}</div>}
            </div>
          </div>
          )}
        </aside>

        <div className="min-w-0">
          {commanders.length === 0 && !readOnly && (
            <div className="panel mb-5 border-gold/40 p-5 text-center sm:p-8">
              <h2 className="display text-2xl sm:text-3xl">Who leads this deck?</h2>
              <p className="mx-auto mt-2 max-w-md opacity-85">Pick a commander. Everything else, colors, suggestions and tags, follows from it.</p>
              <div className="mx-auto mt-4 max-w-md">
                <QuickAdd
                  commanderOnly
                  withBanned={prefs.allowBanned === true}
                  onWithBanned={(on) => updatePrefs({ allowBanned: on })}
                  onAdd={(card) => {
                    const plan = planAdd(entries, card, "commander");
                    if (run(plan, card)) say(`${card.name} leads this deck.`, true);
                    else if (!plan.ok) return plan.reason;
                  }}
                  onPreview={setPreview}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                <button type="button" onClick={() => setPanel("spin")} className="btn min-h-11" title="Five random commanders to choose from">
                  🎲 Spin the wheel
                </button>
                <button type="button" onClick={() => setPanel("import")} className="min-h-10 px-2 text-sm underline opacity-85 hover:opacity-100">
                  Or import a list you already have
                </button>
              </div>
            </div>
          )}
          {/* Narrower screens: roles stay in view as a strip; targets and tags sit behind one row of tabs. */}
          {roles.length > 0 && (
            <div className="mb-1.5 flex items-baseline justify-between gap-2 xl:hidden">
              <h2 className="display text-lg">What this deck needs</h2>
              <span className="text-[13px] opacity-75">
                {roles.filter((r) => (counts[r.key] ?? 0) >= r.target).length} of {roles.length} roles met
              </span>
            </div>
          )}
          {roles.length > 0 && (
            <ul aria-label="Roles" className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 xl:hidden">
              {roles.map((r) => {
                const n = counts[r.key] ?? 0;
                return (
                  <li key={r.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleHighlight(`role:${r.key}`)}
                      aria-pressed={highlight === `role:${r.key}`}
                      title={`Highlight the ${r.name} cards`}
                      className={`panel block min-h-11 min-w-24 px-2.5 py-1 text-left text-[13px] ${highlight === `role:${r.key}` ? "border-gold" : ""}`}
                    >
                      <span className="flex justify-between gap-2">
                        <span className="font-medium">{r.name}</span>
                        <span className={`tabular-nums ${n < r.target ? "text-amber-400" : "text-green-400"}`}>
                          {n}/{r.target}
                        </span>
                      </span>
                      <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10">
                        <span className="block h-full" style={{ width: `${Math.min(100, r.target ? (n / r.target) * 100 : 100)}%`, background: roleColor(r.name) }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mb-3 flex gap-2 xl:hidden">
            <FoldTab active={fold === "roles"} onClick={() => setFold(fold === "roles" ? null : "roles")}>
              Roles
            </FoldTab>
            <FoldTab active={fold === "tags"} onClick={() => setFold(fold === "tags" ? null : "tags")}>
              Top tags
            </FoldTab>
            {!readOnly && (
              <FoldTab active={fold === "mine"} onClick={() => setFold(fold === "mine" ? null : "mine")}>
                My tags
              </FoldTab>
            )}
          </div>
          {fold && (
            <div className="panel mb-4 p-3 xl:hidden">
              {fold === "roles" && renderProfile(true)}
              {fold === "tags" && renderTopTags(true)}
              {fold === "mine" && !readOnly && renderMyTags(true)}
            </div>
          )}
          {!readOnly && commanders.length > 0 && (
            <QuickAdd
              ref={quickAdd}
              withBanned={prefs.allowBanned === true}
              onAdd={(card, board) => {
                const plan = planAdd(entries, card, board);
                if (run(plan, card)) {
                  flash(card.oracle_id);
                  say(`Added ${card.name} to the ${BOARD_LABELS[board].toLowerCase()}.`, true);
                } else if (!plan.ok) return plan.reason;
              }}
              onPreview={setPreview}
              identity={identity}
              onSeeAll={(text) => openSearch(text)}
            />
          )}
          <Toast message={notice} onUndo={noticeUndo && state.past.length > 0 ? undo : undefined} />

          {/* Stays in reach while scrolling a long deck. */}
          <div className="sticky top-0 z-20 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-b border-foreground/10 bg-background/90 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
            <div className="min-w-0 basis-full sm:basis-auto">
              <DeckToolbar settings={view} onChange={setView} />
            </div>
            {!readOnly && (
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                  aria-pressed={selecting}
                  title="Select several cards to move, tag or remove them at once (or Ctrl/Shift-click cards)"
                  className="btn"
                >
                  {selecting ? "Done" : "Select"}
                </button>
                <HeaderButton onClick={undo} disabled={state.past.length === 0} title="Undo (Ctrl+Z)">
                  Undo
                </HeaderButton>
                <HeaderButton onClick={redo} disabled={state.future.length === 0} title="Redo (Ctrl+Shift+Z)">
                  Redo
                </HeaderButton>
                <SaveIndicator status={status} onRetry={retry} />
              </div>
            )}
            {tags.error && <span className="w-full text-sm text-amber-400">{tags.error}</span>}
          </div>

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

          <div className={`mt-4 ${selecting ? "select-none" : ""}`}>
            {sections.length === 0 ? (
              commanders.length > 0 ? null : <p className="px-1.5 text-center text-sm opacity-75">You can also drag cards in from Scryfall.</p>
            ) : (
              <DeckView
                sections={sections}
                view={view.view}
                roomy={stage !== "full"}
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
                onQuantity={(l, n) => {
                  const plan = planSetQuantity(entries, l.card, l.board, n);
                  guardRemoval(plan, () => {
                    if (run(plan) && n === 0) say(`Removed ${l.card.name}.`, true);
                  });
                }}
                onCardDrop={view.group === "role" && !readOnly && roles.length > 0 ? dropOnRole : undefined}
              />
            )}
          </div>
        </div>

        {previewMode === "docked" && <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
            <CardPanel
              card={shown}
              roleKeys={shownLine ? lineRoleKeys(shownLine) : shown ? roleKeysOf(shown) : []}
              extra={
                shown && (
                  <PanelMyTags
                    tags={myTagsOfCard(shown.oracle_id)}
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
                const line = shown && order.find((l) => l.card.oracle_id === shown.oracle_id);
                if (line) openLine(line);
              }}
            />
          </div>
        </aside>}
      </div>
      {previewMode === "float" && preview && !sheet && (
        <FloatingPreview
          side={previewSide}
          card={preview}
          roleKeys={shownLine ? lineRoleKeys(shownLine) : roleKeysOf(preview)}
          extra={<PanelMyTags tags={myTagsOfCard(preview.oracle_id)} highlight={highlight} onHighlight={() => {}} />}
          roles={roles}
          tags={tags}
          highlight={highlight}
        />
      )}

      <SummaryBar
        deckLines={[...commanders, ...mainLines]}
        size={size}
        price={totalPriceWithSplits(entries, pricedCards, pricedPrintings, pricedSplits)}
        unowned={collection.tracking ? unownedPrice(collection.owned, [...commanders, ...companions, ...mainLines]) : undefined}
      />

      {selecting && !readOnly && (
        <>
          {/* Room so the bar never covers the last cards. */}
          <div aria-hidden className="h-40" />
          <BulkBar
            count={selectedLines.length}
            total={selectable.length}
            tags={userId ? myTags.tags : []}
            canSetCopies={selectedLines.some((l) => l.card.max_copies > 1)}
            onMove={bulkMove}
            onTag={bulkTag}
            onCopies={bulkCopies}
            onRemove={bulkRemove}
            onMarkOwned={userId ? bulkMarkOwned : undefined}
            onSelectAll={() => setSelected(new Set(selectable.map((o) => entryKey(o.board, o.card.oracle_id))))}
            onClear={() => setSelected(new Set())}
            onDone={stopSelecting}
          />
        </>
      )}
      </div>

      {sheetLine && (
        <CardSheet
          deckId={deck.id}
          line={{ ...sheetLine, printing: shownPrintings[entryKey(sheetLine.board, sheetLine.card.oracle_id)] ?? sheetLine.printing }}
          index={sheetIndex}
          total={order.length}
          warnings={warningsFor(sheetLine)}
          roleKeys={lineRoleKeys(sheetLine)}
          flags={flags[sheetLine.card.oracle_id] ?? 0}
          isCover={coverId === sheetLine.card.oracle_id}
          onCover={(on) => chooseCover(on ? sheetLine.card.oracle_id : null)}
          manaValue={{
            own: cards[sheetLine.card.oracle_id]?.mana_value ?? sheetLine.card.mana_value,
            counted: manaValues[sheetLine.card.oracle_id] ?? null,
            onChange: (v) => setManaValue(sheetLine.card.oracle_id, v, cards[sheetLine.card.oracle_id]?.mana_value ?? sheetLine.card.mana_value),
          }}
          wish={userId ? { on: wishlist.has(sheetLine.card.oracle_id), onToggle: async () => say(await wishlist.toggle(sheetLine.card.oracle_id)) } : undefined}
          collection={collectionBox(sheetLine.card.oracle_id, shownParts(sheetLine, splits, cards[sheetLine.card.oracle_id]).at(-1)!)}
          mixed={{
            parts: splits[entryKey(sheetLine.board, sheetLine.card.oracle_id)] ?? [],
            onChange: (parts) => saveSplit(sheetLine.board, sheetLine.card.oracle_id, parts),
          }}
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
                {sheetLine.board === "main" && (
                  <button
                    type="button"
                    onClick={() => toggleLock(sheetLine.card, !locked.has(sheetLine.card.oracle_id))}
                    className="min-h-11 rounded-lg border border-foreground/20 px-3 text-sm"
                    title="The Smart Cutter never suggests cutting a locked card"
                  >
                    {locked.has(sheetLine.card.oracle_id) ? "🔓 Unlock (the Smart Cutter may suggest it)" : "🔒 Lock: never suggest cutting"}
                  </button>
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
            const plan = planMove(entries, sheetLine.card, sheetLine.board, to);
            guardRemoval(plan, () => {
              if (run(plan)) setSheet({ oracle_id: sheetLine.card.oracle_id, board: to });
            });
          }}
          onQuantity={(n) => {
            const plan = planSetQuantity(entries, sheetLine.card, sheetLine.board, n);
            guardRemoval(plan, () => {
              if (run(plan) && n === 0) say(`Removed ${sheetLine.card.name}.`, true);
            });
          }}
          pickedHere={!!printings[entryKey(sheetLine.board, sheetLine.card.oracle_id)]}
          myDefault={preferred[sheetLine.card.oracle_id] ?? null}
          onSetDefault={async (to) => {
            const { card, board } = sheetLine;
            const problem = await setDefault(card.oracle_id, to);
            if (problem) return say(problem);
            say(to ? `${to.set_name} is now your default ${card.name} in all your decks.` : `Cleared your default ${card.name}.`);
            // A plain pick of the same printing would stop this deck following the default later. Foil stays a pick.
            const own = printings[entryKey(board, card.oracle_id)];
            if (to && own?.id === to.id && !own.foil) run(planPrinting(printings, card, board, null));
          }}
          onPrinting={(to) => {
            const plan = planPrinting(printings, sheetLine.card, sheetLine.board, to);
            if (run(plan) && plan.ok) say(`${plan.change.label}. Ctrl+Z undoes it.`);
          }}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSheet(null)}
          onSearchWording={
            readOnly
              ? undefined
              : (query, label) => {
                  setSheet(null);
                  openSearch(query, label);
                }
          }
        />
      )}
      {found && !sheetLine && renderFoundSheet(found)}
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
    <button onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className="btn">
      {children}
    </button>
  );
}

function FoldTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active} className={`btn min-w-0 flex-1 ${active ? "border-gold text-gold" : ""}`}>
      {children}
    </button>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <span className="flex items-center gap-2 text-red-400" title={status.error}>
        Not saved ({status.pending} {status.pending === 1 ? "change" : "changes"})
        <button onClick={onRetry} className="rounded border border-red-400/50 px-2 py-0.5">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className={`hidden text-[13px] sm:inline ${status.state === "saving" ? "text-amber-400" : "text-green-400"}`} aria-live="polite">
      {status.state === "saving" ? "Saving…" : "✓ Saved"}
    </span>
  );
}

/** Asks before a manual removal puts a role below target; "Don't warn me again" turns it off (also in Settings). */
function BelowTargetDialog({ lines, onCancel, onRemove }: { lines: string[]; onCancel: () => void; onRemove: (stopWarning: boolean) => void }) {
  const [stop, setStop] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div role="alertdialog" aria-label="Role below target" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="panel w-full max-w-md space-y-3 bg-panel-raised p-5 text-sm">
        <h3 className="display text-xl">Remove anyway?</h3>
        <ul className="list-disc pl-5 text-amber-800 dark:text-amber-300">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} className="h-5 w-5" />
          Don&apos;t warn me again
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" autoFocus className="btn min-h-11" onClick={onCancel}>
            Keep it
          </button>
          <button type="button" className="btn min-h-11 border-red-400 text-red-400" onClick={() => onRemove(stop)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
