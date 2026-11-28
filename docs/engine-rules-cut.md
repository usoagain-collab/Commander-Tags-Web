# Rules cut list and rule-number check (Gate 0)

Written Nov 27, 2026. Status: **signed off by David, Nov 27, 2026 (8:26 PM HST).**

## Which Comprehensive Rules I checked against

- **Current file: June 19, 2026** ("These rules are effective as of June 19, 2026"), https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf. From this file I could read the table of contents and rules up to 120. Rule numbers marked **2026** below were read there.
- This container's network blocks wizards.com, so for full rule text I used the **June 6, 2025** text (a public copy on GitHub). Numbers marked **2025** were read there. Sections 6, 8 and 9 (613, 800, 903) didn't move between the two contents pages, but the text should be re-read in the 2026 file before PR 1. **Ask:** David, could you download the .txt from https://magic.wizards.com/en/rules and drop it in the project's uploads? Then I'll finish the check against 2026 and commit the file as `docs/rules/` reference.

## Every rule number the plan cites

| Plan says | Rule | Checked | Result |
| --- | --- | --- | --- |
| Special actions | 116.2 | 2026 | **Correct.** "There are twelve special actions": 116.2a-k and 116.2m (no 116.2l). Listed in `engine-design.md` section 3. |
| Casting steps | 601.2 | 2025 | Correct (601.2a-i). Rollback of an illegal cast points to "Handling Illegal Actions", which is **733** in 2026 (731 in 2025). |
| Triggers, APNAP | 603, 603.3b | 2025 | Correct. Also used: 603.2d (Panharmonicon), 603.4 (intervening if), 603.7 (delayed). |
| Layers | 613, 613.1, 613.4 (7a-7d) | 2025 | Correct. Also used: 613.3 (CDAs first), **613.6 (an effect keeps applying once started; Humility)**, 613.10 (player effects). |
| Dependency order | 613.8 | Nov 2026 | **Confirmed, unchanged.** 613.8a defines "depends on", 613.8b dependent effects wait and loops fall back to timestamps, 613.8c re-check after each effect. |
| Replacement effects | 614-616 | 2025 | Correct. 616.1 is the "affected player chooses order" rule; 614.15 self-replacement. |
| State-based actions | 704 | 2025 | Correct. Commander-specific ones are **704.6c** (21 commander damage) and **704.6d** (commander to command zone). |
| Commander to command zone | 903.9a, 903.9b | Nov 2026 | **Confirmed, unchanged.** 903.9a: graveyard or exile is a state-based action. 903.9b: hand or library is a replacement, and "may apply more than once to the same event" (exception to 614.5). |
| Commander tax | 903.8 | 2025 | Correct, {2} more per earlier cast from the command zone. |
| 21 commander damage | 903.10a | 2025 | Correct. |
| Free first mulligan | 103.5c | 2025 | Correct (multiplayer and Brawl). |
| Player leaves | 800.4a | Nov 2026 | **Number confirmed, plan's wording needs a fix.** The rule says effects "which give that player control of any objects or players end", not "control effects they created end". Then their objects on the stack that aren't represented by cards cease to exist, then anything still under their control is exiled. Not a state-based action: it happens at once. If the leaver had priority, it passes to the next player in turn order. A stolen creature (Gilded Drake) goes back because the effect giving the leaver control ends. Related: 800.4j (a turn whose player left continues with no active player) and 800.4k (a turn of a player who left doesn't begin). |
| Mandatory loops draw | 104.4b | 2026 | Correct. |
| Basic land mana | 305.6, 305.7 | 2025 | Correct (305.7 is Blood Moon's "loses all abilities from rules text"). |
| Combat | 506-511 | 2025 | Correct: 506 combat phase, 507 beginning, 508 attackers, 509 blockers, 510 damage, 511 end. |
| **Shortcuts** | plan says 730 | 2026 | **Wrong. Taking Shortcuts is 732** in the June 2026 rules (730 in 2025). |
| **Undo** | plan says 729 | 2026 | **Wrong. 729 is Subgames in 2026.** There's no undo rule; the nearest is **733 Handling Illegal Actions**. Undo is our own policy (`engine-design.md` section 7). |
| Monarch, initiative | not cited | 2026 contents | 2026 inserted **722 Preparation Cards** and moved the 72x rules up; 723 is Controlling Another Player, 724 Ending Turns and Phases, 727 Restarting the Game, 728 Rad Counters, 729 Subgames, 730 Merging, 731 Day and Night. Monarch and initiative are in that run; I'll confirm their numbers from the 2026 text. |

**Lesson for later docs:** cite rule numbers with the CR date ("732, June 2026"), and the engine keeps them in one table (`src/lib/engine/rules-refs.ts`) so a renumbering is one edit.

## The cut: Phase 1 vs later

Phase 1 = PRs 1 to 8: solo games against 1 to 3 Casual bots, the 500 most played cards automated, everything else by hand. "Shape" means the data model holds it from PR 1, but the behavior is built only when a top-500 card needs it.

### In Phase 1

| Area | Rules | PR |
| --- | --- | --- |
| Game concepts: players, life, winning and losing, draws, mana, costs, objects, colors, timestamps | 100-122 (except 107.x specials as needed) | 1 |
| Card types used in Commander: artifact, creature, enchantment, instant, land, planeswalker, sorcery, kindred | 301-308 | 1-2 |
| Zones (library, hand, battlefield, graveyard, stack, exile, command) | 400-406, 408 | 1 |
| Turn structure and combat (attack each opponent or their planeswalkers) | 500-514, 802 (attack multiple players) | 1, 3 |
| Casting, activating, mana abilities, loyalty, linked abilities, resolving | 601, 602, 605, 606, 607, 608 | 1-2 |
| Triggers, statics, effects, continuous effects | 603, 604, 609-611 | 4a, 2 |
| Layers and dependency | 613 (all, incl. 613.6 and 613.8) | 4c |
| Replacement and prevention | 614-616 | 4b |
| State-based actions | 704 (all that can occur with the card types above) | 1, 3 |
| Keyword actions needed by the top 500 (destroy, exile, sacrifice, search, shuffle, scry, surveil, mill, create, attach, fight, investigate, exchange...) | 701 (subset) | 2 |
| 30 keywords (listed in `card-language.md`) | 702 (subset) | 2 |
| Copying objects | 707 | 2 (Clone), 4c |
| Double-faced, split, adventure cards; sagas | 709, 712, 715, 714 | 1 (shape), 2 |
| Multiplayer free-for-all, player leaving | 800, 806, 800.4a | 3, 4c |
| Commander | 903 (not 903.12 Brawl) | 3 |
| Mandatory loop detection | 104.4b | 4c |
| Handling illegal actions (rollback) | 733 | 1 |
| Companion special action | 116.2g, 702 companion | 3 |

### Later (Phase 2 or when cards need it)

| Area | Rules | When | Why later |
| --- | --- | --- | --- |
| Optional-loop shortcuts | 732 | Phase 2 | Casual bots don't go infinite; people can click through or use manual tools meanwhile |
| Monarch, initiative and dungeons | 72x (monarch, initiative), 309 | Phase 2, or Phase 1 if a top-500 card needs it | Common in precons, so likely early in Phase 2 |
| Face-down: morph, manifest, cloak, disguise | 708, 116.2b | When needed | Shape is there from PR 1 |
| Foretell, plot, suspend, Rooms | 116.2h/k/f/m | When needed | Shape only |
| Day and night | 731 (2026) | When needed | Few Commander staples |
| Battles | 310 | When needed | Rare in Commander |
| Mutate (merging) | 730 (2026) | Phase 2+ | Hard and uncommon |
| Controlling another player (Mindslaver) | 723 (2026) | Manual, maybe never | Exotic |
| Subgames (Shahrazad), restarting the game (Karn Liberated) | 729, 727 (2026) | Manual, maybe never | Exotic |
| Text-changing effects | 612 | When needed | Rare |
| Phasing beyond Teferi's Protection | 702.26 | With the cards | |

### Not planned

Planechase (901), Vanguard (902), Archenemy (904), Conspiracy Draft (905), Brawl (903.12), Two-Headed Giant and team variants (808-811), limited range of influence (801), attack left/right (803), deploy (804), shared team turns (805), ante (407), Attractions (717), Un-cards. If David wants any of these, they go on the v2 or v3 backlog first.

## Questions for David

1. Agree with the cut? The one to look at: **monarch and initiative** could move into Phase 1 if any of the 500 most played cards use them (I'll check when PR 6 picks the 500).
2. Could you drop the 2026 rules .txt into uploads so I can finish the check (see top)?
