# Corrections and additions (confirmed by me)

**This file wins over every other file in `docs/wiki-data/`.** It holds things I've checked in-game: items missing from the wiki, wrong shapes or effects, misspellings, and wrong tags. When converting to YAML, entries here go into `data/<category>/manual/` with `source: observed`, `verified: true`, and override the wiki version field by field.

Observed with **HP 6.9M** and **ATK 696.3K**. Ratios are rounded to the obvious clean value; the raw observation is listed so it can be rechecked (SPEC §4.3). Shapes use the usual footprint notation: `#` item, `o` item dot, `.` empty, rows top to bottom separated by ` / `.

Fields marked **?** are still unknown (see the end of this file).

## 1. Items missing from the wiki

### Big Spike
- **Shape:** `#` (1×1, no dots)
- **Effect:** Start of Battle: Gain 3 Spike.
- **Rarity:** Uncommon · **Value:** 3
- **Tags:** Tool · **Class:** Warrior (component of Spiked Club, Plate Helmet, Warrior's Helmet, Spiked Shield; Barbarian supply at 3★)

### Steel Spike
- **Shape:** `#` (1×1, no dots)
- **Effect:** Every 4s: Gain 3 Spike and **0.04x HP** Block. The 4 s is a cooldown, so haste and Freeze change it.
  - Observation: 276K Block at 6.9M HP → 0.0400.
- **Rarity:** Rare · **Value:** 6
- **Tags:** Tool · **Class:** Warrior (component of Spiked Whip, Spiked Armor, Spiked Gloves; Rose supply at 0★)

### Lithinum 🔒Bjorn
- **Shape:** `o / # / #` (2 tall, 1 wide, one dot directly above)
- **Effect:** On losing HP from an item: gain **0.04x HP** Max HP.
  - Observation: 276.2K at 6.9M HP → 0.0400.
- **Rarity:** Uncommon · **Value:** 7 · **Tags:** Tool · **Class:** Warrior
- Bjorn exclusive; bought in the Shop; supply at 1★.

### Lithinum Greatshield 🔒Bjorn
- **Shape:** `o##o / o##o / o##o / o..o` (2 wide, 3 tall, dots down both sides and one row below the corners). The earlier 3-wide drawing was wrong.
- **Effect:** On losing HP from an item: gain **0.08x HP** Max HP. On Attacked: 50% chance to reduce DMG taken by 30%.
  - Observation: 552.4K at 6.9M HP → 0.0801.
- **Recipe:** Lithinum + Golden Hero Statue + Wooden Shield. (You wrote "Golden Hero Status"; the item is **Golden Hero Statue**.) Bjorn exclusive; supply at 7★.
- **Rarity:** Legendary · **Value:** 21 · **Tags:** Armor · **Class:** Warrior

### Spirit Stone 🔒Erwen
- **Shape:** `o.o / .#. / o.o` (1×1, dots on the four diagonals)
- **Effect:** Start of Battle: for 8s, per [dot] Spirit: gain 4 Swift and inflict 4 Burn on the enemy.
- **Rarity:** Rare · **Value:** 7 · **Tags:** Tool, Spirit · **Class:** Ranger
- Erwen exclusive; bought in the Shop; supply at 1★.

### Erwen's Bow 🔒Erwen
- **Shape:** `# / # / # / #` (4 tall, 1 wide, no dots)
- **Stats:** DMG **3.6x ATK** · Cooldown 2s · Accuracy 60% · Crit 0%
  - Observation: ~2.5M at 696.3K ATK → 3.59; 3.6x confirmed as the value to use.
- **Effect:** Start of Battle: gain 30 Swift for 10s. Deal **0.2x ATK** extra DMG per Swift stack.
  - Observation: 139.2K at 696.3K ATK → 0.1999.
- **Rarity:** Legendary · **Value:** 23 · **Tags:** Weapon, Bow · **Class:** Ranger
- Erwen exclusive; supply at 7★.

### Fire Spirit (Erwen supply, 0★)
- **Shape:** `##.. / #... / .o.. / ..o. / ...o` (L-shaped 3 cells, dots running diagonally down-right)
- **Stats:** DMG **1.3x ATK** · Cooldown 10s · Accuracy 85% · Crit 0%
  - Observation: 905.2K at 696.3K ATK → 1.3000.
- **Effect:** Start of Battle: for 10s, inflict 12 Burn per [dot] Spirit. On [dot] Bow Hit: refund 30% of Cooldown.
- **Rarity:** Rare · **Value:** 7 · **Tags:** Weapon, Creature, Spirit · **Class:** Ranger

### Wind Spirit (Erwen supply, 3★)
- **Shape:** `..o / .#o / o#. / o..` (2 cells stacked, dots around them)
- **Effect:** Start of Battle: for 10s, gain 10 Swift per [dot] Spirit. On [dot] Spirit Hit: gain 1 Swift.
- **Not a weapon** (no damage, cooldown, or accuracy).
- **Rarity:** Rare · **Value:** 7 · **Tags:** Creature, Spirit · **Class:** Ranger

### Greatdog (merged from Greatsword)
- **Shape:** `#### / oo##` (4 wide, 2 tall; dots under the left half)
- **Stats:** DMG **2.99x ATK** · Cooldown 2.3s · Accuracy 90%
  - Observation: 2.08M at 696.3K ATK → 2.987 (range 2.9798–2.9946). Not a clean ratio (3.0x would show 2.09M); use 2.99x.
- **Effect:** On [dot] Weapon Hit: 65% chance to attack.
- **Rarity:** Legendary · **Value:** 23 · **Tags:** Weapon, Creature · **Class:** Warrior

### Fusion Magic: Frost Edge — **remove**
You've never seen this item. Drop it from the merge lists of Alchemy Magic: Ice Spear and Transformation Magic: Spell Amplification.

## 2. Corrections to wiki items

| Item | Field | Wiki | Correct |
|---|---|---|---|
| Plate Helmet | Shape | `##` | `o#` (1 cell, dot on the left) |
| Spiked Gloves | Shape | `#` | `o#o` (1 cell, dots left and right) |
| Golden Pig | Effect | When entering Shop: Gain 1 Coin. | Keep that, and add: Start of Battle: gain **0.03x HP** Max HP per [dot] Tool (observed 207.1K at 6.9M HP → 0.0300). Current HP rises by the same amount, so you stay at full HP. |
| Spider Fang | Shape | `# / # / # / o` | `.o. / o#o / o#o / .o.` (2 tall, 1 wide, dots on every side) |
| Spider Fang | Effect | Start of Battle: Gain 15 Focus for 15s. Crit Rate +0.25% per Focus stack. | Start of Battle: [dot] items' Poison Inflict +15%. On Poison applied by a [dot] item: refund 20% of Cooldown. (DMG 0.8x / 1.9s / 55% from the wiki, unverified.) |
| Maestro | Effect | Start of Battle: Increases DMG for Creature and Spell by 60%. On Attack: After hasting Creature by 7%, immediately activate Spell. | Start of Battle: [dot] Creatures and Spells deal **0.6x ATK** additional DMG (observed 417.6K at 696.3K ATK → 0.5997). On Attack: haste [dot] Creatures by 7%, then activate [dot] Spells. Spells only activate if a Creature is under its dots. |
| Intermediate Magic: Ignite | Tags | Weapon, Spell, Ice | Tool, Spell, Flame |
| Transformation Magic: Instant Freeze | Tags | Weapon, Spell, Ice | Tool, Spell, Ice |
| Transformation Magic: Charm | Tags | Weapon, Spell | Tool, Spell |
| Transformation Magic: Drizzle | Tags | Weapon, Spell | Tool, Spell |
| Transformation Magic: Deluge | Tags | Weapon, Spell | Tool, Spell |
| Transformation Magic: Spell Amplification | Tags | Weapon, Spell | Tool, Spell |
| Alchemy Magic: Ice Shield | Tags | Weapon, Spell, Ice | Tool, Spell, Ice |
| True Sight | Made from | True Sight, Hawk Feather Talisman | Tracker's Bow, Hawk Feather Talisman |
| Elderwood Bow (gear) | Skill ↔ Gear effect | swapped | **Skill:** Triggers a Poison Explosion dealing DMG equal to 3× the Poison DMG (every 8s). **Gear effect:** On Basic Attack Hit: Inflict 1 Poison. |
| Fusion Magic: Frost Edge | — | listed as a merge result | doesn't exist; remove |
| Clone Potion | Effect | When HP is below or equal to 50%: Gain 15 Dodge for 4s. _(Activates once per battle)_ (copied from Fairy Dust) | Every 5.5s: Heal **0.15x Max HP**. When HP is below or equal to 50%: gain 15 Dodge for **5s** and immediately Heal **0.15x Max HP**. _(The HP ≤ 50% part activates once per battle.)_ Heal observed as 1.03M at 6.9M HP and 600K at 4M HP (→ 0.15; see §6). |
| Clone Potion | Merges into | Dancing Crescent Moon, Clone Potion, Fairy Blessing, Shiny Bow (copied from Fairy Dust) | Not given. Derive it from "Made from" as usual (→ Crow's Footsteps). |
| Transformation Magic: Deluge | Name | Transformation Magic: Deluge | Renamed in-game to **Heavy Rain** (see §3). |
| Transformation Magic: Deluge | Merges into | Transformation Magic: Deluge (itself) | nothing |
| Flame Robe | Made from | Leather Armor, Frozen Dog | Leather Armor, **Blazing Hound** |
| Large Crow | Value | 6 | **15** |

## 3. Names and blessing values

| Where | Wiki | Correct |
|---|---|---|
| Bjorn skill / blessing | *Gigantization* (skill), *Giantization* (blessing) | Same thing. Use **Gigantization**. |
| Barbarian skill link | "That's Mine" | Same skill as **That's Mine!** |
| Lua exclusive item | "Fairy's Bow" | Same item as **Fairy Bow** |
| Divine Smite (gear) | "Divine Blessing" in the skill | Same mechanic as **Divine Grace** |
| Wizard item, Feline Mage supply (7★), Drizzle's merge result | Transformation Magic: Deluge | Renamed in-game to **Transformation Magic: Heavy Rain**. |
| Spark unique blessing | Electrostatic Force: Sun Rate | **Stun Rate** +7.5% / +15% |
| Venom unique blessing | Poison Trigger Interval −0.2s / −0.4s / 0.6s | Mythic is **−0.6s** |
| Erwen unique blessings | First one unnamed | Names unknown. One is **[Bow] DMG** (+20/+30/+60%); the other is **[Spirit] Burn Inflict & Swift Gain** (+25/+50%). Give them ids `erwen_bow_dmg` and `erwen_spirit_gain`. |

## 4. Pets

- **Golem:** ignore it. Its skill has no trigger on the wiki and it isn't worth implementing.

## 5. Notes on the tags above

The tags in §1 were chosen to match similar wiki items (spikes and Lithinum are Tools like Anvil and Smithing Stone; Spirit Stone is a Tool and a Spirit; the Greatshield is Armor like Steel Shield). The `Spirit` tag is new: Erwen's effects count "Spirit" items. On the wiki, Frost Spirit and Blazing Spirit are tagged Weapon, Creature, Spell plus an element, without `Spirit`. They **don't** count as Spirits for Erwen's effects: only items with the `Spirit` tag do.

## 6. Observation stats for later corrections

The §2 rows for Clone Potion, Heavy Rain, Flame Robe, and Large Crow were observed with **HP 6.9M** and **ATK 706.6K** (not the 696.3K at the top of this file).

Clone Potion's 0.15x is confirmed by a second observation: 600K healed at 4M HP (exactly 0.15). The first one (1.03M at 6.9M HP) is also consistent.

## 7. Gear ids and weapon tags

- **Ids:** gear with the same name as an item gets `_gear` at the end of its id: Wooden Shield → `wooden_shield_gear`, Spiked Shield → `spiked_shield_gear`.
- **Every gear weapon has the `weapon` tag**, plus its type:

| Tag | S-rank gear | Other gear (from the name) |
|---|---|---|
| Spear | Spiral Spear, Omnicleaver | Exotic Spear |
| Sword | Primal Flame, Thunderbolt Spike | Novice's Sword |
| Staff | Staff of Vitality, Everfrozen | Frost Staff, Ember Staff |
| Bow | Elderwood Bow, Deathrattle | Guardian's Bow |
| Blunted | Meteor Hammer, Divine Smite | — |

Not confirmed yet (only `weapon` for now): Steel Mace, Morningstar, Vampire Crossbow, Flowing Blade, Prince's Dagger.
