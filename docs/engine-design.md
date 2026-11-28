# Deck Genome Table: engine design (Gate 0)

Written Nov 27, 2026. Status: **signed off by David, Nov 27, 2026 (8:26 PM HST).**

This is one of five Gate 0 documents:

| Gate 0 item | File |
| --- | --- |
| Engine design | `docs/engine-design.md` (this file) |
| Card language spec | `docs/card-language.md` |
| 20 hard cards on paper | `docs/engine-hard-cards.md` |
| Rules cut list + rule numbers checked | `docs/engine-rules-cut.md` |
| Terms and limits, with sources | `docs/engine-terms.md` |

The master plan is the Claude Doc "Deck Genome Table: the ambitious plan" (https://claude.ai/artifact/Ncf1mvfUHi9m5rY43qPnUF). Where this file and the plan differ, this file is newer and the plan gets fixed to match once David signs off.

## The short version

- The engine is a **pure function**: `step(state, action) -> { state, events, decision }`. No screens, no database, no network. It runs the same in a browser, in Node (deck lab) and in a Cloudflare Durable Object (online tables).
- **State is immutable and copy-on-write**: a new state shares every unchanged piece with the old one, so bots can branch cheaply and undo is just "keep the old state".
- **Every card object knows all its faces** from PR 1, and which face is showing is a status on the object, not a different object.
- **People and bots answer the same `Decision` objects.** The engine never waits for anyone; it returns "seat 2 must choose targets for X" and stops.
- **Derived characteristics (layers 1-7) are computed lazily, once per state**, the first time anything reads them, using 613.8 dependency order.
- **Each seat sees a sanitized view**: a function of state and seat, built so hidden facts can't leak, not by deleting fields after the fact.
- **Undo** is a rewind to an earlier state. Solo games can rewind anything. Online tables refuse to rewind past an action that showed anyone a hidden card.
- **Manual moves** (private and Loose rules tables only) go through the same events as automated ones, so automated cards' triggers see them, with a "don't trigger" box.
- **Card scripts are repo files** (David's choice, Nov 27, 2026), served as hashed files and loaded only for the cards in a game. Supabase keeps one status row per card.

---

## 1. State: copy-on-write

### What's in a state

```ts
type GameState = {
  engineVersion: string;        // e.g. "1.0.0"; pinned into every saved log
  scriptsManifest: string;      // hash of the card-script manifest this game loaded
  rng: RngState;                // seeded mulberry32 or similar; never sent to clients
  nextObjectId: number;         // new id every time an object changes zone (rule 400.7)
  nextTimestamp: number;        // timestamps for 613.7 ordering
  turn: { number: number; activeSeat: Seat; phase: Phase; step: Step | null };
  priority: { seat: Seat | null; passedInRow: Seat[] };
  seats: Record<Seat, PlayerState>;     // life, poison, mana pool, commander damage, counters, left?
  objects: PMap<ObjectId, GameObject>;  // every card, token, copy, emblem, ability on the stack
  zones: {
    library: Record<Seat, ObjectId[]>;   // order matters, top = last
    hand: Record<Seat, ObjectId[]>;
    graveyard: Record<Seat, ObjectId[]>; // order matters
    battlefield: ObjectId[];
    stack: ObjectId[];                   // top = last
    exile: ObjectId[];
    command: ObjectId[];
  };
  effects: ContinuousEffect[];          // lasting effects from resolved spells/abilities (611.2a)
  replacements: ReplacementInstance[];  // from resolved spells, "this turn" shields, etc.
  delayedTriggers: DelayedTrigger[];    // "at the beginning of your next end step..."
  pendingTriggers: PendingTrigger[];    // triggered, waiting to be put on the stack (603.3)
  turnMemory: TurnMemory;               // "this turn" facts: lands played, spells cast, Muldrotha uses...
  gameMemory: GameMemory;               // commander casts, commander damage history, monarch...
  pendingDecision: Decision | null;
  loopGuard: LoopGuard;                 // state hashes seen this turn (104.4b)
  table: TableRules;                    // mode: solo | private | strict | loose; options
};
```

### How copy-on-write works here

- Every object inside a state is frozen. A change makes a new copy of **only the path that changed**: the changed object, the map node above it, and the state root. Everything else is shared by reference.
- `objects` is a **persistent map** (a small hash trie, about 150 lines, tested on its own). A plain object would copy all ~400 entries on every change; the trie copies about 3 small nodes.
- Zone lists are plain arrays. A 100-card library copied on a change is cheap enough (measured in PR 1; the bar is 2,000 actions replayed under 1 second).
- **No engine code mutates.** A lint rule bans assignment to state fields inside `src/lib/engine/`, and tests deep-freeze states in development so a stray mutation throws.

### Why it matters

- Bots branch: try "attack with everything", look 3 moves ahead, throw it away. That's a reference to the old state, nothing copied.
- Undo is keeping old states (or replaying the log to a point).
- Same seed + same actions = same game, so bug reports replay exactly.

### Object identity and last known information

- **Rule 400.7: an object that changes zones becomes a new object.** The engine gives it a new `ObjectId` every time. The card behind it keeps the same `cardId` (and owner).
- Before an object leaves a zone, the engine stores a **snapshot of its last known characteristics** (LKI) in `lki[oldId]`, kept until the end of the turn and as long as anything on the stack or in a delayed trigger refers to it. Scripts that say "its power" after the object moved read the snapshot (Swords to Plowshares, Animate Dead's "that creature").
- A zone-change event records `{ oldId, newId }`, so a script can follow the card into its new zone only when the text says so ("return that card", "the exiled card").

---

## 2. Card objects and faces

### Printed data the engine needs (schema change, for David to approve)

Today the site reads faces live from Scryfall. The engine needs every face in our database. **Proposed table** (no migration until David says yes):

```sql
create table card_faces (
  oracle_id   uuid not null references cards(oracle_id) on delete cascade,
  face_index  smallint not null,          -- 0 = front
  name        text not null,
  mana_cost   text,                       -- "{2}{W}{W}", null for lands and back faces with none
  type_line   text not null,
  oracle_text text not null default '',
  power       text,                       -- text, because "*", "1+*", "X"
  toughness   text,
  loyalty     text,
  defense     text,
  colors      text[] not null default '{}',
  color_indicator text[],
  primary key (oracle_id, face_index)
);
```

Filled by the nightly Scryfall import from `card_faces` in `oracle_cards` (single-face cards get one row). Size estimate: about 40,000 rows, roughly 25 MB, which is fine after David's upgrade. Read-only for everyone, like `cards`.

### In the engine

```ts
type CardDef = {                // printed facts, from card_faces + cards, never changed by the game
  oracleId: string;
  layout: Layout;               // normal | split | flip | transform | modal_dfc | adventure | room | meld | prototype | omen | saga | class | case | leveler | token | emblem ...
  faces: FaceDef[];             // 1 or more
  script: ScriptRef | null;     // null = manual card
};

type GameObject = {
  id: ObjectId;
  cardId: CardInstanceId;       // the physical card (or token) this object is
  def: CardDef;
  owner: Seat;
  controller: Seat;             // base controller before layer 2
  zone: ZoneName;
  status: {
    tapped: boolean; flipped: boolean; faceDown: FaceDownKind | null;
    phasedOut: boolean; upFace: number;       // which face is up (DFCs, MDFCs)
    transformed: boolean;
  };
  counters: Record<string, number>;
  damage: number; deathtouchHit: boolean;
  attachedTo: ObjectId | Seat | null;         // may point to an object in another zone (Animate Dead)
  timestamp: number;
  castInfo?: CastInfo;          // on the stack and remembered on the permanent: face cast, modes, X, kicked, overload, alt cost, how many of each mana color spent
  linked?: Record<string, ObjectId[]>;        // linked abilities (607): "exiled with", "put onto the battlefield with this Aura"
  isToken?: TokenDef; isCopyOfSpell?: boolean;
};
```

### Which face counts where

One function, `printedFace(obj)`, picks the face whose printed characteristics apply, following the rules for each layout:

| Layout | Off stack and battlefield | On the stack | On the battlefield |
| --- | --- | --- | --- |
| Transforming DFC | front only (712.8a) | front, unless cast transformed (712.8c) | the face that's up; back face uses front's mana value (712.8e) |
| Modal DFC | front only (712.8a) | the face cast (712.8f) | the face played or cast (712.8f) |
| Split / Room | both halves combined (709.4) | the half cast, or both if fused | Rooms: both halves, locked halves have no abilities (709.5) |
| Adventure | normal card | the Adventure if cast that way (715.3) | normal card |
| Face-down (morph, manifest, cloak, disguise, foretell in exile) | as rule 708: 2/2, no name, no text, no cost, unless a rule says otherwise | same | same |

Layers then run on top of the printed face. Copy effects copy the **face that's up** plus copiable values (707.2, 707.8).

**Phase 1 builds the shape for all of these** and makes only the layouts the 500 most played cards use work (normal, transform, modal DFC, adventure, split, saga). The rest are covered by tests that say "not yet" so nobody mistakes the gap for a bug.

---

## 3. Actions

An action is the one thing a seat sends. Every action is plain JSON, so it can go over a WebSocket, into a log and into a test.

```ts
type Action =
  | { kind: "pass" }
  | { kind: "playLand"; object: ObjectId; face?: number }            // special action 116.2a
  | { kind: "cast"; object: ObjectId; face?: number; via?: PermissionId }  // starts 601.2; choices come as decisions
  | { kind: "activate"; object: ObjectId; ability: AbilityIndex }
  | { kind: "activateMana"; object: ObjectId; ability: AbilityIndex }   // can be done mid-payment (601.2g)
  | { kind: "special"; special: SpecialKind; object?: ObjectId }      // 116.2b-m, see below
  | { kind: "answer"; decision: DecisionId; choice: Choice }          // answers the pending decision
  | { kind: "concede" }
  | { kind: "manual"; edit: ManualEdit; suppressTriggers?: boolean }  // private / Loose tables only, section 7
  | { kind: "rewind"; toAction: number }                              // section 6
  | { kind: "shortcut"; ... }                                         // Phase 2 (rule 732)
  ;
```

### Special actions (rule 116.2)

The June 19, 2026 Comprehensive Rules list **twelve** (116.2a-k and 116.2m; there's no 116.2l). They don't use the stack. The engine has one slot for them, `special`, and a table that says when each is allowed:

| Rule | Special action | Phase 1? |
| --- | --- | --- |
| 116.2a | Play a land | Yes |
| 116.2b | Turn a face-down creature face up | Shape only; works once a top-500 card needs it |
| 116.2c | Take a later action to end an effect or stop a delayed trigger | Shape only |
| 116.2d | Take an action to ignore a static ability's effect for a while | Shape only |
| 116.2e | Discard Circling Vultures | No (one card) |
| 116.2f | Exile a card with suspend from hand | Shape only |
| 116.2g | Pay {3} to put your companion into your hand | **Yes** (companions are common in Commander) |
| 116.2h | Foretell | Shape only |
| 116.2i | Roll the planar die | No (Planechase) |
| 116.2j | Turn a face-down conspiracy up | No (Conspiracy) |
| 116.2k | Plot | Shape only |
| 116.2m | Unlock a Room's locked half | Shape only |

### What a priority decision offers

When a seat has priority, the decision lists every legal starting action: pass, each land it may play, each card it may begin to cast (with each face and each permission that allows it, such as Muldrotha's or Bolas's Citadel's), each ability it may activate, each special action. "May begin to cast" is checked cheaply (timing, zone, permission); whether the cost can actually be paid is found out during casting, and a cast that can't finish rolls back (601.2e, 733).

---

## 4. Decisions

The engine never asks "what now?" in code. It returns a `Decision` and stops. A person's screen draws it; a bot picks from it; the referee forwards it to the right seat.

```ts
type Decision = {
  id: DecisionId;                 // unique, so a late or repeated answer is ignored
  seat: Seat;                     // exactly one seat decides at a time (simultaneous choices are asked in APNAP order, 101.4)
  kind: DecisionKind;
  prompt: PromptText;             // "Choose a target for Swords to Plowshares"
  source?: ObjectId;              // the card asking
  options?: Option[];             // small, listable choices
  constraint?: Constraint;        // big spaces (attackers, blockers, mana payment, dividing damage): a checker, not a list
  min?: number; max?: number;
  default?: Choice;               // what auto-pass, auto-yield and timeouts pick
  hiddenFromOthers: boolean;      // other seats only see "Seat 2 is choosing"
};
```

Decision kinds in Phase 1: `priority`, `mulligan`, `bottomCards`, `chooseFace`, `chooseModes`, `chooseX`, `chooseTargets`, `divide`, `payCost` (mana and other costs, with auto-pay as the default), `orderTriggers`, `orderReplacements`, `chooseObjects` (search, sacrifice, discard), `chooseOpponent`, `yesNo` ("may"), `payOrNot` ("unless that player pays"), `splitPiles` and `choosePile` (Fact or Fiction), `declareAttackers`, `declareBlockers`, `orderBlockers`/damage assignment, `commanderToCommandZone` (903.9a/b), `legendRule`.

Rules for decisions:

- **Answers are checked**, never trusted. An illegal answer is refused with a reason and the same decision stays open.
- **Simultaneous choices** (each player sacrifices a creature) are asked one seat at a time in APNAP order, and hidden choices are only shown after all are in (101.4).
- **Big spaces use constraints.** Attacks in a 4-player game are too many combinations to list, so the decision carries a checker and the screen builds the answer. Bots get a generator.
- **Auto-pay and auto-yields** answer decisions with their `default` when the seat has turned that on. They never answer a decision that has no default.

---

## 5. Derived characteristics: the lazy layer cache

### The problem

The real power of a creature is printed power, then copy effects, then control, text, type, color, abilities, then P/T in four sublayers, with dependencies between effects (613). Computing that after every change is wasteful: a bot rollout makes thousands of changes and reads characteristics for only a few.

### The design

- `derive(state)` computes **every object's characteristics at once** (copy through 7d) and returns a read-only table. It is cached in a `WeakMap<GameState, Derived>`. A new state is a new key, so the cache can never be stale, and nothing is computed until the first read.
- All engine reads go through `chars(state, id)`, which calls `derive` once per state. Scripts can't read printed values directly.
- Result per object: name, mana cost, mana value, colors, types/subtypes/supertypes, abilities (as instances with their source), power, toughness, loyalty, defense, controller.

### The algorithm, per layer

For each layer 1, 2, 3, 4, 5, 6, 7a, 7b, 7c, 7d (613.1, 613.4):

1. Collect the effects that apply in this layer: static abilities of objects that have them **as of the previous layer's result**, characteristic-defining abilities first (613.3), resolved continuous effects (`state.effects`), rules effects (305.7 land type setting, 305.6 intrinsic mana abilities).
2. **Locked-in effects (613.6):** once an effect started applying in an earlier layer, it keeps applying in later layers even if its ability was removed in between. The engine tracks "started" effects per pass. This is what makes Humility plus Opalescence come out right.
3. **Order them (613.7, 613.8):** sort by timestamp, then repeatedly pick the earliest effect that **doesn't depend on any effect not yet applied** (613.8b). Dependency test, from 613.8a: A depends on B if both are in the same layer (or sublayer) and applying B would change A's existence, its text, what it applies to, or what it does to anything it applies to, and neither is a characteristic-defining ability unless both are. The engine tests this by trial: apply B to a scratch copy and compare A's applies-to set and result. If effects depend on each other in a loop, timestamp order decides (613.8b). After each effect is applied, the remaining order is re-checked (613.8c).
4. Apply. Effects from resolved spells use the set of objects fixed when they began (611.2c); static abilities recompute who they affect each time.

### Speed

- The dependency test is the slow part, so it runs **only inside layers with 2+ effects that could interact** (most layers in most states have 0 or 1 effect).
- Benchmarks in PR 4c: values are computed once per state on first read, never on every read; the 10 layer puzzles pass.
- If profiling shows `derive` is still hot in bot rollouts, the next step is **incremental derive**: reuse the previous state's table when the change touched nothing a layer reads (tapping a land changes no characteristic). That's an optimization behind the same function, so nothing else changes.

---

## 6. Hidden information: sanitized seat views

`view(state, seat)` builds what one seat (or a spectator) may see. It's built **from the ground up with only allowed facts**, never by copying the state and deleting fields, so a new field added later is hidden until someone decides to show it.

- **Own hand:** full cards. **Others' hands:** a count, plus any cards revealed to this seat and still known (tracked as `knownTo` sets on objects).
- **Libraries:** a count. The order is never in any view. Cards someone may look at (Bolas's Citadel, "play with the top card revealed", scry in progress) are shown only to the seats allowed.
- **Face-down objects:** a card back with a per-view label ("Face-down creature 2"). The controller sees the face; others don't (708.5).
- **Object ids in views are per-view handles**, re-made whenever an object crosses from hidden to known. Otherwise someone could match the id of a card in an opponent's hand with the one that was searched for earlier.
- **The RNG seed and state never leave the referee** during a game. Replays get it after the game ends.
- **Decisions of others** show as "Seat 2 is choosing" with no options.
- **Event streams are filtered the same way:** "Seat 3 drew a card" for others, "You drew Sol Ring" for the drawer.

Proof (PR 5): every view after every action of 1,000 random games is scanned for others' hand cards and library order. Zero leaks.

---

## 7. Undo: reversible and irreversible

There's no Comprehensive Rules rule for undo; it's our own policy. The closest rules are **733 "Handling Illegal Actions"** (rewinding an illegal action, used for mid-cast rollback) and **732 "Taking Shortcuts"**. The plan's citations of 729 and 730 are out of date: in the June 19, 2026 rules, 729 is Subgames and 730 is Merging with Permanents.

Every action records whether it **revealed hidden information to any seat that didn't have it**: drawing, shuffling, looking at or revealing cards, searching, random choices, a face-down card turned up. That action is an **information boundary**.

| Kind | Examples | Solo (you and bots) | Private table | Strict or Loose table with strangers |
| --- | --- | --- | --- | --- |
| Reversible | backing out of a cast you can't pay, tapping a land for mana and not using it, a misclick before passing priority | Yes | Yes (your own last action, before anyone else acts) | Yes (same) |
| Irreversible | anything past an information boundary | **Yes, full rewind** (David, Nov 27, 2026) | Only if every player agrees, never past a reveal of a hidden card to someone | **Never past a reveal** |

How rewinding works: states are kept for the current turn (cheap, they share structure); older points are reached by replaying the action log from the last turn snapshot. A rewind is itself an action in the log, so replays show it.

Solo games that used a rewind are marked, and **the deck lab and stats never count marked games**.

---

## 8. The manual/automated boundary

### Where manual moves exist (David, Nov 27, 2026)

| Table mode | Manual button | Who can sit |
| --- | --- | --- |
| Solo (you and bots) | Yes | Any deck |
| Private (friends, or friends and bots) | Yes | Any deck |
| Public, strict (players you don't know) | **No**, 100% rules | Only decks whose every card is automated |
| Public, **Loose rules** (host's choice) | Yes; label shown before joining; not rated | Any deck |

### What a manual card does

- The engine knows every card's printed facts with no script: it can be cast, its cost is paid, it goes on the stack, it can be targeted and countered.
- When a manual card's spell or ability resolves (or a manual card asks for something), its controller gets the free-form tools: move a card between zones, tap/untap, add or remove counters, change life, create a token, attach, change control, mark "done".
- Each tool is a `manual` action: logged, marked manual in everyone's log ("David moved Llanowar Elves to the graveyard by hand"), and followed by state-based actions.

### Do manual moves fire triggers? (recommended rule, needs David's sign-off)

**Yes by default.** A manual edit produces the same events an automated one would (a creature moved from battlefield to graveyard is a "dies" event), so automated cards react (Blood Artist sees it die). Each manual tool has a **"don't trigger"** box. With it ticked, the move produces no trigger events.

**Replacement effects too.** The same events also pass through replacement effects (a manual "put into graveyard" with Rest in Peace out goes to exile instead), and the same box turns that off. Reason: if manual moves skipped replacements, a commander moved by hand to the graveyard wouldn't be offered the command zone, and Rest in Peace would look broken. The box name becomes **"Don't apply card effects"**.

**Gap found in the plan:** the PR 5 gate in tab 7 says "a manual zone change fires no triggers". That was written before this decision. It should read: "a manual zone change fires automated triggers and replacements unless 'Don't apply card effects' is ticked; state checks run after either way." I'll fix tab 7 after David signs off.

Runaway chains (a manual move that triggers something that triggers again) are stopped by the same loop guard as automated play (104.4b).

### Online

At private and Loose tables any player can ask to undo a manual change; the owner accepts or refuses. That undo follows section 7's rule (never past a reveal).

---

## 9. Card scripts: where they live and how they load

**David's choice (Nov 27, 2026): versioned files in the repo, plus a status table in Supabase.**

- Scripts live in `engine-cards/<first two characters of oracle_id>/<oracle_id>.json`, one file per card, with its tests beside it (`<oracle_id>.test.json`). Every change is a pull request; CI checks each script against the card language schema and runs its tests on the engine version it targets.
- The build writes a **manifest**: `{ engineVersion, languageVersion, cards: { oracleId: contentHash } }`, and copies each script to a file named by its hash. These are served from a cached file host (Vercel's static files first; the Cloudflare referee can read the same files). A file named by its hash never changes, so it can be cached forever.
- **On-demand loading:** when a game starts, the client or referee loads the manifest, then only the scripts for the cards in the game: every card in every deck (about 400 in a 4-player pod), the commanders, companions, and the token definitions those cards make. A card that joins mid-game from outside (rare) is fetched then, and the game waits for it.
- **Every game pins its manifest hash** in its log, so a bug report or replay loads the exact scripts it was played with.
- Unscripted cards (not in the manifest) are manual cards.

**Proposed Supabase table** (for the coverage meter and the compiler queue; no migration until David approves):

```sql
create table card_script_status (
  oracle_id       uuid primary key references cards(oracle_id) on delete cascade,
  status          text not null check (status in ('queued','automated','manual','failed')),
  script_hash     text,              -- matches the manifest
  language_version text,             -- e.g. "dg-card/1"
  engine_version  text,
  missing_blocks  text[] not null default '{}',   -- "needs: copy a spell"
  attempts        smallint not null default 0,
  oracle_hash     text,              -- hash of the oracle text it was written from; errata re-queues
  updated_at      timestamptz not null default now()
);
```

Readable by everyone (the coverage meter shows on any deck), written only with the service-role key by the compiler.

---

## 10. Events, triggers, replacements (summary; details in PRs 4a-4b)

- Every change goes through **one event pipeline**: propose event, apply replacement effects (affected player or controller picks the order when several apply, 616.1; self-replacement effects first, 614.15), apply, emit the resolved event, match triggers.
- Matched triggers wait in `pendingTriggers` and go on the stack the next time a player would get priority, in APNAP order, each player ordering their own (603.3b). Panharmonicon-style effects add copies at match time.
- State-based actions run as a set whenever a player would get priority, repeated until none apply (704.3), then triggers are put on the stack.
- Commander returns: graveyard or exile to command zone is a **state-based action** (903.9a), so "dies" triggers still fire; hand or library is a **replacement** (903.9b).
- A player leaving (800.4a, Nov 2026 rules): the objects they own leave the game and effects giving them control of objects or players end; then their objects on the stack that aren't cards (abilities, copies) cease to exist; then anything still under their control is exiled. It happens at once, not as a state-based action, and if they had priority it passes to the next player. If they leave during their own turn, that turn finishes with no active player (800.4j): PR 1 starts the next turn at once instead, a simplification to replace in PR 3.

## 11. What the engine promises (invariants checked in every random-game test)

- Every card is in exactly one zone; tokens and copies outside their legal zones cease to exist (704.5d, 704.5e).
- Mana pools never go negative; life totals are integers.
- Exactly one seat has a pending decision, or the game is over.
- The same seed and actions give the same state, on every platform.
- No view ever contains another seat's hidden card or any library order.

## 12. Open items for David

1. Approve or change the two proposed tables (`card_faces`, `card_script_status`). Nothing is created until then.
2. Sign off the manual-move rule in section 8 (fires triggers and replacements by default, with "Don't apply card effects").
3. The rules cut list and terms table (separate docs) each have a question.
