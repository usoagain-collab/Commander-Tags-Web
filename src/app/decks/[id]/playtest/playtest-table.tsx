"use client";

// The playtest table (Phase 6a): solo goldfish on any screen. All game logic lives in src/lib/playtest/game.ts; this
// file draws the wide-screen table and the shared dialogs, and turns drags, clicks and keys into those functions.
// Narrow, short or touch screens get the layout in phone-table.tsx. The game is kept in session storage, so a refresh
// doesn't lose it (this tab only; nothing goes to the database).
import { useRoom } from "@/lib/playtest/use-room";
import { Multiplayer } from "./multiplayer";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokenImage, type DeckToken } from "@/lib/deck/tokens";
import { CardSheet, PhoneTable } from "./phone-table";
import {
  createToken,
  addCounter,
  COUNTER_KINDS,
  mill,
  resolveScry,
  setTopRevealed,
  topCards,
  zoneOf,
  type ScryChoice,
  bottomCount,
  commanderTax,
  pilesOf,
  type Pile,
  deckKey,
  draw,
  keep,
  move,
  mulligan,
  newGame,
  nextTurn,
  putOnBottom,
  readSaved,
  setLife,
  shuffleLibrary,
  toggleTap,
  untapAll,
  type DeckCard,
  type GameState,
  type Instance,
  type Zone,
} from "@/lib/playtest/game";

const DRAG_TYPE = "application/x-ctw-iid";
const storageKey = (deckId: string) => `playtest:${deckId}`;

type Props = {
  deck: { id: string; name: string };
  cards: DeckCard[];
  tokens: DeckToken[];
  canFlag: boolean;
  /** Your name at a shared table (v2 multiplayer). */
  playerName?: string | null;
};

/** Reads a CSS media query, live. */
function useMedia(query: string) {
  return useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function PlaytestTable({ deck, cards, tokens, canFlag, playerName }: Props) {
  const key = deckKey(cards);
  // A narrow window, a sideways phone, or any touch screen: mouse-style dragging doesn't suit these.
  const compact = useMedia("(max-width: 767px), (max-height: 520px), (pointer: coarse)");
  const tablet = useMedia("(min-width: 700px) and (min-height: 600px)");
  const sideways = useMedia("(max-height: 520px) and (orientation: landscape)");
  // The card seen big in the phone layout's card sheet.
  const [inspect, setInspect] = useState<string | null>(null);
  const freeSpot = useRef<((g: GameState) => { x: number; y: number }) | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [preview, setPreview] = useState<Instance | null>(null);
  const [viewing, setViewing] = useState<Zone | null>(null);
  // 6b: right-click menu on a battlefield card, and the library tool being used.
  const [menu, setMenu] = useState<{ iid: string; x: number; y: number } | null>(null);
  const [tool, setTool] = useState<"search" | "scry" | "mill" | "tokens" | null>(null);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  }, []);

  /** Flags a card as an underperformer for this deck (6d): saved to the deck, shown as a badge in the editor. */
  const flag = useCallback(
    async (inst: Instance) => {
      if (inst.token) return say("Tokens can't be flagged.");
      if (!canFlag) return say("Only the deck's owner can flag cards.");
      const { data, error } = await createClient().rpc("flag_card", { p_deck: deck.id, p_oracle: inst.oracleId });
      say(error ? `Couldn't flag: ${error.message}` : `⚑ Flagged ${inst.name} as an underperformer (${data}×). It shows in the editor.`);
    },
    [canFlag, deck.id, say],
  );

  // Restore this tab's game for the same deck list, or deal a new one.
  useEffect(() => {
    let saved: GameState | null = null;
    try {
      saved = readSaved(sessionStorage.getItem(storageKey(deck.id)), key);
    } catch {
      // storage blocked: just play without saving
    }
    setGame(saved ?? newGame(cards, Date.now() >>> 0));
    // Only on first load; New game deals again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!game) return;
    try {
      sessionStorage.setItem(storageKey(deck.id), JSON.stringify({ deckKey: key, state: game }));
    } catch {
      // storage full or blocked: the game still works, it just won't survive a refresh
    }
  }, [game, deck.id, key]);

  const update = useCallback((fn: (g: GameState) => GameState) => setGame((g) => (g ? fn(g) : g)), []);
  const clearPreview = useCallback(() => setPreview(null), []);
  // Multiplayer (v2): a shared table by room code; each player runs their own game.
  const room = useRoom(game, { name: playerName || "Player", deck: deck.name });
  const restart = () => setGame((g) => newGame(cards, Date.now() >>> 0, g?.freeMulligan ?? true));

  // Keys for the common actions (6d adds the rest and a help sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        setViewing(null);
        setMenu(null);
        setTool(null);
        setHelp(false);
        setInspect(null);
      }
      if (e.key === "?") {
        setHelp((h) => !h);
        e.preventDefault();
        return;
      }
      if (!game || game.stage !== "playing" || tool) return;
      // Keys that act on the card under the mouse (any zone it's visible in).
      const hovered = preview && game.cards[preview.iid] ? preview : null;
      const onField = hovered && game.battlefield[hovered.iid] ? hovered.iid : null;
      if ((e.key === "+" || e.key === "=") && onField) update((g) => addCounter(g, onField, "+1/+1", 1));
      else if (e.key === "-" && onField) update((g) => addCounter(g, onField, "+1/+1", -1));
      else if (k === "t" && onField) update((g) => toggleTap(g, onField));
      else if (k === "f" && hovered) void flag(hovered);
      else if (k === "g" && hovered) update((g) => move(g, hovered.iid, "graveyard"));
      else if (k === "e" && hovered) update((g) => move(g, hovered.iid, "exile"));
      else if (k === "h" && hovered) update((g) => move(g, hovered.iid, "hand"));
      else if (k === "b" && hovered && !onField) update((g) => move(g, hovered.iid, "battlefield"));
      // Table actions.
      else if (k === "n") update(nextTurn);
      else if (k === "u") update(untapAll);
      else if (k === "d") update((g) => draw(g));
      else if (k === "s") update(shuffleLibrary);
      else if (k === "l") setTool("search");
      else if (k === "y") setTool("scry");
      else if (k === "m") setTool("mill");
      else if (k === "k") setTool("tokens");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, update, preview, tool, flag]);

  if (cards.length === 0)
    return (
      <p className="p-6 text-sm">
        This deck has no cards to play yet.{" "}
        <Link href={`/decks/${deck.id}`} className="underline">
          Back to the deck
        </Link>
      </p>
    );
  if (!game) return <p className="p-6 text-sm opacity-70">Shuffling…</p>;
  const card = (iid: string) => game.cards[iid];
  // A card played without a drop position takes the phone layout's next free spot when that layout is showing.
  const drop = (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) =>
    update((g) => move(g, iid, to, to === "battlefield" && !opts?.at && freeSpot.current ? { ...opts, at: freeSpot.current(g) } : opts));
  const onInspect = compact ? setInspect : undefined;

  return (
    <>
      {compact ? (
        <PhoneTable game={game} deck={deck} update={update} onMove={drop} onNewGame={restart} onTool={setTool} onView={setViewing} onInspect={setInspect} freeSpotRef={freeSpot} scale={tablet ? 1.5 : 1} landscape={sideways} />
      ) : (
      <main className="fixed inset-0 z-[45] flex flex-col gap-2 bg-background p-2">
        <TopBar game={game} deck={deck} update={update} onNewGame={restart} onTool={setTool} onHelp={() => setHelp(true)} />
        <div className="flex min-h-0 flex-1 gap-2">
          {/* Side zones: scrolls on short screens rather than spilling into the hand. */}
          <aside className="w-[11.5rem] shrink-0 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <CommandZone game={game} onDrop={(iid) => drop(iid, "command")} onPreview={setPreview} />
              <LibraryZone game={game} onDraw={() => update((g) => draw(g))} onDrop={(iid, where) => drop(iid, "library", { library: where })} />
              <PileZone title="Yard" zone="graveyard" game={game} onDrop={(iid) => drop(iid, "graveyard")} onOpen={() => setViewing("graveyard")} onPreview={setPreview} />
              <PileZone title="Exile" zone="exile" game={game} onDrop={(iid) => drop(iid, "exile")} onOpen={() => setViewing("exile")} onPreview={setPreview} />
            </div>
          </aside>
          <Battlefield
            game={game}
            onDrop={(iid, at) => drop(iid, "battlefield", { at })}
            onTap={(iid) => update((g) => toggleTap(g, iid))}
            onPreview={setPreview}
            onMenu={(iid, x, y) => setMenu({ iid, x, y })}
          />
        </div>
        <Hand game={game} onDrop={(iid) => drop(iid, "hand")} onPreview={setPreview} onBottom={(iid) => update((g) => putOnBottom(g, iid))} onPlay={(iid) => drop(iid, "battlefield")} />
      </main>
      )}

      {!compact && <HoverPreview card={preview} onLeave={clearPreview} />}
      {game.stage === "mulligan" && <MulliganDialog game={game} update={update} card={card} onInspect={onInspect} />}
      {viewing && <ZoneViewer zone={viewing} game={game} onClose={() => setViewing(null)} onMove={drop} onPreview={setPreview} onInspect={onInspect} />}
      {inspect && compact && <CardSheet game={game} iid={inspect} update={update} onMove={drop} onFlag={flag} canFlag={canFlag} onClose={() => setInspect(null)} />}
      {menu && zoneOf(game, menu.iid) === "battlefield" && (
        <CardMenu game={game} at={menu} update={update} onMove={drop} onFlag={flag} onClose={() => setMenu(null)} />
      )}
      {tool === "search" && <LibrarySearch game={game} update={update} onMove={drop} onPreview={setPreview} onInspect={onInspect} onClose={() => setTool(null)} />}
      {tool === "scry" && <ScryDialog compact={compact} game={game} update={update} onClose={() => setTool(null)} />}
      {tool === "mill" && <MillDialog compact={compact} game={game} update={update} onClose={() => setTool(null)} />}
      {tool === "tokens" && <TokenPicker compact={compact} tokens={tokens} update={update} onClose={() => setTool(null)} />}
      {help && <ShortcutSheet onClose={() => setHelp(false)} />}
      <Multiplayer room={room} compact={compact} />
      {toast && (
        <div role="status" className={`fixed left-1/2 z-[70] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-gold px-4 py-2 text-sm text-gold-ink shadow-lg ${compact ? "top-14" : "bottom-6"}`}>
          {toast}
        </div>
      )}
    </>
  );
}

// ---------- top bar ----------

function TopBar({
  game,
  deck,
  update,
  onNewGame,
  onTool,
  onHelp,
}: {
  game: GameState;
  deck: { id: string; name: string };
  update: (fn: (g: GameState) => GameState) => void;
  onNewGame: () => void;
  onTool: (t: "search" | "scry" | "mill" | "tokens") => void;
  onHelp: () => void;
}) {
  const playing = game.stage === "playing";
  return (
    <div className="flex shrink-0 items-center gap-2 text-sm">
      <Link href={`/decks/${deck.id}`} aria-label={`Back to ${deck.name}`} className="btn font-bold">
        <span aria-hidden>←</span> Deck
      </Link>
      <span className="rounded-md bg-foreground/10 px-3 py-1.5 font-semibold tabular-nums">Turn {game.turn}</span>
      <BarButton primary disabled={!playing} onClick={() => update(nextTurn)} hint="N">
        Next turn
      </BarButton>
      <TableMenu game={game} update={update} onNewGame={onNewGame} onTool={onTool} onHelp={onHelp} />
      <span className="ml-auto flex items-center gap-1" aria-label="Life total">
        <BarButton onClick={() => update((g) => setLife(g, g.life - 1))} label="Lose 1 life">
          −
        </BarButton>
        <span className="display min-w-14 text-center text-3xl leading-none tabular-nums text-gold">{game.life}</span>
        <BarButton onClick={() => update((g) => setLife(g, g.life + 1))} label="Gain 1 life">
          +
        </BarButton>
      </span>
      {/* The table covers the site footer, so the credit sits here. */}
      <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" className="hidden text-xs opacity-60 hover:underline lg:inline">
        Card data and images: Scryfall
      </a>
    </div>
  );
}

/** Everything but Next turn, one click away. Closes on picking, clicking elsewhere, or Esc. */
function TableMenu({
  game,
  update,
  onNewGame,
  onTool,
  onHelp,
}: {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  onNewGame: () => void;
  onTool: (t: "search" | "scry" | "mill" | "tokens") => void;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const playing = game.stage === "playing";
  const item = (label: string, hint: string | null, disabled: boolean, onPick: () => void) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        onPick();
      }}
      className="flex min-h-9 w-full items-center justify-between gap-4 px-3 text-left text-sm hover:bg-foreground/10 disabled:opacity-40"
    >
      {label}
      {hint && <kbd aria-hidden className="rounded border border-current/30 px-1 text-[11px] font-normal opacity-75">{hint}</kbd>}
    </button>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Actions <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="panel absolute left-0 z-50 mt-1 w-56 overflow-hidden bg-panel-raised py-1 shadow-2xl">
          {item("Untap all", "U", !playing, () => update(untapAll))}
          {item("Draw", "D", !playing, () => update((g) => draw(g)))}
          {item("Shuffle library", "S", false, () => update(shuffleLibrary))}
          <div className="my-1 border-t border-foreground/15" />
          {item("Search library", "L", !playing, () => onTool("search"))}
          {item("Scry / surveil", "Y", !playing, () => onTool("scry"))}
          {item("Mill", "M", !playing, () => onTool("mill"))}
          {item("Tokens", "K", !playing, () => onTool("tokens"))}
          <label className="flex min-h-9 items-center gap-2 px-3 text-sm hover:bg-foreground/10" title="Keep the library's top card face up">
            <input type="checkbox" checked={!!game.topRevealed} onChange={(e) => update((g) => setTopRevealed(g, e.target.checked))} />
            Top card face up
          </label>
          <div className="my-1 border-t border-foreground/15" />
          {item("Keyboard shortcuts", "?", false, onHelp)}
          {item("New game", null, false, onNewGame)}
        </div>
      )}
    </div>
  );
}

function BarButton({
  onClick,
  disabled,
  hint,
  label,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  label?: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  // A text button names itself; the shortcut key is announced as a shortcut, not as part of the name.
  const name = label ?? (typeof children === "string" ? children : undefined);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      aria-keyshortcuts={hint}
      title={hint ? `${name ?? ""} (${hint})`.trim() : name}
      className={`btn ${primary ? "btn-gold" : ""}`}
    >
      {children}
      {hint && <kbd aria-hidden className="rounded border border-current/30 px-1 text-[11px] font-normal opacity-75">{hint}</kbd>}
    </button>
  );
}

// ---------- cards and drop targets ----------

/** Width of the cards in the side zones. */
const ZONE_CARD = 72;

/** A card the player can drag. `size` is the width in px. */
function CardView({
  inst,
  size,
  tapped,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPreview,
  title,
}: {
  inst: Instance;
  size: number;
  tapped?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onPreview: (c: Instance | null) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, inst.iid);
        e.dataTransfer.effectAllowed = "move";
        const r = e.currentTarget.getBoundingClientRect();
        // Remember where the card was grabbed, so it lands where it's dropped, not by its corner.
        e.dataTransfer.setData("application/x-ctw-grab", `${e.clientX - r.left},${e.clientY - r.top}`);
        onPreview(null);
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e);
            }
          : undefined
      }
      onMouseEnter={() => onPreview(inst)}
      onMouseLeave={() => onPreview(null)}
      title={title ?? inst.name}
      style={{ width: size }}
      className={`block shrink-0 transition-transform ${tapped ? "rotate-90" : ""}`}
    >
      {inst.image ? (
        <img src={inst.image} alt={inst.name} draggable={false} className="w-full rounded-[4.75%/3.5%] shadow" />
      ) : (
        <span className="flex aspect-[63/88] w-full items-center justify-center rounded-lg border bg-foreground/5 p-1 text-center text-[10px]">{inst.name}</span>
      )}
    </button>
  );
}

/** A zone that accepts dragged cards; outlined while one is over it. */
function DropTarget({
  onDrop,
  className = "",
  children,
  label,
}: {
  onDrop: (iid: string, e: React.DragEvent) => void;
  className?: string;
  children: React.ReactNode;
  label: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      aria-label={label}
      className={`${className} ${over ? "outline-2 outline-dashed outline-amber-500" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        const iid = e.dataTransfer.getData(DRAG_TYPE);
        setOver(false);
        if (!iid) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(iid, e);
      }}
    >
      {children}
    </div>
  );
}

function ZoneLabel({ title, count, extra }: { title: string; count: number; extra?: React.ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-1 text-xs font-semibold uppercase tracking-wide opacity-70">
      <span>{title}</span>
      <span className="tabular-nums">
        {extra}
        {count}
      </span>
    </p>
  );
}

// ---------- side zones ----------

function CommandZone({ game, onDrop, onPreview }: { game: GameState; onDrop: (iid: string) => void; onPreview: (c: Instance | null) => void }) {
  const ids = game.zones.command;
  // Every commander's tax, wherever it is now. Partners need their names to tell the two apart.
  const commanders = Object.values(game.cards).filter((c) => c.commander);
  return (
    <DropTarget label="Command zone" onDrop={onDrop} className="rounded-lg border border-foreground/15 p-1.5">
      <ZoneLabel title="Command" count={ids.length} />
      {commanders.map((c) => (
        <p key={c.iid} className="truncate text-xs tabular-nums" title="Commander tax: 2 more for each time it was cast from the command zone">
          {commanders.length > 1 ? c.name.split(",")[0] : "Tax"}: <strong>{commanderTax(game, c.iid)}</strong>
        </p>
      ))}
      <div className="mt-1 flex flex-col gap-1">
        {ids.map((iid) => (
          <div key={iid}>
            <CardView inst={game.cards[iid]} size={ZONE_CARD} onPreview={onPreview} title={`${game.cards[iid].name}: drag to the battlefield to cast`} />
          </div>
        ))}
      </div>
    </DropTarget>
  );
}

function LibraryZone({ game, onDraw, onDrop }: { game: GameState; onDraw: () => void; onDrop: (iid: string, where: "top" | "bottom") => void }) {
  const n = game.zones.library.length;
  const dragging = useDragging();
  return (
    <div className="rounded-lg border border-foreground/15 p-1.5">
      <ZoneLabel title="Library" count={n} />
      <div className="relative mt-1">
        {game.topRevealed && n > 0 ? (
          <TopCard inst={game.cards[game.zones.library[0]]} disabled={game.stage !== "playing"} onDraw={onDraw} />
        ) : (
          <button
            type="button"
            onClick={onDraw}
            disabled={!n || game.stage !== "playing"}
            title="Click to draw (D)"
            className="flex aspect-[63/88] w-[72px] items-center justify-center rounded-[4.75%/3.5%] border border-foreground/30 bg-gradient-to-br from-amber-900 to-stone-800 text-sm font-semibold text-amber-100 shadow disabled:opacity-50"
          >
            {n ? "Draw" : "Empty"}
          </button>
        )}
        {/* While dragging, the library splits into a top and a bottom drop target. */}
        {dragging && (
          <div className="absolute inset-0 flex w-[72px] flex-col overflow-hidden rounded-[4.75%/3.5%] text-xs font-semibold text-white">
            <DropTarget label="Library top" onDrop={(iid) => onDrop(iid, "top")} className="flex flex-1 items-center justify-center bg-black/50">
              Top
            </DropTarget>
            <DropTarget label="Library bottom" onDrop={(iid) => onDrop(iid, "bottom")} className="flex flex-1 items-center justify-center border-t border-white/40 bg-black/50">
              Bottom
            </DropTarget>
          </div>
        )}
      </div>

    </div>
  );
}

function PileZone({
  title,
  zone,
  game,
  onDrop,
  onOpen,
  onPreview,
}: {
  title: string;
  zone: "graveyard" | "exile";
  game: GameState;
  onDrop: (iid: string) => void;
  onOpen: () => void;
  onPreview: (c: Instance | null) => void;
}) {
  const ids = game.zones[zone];
  const top = ids.at(-1);
  return (
    <DropTarget label={title} onDrop={onDrop} className="rounded-lg border border-foreground/15 p-1.5">
      <ZoneLabel title={title} count={ids.length} />
      <div className="mt-1">
        {top ? (
          <CardView inst={game.cards[top]} size={ZONE_CARD} onPreview={onPreview} onClick={onOpen} title={`${game.cards[top].name}: click to see all ${ids.length}`} />
        ) : (
          <div className="flex aspect-[63/88] w-[72px] items-center justify-center rounded-lg border border-dashed border-foreground/20 text-xs opacity-50">Empty</div>
        )}
      </div>
    </DropTarget>
  );
}

// ---------- battlefield ----------

function Battlefield({
  game,
  onDrop,
  onTap,
  onPreview,
  onMenu,
}: {
  game: GameState;
  onDrop: (iid: string, at: { x: number; y: number }) => void;
  onTap: (iid: string) => void;
  onPreview: (c: Instance | null) => void;
  onMenu: (iid: string, x: number, y: number) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  // The commander's art lies faintly across the table for the whole game, wherever the commander goes.
  const art = useRef(game.cards[game.zones.command[0]]?.image?.replace("/normal/", "/art_crop/") ?? null);
  const ids = game.zones.battlefield;
  const lands = ids.filter((iid) => game.cards[iid].land);
  const tokenIds = ids.filter((iid) => game.cards[iid].token);
  const others = ids.filter((iid) => !game.cards[iid].land && !game.cards[iid].token);

  // A click taps or untaps the next card in the pile, so there's nothing to aim at. The top card stays put as a pile
  // shrinks (the depth behind it never changes the width), so repeated clicks keep landing on the same pile.
  const pileRow = (label: string, count: number, piles: Pile[]) => (
    <div className="flex min-h-[120px] items-end gap-2 overflow-x-auto border-t border-foreground/10 px-2 py-2">
      <span className="self-center text-xs font-semibold uppercase tracking-wide opacity-50">
        {label} {count}
      </span>
      {piles.map((pile) => {
        const iid = pile.ids[0];
        const inst = game.cards[iid];
        return (
          <div key={pile.key} className={`enter relative shrink-0 cursor-pointer pl-2 ${pile.tapped ? "mx-3" : ""}`} onClick={() => onTap(iid)}>
            {pile.ids.slice(1, 3).map((behind, i) => (
              <div key={behind} aria-hidden className={`pointer-events-none absolute top-0 w-[72px] ${pile.tapped ? "rotate-90" : ""}`} style={{ left: 4 - i * 4 }}>
                {inst.image ? <img src={inst.image} alt="" className="w-full rounded-[4.75%/3.5%] shadow" /> : <div className="aspect-[63/88] rounded-lg border bg-foreground/5" />}
              </div>
            ))}
            <div className="relative">
              <CardView
                inst={inst}
                size={72}
                tapped={pile.tapped}
                onContextMenu={(e) => onMenu(iid, e.clientX, e.clientY)}
                onPreview={onPreview}
                title={`${pile.ids.length} × ${inst.name}: click to ${pile.tapped ? "untap" : "tap"} one, right-click for counters and moves`}
              />
              <CounterBadges counters={game.battlefield[iid]?.counters} />
            </div>
            {pile.ids.length > 1 && <span className="pointer-events-none absolute -top-2 right-0 z-10 rounded bg-black/80 px-1.5 text-xs font-semibold text-white">×{pile.ids.length}</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <DropTarget
      label="Battlefield"
      className="felt flex min-w-0 flex-1 flex-col rounded-xl border border-foreground/15"
      onDrop={(iid, e) => {
        const r = area.current!.getBoundingClientRect();
        const [gx, gy] = (e.dataTransfer.getData("application/x-ctw-grab") || "0,0").split(",").map(Number);
        onDrop(iid, { x: ((e.clientX - gx - r.left) / r.width) * 100, y: ((e.clientY - gy - r.top) / r.height) * 100 });
      }}
    >
      {/* Free area: cards stay exactly where they're dropped. */}
      <div ref={area} className="relative min-h-0 flex-1">
        {art.current && <img aria-hidden src={art.current} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full rounded-t-xl object-cover opacity-[0.16]" />}
        {others.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm opacity-70">Drag cards here to play them, or double-click a card in your hand</p>}
        {others.map((iid) => {
          const p = game.battlefield[iid];
          return (
            <div key={iid} className="enter absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <CardView
                inst={game.cards[iid]}
                size={100}
                tapped={p.tapped}
                onClick={() => onTap(iid)}
                onContextMenu={(e) => onMenu(iid, e.clientX, e.clientY)}
                onPreview={onPreview}
                title={`${game.cards[iid].name}: click to tap, right-click for counters and moves`}
              />
              <CounterBadges counters={p.counters} />
            </div>
          );
        })}
      </div>
      {tokenIds.length > 0 && pileRow("Tokens", tokenIds.length, pilesOf(game, tokenIds))}
      {/* Lands row, grouped automatically. */}
      {pileRow("Lands", lands.length, pilesOf(game, lands))}
    </DropTarget>
  );
}

/** The hovered card, big, on the side away from the mouse. It's only there while hovering and takes no clicks, so the field keeps the room. */
function HoverPreview({ card, onLeave }: { card: Instance | null; onLeave: () => void }) {
  const [side, setSide] = useState<"left" | "right">("right");
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setSide(e.clientX < window.innerWidth / 2 ? "right" : "left");
      // A card that left its spot under a still mouse never gets its mouse-leave.
      if (!(e.target as Element).closest?.("[draggable=true]")) onLeave();
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [onLeave]);
  if (!card) return null;
  return (
    <div aria-hidden className={`pointer-events-none fixed top-14 z-[60] w-[270px] ${side === "left" ? "left-3" : "right-3"}`}>
      {card.image ? (
        <img src={card.image} alt="" className="w-full rounded-[4.75%/3.5%] shadow-2xl" />
      ) : (
        <div className="flex aspect-[63/88] items-center justify-center rounded-xl border bg-background p-4 text-center">{card.name}</div>
      )}
    </div>
  );
}

// ---------- hand ----------

function Hand({
  game,
  onDrop,
  onPreview,
  onBottom,
  onPlay,
}: {
  game: GameState;
  onDrop: (iid: string) => void;
  onPreview: (c: Instance | null) => void;
  onBottom: (iid: string) => void;
  onPlay: (iid: string) => void;
}) {
  const ids = game.zones.hand;
  const choosing = game.stage === "bottom";
  return (
    <DropTarget label="Hand" onDrop={onDrop} className="shrink-0 rounded-lg border border-foreground/15 px-2 py-1">
      <ZoneLabel
        title={choosing ? `Hand: click ${game.toBottom} more to put on the bottom` : "Hand"}
        count={ids.length}
      />
      {/* A big hand overlaps rather than running off the screen; hovering a card brings it forward. */}
      <div className={`hand mt-0.5 flex min-h-[126px] items-end gap-1 ${ids.length > 9 ? "[&>*:not(:first-child)]:-ml-[calc(var(--overlap))] [&>*:hover]:z-10" : ""} ${choosing ? "rounded ring-2 ring-amber-500" : ""}`} style={{ ["--overlap" as string]: `${Math.min(75, Math.max(0, 90 - 800 / ids.length))}px` }}>
        {ids.map((iid) => (
          <CardView
            key={iid}
            inst={game.cards[iid]}
            size={90}
            onPreview={onPreview}
            onClick={choosing ? () => onBottom(iid) : undefined}
            onDoubleClick={choosing ? undefined : () => onPlay(iid)}
            title={choosing ? `Put ${game.cards[iid].name} on the bottom` : `${game.cards[iid].name}: drag to play (or double-click)`}
          />
        ))}
      </div>
    </DropTarget>
  );
}

// ---------- dialogs ----------

function MulliganDialog({
  game,
  update,
  card,
  onInspect,
}: {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  card: (iid: string) => Instance;
  onInspect?: (iid: string) => void;
}) {
  const cost = bottomCount(game.mulligans + 1, game.freeMulligan);
  const lands = game.zones.hand.filter((iid) => card(iid).land).length;
  // Closing (the ✕, a click outside, or Esc) keeps this hand, like Keep (friend test: there was no way out).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && update(keep);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update]);
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${onInspect ? "p-2" : "p-6"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Opening hand"
      // On a phone a stray tap beside the cards shouldn't decide the hand: the buttons do that.
      onClick={onInspect ? undefined : () => update(keep)}
    >
      <div className={`relative max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl bg-background shadow-xl ${onInspect ? "p-3" : "p-5"}`} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => update(keep)}
          title="Close and keep this hand"
          aria-label="Close and keep this hand"
          className={`absolute right-2 top-2 flex items-center justify-center rounded-md opacity-70 hover:bg-foreground/10 hover:opacity-100 ${onInspect ? "h-11 w-11" : "h-9 w-9"}`}
        >
          ✕
        </button>
        <div className="flex flex-wrap items-baseline justify-between gap-2 pr-10">
          <h2 className="text-lg font-semibold">
            Opening hand{game.mulligans > 0 && ` (mulligan ${game.mulligans})`}: {lands} {lands === 1 ? "land" : "lands"}
          </h2>
          <label className={`flex items-center gap-2 text-sm ${onInspect ? "min-h-11" : ""}`}>
            <input
              type="checkbox"
              className={onInspect ? "h-5 w-5" : ""}
              checked={game.freeMulligan}
              onChange={(e) => update((g) => ({ ...g, freeMulligan: e.target.checked }))}
            />
            First mulligan is free (multiplayer rule)
          </label>
        </div>
        <div className={onInspect ? "mt-3 grid grid-cols-4 gap-1.5" : "mt-4 flex flex-wrap justify-center gap-2"}>
          {game.zones.hand.map((iid) => {
            const c = card(iid);
            if (onInspect)
              return (
                <button key={iid} type="button" onClick={() => onInspect(iid)} aria-label={`See ${c.name}`}>
                  {c.image ? (
                    <img src={c.image} alt="" draggable={false} className="w-full rounded-[4.75%/3.5%] shadow" />
                  ) : (
                    <span className="flex aspect-[63/88] w-full items-center justify-center rounded-lg border p-1 text-center text-[11px]">{c.name}</span>
                  )}
                </button>
              );
            return c.image ? (
              <img key={iid} src={c.image} alt={c.name} className="w-[130px] rounded-[4.75%/3.5%] shadow" />
            ) : (
              <span key={iid} className="flex aspect-[63/88] w-[130px] items-center justify-center rounded-lg border p-2 text-center text-xs">
                {c.name}
              </span>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-sm opacity-70">
            {bottomCount(game.mulligans, game.freeMulligan) > 0
              ? `Keeping puts ${bottomCount(game.mulligans, game.freeMulligan)} on the bottom.`
              : "Keeping this hand costs nothing."}{" "}
            Closing also keeps your hand.
          </p>
          <button
            type="button"
            onClick={() => update(mulligan)}
            className="min-h-11 rounded-lg border border-foreground/20 px-4 hover:bg-foreground/10"
          >
            Mulligan{cost > 0 ? ` (then ${cost} to the bottom)` : " (free)"}
          </button>
          <button type="button" onClick={() => update(keep)} className="min-h-11 rounded-lg bg-gold px-5 font-medium text-gold-ink">
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}

/** Graveyard or exile, all cards, each with quick moves (and draggable to any zone). */
function ZoneViewer({
  zone,
  game,
  onClose,
  onMove,
  onPreview,
  onInspect,
}: {
  zone: Zone;
  game: GameState;
  onClose: () => void;
  onMove: (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => void;
  onPreview: (c: Instance | null) => void;
  onInspect?: (iid: string) => void;
}) {
  const ids = [...game.zones[zone]].reverse(); // newest first
  const title = zone === "graveyard" ? "Graveyard" : zone === "exile" ? "Exile" : zone;
  return (
    <div className={`fixed inset-x-0 bottom-0 z-50 overflow-y-auto border-t border-foreground/20 bg-background/95 p-4 shadow-2xl backdrop-blur ${onInspect ? "max-h-[85dvh]" : "max-h-[55vh]"}`} role="dialog" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">
          {title} ({ids.length})
        </h2>
        <button type="button" onClick={onClose} className="btn">
          {onInspect ? "Close" : "Close (Esc)"}
        </button>
      </div>
      {ids.length === 0 ? (
        <p className="text-sm opacity-60">Empty.</p>
      ) : (
        <ul className={onInspect ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-3"}>
          {ids.map((iid) => (
            <li key={iid} className={`flex flex-col gap-1 ${onInspect ? "" : "w-[120px]"}`}>
              <ListCard inst={game.cards[iid]} size={120} onPreview={onPreview} onInspect={onInspect} />
              {/* Touch layouts: a tap on the card opens its sheet, with these same moves in bigger buttons. */}
              {!onInspect && (
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <MiniButton onClick={() => onMove(iid, "hand")}>Hand</MiniButton>
                  <MiniButton onClick={() => onMove(iid, "battlefield")}>Play</MiniButton>
                  <MiniButton onClick={() => onMove(iid, "library", { library: "top" })}>Lib top</MiniButton>
                  <MiniButton onClick={() => onMove(iid, zone === "graveyard" ? "exile" : "graveyard")}>{zone === "graveyard" ? "Exile" : "Graveyard"}</MiniButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A card in a zone list: draggable with a mouse; on touch layouts a tap shows it big. */
function ListCard({ inst, size, onPreview, onInspect }: { inst: Instance; size: number; onPreview: (c: Instance | null) => void; onInspect?: (iid: string) => void }) {
  if (!onInspect) return <CardView inst={inst} size={size} onPreview={onPreview} />;
  return (
    <button type="button" onClick={() => onInspect(inst.iid)} aria-label={`See ${inst.name}`} className="block w-full">
      {inst.image ? (
        <img src={inst.image} alt="" draggable={false} className="w-full rounded-[4.75%/3.5%] shadow" />
      ) : (
        <span className="flex aspect-[63/88] w-full items-center justify-center rounded-lg border bg-foreground/5 p-1 text-center text-[11px]">{inst.name}</span>
      )}
    </button>
  );
}

function MiniButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-7 rounded border border-foreground/20 px-1 hover:bg-foreground/10 [@media(pointer:coarse),(max-width:767px)]:min-h-11">
      {children}
    </button>
  );
}

/** True while one of our cards is being dragged (some drop targets only appear then). */
function useDragging() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (e: DragEvent) => e.dataTransfer?.types.includes(DRAG_TYPE) && setDragging(true);
    // Capture, because a drop target stops the drop from bubbling and a card that changed zones takes its dragend with it.
    // A beat later, so the Library's Top / Bottom targets are still there to receive the drop.
    const stop = () => setTimeout(() => setDragging(false), 0);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", stop, true);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", stop, true);
      window.removeEventListener("drop", stop, true);
    };
  }, []);
  return dragging;
}

// ---------- library top card, counters and card menu (6b) ----------

/** The library's top card shown face up ("Top face up"); still click to draw it. */
function TopCard({ inst, disabled, onDraw }: { inst: Instance; disabled: boolean; onDraw: () => void }) {
  return (
    <button type="button" onClick={onDraw} disabled={disabled} title={`Top card: ${inst.name} (click to draw)`} className="block w-[72px]">
      {inst.image ? (
        <img src={inst.image} alt={inst.name} draggable={false} className="w-full rounded-[4.75%/3.5%] shadow ring-2 ring-amber-400" />
      ) : (
        <span className="flex aspect-[63/88] items-center justify-center rounded-lg border p-1 text-center text-[10px]">{inst.name}</span>
      )}
    </button>
  );
}

/** Counter pills on a card (labels only; change counters from the right-click menu or the + / - keys). */
function CounterBadges({ counters }: { counters?: Record<string, number> }) {
  const list = Object.entries(counters ?? {});
  if (!list.length) return null;
  return (
    <span className="pointer-events-none absolute bottom-1 left-1 flex flex-col items-start gap-0.5">
      {list.map(([k, n]) => (
        <span key={k} className="rounded bg-black/85 px-1.5 text-[11px] font-semibold text-white tabular-nums">
          {k === "+1/+1" ? `+${n}/+${n}` : k === "-1/-1" ? `-${n}/-${n}` : `${n} ${k}`}
        </span>
      ))}
    </span>
  );
}

/** Right-click menu on a battlefield card: tap, counters, and moves to other zones. */
function CardMenu({
  game,
  at,
  update,
  onMove,
  onFlag,
  onClose,
}: {
  game: GameState;
  at: { iid: string; x: number; y: number };
  update: (fn: (g: GameState) => GameState) => void;
  onMove: (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => void;
  onFlag: (inst: Instance) => void;
  onClose: () => void;
}) {
  const { iid } = at;
  const p = game.battlefield[iid];
  const inst = game.cards[iid];
  const [custom, setCustom] = useState("");
  const kinds = [...new Set([...COUNTER_KINDS, ...Object.keys(p?.counters ?? {})])];
  const go = (to: Zone, opts?: Parameters<typeof move>[3]) => {
    onMove(iid, to, opts);
    onClose();
  };
  // Keep the menu on screen.
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 250));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 440));
  return (
    <>
      <div
        className="fixed inset-0 z-[46]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div role="menu" aria-label={`${inst.name} actions`} className="fixed z-50 w-60 rounded-lg border border-foreground/20 bg-background p-2 text-sm shadow-xl" style={{ left, top }}>
        <p className="truncate px-1 pb-1 font-semibold">{inst.name}</p>
        <MenuItem
          onClick={() => {
            update((g) => toggleTap(g, iid));
            onClose();
          }}
        >
          {p?.tapped ? "Untap" : "Tap"}
        </MenuItem>
        {!inst.token && (
          <MenuItem
            onClick={() => {
              onFlag(inst);
              onClose();
            }}
          >
            ⚑ Flag as underperformer (F)
          </MenuItem>
        )}
        <p className="mt-1 px-1 text-xs font-semibold uppercase tracking-wide opacity-60">Counters</p>
        {kinds.map((k) => (
          <div key={k} className="flex items-center gap-1 px-1">
            <span className="flex-1 truncate">{k}</span>
            <span className="w-6 text-center tabular-nums">{p?.counters?.[k] ?? 0}</span>
            <MenuButton label={`Remove a ${k} counter`} onClick={() => update((g) => addCounter(g, iid, k, -1))}>
              −
            </MenuButton>
            <MenuButton label={`Add a ${k} counter`} onClick={() => update((g) => addCounter(g, iid, k, 1))}>
              +
            </MenuButton>
          </div>
        ))}
        <form
          className="mt-1 flex gap-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = custom.trim().toLowerCase();
            if (name) update((g) => addCounter(g, iid, name, 1));
            setCustom("");
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Other counter, e.g. time"
            maxLength={20}
            aria-label="Other counter name"
            className="min-w-0 flex-1 rounded border border-foreground/20 bg-background px-2 py-1 text-xs"
          />
          <MenuButton label="Add that counter" submit>
            +
          </MenuButton>
        </form>
        <p className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide opacity-60">Move to</p>
        <div className="grid grid-cols-2 gap-1">
          <MenuItem onClick={() => go("hand")}>Hand</MenuItem>
          <MenuItem onClick={() => go("graveyard")}>Graveyard</MenuItem>
          <MenuItem onClick={() => go("exile")}>Exile</MenuItem>
          <MenuItem onClick={() => go("library", { library: "top" })}>Library top</MenuItem>
          <MenuItem onClick={() => go("library", { library: "bottom" })}>Library bottom</MenuItem>
          {inst.commander && <MenuItem onClick={() => go("command")}>Command zone</MenuItem>}
        </div>
      </div>
    </>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block min-h-8 w-full rounded px-2 text-left hover:bg-foreground/10">
      {children}
    </button>
  );
}

function MenuButton({ onClick, label, submit, children }: { onClick?: () => void; label: string; submit?: boolean; children: React.ReactNode }) {
  return (
    <button
      type={submit ? "submit" : "button"}
      onClick={submit ? undefined : onClick}
      aria-label={label}
      title={label}
      className="h-7 w-7 rounded border border-foreground/20 hover:bg-foreground/10"
    >
      {children}
    </button>
  );
}

// ---------- library tools (6b) ----------

/** Search the library (a tutor): every card, alphabetical so the order stays secret, then shuffle. */
function LibrarySearch({
  game,
  update,
  onMove,
  onPreview,
  onInspect,
  onClose,
}: {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  onMove: (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => void;
  onPreview: (c: Instance | null) => void;
  onInspect?: (iid: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const ids = game.zones.library
    .filter((iid) => !needle || game.cards[iid].name.toLowerCase().includes(needle) || game.cards[iid].typeLine.toLowerCase().includes(needle))
    .sort((a, b) => game.cards[a].name.localeCompare(game.cards[b].name));
  return (
    <div className={`fixed inset-x-0 bottom-0 z-50 overflow-y-auto border-t border-foreground/20 bg-background/95 p-4 shadow-2xl backdrop-blur ${onInspect ? "max-h-[92dvh]" : "max-h-[70vh]"}`} role="dialog" aria-label="Search library">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Search library ({game.zones.library.length})</h2>
        <input
          // A phone's keyboard shouldn't jump up and cover the list before it's wanted.
          autoFocus={!onInspect}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={onInspect ? "Name or type" : "Filter by name or type, e.g. forest, creature"}
          aria-label="Filter"
          // 16 px text on touch layouts: iPhones zoom the page when focusing anything smaller.
          className={`min-h-9 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3 ${onInspect ? "basis-full text-base" : "text-sm"}`}
        />
        <button
          type="button"
          onClick={() => {
            update(shuffleLibrary);
            onClose();
          }}
          className="btn btn-gold"
        >
          Shuffle and close
        </button>
        <button type="button" onClick={onClose} className="min-h-9 rounded-md border border-foreground/20 px-3 text-sm">
          Close without shuffling
        </button>
      </div>
      <ul className={onInspect ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-3"}>
        {ids.map((iid) => (
          <li key={iid} className={`flex flex-col gap-1 ${onInspect ? "" : "w-[110px]"}`}>
            <ListCard inst={game.cards[iid]} size={110} onPreview={onPreview} onInspect={onInspect} />
            {!onInspect && (
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <MiniButton onClick={() => onMove(iid, "hand")}>Hand</MiniButton>
                <MiniButton onClick={() => onMove(iid, "battlefield")}>Play</MiniButton>
                <MiniButton onClick={() => onMove(iid, "graveyard")}>Graveyard</MiniButton>
                <MiniButton onClick={() => onMove(iid, "library", { library: "top" })}>Top</MiniButton>
              </div>
            )}
          </li>
        ))}
        {ids.length === 0 && <li className="text-sm opacity-60">No cards match.</li>}
      </ul>
    </div>
  );
}

/** Scry or surveil N: look at the top N, choose top / bottom / graveyard for each, and order the ones on top. */
/** A number you change with big buttons, for touch layouts; a typed box otherwise. */
function CountInput({ compact, value, min, max, onChange }: { compact: boolean; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  if (!compact)
    return <input type="number" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value) || min)} className="w-16 rounded-md border border-foreground/20 bg-background px-2 py-1" autoFocus />;
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" aria-label="One fewer" onClick={() => set(value - 1)} className="btn h-12 w-12 p-0 text-lg">
        −
      </button>
      <span className="w-9 text-center text-xl font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="One more" onClick={() => set(value + 1)} className="btn h-12 w-12 p-0 text-lg">
        +
      </button>
    </span>
  );
}

function CountField({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  return compact ? <div className="flex items-center gap-2 text-sm">{children}</div> : <label className="flex items-center gap-2 text-sm">{children}</label>;
}

function ScryDialog({ compact, game, update, onClose }: { compact: boolean; game: GameState; update: (fn: (g: GameState) => GameState) => void; onClose: () => void }) {
  const [count, setCount] = useState(1);
  const [order, setOrder] = useState<string[] | null>(null);
  const [choice, setChoice] = useState<Record<string, ScryChoice>>({});
  const nudge = (i: number, by: number) =>
    setOrder((o) => {
      if (!o) return o;
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <div className={`fixed inset-0 z-50 flex justify-center bg-black/60 ${compact ? "items-end" : "items-center p-6"}`} role="dialog" aria-modal="true" aria-label="Scry or surveil">
      <div className={`w-full max-w-4xl overflow-y-auto bg-background shadow-xl ${compact ? "max-h-[92dvh] rounded-t-2xl p-3" : "max-h-full rounded-2xl p-5"}`}>
        {!order ? (
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const top = topCards(game, count);
              setOrder(top);
              setChoice(Object.fromEntries(top.map((iid) => [iid, "top" as ScryChoice])));
            }}
          >
            <h2 className="text-lg font-semibold">Scry / surveil</h2>
            {/* Not a label on touch layouts: tapping its words would press the first button inside. */}
            <CountField compact={compact}>
              Look at the top
              <CountInput compact={compact} value={count} min={1} max={20} onChange={setCount} />
              cards
            </CountField>
            <button type="submit" className={`btn btn-gold ${compact ? "min-h-12 flex-1" : ""}`}>
              Look
            </button>
            <button type="button" onClick={onClose} className={`btn ${compact ? "min-h-12 flex-1" : ""}`}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Top {order.length}: choose where each goes</h2>
            <p className="text-sm opacity-70">{compact ? "Cards kept on top go back in this order, 1st on top. Graveyard = surveil." : "Cards kept on top go back in this order, leftmost on top. Graveyard = surveil."}</p>
            <ul className={compact ? "mt-3 grid grid-cols-2 gap-3" : "mt-3 flex flex-wrap gap-3"}>
              {order.map((iid, i) => (
                <li key={iid} className={`flex flex-col gap-1 ${compact ? "" : "w-[130px]"}`}>
                  {compact && <span className="text-sm font-semibold tabular-nums">{["1st", "2nd", "3rd"][i] ?? `${i + 1}th`}</span>}
                  {game.cards[iid].image ? (
                    <img src={game.cards[iid].image!} alt={game.cards[iid].name} className="w-full rounded-[4.75%/3.5%] shadow" />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border p-2 text-center text-xs">{game.cards[iid].name}</span>
                  )}
                  <select
                    value={choice[iid]}
                    onChange={(e) => setChoice((c) => ({ ...c, [iid]: e.target.value as ScryChoice }))}
                    aria-label={`Where ${game.cards[iid].name} goes`}
                    className={`rounded-md border border-foreground/20 bg-background px-1 ${compact ? "min-h-11 text-base" : "min-h-9 text-sm"}`}
                  >
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="graveyard">Graveyard</option>
                  </select>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <MiniButton onClick={() => nudge(i, -1)}>{compact ? "Move up" : "← Earlier"}</MiniButton>
                    <MiniButton onClick={() => nudge(i, 1)}>{compact ? "Move down" : "Later →"}</MiniButton>
                  </div>
                </li>
              ))}
            </ul>
            <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-background py-1">
              <button type="button" onClick={onClose} className={`btn ${compact ? "min-h-12 flex-1" : ""}`}>
                Cancel (leave as is)
              </button>
              <button
                type="button"
                onClick={() => {
                  update((g) => resolveScry(g, order, choice));
                  onClose();
                }}
                className={`btn btn-gold ${compact ? "min-h-12 flex-1" : ""}`}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MillDialog({ compact, game, update, onClose }: { compact: boolean; game: GameState; update: (fn: (g: GameState) => GameState) => void; onClose: () => void }) {
  const [count, setCount] = useState(1);
  return (
    <div className={`fixed inset-0 z-50 flex justify-center bg-black/60 ${compact ? "items-end" : "items-center p-6"}`} role="dialog" aria-modal="true" aria-label="Mill">
      <form
        className={`flex flex-wrap items-center gap-3 bg-background shadow-xl ${compact ? "w-full rounded-t-2xl p-3" : "rounded-2xl p-5"}`}
        onSubmit={(e) => {
          e.preventDefault();
          update((g) => mill(g, count));
          onClose();
        }}
      >
        <h2 className="text-lg font-semibold">Mill</h2>
        <CountField compact={compact}>
          Put the top
          <CountInput compact={compact} value={count} min={1} max={Math.max(1, game.zones.library.length)} onChange={setCount} />
          {compact ? "cards" : "cards into the graveyard"}
        </CountField>
        <button type="submit" className={`btn btn-gold ${compact ? "min-h-12 flex-1" : ""}`}>
          Mill
        </button>
        <button type="button" onClick={onClose} className={`btn ${compact ? "min-h-12 flex-1" : ""}`}>
          Cancel
        </button>
      </form>
    </div>
  );
}

// ---------- tokens (6c) ----------

/** The deck's tokens (from its cards) to put onto the battlefield, plus any other token by name. */
function TokenPicker({ compact, tokens, update, onClose }: { compact: boolean; tokens: DeckToken[]; update: (fn: (g: GameState) => GameState) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const make = (spec: { name: string; image: string | null; typeLine: string }) => {
    update((g) => createToken(g, spec));
    setMade(spec.name);
  };
  return (
    <div className={`fixed inset-x-0 bottom-0 z-50 overflow-y-auto border-t border-foreground/20 bg-background/95 p-4 shadow-2xl backdrop-blur ${compact ? "max-h-[85dvh]" : "max-h-[60vh]"}`} role="dialog" aria-label="Tokens">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className={`font-semibold ${compact ? "mr-auto" : ""}`}>Create a token</h2>
        {compact && (
          <button type="button" onClick={onClose} className="btn min-h-11">
            Close
          </button>
        )}
        {made && <span className={`text-sm opacity-70 ${compact ? "basis-full" : ""}`}>Made a {made}. {compact ? "Tap" : "Click"} again for another.</span>}
        <form
          className={compact ? "flex basis-full gap-2" : "ml-auto flex gap-2"}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) make({ name: name.trim(), image: null, typeLine: "Token" });
            setName("");
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Other token, e.g. 1/1 Soldier"
            maxLength={40}
            aria-label="Other token name"
            className={`rounded-md border border-foreground/20 bg-background px-3 ${compact ? "min-h-11 min-w-0 flex-1 text-base" : "min-h-9 text-sm"}`}
          />
          <button type="submit" className={`btn ${compact ? "min-h-11" : ""}`}>
            Create
          </button>
        </form>
        {!compact && (
          <button type="button" onClick={onClose} className="btn">
            Close (Esc)
          </button>
        )}
      </div>
      {tokens.length === 0 ? (
        <p className="text-sm opacity-60">No cards in this deck make tokens. Use “Other token” for anything else.</p>
      ) : (
        <ul className={compact ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-3"}>
          {tokens.map((t) => (
            <li key={t.token_id}>
              <button
                type="button"
                onClick={() => make({ name: t.name, image: tokenImage(t.token_id), typeLine: t.type_line })}
                title={`Create a ${t.name}`}
                className={`block text-left text-xs ${compact ? "w-full" : "w-[110px]"}`}
              >
                {/* A fixed card shape, so the button is big while the picture loads. */}
                <img src={tokenImage(t.token_id)} alt={t.name} loading="lazy" draggable={false} style={{ aspectRatio: "63 / 88" }} className="w-full rounded-[4.75%/3.5%] shadow hover:ring-2 hover:ring-amber-400" />
                <span className="mt-1 block font-medium">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- keyboard shortcuts (6d) ----------

const SHORTCUTS: [string, string][] = [
  ["N", "Next turn (untap all, then draw)"],
  ["U", "Untap all"],
  ["D", "Draw a card"],
  ["S", "Shuffle the library"],
  ["L", "Search the library"],
  ["Y", "Scry / surveil"],
  ["M", "Mill"],
  ["K", "Create a token"],
  ["T", "Tap or untap the card under the mouse"],
  ["+ / −", "Add or remove a +1/+1 counter on the card under the mouse"],
  ["F", "Flag the card under the mouse as an underperformer"],
  ["H", "Card under the mouse to hand"],
  ["B", "Card under the mouse to the battlefield"],
  ["G", "Card under the mouse to the graveyard"],
  ["E", "Card under the mouse to exile"],
  ["Right-click", "Card menu: counters, flag, moves"],
  ["Esc", "Close any panel"],
  ["?", "Show or hide this list"],
];

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="min-h-9 rounded-md border border-foreground/20 px-3 text-sm">
            Close (Esc)
          </button>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-foreground/30 px-1.5 py-0.5 text-xs">{k}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
