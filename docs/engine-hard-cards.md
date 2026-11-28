# 20 hard cards on paper (Gate 0)

Written Nov 27, 2026, in `dg-card/1` (see `docs/card-language.md`). Oracle text is from our `cards` table (Scryfall, nightly). Status: **signed off by David, Nov 27, 2026 (8:26 PM HST).**

The Gate 0 pass bar: **each card fits, or the gap is named with a fix.** Result: **all 21 fit** (the list says "Gilded Drake / Muldrotha", so both are here). Seven needed something the first draft of the language didn't have; each is named under **What it needed**, and those blocks are now in the spec.

Scripts are YAML for reading; the real files are JSON with the same shape. Printed facts (cost, types, P/T) come from the card data, not the script.

| # | Card | Fits? | What it needed |
| --- | --- | --- | --- |
| 1 | Humility | Yes | 613.6 "keeps applying once started" in the layer engine |
| 2 | Opalescence | Yes | P/T expression read per affected object |
| 3 | Blood Moon | Yes | `setLandSubtypes` with 305.7 meaning |
| 4 | Urborg, Tomb of Yawgmoth | Yes | 305.6 intrinsic mana abilities from land types |
| 5 | Doubling Season | Yes | none |
| 6 | Panharmonicon | Yes | `triggerAgain` rule effect (603.2d) |
| 7 | Clone | Yes | `copyOf` "enters as a copy" replacement |
| 8 | Teferi's Protection | Yes | player-level effects (613.10), phasing |
| 9 | Rhystic Study | Yes | none |
| 10 | Smothering Tithe | Yes | none |
| 11 | Dockside Extortionist | Yes | none |
| 12 | Thassa's Oracle | Yes | `devotion` (700.5a), `winGame` |
| 13 | Necropotence | Yes | delayed trigger capturing a variable; hidden face-down exile |
| 14 | Cyclonic Rift | Yes | overload as a cast choice the script can branch on |
| 15 | Fact or Fiction | Yes | `splitPiles` / `choosePile` decisions |
| 16 | Emeria's Call (modal DFC) | Yes | none beyond the face model |
| 17 | Animate Dead | Yes | linked abilities (607), Aura attached to a card in a graveyard, ability changing its own enchant |
| 18 | Bolas's Citadel | Yes | look and cast permissions; the seat view must honor "look" |
| 19 | Chord of Calling | Yes | convoke keyword in payment |
| 20a | Gilded Drake | Yes | `resolvesWithoutTargets`, `exchangeControl` (701.12) |
| 20b | Muldrotha, the Gravetide | Yes | per-turn permission uses by card type |

---

## 1. Humility

> All creatures lose all abilities and have base power and toughness 1/1.

```yaml
abilities:
  - kind: static
    effects:
      - continuous: { layer: 6, affects: { type: creature }, do: { removeAllAbilities: true } }
      - continuous: { layer: 7b, affects: { type: creature }, do: { setBasePT: [1, 1] } }
```

**Fits.** Both effects come from one ability with one timestamp. If Humility itself is a creature (Opalescence), it loses its own ability in layer 6, and **613.6** says its effect still applies to the same set of objects in layer 7b. The layer engine tracks "effects that started" for this.

## 2. Opalescence

> Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.

```yaml
abilities:
  - kind: static
    effects:
      - continuous:
          layer: 4
          affects: { type: enchantment, not: { subtype: Aura }, other: true }
          do: { addTypes: [creature] }
      - continuous:
          layer: 7b
          affects: { type: enchantment, not: { subtype: Aura }, other: true }
          do: { setBasePT: [{ manaValue: affected }, { manaValue: affected }] }
```

**Fits.** `affected` means "each object this applies to", so every enchantment gets its own mana value.

**Humility + Opalescence (PR 4c layer puzzle):** layer 4 makes Humility a 4/4 creature. Layer 6: Humility removes all creatures' abilities, including its own, but keeps applying (613.6). Layer 7b: both set base P/T, so **timestamp decides**. Opalescence later: enchantment creatures (including Humility) are MV/MV, other creatures 1/1. Humility later: every creature is 1/1. No creature has abilities either way.

## 3. Blood Moon

> Nonbasic lands are Mountains.

```yaml
abilities:
  - kind: static
    effects:
      - continuous: { layer: 4, affects: { type: land, not: { supertype: basic } }, do: { setLandSubtypes: [Mountain] } }
```

**Fits.** `setLandSubtypes` follows **305.7**: the land loses its old land types and every ability from its rules text, and gains "{T}: Add {R}" (305.6).

## 4. Urborg, Tomb of Yawgmoth

> Each land is a Swamp in addition to its other land types.

```yaml
abilities:
  - kind: static
    effects:
      - continuous: { layer: 4, affects: { type: land }, do: { addSubtypes: [Swamp] } }
```

**Fits.** The "{T}: Add {B}" comes from **305.6** (basic land types grant the mana ability), which the engine adds after layer 4, not from the script.

**Blood Moon + Urborg (PR 4c layer puzzle):** both are layer 4. Blood Moon's effect changes whether Urborg's effect exists (Urborg loses its ability), so Urborg's effect **depends on** Blood Moon's (613.8a) and Blood Moon applies first whatever the timestamps. Result: Urborg is just a Mountain, nonbasic lands tap for {R}, and no land is a Swamp because of Urborg.

## 5. Doubling Season

> If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
> If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.

```yaml
abilities:
  - kind: replacement
    replaces: { event: createTokens, controller: you }
    with: { multiplyCount: 2 }
  - kind: replacement
    replaces: { event: putCounters, on: { kind: permanent, controller: you } }
    with: { multiplyCount: 2 }
```

**Fits.** A planeswalker entering with loyalty counters is a "put counters" event, so it doubles (Scryfall ruling). With two such effects (Doubling Season plus Parallel Lives), the affected player orders them (616.1).

## 6. Panharmonicon

> If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.

```yaml
abilities:
  - kind: static
    effects:
      - ruleEffect:
          triggerAgain:
            cause: { event: enters, object: { type: [artifact, creature] } }
            source: { kind: permanent, controller: you }
            extra: 1
```

**What it needed:** a hook where triggers are counted (**603.2d**: work out how many times it triggers, then trigger that many). It applies to Dockside's own ETB and to Soul Warden seeing a creature enter. Two Panharmonicons give 2 extra.

## 7. Clone

> You may have this creature enter as a copy of any creature on the battlefield.

```yaml
abilities:
  - kind: replacement
    self: true
    replaces: { event: enters, object: self }
    with:
      - may:
          do:
            - choose: { select: { type: creature, zone: battlefield, other: true }, as: orig }
            - continuous: { layer: 1, affects: self, do: { copyOf: $orig }, duration: forever }
```

**What it needed:** the copy effect (layer 1) with copiable values per **707.2**, including other copy effects on the original, the face that's up, and face-down rules. "As enters" is a replacement (614.1c), so Clone never exists on the battlefield as a 0/0. It doesn't target (hexproof creatures can be copied). If you don't copy, it enters as a 0/0 and dies to state-based actions.

## 8. Teferi's Protection

> Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. Exile Teferi's Protection.

```yaml
abilities:
  - kind: spell
    effect:
      - ruleEffect: { lifeCantChange: you, duration: untilYourNextTurn }
      - continuous: { player: you, do: { gainAbility: { keyword: protection, from: everything } }, duration: untilYourNextTurn }
      - phaseOut: { select: { kind: permanent, controller: you } }
      - move: { object: self, to: exile }     # replaces 608.2n's "put into graveyard"
```

**What it needed:** effects on **players**, applied after objects (613.10), protection from everything for a player (702.16j), and phasing (702.26: phased-out permanents act as if they don't exist; Auras and Equipment attached phase out with them). Phasing in happens in your untap step before untapping.

## 9. Rhystic Study

> Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.

```yaml
abilities:
  - kind: triggered
    when: { event: cast, by: opponent, as: { player: p } }
    effect:
      - unless:
          player: $p
          pay: "{1}"
          then: [ { may: { do: [ { draw: 1 } ] } } ]
```

**Fits.** "Unless" means "$p may pay; if they don't, do it" (**118.12a**). The opponent answers first, then you choose whether to draw. Both answers support **auto-yield** ("always decline to pay for Rhystic Study", "always draw").

## 10. Smothering Tithe

> Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.

```yaml
abilities:
  - kind: triggered
    when: { event: draw, player: opponent, as: { player: p } }
    effect:
      - unless: { player: $p, pay: "{2}", then: [ { createToken: { token: Treasure, count: 1 } } ] }
```

**Fits.** One trigger per card drawn (a "draw three" triggers three times, 603.2c). Treasure is a built-in token.

## 11. Dockside Extortionist

> When this creature enters, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.

```yaml
abilities:
  - kind: triggered
    when: { event: enters, object: self }
    effect:
      - createToken:
          token: Treasure
          count: { count: { kind: permanent, type: [artifact, enchantment], controller: opponent } }
```

**Fits.** X is counted on resolution. With Panharmonicon it triggers twice, and each counts again. With Doubling Season each trigger's Treasures double.

## 12. Thassa's Oracle

> When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.

```yaml
abilities:
  - kind: triggered
    when: { event: enters, object: self }
    effect:
      - let: { x: { devotion: blue } }
      - look: { player: you, zone: library, top: $x, as: seen }
      - choose: { from: $seen, min: 0, max: 1, as: keep }
      - putOnBottom: { objects: { minus: [$seen, $keep] }, random: true }
      - putOnTop: { objects: $keep }
      - if: { compare: [$x, ">=", { librarySize: you }] }
        then: [ { winGame: you } ]
```

**What it needed:** `devotion`, counted after copy, control and text effects but before other characteristic changes (**700.5a**), from the {U} symbols (hybrid counts) in mana costs of permanents you control. X is worked out once, when the ability resolves. `winGame` in multiplayer makes every opponent lose (104.2a). Looking is an information boundary (no online undo past it).

## 13. Necropotence

> Skip your draw step.
> Whenever you discard a card, exile that card from your graveyard.
> Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.

```yaml
abilities:
  - kind: static
    effects: [ { ruleEffect: { skipStep: draw, player: you } } ]
  - kind: triggered
    when: { event: discard, player: you, as: { object: c } }
    effect:
      - exile: { object: { follow: $c, to: graveyard } }    # does nothing if it went elsewhere (Madness) or left
  - kind: activated
    cost: { payLife: 1 }
    effect:
      - move: { object: { topOf: { library: you } }, to: exile, faceDown: true, as: e }
      - delayed:
          when: { event: beginStep, step: end, turnOf: you, next: true }
          effect: [ { move: { object: { follow: $e, in: exile }, to: hand } } ]
```

**What it needed:** a delayed trigger that **captures** `$e`, so it knows which card at the end step, and does nothing if that card left exile. The card is face down in exile: nobody, including you, sees it in the seat view (no permission is granted to look). Paying life mid-draw is fine at instant speed.

## 14. Cyclonic Rift

> Return target nonland permanent you don't control to its owner's hand.
> Overload {6}{U}

```yaml
abilities:
  - kind: keyword
    keyword: overload
    cost: "{6}{U}"
  - kind: spell
    effect:
      - if: { castWith: overload }
        then:
          - bounce: { select: { kind: permanent, not: { type: land }, controller: notYou } }
        else:
          - targets: [ { id: t, select: { kind: permanent, not: { type: land }, controller: notYou } } ]
          - bounce: { object: $t }
```

**What it needed:** overload is an alternative cost chosen while casting (**702.96a**, 118.9a: only one alternative cost), and the spell branches on that choice. Because the overloaded version has no targets, hexproof and protection don't stop it, which the `if` shape makes natural. (Targets declared inside a branch are still chosen during casting; the schema checks this.)

## 15. Fact or Fiction

> Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.

```yaml
abilities:
  - kind: spell
    effect:
      - reveal: { player: you, zone: library, top: 5, as: cards }
      - choose: { opponent: true, as: o }          # in multiplayer, the caster picks which opponent
      - splitPiles: { player: $o, objects: $cards, piles: 2, as: piles }
      - choosePile: { player: you, from: $piles, as: pick }
      - move: { objects: $pick, to: hand }
      - move: { objects: { minus: [$cards, $pick] }, to: graveyard }
```

**What it needed:** two decision kinds, `splitPiles` (one pile may be empty) and `choosePile`. Revealing is an information boundary.

## 16. Emeria's Call // Emeria, Shattered Skyclave (modal double-faced card)

> Front (Sorcery): Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.
> Back (Land): As this land enters, you may pay 3 life. If you don't, it enters tapped. {T}: Add {W}.

```yaml
faces:
  - abilities:
      - kind: spell
        effect:
          - createToken: { token: { name: Angel Warrior, types: [creature], subtypes: [Angel, Warrior], colors: [white], pt: [4, 4], abilities: [ { keyword: flying } ] }, count: 2 }
          - continuous:
              affects: { type: creature, controller: you, not: { subtype: Angel } }   # set fixed now (611.2c)
              layer: 6
              do: { gainAbility: { keyword: indestructible } }
              duration: untilYourNextTurn
  - abilities:
      - kind: replacement
        self: true
        replaces: { event: enters, object: self }
        with: [ { unless: { player: you, pay: { life: 3 }, then: [ { enterTapped: true } ] } } ]
      - kind: mana
        cost: tap
        add: "{W}"
```

**Fits.** The face model does the hard part: in hand it's a mana value 7 sorcery (712.8a); the priority decision offers "cast Emeria's Call" and "play Emeria, Shattered Skyclave" (a special action, 116.2a); on the battlefield it has only the back face (712.8f). The indestructible effect only covers creatures you control when it resolves (611.2c), so the new Angels don't get it and later creatures don't either.

## 17. Animate Dead

> Enchant creature card in a graveyard
> When this Aura enters, if it's on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.
> Enchanted creature gets -1/-0.

```yaml
abilities:
  - kind: keyword
    keyword: enchant
    id: enchantGraveyard
    select: { kind: card, type: creature, zone: graveyard }
  - kind: triggered
    when: { event: enters, object: self }
    if: { zoneOf: self, is: battlefield }        # intervening if (603.4)
    link: reanimated
    effect:
      - continuous:
          layer: 6
          affects: self
          do:
            removeAbility: enchantGraveyard
            gainAbility: { keyword: enchant, select: { linked: reanimated } }
          duration: whileSource
      - move: { object: { attachedTo: self }, to: battlefield, underControlOf: you, as: back }
      - link: { name: reanimated, objects: $back }
      - attach: { object: self, to: $back }
  - kind: triggered
    when: { event: zoneChange, from: battlefield, object: self }
    effect:
      - sacrifice: { object: { linked: reanimated, follow: battlefield }, by: controllerOf }
  - kind: static
    effects:
      - continuous: { layer: 7c, affects: { attachedTo: self }, do: { modifyPT: [-1, 0] } }
```

**What it needed:** (1) an Aura on the battlefield attached to a **card in another zone** (`attachedTo` may point anywhere); (2) a **linked ability** (607) so "the creature put onto the battlefield with this Aura" follows the new object, not the old graveyard card; (3) a layer 6 effect that changes the Aura's own enchant ability, so state-based actions (704.5m) don't drop it once the creature is on the battlefield. If the creature card leaves the graveyard before the trigger resolves, nothing returns and the Aura is put into the graveyard by state-based actions.

## 18. Bolas's Citadel

> You may look at the top card of your library any time.
> You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.
> {T}, Sacrifice ten nonland permanents: Each opponent loses 10 life.

```yaml
abilities:
  - kind: static
    effects:
      - permission: { lookAt: { zone: library, position: top }, who: you, anyTime: true }
      - permission:
          castFrom: { zone: library, position: top }
          playLands: true
          who: you
          alternativeCost: { payLife: { manaValue: spell } }
  - kind: activated
    cost: [ tap, { sacrifice: { count: 10, select: { kind: permanent, not: { type: land }, controller: you } } } ]
    effect:
      - forEach: { player: opponent, do: [ { loseLife: { player: $each, amount: 10 } } ] }
```

**What it needed:** the `lookAt` permission is read by **the seat view** (`view(state, seat)` shows you your top card, nobody else). Each new top card is an information boundary for you only. Paying life instead of mana is an alternative cost (118.9a), so it can't combine with overload or other alternative costs; additional costs (kicker) are still paid normally, and X is 0. Lands are played under the normal one-per-turn limit.

## 19. Chord of Calling

> Convoke
> Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.

```yaml
abilities:
  - kind: keyword
    keyword: convoke
  - kind: spell
    effect:
      - search: { player: you, zone: library, select: { type: creature, manaValue: { "<=": { x: true } } }, max: 1, as: found }
      - move: { objects: $found, to: battlefield }
      - shuffle: { player: you }
```

**What it needed:** convoke (**702.51a**) inside the payment decision: each creature you tap pays {1} or one mana of its color. Auto-pay offers convoke only when you turn it on. The search may fail to find (701.23b). Searching is an information boundary.

## 20a. Gilded Drake

> Flying
> When this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.

```yaml
abilities:
  - kind: keyword
    keyword: flying
  - kind: triggered
    when: { event: enters, object: self }
    targets: [ { id: t, select: { type: creature, controller: opponent }, count: { min: 0, max: 1 } } ]
    resolvesWithoutTargets: true
    effect:
      - exchangeControl: { objects: [self, $t], as: done }
      - if: { not: $done }
        then: [ { sacrifice: { object: self } } ]
```

**What it needed:** `resolvesWithoutTargets` (its own text overrides 608.2b) and `exchangeControl` per **701.12a-b**: if the whole exchange can't happen, none of it does, and `$done` is false (target gone, Drake gone, or same controller). The control change is a layer 2 effect with no end. If the player who gained a creature leaves the game, the effect giving them control ends (800.4a) and the creature goes back.

## 20b. Muldrotha, the Gravetide

> During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard. (If a card has multiple permanent types, choose one as you play it.)

```yaml
abilities:
  - kind: static
    effects:
      - permission:
          castFrom: { zone: graveyard, kind: card, owner: you }
          spellsOnly: { kind: permanent }
          playLand: 1
          duringTurnOf: you
          perTurn: { onePerPermanentType: [artifact, battle, creature, enchantment, land, planeswalker] }
```

**What it needed:** a permission with **uses per turn by card type**, stored in `turnMemory` under Muldrotha's object id. Casting an artifact creature asks which type it uses (a `chooseFace`-style decision). A Muldrotha that leaves and returns is a new object (400.7) with fresh uses. The land still counts toward your one land per turn.

---

## What this told us about the language

- Every block used here is now in `docs/card-language.md`.
- Two cards changed the **engine**, not just the language: Humility (613.6 inside the layer engine) and Bolas's Citadel (the seat view reads permissions). Both are in `docs/engine-design.md`.
- Tests for each card (written by the separate tester pass in PR 2) start from the rulings on Scryfall and the two layer puzzles above.
