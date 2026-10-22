"use client";

// The playtest table (Phase 6a): solo goldfish, desktop/tablet only (David, Oct 22, 2026). All game logic lives in
// src/lib/playtest/game.ts; this file draws it and turns drags, clicks and keys into those functions. The game is
// kept in session storage, so a refresh doesn't lose it (this tab only; nothing goes to the database).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  bottomCount,
  commanderTax,
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

type Props = { deck: { id: string; name: string }; cards: DeckCard[] };

export function PlaytestTable({ deck, cards }: Props) {
  const key = deckKey(cards);
  const [game, setGame] = useState<GameState | null>(null);
  const [preview, setPreview] = useState<Instance | null>(null);
  const [viewing, setViewing] = useState<Zone | null>(null);

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
  const restart = () => setGame((g) => newGame(cards, Date.now() >>> 0, g?.freeMulligan ?? true));

  // Keys for the common actions (6d adds the rest and a help sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") setViewing(null);
      if (!game || game.stage !== "playing") return;
      if (k === "n") update(nextTurn);
      else if (k === "u") update(untapAll);
      else if (k === "d") update((g) => draw(g));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, update]);

  if (!game) return <p className="p-6 text-sm opacity-70">Shuffling…</p>;
  const card = (iid: string) => game.cards[iid];
  const drop = (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => update((g) => move(g, iid, to, opts));

  return (
    <>
      <p className="p-6 text-sm md:hidden">
        The playtester needs a bigger screen (a tablet or computer). Phone playtesting is planned for a later version.{" "}
        <Link href={`/decks/${deck.id}`} className="underline">
          Back to the deck
        </Link>
      </p>
      <main className="hidden h-[calc(100vh-7rem)] min-h-[640px] flex-col gap-2 px-3 pb-2 md:flex">
        <TopBar game={game} deck={deck} update={update} onNewGame={restart} />
        <div className="flex min-h-0 flex-1 gap-2">
          {/* Side zones: scrolls on short screens rather than spilling into the hand. */}
          <aside className="flex w-[13.5rem] shrink-0 flex-col gap-2 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <CommandZone game={game} onDrop={(iid) => drop(iid, "command")} onPreview={setPreview} />
              <LibraryZone game={game} onDraw={() => update((g) => draw(g))} onDrop={(iid, where) => drop(iid, "library", { library: where })} />
              <PileZone title="Graveyard" zone="graveyard" game={game} onDrop={(iid) => drop(iid, "graveyard")} onOpen={() => setViewing("graveyard")} onPreview={setPreview} />
              <PileZone title="Exile" zone="exile" game={game} onDrop={(iid) => drop(iid, "exile")} onOpen={() => setViewing("exile")} onPreview={setPreview} />
            </div>
            <CommanderTax game={game} />
          </aside>
          <Battlefield game={game} onDrop={(iid, at) => drop(iid, "battlefield", { at })} onTap={(iid) => update((g) => toggleTap(g, iid))} onPreview={setPreview} />
          <PreviewPane card={preview} game={game} />
        </div>
        <Hand game={game} onDrop={(iid) => drop(iid, "hand")} onPreview={setPreview} onBottom={(iid) => update((g) => putOnBottom(g, iid))} onPlay={(iid) => drop(iid, "battlefield")} />
      </main>

      {game.stage === "mulligan" && <MulliganDialog game={game} update={update} card={card} />}
      {viewing && <ZoneViewer zone={viewing} game={game} onClose={() => setViewing(null)} onMove={drop} onPreview={setPreview} />}
    </>
  );
}

// ---------- top bar ----------

function TopBar({
  game,
  deck,
  update,
  onNewGame,
}: {
  game: GameState;
  deck: { id: string; name: string };
  update: (fn: (g: GameState) => GameState) => void;
  onNewGame: () => void;
}) {
  const playing = game.stage === "playing";
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
      <Link href={`/decks/${deck.id}`} className="mr-1 opacity-70 hover:underline">
        ← {deck.name}
      </Link>
      <span className="rounded-md bg-foreground/10 px-3 py-1.5 font-semibold tabular-nums">Turn {game.turn}</span>
      <BarButton disabled={!playing} onClick={() => update(nextTurn)} hint="N">
        Next turn
      </BarButton>
      <BarButton disabled={!playing} onClick={() => update(untapAll)} hint="U">
        Untap all
      </BarButton>
      <BarButton disabled={!playing} onClick={() => update((g) => draw(g))} hint="D">
        Draw
      </BarButton>
      <BarButton onClick={() => update(shuffleLibrary)}>Shuffle library</BarButton>
      <span className="ml-auto flex items-center gap-1" aria-label="Life total">
        <BarButton onClick={() => update((g) => setLife(g, g.life - 1))} label="Lose 1 life">
          −
        </BarButton>
        <span className="min-w-14 text-center text-xl font-semibold tabular-nums">{game.life}</span>
        <BarButton onClick={() => update((g) => setLife(g, g.life + 1))} label="Gain 1 life">
          +
        </BarButton>
      </span>
      <BarButton onClick={onNewGame}>New game</BarButton>
    </div>
  );
}

function BarButton({
  onClick,
  disabled,
  hint,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={hint ? `${label ?? ""} (${hint})`.trim() : label}
      className="min-h-9 rounded-md border border-foreground/20 px-3 hover:bg-foreground/10 disabled:opacity-40"
    >
      {children}
      {hint && <kbd className="ml-1.5 rounded border border-foreground/20 px-1 text-[10px] opacity-60">{hint}</kbd>}
    </button>
  );
}

// ---------- cards and drop targets ----------

/** A card the player can drag. `size` is the width in px. */
function CardView({
  inst,
  size,
  tapped,
  onClick,
  onDoubleClick,
  onPreview,
  title,
}: {
  inst: Instance;
  size: number;
  tapped?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
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
    <p className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide opacity-70">
      <span>{title}</span>
      <span className="tabular-nums">
        {extra}
        {count}
      </span>
    </p>
  );
}

// ---------- side zones ----------

/** Commander tax for every commander, wherever it is now. */
function CommanderTax({ game }: { game: GameState }) {
  const commanders = Object.values(game.cards).filter((c) => c.commander);
  if (!commanders.length) return null;
  return (
    <div className="rounded-lg border border-foreground/15 px-2 py-1.5 text-xs" title="Commander tax: 2 more for each time it was cast from the command zone">
      {commanders.map((c) => (
        <p key={c.iid} className="tabular-nums">
          {c.name.split(",")[0]}: tax <strong>+{commanderTax(game, c.iid)}</strong>
        </p>
      ))}
    </div>
  );
}

function CommandZone({ game, onDrop, onPreview }: { game: GameState; onDrop: (iid: string) => void; onPreview: (c: Instance | null) => void }) {
  const ids = game.zones.command;
  return (
    <DropTarget label="Command zone" onDrop={onDrop} className="rounded-lg border border-foreground/15 p-1.5">
      <ZoneLabel title="Command" count={ids.length} />
      <div className="mt-1 flex flex-col gap-1">
        {ids.map((iid) => (
          <div key={iid}>
            <CardView inst={game.cards[iid]} size={88} onPreview={onPreview} title={`${game.cards[iid].name}: drag to the battlefield to cast`} />
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
        <button
          type="button"
          onClick={onDraw}
          disabled={!n || game.stage !== "playing"}
          title="Click to draw (D)"
          className="flex aspect-[63/88] w-[88px] items-center justify-center rounded-[4.75%/3.5%] border border-foreground/30 bg-gradient-to-br from-amber-900 to-stone-800 text-sm font-semibold text-amber-100 shadow disabled:opacity-50"
        >
          {n ? "Draw" : "Empty"}
        </button>
        {/* While dragging, the library splits into a top and a bottom drop target. */}
        {dragging && (
          <div className="absolute inset-0 flex w-[88px] flex-col overflow-hidden rounded-[4.75%/3.5%] text-xs font-semibold text-white">
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
          <CardView inst={game.cards[top]} size={88} onPreview={onPreview} onClick={onOpen} title={`${game.cards[top].name}: click to see all ${ids.length}`} />
        ) : (
          <div className="flex aspect-[63/88] w-[88px] items-center justify-center rounded-lg border border-dashed border-foreground/20 text-xs opacity-50">Empty</div>
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
}: {
  game: GameState;
  onDrop: (iid: string, at: { x: number; y: number }) => void;
  onTap: (iid: string) => void;
  onPreview: (c: Instance | null) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const ids = game.zones.battlefield;
  const lands = ids.filter((iid) => game.cards[iid].land);
  const others = ids.filter((iid) => !game.cards[iid].land);

  // Lands group by name in the lands row, so 12 Forests take one stack instead of a whole row.
  const landGroups: { name: string; ids: string[] }[] = [];
  for (const iid of lands) {
    const name = game.cards[iid].name;
    const g = landGroups.find((x) => x.name === name);
    if (g) g.ids.push(iid);
    else landGroups.push({ name, ids: [iid] });
  }

  return (
    <DropTarget
      label="Battlefield"
      className="flex min-w-0 flex-1 flex-col rounded-lg border border-foreground/15 bg-foreground/[0.03]"
      onDrop={(iid, e) => {
        const r = area.current!.getBoundingClientRect();
        const [gx, gy] = (e.dataTransfer.getData("application/x-ctw-grab") || "0,0").split(",").map(Number);
        onDrop(iid, { x: ((e.clientX - gx - r.left) / r.width) * 100, y: ((e.clientY - gy - r.top) / r.height) * 100 });
      }}
    >
      {/* Free area: cards stay exactly where they're dropped. */}
      <div ref={area} className="relative min-h-0 flex-1">
        {others.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm opacity-40">Drag cards here to play them</p>}
        {others.map((iid) => {
          const p = game.battlefield[iid];
          return (
            <div key={iid} className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <CardView inst={game.cards[iid]} size={100} tapped={p.tapped} onClick={() => onTap(iid)} onPreview={onPreview} title={`${game.cards[iid].name}: click to tap or untap`} />
            </div>
          );
        })}
      </div>
      {/* Lands row, grouped automatically. */}
      <div className="flex min-h-[120px] items-end gap-3 overflow-x-auto border-t border-foreground/10 px-2 py-2">
        <span className="self-center text-xs font-semibold uppercase tracking-wide opacity-50">Lands {lands.length}</span>
        {landGroups.map((g) => (
          <div key={g.name} className="relative flex shrink-0" title={`${g.ids.length} × ${g.name}`}>
            {g.ids.map((iid, i) => (
              <div key={iid} style={{ marginLeft: i === 0 ? 0 : -58 }}>
                <CardView
                  inst={game.cards[iid]}
                  size={72}
                  tapped={game.battlefield[iid]?.tapped}
                  onClick={() => onTap(iid)}
                  onPreview={onPreview}
                  title={`${game.cards[iid].name}: click to tap or untap`}
                />
              </div>
            ))}
            {g.ids.length > 1 && (
              <span className="pointer-events-none absolute -top-2 right-0 rounded bg-black/80 px-1.5 text-xs font-semibold text-white">×{g.ids.length}</span>
            )}
          </div>
        ))}
      </div>
    </DropTarget>
  );
}

function PreviewPane({ card, game }: { card: Instance | null; game: GameState }) {
  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      {card ? (
        <div className="space-y-1">
          {card.image ? (
            <img src={card.image} alt={card.name} className="w-full rounded-[4.75%/3.5%] shadow-lg" />
          ) : (
            <div className="flex aspect-[63/88] items-center justify-center rounded-xl border p-4 text-center">{card.name}</div>
          )}
          {card.commander && <p className="text-xs opacity-70">Commander tax: +{commanderTax(game, card.iid)}</p>}
        </div>
      ) : (
        <div className="flex aspect-[63/88] items-center justify-center rounded-xl border border-dashed border-foreground/20 p-4 text-center text-xs opacity-50">
          Hover a card to see it here
        </div>
      )}
    </aside>
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
    <DropTarget label="Hand" onDrop={onDrop} className="shrink-0 rounded-lg border border-foreground/15 px-2 py-1.5">
      <ZoneLabel
        title={choosing ? `Hand: click ${game.toBottom} more to put on the bottom` : "Hand"}
        count={ids.length}
      />
      <div className={`mt-1 flex min-h-[150px] items-end gap-1 overflow-x-auto ${choosing ? "rounded ring-2 ring-amber-500" : ""}`}>
        {ids.map((iid) => (
          <CardView
            key={iid}
            inst={game.cards[iid]}
            size={105}
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
}: {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  card: (iid: string) => Instance;
}) {
  const cost = bottomCount(game.mulligans + 1, game.freeMulligan);
  const lands = game.zones.hand.filter((iid) => card(iid).land).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Opening hand">
      <div className="w-full max-w-5xl rounded-2xl bg-background p-5 shadow-xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Opening hand{game.mulligans > 0 && ` (mulligan ${game.mulligans})`}: {lands} {lands === 1 ? "land" : "lands"}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={game.freeMulligan}
              onChange={(e) => update((g) => ({ ...g, freeMulligan: e.target.checked }))}
            />
            First mulligan is free (multiplayer rule)
          </label>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {game.zones.hand.map((iid) => {
            const c = card(iid);
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
              : "Keeping this hand costs nothing."}
          </p>
          <button
            type="button"
            onClick={() => update(mulligan)}
            className="min-h-11 rounded-lg border border-foreground/20 px-4 hover:bg-foreground/10"
          >
            Mulligan{cost > 0 ? ` (then ${cost} to the bottom)` : " (free)"}
          </button>
          <button type="button" onClick={() => update(keep)} className="min-h-11 rounded-lg bg-foreground px-5 font-medium text-background">
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
}: {
  zone: Zone;
  game: GameState;
  onClose: () => void;
  onMove: (iid: string, to: Zone, opts?: Parameters<typeof move>[3]) => void;
  onPreview: (c: Instance | null) => void;
}) {
  const ids = [...game.zones[zone]].reverse(); // newest first
  const title = zone === "graveyard" ? "Graveyard" : zone === "exile" ? "Exile" : zone;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[55vh] overflow-y-auto border-t border-foreground/20 bg-background/95 p-4 shadow-2xl backdrop-blur" role="dialog" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">
          {title} ({ids.length})
        </h2>
        <button type="button" onClick={onClose} className="min-h-9 rounded-md border border-foreground/20 px-3 text-sm">
          Close (Esc)
        </button>
      </div>
      {ids.length === 0 ? (
        <p className="text-sm opacity-60">Empty.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {ids.map((iid) => (
            <li key={iid} className="flex w-[120px] flex-col gap-1">
              <CardView inst={game.cards[iid]} size={120} onPreview={onPreview} />
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <MiniButton onClick={() => onMove(iid, "hand")}>Hand</MiniButton>
                <MiniButton onClick={() => onMove(iid, "battlefield")}>Play</MiniButton>
                <MiniButton onClick={() => onMove(iid, "library", { library: "top" })}>Lib top</MiniButton>
                <MiniButton onClick={() => onMove(iid, zone === "graveyard" ? "exile" : "graveyard")}>{zone === "graveyard" ? "Exile" : "Graveyard"}</MiniButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-7 rounded border border-foreground/20 px-1 hover:bg-foreground/10">
      {children}
    </button>
  );
}

/** True while one of our cards is being dragged (some drop targets only appear then). */
function useDragging() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (e: DragEvent) => e.dataTransfer?.types.includes(DRAG_TYPE) && setDragging(true);
    const stop = () => setDragging(false);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
  return dragging;
}
