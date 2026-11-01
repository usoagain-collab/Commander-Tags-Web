"use client";

// The playtest table on phones and touch screens (David, Nov 1, 2026). Same game logic as the desktop table, laid out
// for one thumb: the field is an accordion (tap Lands or Play to give it the room), the side zones are small chips
// that open when needed, and everything but Next turn lives in the menu. Cards move with pointer events rather than
// HTML5 drag, which touch browsers only start after a long press.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addCounter,
  commanderTax,
  COUNTER_KINDS,
  draw,
  move,
  nextTurn,
  putOnBottom,
  setLife,
  setTopRevealed,
  shuffleLibrary,
  toggleTap,
  untapAll,
  zoneOf,
  type GameState,
  type Instance,
  type Zone,
  pilesOf,
} from "@/lib/playtest/game";

type Update = (fn: (g: GameState) => GameState) => void;
type MoveCard = (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => void;
type Tool = "search" | "scry" | "mill" | "tokens";
type Section = "play" | "tokens" | "lands";
/** "strip" is a closed field section: it means "the battlefield", with no particular spot. */
type DropName = "battlefield" | "strip" | "hand" | "graveyard" | "exile" | "command" | "library-top" | "library-bottom";

const HINT_KEY = "playtest:phone-hint-seen";
const NO_CALLOUT ={ WebkitTouchCallout: "none" } as React.CSSProperties;

// ---------- finger (and mouse) dragging ----------

type PressOptions = {
  iid: string;
  /** Run on a quick tap. */
  onTap?: () => void;
  /** Run on holding still for a moment. */
  onHold?: () => void;
  /** False while choosing a hand: tap and hold still work. */
  canDrag?: boolean;
};

const DRAG_START_PX = 8;
const HOLD_MS = 450;

/**
 * One gesture on a card: tap, hold or drag. The card follows the finger as a "ghost" above it, so the finger doesn't
 * hide where it lands. The ghost moves by writing its style directly, so a drag doesn't re-render the table.
 */
function useCardPress(onDrop: (iid: string, target: DropName, ghost: { x: number; y: number }) => void, ghostWidth: number) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DropName | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0, y: 0 });
  const stopCurrent = useRef<(() => void) | null>(null);
  useEffect(() => () => stopCurrent.current?.(), []);

  const ghostAt = useCallback(
    // Its bottom edge tucks just under the fingertip: it feels held, and the card still shows above the finger.
    (x: number, y: number) => ({ x: x - ghostWidth / 2, y: y - ghostWidth * 1.4 + 8 }),
    [ghostWidth],
  );
  const place = useCallback(() => {
    if (ghost.current) ghost.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(1.06)`;
  }, []);

  const press = useCallback(
    (e: React.PointerEvent, { iid, onTap, onHold, canDrag = true }: PressOptions) => {
      // One card at a time: a second finger while one is moving does nothing.
      if (e.button !== 0 || stopCurrent.current) return;
      const pointer = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      let target: DropName | null = null;
      const hold = window.setTimeout(() => {
        if (moved) return;
        stop();
        onHold?.();
      }, HOLD_MS);
      const findTarget = (x: number, y: number) =>
        (document.elementFromPoint(x, y)?.closest("[data-drop]")?.getAttribute("data-drop") as DropName | null) ?? null;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        if (!moved) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX) return;
          window.clearTimeout(hold);
          if (!canDrag) return;
          moved = true;
          setDragging(iid);
        }
        position.current = ghostAt(ev.clientX, ev.clientY);
        place();
        const next = findTarget(ev.clientX, ev.clientY);
        if (next !== target) {
          target = next;
          setOver(next);
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        const wasDrag = moved;
        const stillClose = Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX;
        const landing = findTarget(ev.clientX, ev.clientY);
        const at = ghostAt(ev.clientX, ev.clientY);
        stop();
        if (wasDrag) {
          if (landing) onDrop(iid, landing, at);
        } else if (stillClose) onTap?.();
      };
      const onCancel = (ev: PointerEvent) => {
        // The browser took the gesture over, for example to scroll the hand sideways.
        if (ev.pointerId === pointer) stop();
      };
      function stop() {
        window.clearTimeout(hold);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        stopCurrent.current = null;
        setDragging(null);
        setOver(null);
      }
      stopCurrent.current = stop;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      position.current = ghostAt(startX, startY);
    },
    [ghostAt, onDrop, place],
  );

  // The ghost mounts when a drag starts: put it under the finger straight away.
  useLayoutEffect(() => {
    if (dragging) place();
  }, [dragging, place]);

  return { press, dragging, over, ghost };
}

/** A card you can tap, hold or drag. The whole card is the target; nothing small sits on top of it. */
function Tile({
  inst,
  width,
  tapped,
  faded,
  panX,
  label,
  onPress,
  onTap,
  onHold,
  children,
  style,
}: {
  inst: Instance;
  width: number;
  tapped?: boolean;
  faded?: boolean;
  /** Sideways swipes scroll (the hand), so only upward moves drag the card. */
  panX?: boolean;
  label: string;
  onPress: (e: React.PointerEvent) => void;
  /** Keyboard users: Enter does what a tap does. */
  onTap?: () => void;
  onHold?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPress}
      onClick={(e) => {
        if (e.detail === 0) onTap?.();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onHold?.();
      }}
      style={{ width, touchAction: panX ? "pan-x" : "none", ...NO_CALLOUT, ...style }}
      className={`relative block shrink-0 transition-transform duration-150 ${tapped ? "rotate-90" : ""} ${faded ? "opacity-30" : ""}`}
    >
      <CardFace inst={inst} />
      {children}
    </button>
  );
}

function CardFace({ inst }: { inst: Instance }) {
  return inst.image ? (
    <img src={inst.image} alt="" draggable={false} style={NO_CALLOUT} className="pointer-events-none w-full rounded-[4.75%/3.5%] shadow" />
  ) : (
    <span className="flex aspect-[63/88] w-full items-center justify-center rounded-lg border border-foreground/30 bg-panel-raised p-1 text-center text-[11px] leading-tight">{inst.name}</span>
  );
}

function CounterPills({ counters }: { counters?: Record<string, number> }) {
  const list = Object.entries(counters ?? {});
  if (!list.length) return null;
  return (
    <span className="pointer-events-none absolute bottom-0.5 left-0.5 flex flex-col items-start gap-0.5">
      {list.map(([k, n]) => (
        <span key={k} className="rounded bg-black/85 px-1 text-[11px] font-semibold text-white tabular-nums">
          {k === "+1/+1" ? `+${n}/+${n}` : k === "-1/-1" ? `-${n}/-${n}` : `${n} ${k}`}
        </span>
      ))}
    </span>
  );
}

// ---------- layout helpers ----------

/** Cards in the play area shrink as it fills, so the board stays in view without scrolling. */
const playWidth = (count: number, scale: number) => Math.round((count <= 9 ? 84 : count <= 16 ? 66 : 52) * scale);
/** Keeps the section's label readable above the first row of cards. */
const LABEL_ROOM = 20;
const pileWidth = (piles: number, scale: number) => Math.round((piles <= 8 ? 72 : piles <= 15 ? 56 : 46) * scale);

type Box = { width: number; height: number };

/** The grid a tidy board uses: as many cells as fit this card size. */
function cells(box: Box, width: number) {
  // A little wider than the card: a tapped card turns sideways and shouldn't cover much of its neighbour.
  const cellW = width * 1.15 + 4;
  const cellH = width * 1.4 + 8;
  return { cols: Math.max(1, Math.floor(box.width / cellW)), rows: Math.max(1, Math.floor((box.height - LABEL_ROOM) / cellH)), cellW, cellH };
}

const cellPosition = (i: number, box: Box, width: number) => {
  const { cols, rows, cellW, cellH } = cells(box, width);
  // Once the grid is full, later cards go over the first ones, a little lower, so each still shows.
  const lap = Math.floor(i / (cols * rows));
  const n = i % (cols * rows);
  return {
    x: (((n % cols) * cellW + (cellW - width) / 2) / box.width) * 100,
    y: ((Math.floor(n / cols) * cellH + LABEL_ROOM + lap * 18) / box.height) * 100,
  };
};

/** The first grid cell with no card on it, for a card played without a drop position. */
function freeSpot(game: GameState, box: Box, width: number) {
  const placed = game.zones.battlefield.filter((iid) => !game.cards[iid].land && !game.cards[iid].token).map((iid) => game.battlefield[iid]);
  const { cols, rows, cellW, cellH } = cells(box, width);
  for (let i = 0; i < cols * rows; i++) {
    const spot = cellPosition(i, box, width);
    const taken = placed.some((p) => Math.abs(p.x - spot.x) < ((cellW / 2) / box.width) * 100 && Math.abs(p.y - spot.y) < ((cellH / 2) / box.height) * 100);
    if (!taken) return spot;
  }
  return cellPosition(placed.length, box, width);
}

// ---------- the table ----------

export function PhoneTable({
  game,
  deck,
  update,
  onMove,
  onNewGame,
  onTool,
  onView,
  onInspect,
  freeSpotRef,
  scale,
  landscape,
}: {
  game: GameState;
  deck: { id: string; name: string };
  update: Update;
  onMove: MoveCard;
  onNewGame: () => void;
  onTool: (t: Tool) => void;
  onView: (z: Zone) => void;
  onInspect: (iid: string) => void;
  /** Lets the shared dialogs' Play buttons use this layout's free spots. */
  freeSpotRef: React.RefObject<((g: GameState) => { x: number; y: number }) | null>;
  /** Card size multiplier: 1 on phones, more on tablets. */
  scale: number;
  /** A sideways phone: the field on the left, everything else in a column on the right. */
  landscape: boolean;
}) {
  const [section, setSection] = useState<Section>("play");
  // How-to strip, until dismissed. Browser storage is fine here: it's only a convenience.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try {
      setHint(!localStorage.getItem(HINT_KEY));
    } catch {
      setHint(true);
    }
  }, []);
  const dismissHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // storage blocked: it just comes back next visit
    }
  };
  const [sheet, setSheet] = useState<"menu" | "life" | "library" | "command" | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const playing = game.stage === "playing";

  const ids = game.zones.battlefield;
  const lands = ids.filter((iid) => game.cards[iid].land);
  const tokenIds = ids.filter((iid) => game.cards[iid].token);
  const others = ids.filter((iid) => !game.cards[iid].land && !game.cards[iid].token);
  const size = playWidth(others.length + 1, scale);

  const [box, setBox] = useState<Box>({ width: 360, height: 360 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const read = () => {
      if (el.clientWidth && el.clientHeight) setBox({ width: el.clientWidth, height: el.clientHeight });
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
    // Turning the phone rebuilds the field, so the element to watch changes too.
  }, [section, landscape]);

  useEffect(() => {
    freeSpotRef.current = (g) => freeSpot(g, box, size);
    return () => {
      freeSpotRef.current = null;
    };
  }, [box, size, freeSpotRef]);

  /** Plays a card at the next free spot (lands ignore it: they go to their section). */
  const play = useCallback((iid: string) => onMove(iid, "battlefield"), [onMove]);

  const onDrop = useCallback(
    (iid: string, target: DropName, ghost: { x: number; y: number }) => {
      if (target === "library-top") return onMove(iid, "library", { library: "top" });
      if (target === "library-bottom") return onMove(iid, "library", { library: "bottom" });
      if (target !== "battlefield" && target !== "strip") return onMove(iid, target);
      const inst = game.cards[iid];
      const el = area.current;
      const onBattlefield = !!game.battlefield[iid];
      if (inst.land || inst.token) {
        if (!onBattlefield) play(iid);
        return;
      }
      if (target === "battlefield" && el && section === "play") {
        const r = el.getBoundingClientRect();
        return onMove(iid, "battlefield", { at: { x: ((ghost.x - r.left) / r.width) * 100, y: ((ghost.y - r.top) / r.height) * 100 } });
      }
      if (!onBattlefield) play(iid);
      setSection("play");
    },
    [game, onMove, play, section],
  );

  const { press, dragging, over, ghost } = useCardPress(onDrop, size);
  const pressCard = (e: React.PointerEvent, opts: PressOptions) => press(e, { canDrag: playing, ...opts });
  const ring = (name: DropName) => (over === name ? "ring-2 ring-inset ring-gold" : "");
  const dragged = dragging ? game.cards[dragging] : null;

  const tidy = useCallback(
    () =>
      update((g) => {
        const list = g.zones.battlefield.filter((iid) => !g.cards[iid].land && !g.cards[iid].token);
        return list.reduce((acc, iid, i) => move(acc, iid, "battlefield", { at: cellPosition(i, box, size) }), g);
      }),
    [box, size, update],
  );

  // When a filling board makes the cards shrink, line them up again: the old spots no longer suit the new size.
  const lastSize = useRef(size);
  useEffect(() => {
    if (size < lastSize.current) tidy();
    lastSize.current = size;
  }, [size, tidy]);

  // Same when the phone turns: the field changes shape. Waits for the new measurements (tidy changes with them).
  const lastLandscape = useRef(landscape);
  const measured = useRef(box);
  useEffect(() => {
    if (measured.current === box) return;
    measured.current = box;
    if (lastLandscape.current !== landscape) {
      lastLandscape.current = landscape;
      tidy();
    }
  }, [box, landscape, tidy]);

  const untappedLands = lands.filter((iid) => !game.battlefield[iid].tapped).length;
  const strips: { key: Section; label: string; detail?: string; show: boolean }[] = [
    { key: "play", label: "Play", detail: `${others.length}`, show: true },
    { key: "tokens", label: "Tokens", detail: `${tokenIds.length}`, show: tokenIds.length > 0 || section === "tokens" },
    { key: "lands", label: "Lands", detail: lands.length ? `${lands.length} (${untappedLands} untapped)` : "0", show: true },
  ];

  // Tokens can all leave while their section is open.
  useEffect(() => {
    if (section === "tokens" && tokenIds.length === 0) setSection("play");
  }, [section, tokenIds.length]);

  // A downward swipe shouldn't reload the page or bounce it. Restored on leaving.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = before;
    };
  }, []);

  const commanders = game.zones.command;
  const firstCommander = commanders[0] ? game.cards[commanders[0]] : null;

  const topBar = (
      <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 px-1">
        <Link href={`/decks/${deck.id}`} aria-label={`Back to ${deck.name}`} className="btn h-10 shrink-0 gap-1 px-2.5 text-sm font-bold">
          <span aria-hidden className="text-base leading-none">←</span> Deck
        </Link>
        <span className="text-sm font-semibold tabular-nums">Turn {game.turn}</span>
        <button type="button" onClick={() => setSheet("life")} aria-label={`Life ${game.life}. Change life`} className="mx-auto flex h-11 min-w-20 items-center justify-center gap-1.5 rounded-md px-2">
          <span aria-hidden className="text-xs opacity-70">
            Life
          </span>
          <span className="display text-2xl leading-none tabular-nums text-gold">{game.life}</span>
        </button>
        <button type="button" onClick={() => setSheet("menu")} className="btn min-h-11 shrink-0">
          Menu
        </button>
      </header>
  );

  const field = (
      // The open section takes the room, the others shrink to a strip you can tap.
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {strips
          .filter((s) => s.show)
          .map((s) =>
            s.key === section ? (
              <section key={s.key} data-drop="battlefield" aria-label={s.label} style={{ touchAction: s.key === "play" ? "none" : "pan-y" }} className={`felt relative min-h-0 flex-1 ${ring("battlefield")}`}>
                <p className="pointer-events-none absolute left-2 top-0.5 z-0 text-[13px] font-semibold text-foreground/80">
                  {s.label} {s.detail}
                </p>
                {s.key === "play" ? (
                  <div ref={area} className="absolute inset-0 overflow-hidden">
                    {others.length === 0 && (
                      <p className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center text-sm text-foreground/75">
                        Drag a card up from your hand to play it.
                      </p>
                    )}
                    {others.map((iid) => {
                      const p = game.battlefield[iid];
                      return (
                        // A tapped card sticks out sideways by a fifth of its width: keep that inside the field too.
                        <div key={iid} className="enter absolute" style={{ left: `max(${p.tapped ? size * 0.2 : 0}px, min(${p.x}%, calc(100% - ${p.tapped ? size * 1.2 : size}px)))`, top: `max(0px, min(${p.y}%, calc(100% - ${Math.round(size * 1.4)}px)))` }}>
                          <Tile
                            inst={game.cards[iid]}
                            width={size}
                            tapped={p.tapped}
                            faded={dragging === iid}
                            label={`${game.cards[iid].name}${p.tapped ? ", tapped" : ""}`}
                            onTap={() => update((g) => toggleTap(g, iid))}
                            onHold={() => onInspect(iid)}
                            onPress={(e) => pressCard(e, { iid, onTap: () => update((g) => toggleTap(g, iid)), onHold: () => onInspect(iid) })}
                          >
                            <CounterPills counters={p.counters} />
                          </Tile>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <PileGrid
                    game={game}
                    ids={s.key === "lands" ? lands : tokenIds}
                    scale={scale}
                    empty={s.key === "lands" ? "No lands yet. Drag one up from your hand." : "No tokens."}
                    dragging={dragging}
                    onPress={pressCard}
                    update={update}
                    onInspect={onInspect}
                  />
                )}
              </section>
            ) : (
              <button
                key={s.key}
                type="button"
                data-drop="strip"
                onClick={() => setSection(s.key)}
                aria-label={`Open ${s.label}: ${s.detail}`}
                className={`felt flex h-11 shrink-0 items-center justify-between border-t border-foreground/15 px-3 text-sm ${ring("strip")}`}
              >
                <span className="font-semibold">{s.label}</span>
                <span className="tabular-nums text-foreground/80">{s.detail} ▴</span>
              </button>
            ),
          )}
      </div>
  );

  const zones = (
    <div className="relative shrink-0">
      {hint && (
        <button type="button" onClick={dismissHint} className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-foreground/10 bg-panel px-3 text-left text-[13px] leading-tight">
          <span>Hand: tap to read. Field: tap to tap, hold for moves. Lands stack: taps one.</span>
          <span aria-label="Dismiss" className="shrink-0 text-foreground/70">
            ✕
          </span>
        </button>
      )}
      {/* While a card is moving, the other zones open up right here, within reach of the thumb, as big targets. */}
      {dragging && (
        <div className={`absolute inset-x-0 z-20 grid gap-1 bg-background p-1 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] ${landscape ? "top-0 h-28 grid-cols-3" : `bottom-0 h-[7rem] ${dragged?.commander ? "grid-cols-5" : "grid-cols-4"}`}`}>
          <DropTile name="graveyard" label="Graveyard" over={over} />
          <DropTile name="exile" label="Exile" over={over} />
          <DropTile name="library-top" label="Library top" over={over} />
          <DropTile name="library-bottom" label="Library bottom" over={over} />
          {dragged?.commander && <DropTile name="command" label="Command" over={over} />}
        </div>
      )}
      {/* Collapsed zones, and the one button that stays out: Next turn. */}
      <div className={`flex items-stretch gap-1 border-t border-foreground/10 p-1 ${landscape ? "flex-wrap" : ""}`}>
        <ZoneChip
          label="Command"
          count={commanders.length}
          drop="command"
          ring={ring("command")}
          onClick={() => setSheet("command")}
          onPointerDown={
            firstCommander && playing
              ? (e) => {
                  pressCard(e, { iid: firstCommander.iid, onTap: () => setSheet("command"), onHold: () => setSheet("command") });
                }
              : undefined
          }
        />
        <ZoneChip label="Library" count={game.zones.library.length} drop="library-top" ring={ring("library-top")} onClick={() => setSheet("library")} />
        <ZoneChip label="Yard" count={game.zones.graveyard.length} drop="graveyard" ring={ring("graveyard")} onClick={() => onView("graveyard")} />
        <ZoneChip label="Exile" count={game.zones.exile.length} drop="exile" ring={ring("exile")} onClick={() => onView("exile")} />
        <button type="button" disabled={!playing} onClick={() => update(nextTurn)} className={`btn btn-gold shrink-0 whitespace-nowrap px-3 text-sm ${landscape ? "min-h-11 w-full" : "min-h-12"}`}>
          Next turn
        </button>
      </div>
    </div>
  );

  const hand = <PhoneHand game={game} scale={scale} ring={ring("hand")} dragging={dragging} onPress={pressCard} onInspect={onInspect} update={update} landscape={landscape} />;

  return (
    <main className={`fixed inset-0 z-[45] flex h-dvh select-none overflow-hidden bg-background ${landscape ? "flex-row" : "flex-col"}`} style={{ touchAction: "manipulation" }}>
      {landscape ? (
        <>
          {field}
          <div className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-foreground/10">
            {topBar}
            {zones}
            {hand}
          </div>
        </>
      ) : (
        <>
          {topBar}
          {field}
          {zones}
          {hand}
        </>
      )}

      {/* The card under the finger. */}
      {dragged && (
        <div ref={ghost} aria-hidden className="pointer-events-none fixed left-0 top-0 z-50 drop-shadow-2xl" style={{ width: size }}>
          <CardFace inst={dragged} />
        </div>
      )}

      {sheet === "menu" && <MenuSheet game={game} deck={deck} update={update} onTool={onTool} onTidy={tidy} onNewGame={onNewGame} onClose={() => setSheet(null)} />}
      {sheet === "life" && <LifeSheet game={game} update={update} onClose={() => setSheet(null)} />}
      {sheet === "library" && <LibrarySheet game={game} update={update} onTool={onTool} onInspect={onInspect} onClose={() => setSheet(null)} />}
      {sheet === "command" && <CommandSheet game={game} onCast={play} onInspect={onInspect} onClose={() => setSheet(null)} />}
    </main>
  );
}

function DropTile({ name, label, over }: { name: DropName; label: string; over: DropName | null }) {
  return (
    <div data-drop={name} className={`flex items-center justify-center rounded-md border border-dashed px-0.5 text-center text-xs font-semibold leading-tight ${over === name ? "border-gold bg-gold text-gold-ink" : "border-foreground/40 bg-panel-raised"}`}>
      {label}
    </div>
  );
}

function ZoneChip({
  label,
  count,
  drop,
  ring,
  onClick,
  onPointerDown,
}: {
  label: string;
  count: number;
  drop: DropName;
  ring: string;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      data-drop={drop}
      // With a press handler the gesture decides (tap opens, drag moves); otherwise a plain click opens.
      onClick={(e) => {
        if (!onPointerDown || e.detail === 0) onClick();
      }}
      onPointerDown={onPointerDown}
      aria-label={`${label === "Yard" ? "Graveyard" : label}: ${count}`}
      style={onPointerDown ? { touchAction: "none" } : undefined}
      className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-md border border-foreground/15 bg-panel leading-tight ${ring}`}
    >
      <span className="text-xs text-foreground/80">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
    </button>
  );
}

// ---------- lands and tokens ----------

function PileGrid({
  game,
  ids,
  scale,
  empty,
  dragging,
  onPress,
  update,
  onInspect,
}: {
  game: GameState;
  ids: string[];
  scale: number;
  empty: string;
  dragging: string | null;
  onPress: (e: React.PointerEvent, opts: PressOptions) => void;
  update: Update;
  onInspect: (iid: string) => void;
}) {
  const piles = pilesOf(game, ids);
  const width = pileWidth(piles.length, scale);
  if (!piles.length) return <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-foreground/75">{empty}</p>;
  return (
    <div className="absolute inset-0 overflow-y-auto">
      {/* Room around each card, so a tapped (sideways) one doesn't cover its neighbour. */}
      <div className="flex flex-wrap content-start gap-x-5 gap-y-3 px-5 pb-3 pt-7">
        {piles.map((pile) => {
          const iid = pile.ids[0];
          const inst = game.cards[iid];
          const name = `${inst.name}, ${pile.ids.length} ${pile.tapped ? "tapped" : "untapped"}`;
          const tap = () => update((g) => toggleTap(g, iid));
          return (
            <Tile
              key={pile.key}
              inst={inst}
              width={width}
              tapped={pile.tapped}
              faded={dragging === iid && pile.ids.length === 1}
              label={name}
              onTap={tap}
              onHold={() => onInspect(iid)}
              onPress={(e) => onPress(e, { iid, onTap: tap, onHold: () => onInspect(iid) })}
            >
              <CounterPills counters={game.battlefield[iid].counters} />
              {pile.ids.length > 1 && <span className={`pointer-events-none absolute bottom-0 right-0 rounded bg-black/85 px-1.5 text-sm font-bold tabular-nums text-white ${pile.tapped ? "-rotate-90" : ""}`}>×{pile.ids.length}</span>}
            </Tile>
          );
        })}
      </div>
    </div>
  );
}

// ---------- hand ----------

const HAND_CARD = 58;
/** Each card keeps at least this much showing: about a fingertip. */
const HAND_MIN_STEP = 42;

function PhoneHand({
  game,
  scale,
  ring,
  dragging,
  onPress,
  onInspect,
  update,
  landscape,
}: {
  landscape: boolean;
  game: GameState;
  scale: number;
  ring: string;
  dragging: string | null;
  onPress: (e: React.PointerEvent, opts: PressOptions) => void;
  onInspect: (iid: string) => void;
  update: Update;
}) {
  const ids = game.zones.hand;
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(360);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setRoom(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const width = Math.round(HAND_CARD * scale);
  const minStep = Math.round(HAND_MIN_STEP * scale);
  // Cards overlap just enough to fit; past that the row scrolls sideways.
  const step = ids.length > 1 ? Math.min(width + 4, Math.max(minStep, (room - width - 12) / (ids.length - 1))) : width;
  const choosing = game.stage === "bottom";
  // The row only claims sideways swipes when it has something to scroll, so a drag can otherwise go any direction.
  const scrolls = !landscape && width + (ids.length - 1) * minStep > room - 12;
  return (
    <section data-drop="hand" aria-label={`Hand: ${ids.length}`} className={`border-t ${landscape ? "min-h-0 flex-1 overflow-y-auto" : "shrink-0"} border-foreground/10 pb-[env(safe-area-inset-bottom)] ${ring} ${choosing ? "bg-gold/10" : ""}`}>
      <p className="flex justify-between px-2 pt-1 text-[13px] font-semibold text-foreground/80">
        <span>{choosing ? `Tap ${game.toBottom} ${game.toBottom === 1 ? "card" : "cards"} to put on the bottom. Hold to read.` : "Hand"}</span>
        <span className="tabular-nums">{ids.length}</span>
      </p>
      <div ref={row} className={`flex px-1.5 pb-1.5 pt-1 ${landscape ? "flex-wrap gap-1" : "overflow-x-auto"}`} style={{ minHeight: Math.round(width * 1.4) + 10, scrollbarWidth: "none" }}>
        {ids.map((iid, i) => {
          const tap = choosing ? () => update((g) => putOnBottom(g, iid)) : () => onInspect(iid);
          return (
            <Tile
              key={iid}
              inst={game.cards[iid]}
              width={width}
              panX={scrolls}
              faded={dragging === iid}
              label={game.cards[iid].name}
              onTap={tap}
              onHold={() => onInspect(iid)}
              onPress={(e) => onPress(e, { iid, onTap: tap, onHold: () => onInspect(iid) })}
              style={landscape ? undefined : { marginLeft: i === 0 ? 0 : step - width }}
            />
          );
        })}
        {ids.length === 0 && <span className="m-auto text-sm text-foreground/70">No cards in hand. Next turn draws one.</span>}
      </div>
    </section>
  );
}

// ---------- sheets ----------

/** A bottom sheet: big buttons within thumb reach. Tapping outside or Esc closes it. */
function Sheet({ title, onClose, z = "z-40", children }: { title: string; onClose: () => void; z?: string; children: React.ReactNode }) {
  const opened = useRef(Date.now());
  // Phones send a late "click" where the finger lifted. Without this pause, the tap that opened the sheet could land
  // on whichever button just appeared under it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 350);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={`fixed inset-0 ${z} flex flex-col justify-end bg-black/60`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        // The finger that opened this by holding a card can lift right here: that isn't a tap outside.
        if (Date.now() - opened.current > 350) onClose();
      }}
    >
      <div style={{ pointerEvents: ready ? undefined : "none" }} className="max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-foreground/15 bg-background p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="min-w-0 font-semibold leading-tight">{title}</h2>
          <button type="button" onClick={onClose} className="btn min-h-11 shrink-0">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetButton({ onClick, gold, disabled, children }: { onClick: () => void; gold?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`btn min-h-12 w-full ${gold ? "btn-gold" : ""}`}>
      {children}
    </button>
  );
}

function MenuSheet({
  game,
  deck,
  update,
  onTool,
  onTidy,
  onNewGame,
  onClose,
}: {
  game: GameState;
  deck: { id: string; name: string };
  update: Update;
  onTool: (t: Tool) => void;
  onTidy: () => void;
  onNewGame: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const playing = game.stage === "playing";
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <Sheet title="Menu" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <SheetButton disabled={!playing} onClick={act(() => update((g) => draw(g)))}>
          Draw a card
        </SheetButton>
        <SheetButton disabled={!playing} onClick={act(() => update(untapAll))}>
          Untap all
        </SheetButton>
        <SheetButton disabled={!playing} onClick={act(() => onTool("tokens"))}>
          Create token
        </SheetButton>
        <SheetButton disabled={!playing} onClick={act(() => onTool("search"))}>
          Search library
        </SheetButton>
        <SheetButton disabled={!playing} onClick={act(() => onTool("scry"))}>
          Scry / surveil
        </SheetButton>
        <SheetButton disabled={!playing} onClick={act(() => onTool("mill"))}>
          Mill
        </SheetButton>
        <SheetButton onClick={act(() => update(shuffleLibrary))}>Shuffle library</SheetButton>
        <SheetButton disabled={!playing} onClick={act(onTidy)}>
          Tidy the field
        </SheetButton>
      </div>
      <label className="mt-2 flex min-h-12 items-center gap-3 rounded-lg border border-foreground/15 px-3 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={!!game.topRevealed} onChange={(e) => update((g) => setTopRevealed(g, e.target.checked))} />
        Keep the library&apos;s top card face up
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {confirming ? (
          <SheetButton gold onClick={act(onNewGame)}>
            Yes, start over
          </SheetButton>
        ) : (
          <SheetButton onClick={() => setConfirming(true)}>New game</SheetButton>
        )}
        <Link href={`/decks/${deck.id}`} className="btn min-h-12 w-full">
          Back to deck
        </Link>
      </div>
    </Sheet>
  );
}

function LifeSheet({ game, update, onClose }: { game: GameState; update: Update; onClose: () => void }) {
  const change = (by: number) => update((g) => setLife(g, g.life + by));
  return (
    <Sheet title="Life total" onClose={onClose}>
      <p className="display py-2 text-center text-5xl tabular-nums text-gold">{game.life}</p>
      <div className="grid grid-cols-4 gap-2">
        {[-5, -1, 1, 5].map((by) => (
          <SheetButton key={by} onClick={() => change(by)}>
            {by > 0 ? `+${by}` : `−${-by}`}
          </SheetButton>
        ))}
      </div>
    </Sheet>
  );
}

function LibrarySheet({ game, update, onTool, onInspect, onClose }: { game: GameState; update: Update; onTool: (t: Tool) => void; onInspect: (iid: string) => void; onClose: () => void }) {
  const playing = game.stage === "playing";
  const n = game.zones.library.length;
  const top = game.topRevealed && n ? game.cards[game.zones.library[0]] : null;
  const tool = (t: Tool) => () => {
    onTool(t);
    onClose();
  };
  return (
    <Sheet title={`Library: ${n} ${n === 1 ? "card" : "cards"}`} onClose={onClose}>
      {top && (
        <button type="button" onClick={() => onInspect(top.iid)} aria-label={`Top card: ${top.name}. See it`} className="mx-auto mb-2 block w-28">
          <CardFace inst={top} />
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <SheetButton
            gold
            disabled={!playing || !n}
            onClick={() => {
              update((g) => draw(g));
              onClose();
            }}
          >
            Draw a card
          </SheetButton>
        </div>
        <SheetButton disabled={!playing} onClick={tool("search")}>
          Search
        </SheetButton>
        <SheetButton disabled={!playing} onClick={tool("scry")}>
          Scry / surveil
        </SheetButton>
        <SheetButton disabled={!playing} onClick={tool("mill")}>
          Mill
        </SheetButton>
        <SheetButton
          onClick={() => {
            update(shuffleLibrary);
            onClose();
          }}
        >
          Shuffle
        </SheetButton>
      </div>
    </Sheet>
  );
}

function CommandSheet({ game, onCast, onInspect, onClose }: { game: GameState; onCast: (iid: string) => void; onInspect: (iid: string) => void; onClose: () => void }) {
  const commanders = Object.values(game.cards).filter((c) => c.commander);
  return (
    <Sheet title="Command zone" onClose={onClose}>
      {commanders.length === 0 && <p className="text-sm text-foreground/75">This deck has no commander set.</p>}
      <ul className="space-y-3">
        {commanders.map((c) => {
          const here = zoneOf(game, c.iid) === "command";
          return (
            <li key={c.iid} className="flex gap-3">
              <button type="button" onClick={() => onInspect(c.iid)} aria-label={`See ${c.name}`} className="w-24 shrink-0">
                <CardFace inst={c} />
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-foreground/80">
                  Commander tax: +{commanderTax(game, c.iid)}
                  {!here && ` · now in ${zoneLabel(zoneOf(game, c.iid))}`}
                </p>
                {here && (
                  <SheetButton
                    gold
                    disabled={game.stage !== "playing"}
                    onClick={() => {
                      onCast(c.iid);
                      onClose();
                    }}
                  >
                    Cast
                  </SheetButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

const zoneLabel = (z: Zone | null) => (z === "battlefield" ? "play" : z === "library" ? "the library" : z === "hand" ? "hand" : z === "graveyard" ? "the graveyard" : z === "exile" ? "exile" : "the command zone");

/**
 * A card seen big, with what you can do with it from where it is. Opens from a tap in hand, a hold on the field, and
 * any card in the zone viewers.
 */
export function CardSheet({
  game,
  iid,
  update,
  onMove,
  onFlag,
  canFlag,
  onClose,
}: {
  game: GameState;
  iid: string;
  update: Update;
  onMove: MoveCard;
  onFlag: (inst: Instance) => void;
  canFlag: boolean;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [hasBack, setHasBack] = useState(false);
  const [countersOpen, setCountersOpen] = useState(() => Object.keys(game.battlefield[iid]?.counters ?? {}).length > 0);
  const inst = game.cards[iid];
  const zone = zoneOf(game, iid);
  // The card can stop existing (a token leaving the battlefield).
  if (!inst || !zone) return null;
  const placed = game.battlefield[iid];
  const onField = zone === "battlefield";
  const go = (to: Zone, opts?: Parameters<typeof move>[3]) => {
    onMove(iid, to, opts);
    onClose();
  };
  const kinds = [...new Set([...COUNTER_KINDS, ...Object.keys(placed?.counters ?? {})])];
  // Two-faced cards keep their back image at the same address under /back/. Split cards have none, so the Flip
  // button only appears once that image has actually loaded.
  const backImage = inst.image && inst.name.includes(" // ") ? inst.image.replace("/front/", "/back/") : null;

  const counters = onField && (
            <details className="mb-2 rounded-lg border border-foreground/15 px-3" open={countersOpen} onToggle={(e) => setCountersOpen(e.currentTarget.open)}>
              <summary className="flex min-h-12 cursor-pointer items-center justify-between font-medium">
                Counters
                <span aria-hidden className="text-sm text-foreground/70">
                  {Object.values(placed?.counters ?? {}).reduce((a, b) => a + Math.abs(b), 0) || "▾"}
                </span>
              </summary>
              <ul className="space-y-1">
                {kinds.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{k}</span>
                    <button type="button" aria-label={`Remove a ${k} counter`} onClick={() => update((g) => addCounter(g, iid, k, -1))} className="btn h-11 w-11 p-0">
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{placed?.counters?.[k] ?? 0}</span>
                    <button type="button" aria-label={`Add a ${k} counter`} onClick={() => update((g) => addCounter(g, iid, k, 1))} className="btn h-11 w-11 p-0">
                      +
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="mb-3 mt-2 flex gap-2"
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
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3 text-base"
                />
                <button type="submit" className="btn min-h-11 shrink-0">
                  Add
                </button>
              </form>
            </details>
  );

  return (
    <Sheet title={inst.name} onClose={onClose} z="z-[60]">
      <div className="mx-auto mb-3 w-[min(60vw,36dvh,20rem)]">
        <CardFace inst={flipped && backImage ? { ...inst, image: backImage } : inst} />
        {backImage && !hasBack && <img src={backImage} alt="" hidden onLoad={() => setHasBack(true)} />}
        {hasBack && (
          <button type="button" onClick={() => setFlipped((f) => !f)} className="btn mt-1 min-h-11 w-full">
            Flip
          </button>
        )}
      </div>
      {game.stage === "bottom" && zone === "hand" ? (
        <SheetButton
          gold
          onClick={() => {
            update((g) => putOnBottom(g, iid));
            onClose();
          }}
        >
          Put on the bottom ({game.toBottom} to go)
        </SheetButton>
      ) : game.stage !== "playing" ? null : (
        <>
          <div className="mb-2">
            {onField ? (
              <SheetButton
                gold
                onClick={() => {
                  update((g) => toggleTap(g, iid));
                  onClose();
                }}
              >
                {placed?.tapped ? "Untap" : "Tap"}
              </SheetButton>
            ) : (
              <SheetButton gold onClick={() => go("battlefield")}>
                {zone === "command" ? "Cast" : "Play"}
              </SheetButton>
            )}
          </div>
          {counters}
          <div className="grid grid-cols-2 gap-2">
            {inst.token ? (
              <div className="col-span-2">
                <SheetButton onClick={() => go("graveyard")}>Remove token</SheetButton>
              </div>
            ) : (
              <>
                {zone !== "hand" && <SheetButton onClick={() => go("hand")}>To hand</SheetButton>}
                {zone !== "graveyard" && <SheetButton onClick={() => go("graveyard")}>To graveyard</SheetButton>}
                {zone !== "exile" && <SheetButton onClick={() => go("exile")}>To exile</SheetButton>}
                <SheetButton onClick={() => go("library", { library: "top" })}>Library top</SheetButton>
                <SheetButton onClick={() => go("library", { library: "bottom" })}>Library bottom</SheetButton>
                {inst.commander && zone !== "command" && <SheetButton onClick={() => go("command")}>To command zone</SheetButton>}
              </>
            )}
          </div>
          {!inst.token && canFlag && (
            <button
              type="button"
              onClick={() => {
                onFlag(inst);
                onClose();
              }}
              className="btn mt-3 min-h-12 w-full"
            >
              ⚑ Flag as underperformer
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
