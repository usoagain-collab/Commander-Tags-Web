"use client";

// Multiplayer playtesting (v2): a 👥 button on the table opens the room screen. Create a room and share its code,
// or join one; then everyone at the table sees each other's board, life, hand size and commanders, passes the
// turn in join order, and tracks the commander damage they take. Each player runs their own deck and game.
import { useState } from "react";
import { COMMANDER_DAMAGE_LIMIT, lostToCommander, MAX_PLAYERS, readCode, roomCode, type PlayerView } from "@/lib/playtest/room";
import type { Room } from "@/lib/playtest/use-room";
import { GlassOverlay } from "../glass-overlay";

export function Multiplayer({ room, compact }: { room: Room; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const inRoom = !!room.code;
  const activeName = room.seats.find((s) => s.id === room.active)?.name;
  return (
    <>
      <div className={`fixed z-40 flex items-center gap-1.5 ${compact ? "right-0 top-1/2 -translate-y-1/2 flex-col" : "bottom-3 left-3"}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={inRoom ? `Room ${room.code}: ${room.seats.length} players` : "Play with friends"}
          title={inRoom ? `Room ${room.code}` : "Play with friends: a shared table, each with your own deck"}
          className={`btn min-h-11 min-w-11 shadow-xl ${inRoom ? "border-gold" : ""} ${compact ? "rounded-r-none px-2" : ""}`}
        >
          👥{!compact && <span>{inRoom ? `Room ${room.code}` : "Play with friends"}</span>}
          {inRoom && compact && <span className="text-xs tabular-nums">{room.seats.length}</span>}
        </button>
        {inRoom && !compact &&
          room.opponents.map(({ seat, view }) => (
            <button
              key={seat.id}
              type="button"
              onClick={() => setOpen(true)}
              title={`${seat.name}${view ? `: ${view.life} life, ${view.hand} in hand` : ""}`}
              className={`btn min-h-11 shadow-xl ${room.active === seat.id ? "border-gold" : ""}`}
            >
              <span className="max-w-24 truncate">{seat.name}</span>
              <span className="display text-lg tabular-nums text-gold">{view?.life ?? "…"}</span>
            </button>
          ))}
        {inRoom && !compact && activeName && (
          <span className="rounded-md bg-background/80 px-2 py-1 text-xs shadow-xl">{room.myTurn ? "Your turn" : `${activeName}'s turn`}</span>
        )}
      </div>
      {open && <RoomScreen room={room} onClose={() => setOpen(false)} />}
    </>
  );
}

function RoomScreen({ room, onClose }: { room: Room; onClose: () => void }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const typed = readCode(text);
  const lost = lostToCommander(room.damage);

  return (
    <GlassOverlay label="Play with friends" paused={false} onClose={onClose}>
      <div className="mx-auto max-w-6xl space-y-6 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="display text-3xl">Play with friends</h2>
            <p className="mt-1 max-w-prose opacity-85">
              A shared table for up to {MAX_PLAYERS}: everyone plays their own deck on their own screen and sees the others&apos; boards, life and hand sizes. Nothing is saved.
            </p>
          </div>
          <button type="button" autoFocus onClick={onClose} className="btn min-h-11 shrink-0">
            Back to my table
          </button>
        </div>

        {!room.code ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="panel p-4">
              <h3 className="display text-xl">Start a room</h3>
              <p className="mt-1 opacity-80">You get a code to send your friends.</p>
              <button type="button" onClick={() => room.join(roomCode())} className="btn btn-gold mt-3 min-h-11 px-5">
                Create a room
              </button>
            </section>
            <section className="panel p-4">
              <h3 className="display text-xl">Join a room</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed) room.join(typed);
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Code, like K7QPM"
                  aria-label="Room code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 font-mono text-lg uppercase tracking-widest"
                />
                <button type="submit" disabled={!typed} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
                  Join
                </button>
              </form>
            </section>
          </div>
        ) : (
          <>
            <section className="panel flex flex-wrap items-center gap-3 p-4">
              <span className="opacity-80">Room</span>
              <span className="font-mono text-3xl font-bold tracking-[0.2em]">{room.code}</span>
              <button
                type="button"
                className="btn min-h-10"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(room.code!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    // the code is on screen to read out
                  }
                }}
              >
                {copied ? "Copied" : "Copy code"}
              </button>
              <span className="opacity-80">
                {room.status === "joining" && "Connecting…"}
                {room.status === "error" && "Couldn't connect to the room. Check your connection and try again."}
                {room.status === "full" && `This room already has ${MAX_PLAYERS} players.`}
                {room.status === "joined" && `${room.seats.length} at the table`}
              </span>
              <button type="button" onClick={room.leave} className="btn ml-auto min-h-10 text-red-400">
                Leave room
              </button>
            </section>

            <section>
              <h3 className="eyebrow mb-2">Turn order</h3>
              <ol className="flex flex-wrap items-center gap-2">
                {room.seats.map((s, i) => (
                  <li key={s.id} className={`rounded-full border px-3 py-1 ${room.active === s.id ? "border-gold bg-gold text-gold-ink" : "border-foreground/20"}`}>
                    {i + 1}. {s.id === room.id ? "You" : s.name}
                  </li>
                ))}
                {room.myTurn && room.seats.length > 1 && (
                  <li>
                    <button type="button" onClick={room.passTurn} className="btn btn-gold min-h-10">
                      Pass the turn ▸
                    </button>
                  </li>
                )}
              </ol>
            </section>

            {lost && <p className="rounded-lg border border-red-500 bg-red-500/10 p-3 text-base text-red-300">You&apos;ve taken {COMMANDER_DAMAGE_LIMIT} or more damage from one commander: that&apos;s a loss.</p>}

            {room.opponents.length === 0 ? (
              <p className="panel p-4 text-base opacity-85">Waiting for friends: send them the code above. They open any of their decks, choose Playtest, then 👥 and Join.</p>
            ) : (
              room.opponents.map(({ seat, view }) => (
                <Opponent key={seat.id} name={seat.name} view={view} active={room.active === seat.id} damage={room.damage[seat.id] ?? 0} onDamage={(n) => room.setDamage(seat.id, n)} />
              ))
            )}
          </>
        )}
      </div>
    </GlassOverlay>
  );
}

function Opponent({ name, view, active, damage, onDamage }: { name: string; view: PlayerView | null; active: boolean; damage: number; onDamage: (n: number) => void }) {
  if (!view) {
    return (
      <section className="panel p-4">
        <h3 className="display text-xl">{name}</h3>
        <p className="mt-1 opacity-75">Setting up their table…</p>
      </section>
    );
  }
  const lands = view.battlefield.filter((c) => c.land);
  const others = view.battlefield.filter((c) => !c.land);
  const landCounts = [...lands.reduce((m, c) => m.set(c.name, (m.get(c.name) ?? 0) + 1), new Map<string, number>())];
  return (
    <section className={`panel p-4 ${active ? "border-gold" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="display text-xl">{name}</h3>
        <span className="opacity-75">{view.deck}</span>
        {active && <span className="rounded bg-gold px-2 py-0.5 text-xs font-semibold text-gold-ink">Their turn</span>}
        <span className="display ml-auto text-3xl tabular-nums text-gold" aria-label="Life">
          {view.life}
        </span>
      </div>
      <p className="mt-1 opacity-80">
        Turn {view.turn} · {view.hand} in hand · {view.library} in library · {view.graveyard.length} in graveyard · {view.exile} exiled
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        {view.commanders.map((c) => (
          <figure key={c.name} className="w-24">
            {c.image ? <img src={c.image} alt={c.name} className={`w-full rounded-[4.75%/3.5%] ${c.inZone ? "" : "opacity-60"}`} /> : <span>{c.name}</span>}
            <figcaption className="mt-1 text-xs opacity-80">
              {c.inZone ? "In command zone" : "On the battlefield"}
              {c.tax > 0 && ` · tax ${c.tax}`}
            </figcaption>
          </figure>
        ))}
        <div className="flex items-center gap-2">
          <span className="opacity-85" title="Commander damage you've taken from this player">
            Their commander hit you for
          </span>
          <button type="button" aria-label="One less commander damage" onClick={() => onDamage(damage - 1)} disabled={damage <= 0} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
            −
          </button>
          <span className={`w-8 text-center text-lg font-semibold tabular-nums ${damage >= COMMANDER_DAMAGE_LIMIT ? "text-red-400" : ""}`}>{damage}</span>
          <button type="button" aria-label="One more commander damage" onClick={() => onDamage(damage + 1)} className="min-h-10 min-w-10 rounded-md border border-foreground/20">
            +
          </button>
        </div>
      </div>
      {others.length > 0 && (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {others.map((c) => (
            <li key={c.iid} className="relative" title={c.name}>
              {c.image ? (
                <img src={c.image} alt={c.name} className={`w-full rounded-[4.75%/3.5%] transition-transform ${c.tapped ? "rotate-12 opacity-70" : ""}`} />
              ) : (
                <span className="panel block p-1 text-xs">{c.name}</span>
              )}
              {Object.entries(c.counters).map(([kind, n]) => (
                <span key={kind} className="absolute left-1 top-1 rounded bg-black/80 px-1 text-[11px] text-white">
                  {n} {kind}
                </span>
              ))}
              {c.token && <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1 text-[10px] text-white">token</span>}
            </li>
          ))}
        </ul>
      )}
      {landCounts.length > 0 && (
        <p className="mt-2 opacity-80">
          <span className="eyebrow">Lands </span>
          {landCounts.map(([n, q]) => (q > 1 ? `${n} ×${q}` : n)).join(" · ")}
        </p>
      )}
      {view.graveyard.length > 0 && (
        <p className="mt-1 truncate opacity-70" title={view.graveyard.map((g) => g.name).join(", ")}>
          <span className="eyebrow">Graveyard </span>
          {view.graveyard
            .slice(-6)
            .reverse()
            .map((g) => g.name)
            .join(" · ")}
          {view.graveyard.length > 6 && " …"}
        </p>
      )}
    </section>
  );
}
