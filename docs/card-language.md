# Card language spec, version `dg-card/1` (Gate 0)

Written Nov 27, 2026. Status: **signed off by David, Nov 27, 2026 (8:26 PM HST).** The 20 hard cards written in this language are in `docs/engine-hard-cards.md`.

## What it is, in plain words

A card script is **data, not code**: a JSON file that says what a card does using a fixed set of building blocks. The engine reads it and does the work. Because scripts can't run arbitrary code:

- a script can't crash the engine, read hidden cards it shouldn't, or cheat;
- the compiler (Claude) can only write things the engine understands, and a schema check rejects anything else;
- a block that's wrong is fixed once and every card using it is fixed.

Examples in these docs are written in **YAML** because it's easier to read. The stored files are JSON with the same shape.

## File shape

```yaml
schema: dg-card/1           # language version; see Versioning
oracleId: 5a6f...           # the card
name: Swords to Plowshares
oracleHash: 9c1e...         # hash of the oracle text it was written from; errata re-queues the card
faces:                      # one entry per face, same order as card_faces.face_index
  - abilities: [ ... ]
tokens: [ ... ]             # token definitions this card makes, if not a standard one (Treasure etc. are built in)
notes: "..."                # optional, for people; ignored by the engine
```

Printed facts (name, cost, types, P/T, colors) are **not** in the script. They come from `card_faces`, so a script can't disagree with the printed card.

## Abilities

Each face has a list of abilities. Every ability is one of these kinds:

| Kind | Rule | Example |
| --- | --- | --- |
| `keyword` | 702 | `{ keyword: flying }`, `{ keyword: ward, cost: "{2}" }` |
| `spell` | 608 | what an instant or sorcery does when it resolves |
| `activated` | 602 | `cost` + `effect`, optional `timing` (sorcery speed), `limit` (once each turn) |
| `mana` | 605 | activated or triggered mana ability; resolves immediately, no stack |
| `triggered` | 603 | `when` (event pattern), optional `if` (intervening if, 603.4), `effect` |
| `static` | 604 | a continuous effect, a rule change, or a permission, active while the source is in the right zone |
| `replacement` | 614 | `replaces` (event pattern) + `with`; `self: true` for self-replacement (614.15) |
| `cda` | 604.3 | characteristic-defining ability (Tarmogoyf's P/T); applies in all zones |
| `loyalty` | 606 | planeswalker ability with a loyalty cost |
| `cost` | 118, 601.2f | alternative or additional costs offered when casting (overload, kicker, convoke is a keyword) |

Every ability can have `zone` (where it works, default battlefield for permanents, stack for spells), and `id` (a name other abilities on the card can refer to, for linked abilities, 607).

## Building blocks

### Selectors (which objects or players)

A selector describes a set, checked against **derived** characteristics:

```yaml
{ type: creature, controller: you }                    # creatures you control
{ type: [artifact, enchantment], controller: opponent } # artifacts and enchantments your opponents control
{ type: enchantment, not: { subtype: Aura }, other: true }   # each other non-Aura enchantment
{ type: land, not: { supertype: basic } }               # nonbasic lands
{ zone: graveyard, type: creature, kind: card }         # creature card in a graveyard
{ player: opponent }                                    # an opponent
```

Fields: `type`, `subtype`, `supertype`, `color`, `controller`, `owner`, `zone`, `kind` (permanent / card / spell / ability / token / player), `name`, `manaValue` (with comparisons), `power`, `tapped`, `other` (not the source), `not`, `anyOf`, `allOf`, `with` (has a keyword or counter), `self`.

### Targets

```yaml
targets:
  - id: t                       # bound as $t
    select: { type: creature }
    count: 1                    # or { min: 0, max: 1 } for "up to one"
```

Targets are chosen while casting (601.2c) and rechecked on resolution (608.2b). If every target is illegal the spell or ability does nothing, unless the ability says `resolvesWithoutTargets: true` (Gilded Drake's text says so).

### Effects

An `effect` is a list of steps done in order. Core steps in v1:

| Group | Steps |
| --- | --- |
| Cards | `draw`, `discard`, `mill`, `reveal`, `look`, `search` (library, with filter; can fail to find, 701.23), `shuffle`, `scry`, `surveil`, `putOnTop`, `putOnBottom` (with `random: true`) |
| Moving | `move` (any zone to any zone, with `tapped`, `faceDown`, `underControlOf`, `attachTo`), `destroy`, `exile`, `sacrifice`, `bounce` (to owner's hand), `returnToBattlefield` |
| Making | `createToken` (definition + count), `copy` (a spell or permanent), `createEmblem` |
| Numbers | `gainLife`, `loseLife`, `dealDamage`, `addCounters`, `removeCounters`, `addMana`, `payLife` |
| State | `tap`, `untap`, `attach`, `phaseOut`, `exchangeControl`, `gainControl`, `transform`, `turnFaceUp` |
| Lasting | `continuous` (a layer effect with a duration), `ruleEffect` (a rule change with a duration), `grantPermission`, `addReplacement` (a shield: "the next time...") |
| Delayed | `delayed` (a delayed triggered ability: `when` + `effect`, 603.7) |
| Game | `winGame`, `loseGame`, `extraTurn`, `skipStep` |
| Choices | `may` (the controller or a named player chooses yes/no), `unless` (a named player may pay a cost to stop it), `choose` (objects, a mode, a number, an opponent, a color, a card type), `splitPiles` + `choosePile`, `vote` |
| Control flow | `if` / `else` (conditions), `forEach` (over a selector or a list), `repeat` (a number of times) |

Each step can bind its result: `{ exile: $t, as: exiled }` makes `$exiled` the list of objects that actually moved (their new ids), which later steps and delayed triggers can use.

### Expressions (numbers and values)

```yaml
3
{ count: { type: [artifact, enchantment], controller: opponent } }   # Dockside
{ devotion: blue }                                                     # Thassa's Oracle
{ x: true }                                                            # the X paid
{ power: $t, lki: true }                                               # Swords: last known power
{ manaValue: self }
{ add: [ ..., ... ] }, { times: [ ..., 2 ] }, { min: [...] }
{ librarySize: you }
```

Expressions are worked out **when the step runs**, unless the text locks them earlier (an X chosen while casting is fixed then).

### Conditions

`{ compare: [expr, ">=", expr] }`, `{ exists: selector }`, `{ zoneOf: $t, is: battlefield }`, `{ castWith: overload }` (what was chosen while casting), `{ isTurnOf: you }`, `{ paid: false }` (after an `unless`), `{ and/or/not: [...] }`.

### Event patterns (for triggers and replacements)

```yaml
{ event: zoneChange, from: battlefield, to: graveyard, object: { type: creature } }   # dies
{ event: enters, object: self }                                                        # ETB
{ event: cast, by: opponent }
{ event: draw, player: opponent }
{ event: discard, player: you }
{ event: beginStep, step: end, turnOf: you, next: true }
{ event: attacks, object: { controller: you } }
{ event: createTokens, controller: you }        # for replacements like Doubling Season
{ event: putCounters, on: { controller: you, kind: permanent } }
{ event: lifeChange, player: you }
```

A trigger can bind what it saw: `as: { player: p, object: o }` makes `$p` and `$o` available in its effect, with LKI for objects that already moved.

### Continuous effects

```yaml
continuous:
  layer: 4                 # 1, 2, 3, 4, 5, 6, 7a, 7b, 7c, 7d
  affects: { type: land, not: { supertype: basic } }
  lockSet: false           # static abilities: false (re-check each time). Resolved spells: true (611.2c), the default for effect steps
  do: { setLandSubtypes: [Mountain] }    # or addTypes, removeAllAbilities, setBasePT, modifyPT, gainAbility, setController, copyOf...
  duration: whileSource     # whileSource (static), endOfTurn, untilYourNextTurn, untilLeaves: $x, forever
```

The engine, not the script, decides the order effects apply in (timestamps and 613.8 dependency). Scripts only say what an effect does and which layer it's in. The schema checks that each `do` matches its layer (no `setBasePT` in layer 4).

### Permissions and rule effects

```yaml
permission: { castFrom: { zone: library, position: top }, who: you, also: [playLands] }   # Bolas's Citadel
permission: { lookAt: { zone: library, position: top }, who: you, anyTime: true }        # also changes the seat view
permission: { castFrom: { zone: graveyard }, perTurn: { onePerPermanentType: true }, playLand: 1, duringTurnOf: you }  # Muldrotha
ruleEffect: { skipStep: draw, player: you }                                               # Necropotence
ruleEffect: { lifeCantChange: you }                                                      # Teferi's Protection
ruleEffect: { triggerAgain: { when: { event: enters, object: { type: [artifact, creature] } }, controller: you } }  # Panharmonicon
alternativeCost: { payLife: { manaValue: spell } }                                       # Bolas's Citadel's cast
```

Permissions are what the priority decision reads to offer "cast from top of library" and so on. A `perTurn` permission keeps its usage in `turnMemory`, tied to the source object's id (so a Muldrotha that leaves and returns is a new object with fresh uses).

## Bound variables and last known information

- Names start with `$`. They come from targets (`$t`), trigger bindings (`$p`, `$o`), and `as:` on effect steps (`$exiled`, `$returned`, `$found`).
- **Scope:** an ability's variables live while it resolves. A `delayed` trigger created by that ability **captures** the variables it uses (Necropotence's exiled card), so it still knows which card at the end step.
- **Zone changes:** a variable holds an object id. If that object has since changed zones, it's a different object (400.7); reading it gives its **last known information** (`lki: true`, or automatically for "its power", "its controller" after it left). Acting on it ("return that card") does nothing unless the script followed it: `{ follow: $t, to: graveyard }`, which finds the new object only if it went where the text says.
- **Linked abilities (607):** an ability with `link: name` stores the objects in `obj.linked.name`, and another ability on the same object reads them (`{ linked: name }`). Animate Dead uses this for "the creature put onto the battlefield with this Aura".

## Keywords

About 150 keywords will be one entry each. v1 has **30**, picked from the 500 most played cards: flying, first strike, double strike, deathtouch, lifelink, trample, vigilance, haste, reach, menace, hexproof, indestructible, flash, defender, ward, protection, flashback, cycling, kicker, convoke, overload, cascade, equip, enchant, landfall (ability word, a trigger helper), affinity, storm, crew, partner variants (partner, partner with, friends forever, choose a Background, Doctor's companion), companion. The PR 2 gate checks the 30 hand-written cards use each of them.

## Versioning

- `schema: dg-card/1` on every file. **Adding** a block or field is a minor change: old scripts stay valid, the version stays `dg-card/1`.
- **Changing what a block means** is a new major version (`dg-card/2`). It ships with either an automatic migration of every script that uses the block, or a re-check (rerun tests, re-queue failures). Old scripts never silently change meaning.
- The engine declares which language versions it can run. The manifest lists each script's version, so a game knows up front if it can't run a card (it plays it as manual instead).
- Every block in the schema carries the rule numbers it implements, so the rules cut list can tell which cards a later rule unlocks.

## What makes a card "fit"

A card fits `dg-card/1` when every sentence of its oracle text maps to blocks above, its tests (written by the separate tester pass) pass, and no `notes` say "approximation". A card that needs a block the language doesn't have yet stays **manual** with `missing_blocks` filled in ("needs: copy a spell"); the top of that tally is what the language learns next.
