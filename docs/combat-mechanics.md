# How the simulator thinks combat works

This is my whole model of a battle: every mechanic, what order things happen in, and how they interact. It describes what the code does today (2026-10-16), not individual items. Use it to spot where my model and the game disagree.

**Where each rule comes from:**

- **[you]**: you told me or measured it in game.
- **[config]**: an unconfirmed setting in `data/config.yaml` (marked `[UNVERIFIED]` there). Change it there if the game behaves differently.
- **[reading]**: my reading of item, skill or pet text. A reading that changes a result is also shown as a warning in battle (see §14).
- No tag: the rule comes from the SPEC or wiki notes, or the code needs it to work at all.

---

## 1. Before the battle: your numbers

### 1.1 Account stats

- **HP, ATK and Initial Block** are typed in exactly as the game shows them, gear included. They are never multiplied again. [you]
- **Every other stat** (Crit Rate, Crit DMG, Burn DMG, Item Haste, Burn Inflict, …) is calculated from four sources, added together: [you]
  - **Gear stat lines**, up to the rarity the gear is equipped at (`data/gear/manual/stat_lines.yaml`). S gear starts at epic, so the wiki's numbers are already the epic version: rare-and-below lines that change a base number aren't added again. [you]
  - **Weapon bonus stat** (e.g. Primal Flame's Crit Rate). It grows with rarity **and** tier. Known so far: S weapons give 12.5% at epic +0 and 50% at mythic +0. [you] For any other rarity + tier, type the value the game shows on the weapon in the Profile tab. Until you do, the bonus is **not applied**, and red warnings show in the Profile and Bag tabs and in battle. A typed value always wins.
  - **The active hero's stat blessings** (All DMG, Crit DMG, [Creature] DMG, …).
  - **Owned auras' ownership effects**, at their star level. They always apply, equipped or not. [you]
- Two copies of the same ring or glove count as two pieces. [you]
- The Profile tab lists each calculated stat with where it came from.

### 1.2 Each item's numbers

- **Damage per hit** = the item's ratio × your ATK.
- **Its damage bonus (type %)** = Attack DMG Increase (weapons only) + any matching tag stats (e.g. [Creature] DMG) + tag blessings, which are added per item because they aren't on Stat Details. [config: `tag_bonuses_in_stat_details: false`]
- **Cooldown**: the item's base cooldown, with Item Haste and haste from passive effects.
- **Accuracy**: the item's accuracy + Accuracy Bonus.
- **Crit chance**: the item's crit + Crit Rate.
- **Crit damage**: Crit DMG (default 100%, so a crit deals 200%) + the item's own crit damage.
- **Passive "+x% to items" effects** from bag items are part of these numbers before the fight starts. Hero-skill and pet passives are added when the battle starts.

### 1.3 Things placed at the start

- **Pets that summon items** put them into empty bag cells. They scan left to right, then top to bottom, and place each item unrotated in the first spot it fits. Items you placed by hand count towards the number summoned.
- **Enhanced cells**: you mark them by hand for Venom's and Cecilia's skills. Items covering them get the "enhanced" effects.

---

## 2. Who can have effects ("effect owners")

- **Bag items.** Many reach other items through their **dots**: a dot covering part of another item means "this item affects that one". Dots only count the items they actually touch.
- **Gear**, placed in the bag like items:
  - **Gear weapons** have a basic attack that fires at 0s and then on its cooldown.
  - Weapons can also have a **gear skill**: on a fixed timer, or a Skill Gauge filled by charge effects.
- **Hero skills** of the active hero (all 46 are entered) and **skill links**. They're owners outside the bag and appear as their own rows in the results.
- **Pets** with battle skills: each active pet is an owner outside the bag, with only the effects for its star level. They have their own rows in the results.
- **The enemy**: either typed-in attacks, or a full build that works exactly like yours (§12).

Item effects and status effects are separate systems. Item effects are triggers and actions on items. Status effects are stacks on a fighter (Burn, Freeze, …).

---

## 3. The clock

- The battle runs in **ticks of 0.1s**. [config: `tick_seconds`, unconfirmed: real frame timing may vary per item]
- Inside a tick, your side is processed first [config: `side_order`; `random` = a seeded coin flip each tick and at the start of battle]. A fighter who reaches 0 HP stops acting **at once**: no more attacks, effects or damage that tick, so the first killing blow wins. [you] [config: `death_timing: immediate`]

### 3.1 Start of battle (tick 0)

All start-of-battle and passive actions run in priority order, lower first [config: `battle_start_priority`]. Ties go by side (yours first), then bag position (top to bottom, left to right).

| Priority | What happens |
|---|---|
| 10 | Stat changes ("+x% Haste", combat stats, "items inflict x% more") |
| 20 | Applying statuses (Torch's Burn lands before anything hits) |
| 25 | Cleanse, remove or steal statuses |
| 30 | Gain Block, heal, lose HP |
| 35 | Seal |
| 40 | Remove Block |
| 50 | Damage, attacks, activations, **gear weapon basic attacks** |

- Normal items **don't** attack at the start. They begin their first cooldown.
- The enemy's starting statuses are applied when the fight sets up, before this.

### 3.2 Every tick after that, in this order

1. **Berserk** stacks update (§10).
2. **Queued steps** due this tick run: the next hit of a multi-hit attack, the next activation of "Activates Burn N times", the repeat of a crit Burn (§5).
3. **Status timers**: Poison and Regen tick on a **global 2s timer from battle start**, not from when the stacks were applied. [you]
4. **Effect timers** ("Every 4s: …"). These are also counted from battle start and **ignore haste and Freeze**.
5. **Execute checks** ("execute the enemy when …").
6. **For each side, for each item:**
   1. Its gear skill timer advances. A skill that's due activates.
   2. Its cooldown advances. A full cooldown activates the item.
7. **Deaths** are settled (§11).
8. **Expiry**: timed stacks, timed stat changes and Seals whose time is up end. The log says when each one ends. Something applied at tick t for d seconds is active through tick t + d.

---

## 4. Cooldowns and activations

- **Cooldown** = base ÷ (1 + haste%) × (1 + Freeze stacks ÷ 100), never below 0.1s.
  - **Haste** = Item Haste + haste from effects + Swift stacks (+1% each) + Berserk haste.
  - **Freeze** slows only bag items, not gear skill timers. It has no cap.
- An item fills its cooldown each tick. When full it activates. At most **one activation per tick**, and leftover progress carries over to the next cooldown.
- **Stun** stops all of the holder's cooldowns from progressing.
  - It does **not** pause gear skill timers. [you]
  - Stunned while already stunned: the stun refreshes to whichever duration is longer. [you]
- **Seal** disables one item: no cooldown progress, no effects, no attacks.
- **Activation:**
  1. The `on_activation` / "On Use" effects fire.
  2. If the item has damage, it attacks.
  3. Items with "attacks N times per battle" stop after N.
- "Attack 0 ~ N more time(s)" (Intermediate Magic: Spark, Thunderstrike, Lightning Storm, Firestorm, Thunder Dragon): after each activation, 0 to N more activations at random, one tick apart. Each extra attack is an activation of its own, so On Activation effects and dot watchers (Witch's Mirror, Wizard's Hat, "On Spell Activation") see it again (user, 2026-10-17).
- "Activate an item" effects can chain, with no limit (user, 2026-10-17: the game has no chain cap). An item that another activation sets off (Lightning Rod's "On Enemy Stun: Activate [dot] Spell") activates after that activation finishes all of its own effects, in the same tick. So Instant Freeze spends its 25 Freeze before the Stun's Rod activation fires it again, and the Rod → Stun → Instant Freeze chain stops by itself once the enemy has under 25 Freeze.
- The only cut-off is a simulator guard against a hang (`combat.max_chain_depth`, 400 steps). It's not a game rule, and hitting it shows as "Simulator bug".
- Spending stacks ("spend 25 Freeze") is a cost, not removing a buff. Steal-on-remove (Trixie) and Witch's Mirror's "If removed" don't see it, and only buffs can be stolen.
- **Gear skills** are on a fixed timer that haste and Freeze never change. Skill Gauge skills fire at 100% gauge. "Refunds x% Skill Charge" moves a timer skill forward by x% of its interval.

---

## 5. Multi-hits and sequences

**New from 2026-10-16, from you: every step of a sequence takes its own tick**, one tick apart. [config: `multi_hit_spacing_ticks: 1`] This covers:

- the hits of a multi-hit weapon attack ("attacks 3 times" = hits at t, t+0.1, t+0.2)
- the hits of a gear skill
- "Activates Burn N times": each activation is its own tick, and each uses the Burn stacks there are **at that moment**
- **crit repeats**: a crit Burn under Primal Flame mythic deals its damage twice, the second time one tick later, and the next activation waits for it
  - so 9 activations that all crit = **18 ticks**, matching what you see in game
- pet attacks that hit several times (White Wolf Captain's 3 hits)

A sequence stops if the fight ends. Gauntlet clears queued steps between fights.

---

## 6. One hit, start to finish

This order applies to weapon hits and gear skill hits. Gear skill hits count as weapon hits: they roll accuracy and trigger Burn, Spike and on-hit effects. [you]

1. **Invincible** defender: no hit at all.
2. **Evade** (e.g. Raven's Outlaw Tactics): the hit misses and counts as a dodge.
3. **Accuracy roll.**
   - Hit chance = item accuracy + accuracy bonuses + Focus (+1% per stack) + Berserk accuracy + accuracy gained in battle − defender's Evasion − Dodge (+1% per stack).
   - It's clamped to **25%–100%**. A miss fires the defender's `on_dodge` (at most once per tick per effect).
   - "Always hits" items skip this roll.
4. **Crit roll**: item crit chance + crit gained in battle − the attacker's Crit Rate Reduction (Phoenix), capped at 100%.
5. **Damage** =
   - base × (1 + Total ATK % gained in battle)
   - × (1 + type%) × (1 + All DMG% + Berserk DMG%) [config: `all_dmg_mode: separate`]
   - × (1 + Crit DMG%) if it crit
   - × (1 + Hawk Eye bonus) if Hawk Eye procced
   - \+ extra damage from current Block (Rebecca)
   - all × (1 + Final DMG vs Bosses %) against a boss.
   - type% also includes "DMG vs Stunned" while the defender is stunned.
6. **Before attacked**: the defender's "On Attacked: chance to reduce DMG taken" effects can cut this hit.
7. **Taking damage** (§7).
8. **Statuses that react to weapon hits:**
   - the attacker's **Vamp** heals the attacker
   - the defender's **Burn** deals Burn damage
   - the defender's **Spike** damages the attacker
   - each is one roll for all its stacks.
9. **Item triggers**, in order:
   1. `on_hit` (or `on_skill_hit` for a skill)
   2. `on_weapon_hit`
   3. `on_crit`
   4. the defender's `on_attacked`

---

## 7. Taking damage

The same path for every kind of damage (weapon, skill, status, effect):

1. **Invincible**: no damage.
2. **Reductions and vulnerabilities**, all added together:
   - DMG Reduction (weapon, skill and status damage)
   - Attack DMG Reduction / Vulnerability (weapon and skill)
   - <status> DMG Reduction / Vulnerability (status damage)
   - Crit Vulnerability on crits
   - Vulnerability statuses
   - DMG Taken Increase (Phoenix 4★)
   - Damage taken can't drop below **25%** of the damage dealt.
   - "Effect" damage (fixed damage, e.g. Red Dragon, Fire Fox) skips the reductions.
3. **Immunities**: an immunity to weapon attacks or to a status sets that damage to 1. "Damage to 1" statuses use up a stack.
4. **Block** absorbs first.
   - Statuses ignore Block if the dealer has "statuses ignore Block" (Rose's Impale).
5. **HP**.
   - If this would kill, the holder's `on_lethal` effects run first (§11).
   - The damage totals in the results count only what was actually taken off: no overkill.
6. **Waterdrop Cushion** refills the HP just lost: each stack heals 1% of max HP, up to full. [you]
   - It only works while you're below full HP. Damage Block soaks up never reaches it, unless something ignores Block (Rose).
   - A part-percent missing uses a whole stack: missing 2.3% uses 3. [config: `refill_rounding: ceil`]
   - It's not a heal: Healing Power and Heal Reduction don't change it, and it doesn't fire `on_heal`. [reading]
   - It can't save you from a killing blow: at 0 HP you're already dying. [reading]
7. `on_damage_dealt` for the source item. HP-threshold triggers ("When HP is below 30%") check now, after the cushion refilled. [reading]

---

## 8. Statuses

### 8.1 Applying stacks

1. **Immunity**: nothing lands.
2. **Stun only**: a resistance roll. Chance to stun = 100% × (1 − Stun Resistance). 80% resistance = 20% of stuns land. [you] A resisted Stun fires `on_status_resisted` (Yeti).
3. **Inflict bonuses**, added together, then × a pet multiplier:
   - <status> Inflict Increase (Stat Details)
   - tag blessings for the item's tags
   - "items inflict x% more" effects
   - pet multipliers ("Summoned Spiders inflict ×2 Poison")
   - Effects marked "ignore inflict bonus" skip all of this. Gloves of Plague's "inflict 2 of the most common debuff" gives exactly 2. [you]
4. **Resistance**: × (1 − (<status> Resistance + All Debuff Resist)). This applies only to statuses that have a resistance stat: Burn, Poison, Freeze.
5. **Fractional stacks**: 1.5 per hit gives 2, 1, 2, 1…, rounding up first. [you] Each item keeps its own remainder.
6. **Timed or permanent**: timed stacks expire on their own; permanent ones stay until removed. Snowball Fight makes timed Burn and Freeze last longer.
7. `on_status_applied` fires for the inflicting item's side with the number of stacks.
   - "Every 100 Freeze" effects build up across hits, and the leftover carries over.
   - The item whose hit caused it is credited with the "helped" stacks shown in brackets in the results.
8. **Debuff reflect** (Trixie): part of a debuff given to the holder goes back to the inflicter. It's never reflected twice.

### 8.2 What each status does

| Status | Effect |
|---|---|
| **Burn** | When the holder is hit by a weapon (or skill), a **50% chance** (wiki, unconfirmed) to deal stacks × 0.1 × the **inflicter's** ATK. [you: 0.1×] One roll per hit for all stacks. Doesn't decay by itself; only timed stacks expire. |
| **Poison** | Every 2s on the global timer, deals stacks × 0.1 × the inflicter's ATK. [you] |
| **Spike** | When the holder is hit by a weapon, deals stacks × 0.1 × the **holder's** ATK to the attacker. [you] |
| **Vamp** | On the holder's weapon hits, heals stacks × 0.5% of the holder's max HP. [you] |
| **Regen** | Every 2s on the global timer, heals stacks × 0.5% of max HP. [you] |
| **Freeze** | Cooldown × (1 + stacks ÷ 100), items only, no cap. |
| **Stun** | Cooldowns stop for the duration. One instance at a time. |
| **Seal** | Disables one item for the duration. |
| **Invincible** | Takes no damage; enemy hits don't land. |
| **Heal Amount Reduction** | Like a stat: healing × (1 + heal bonus % − reduction %), never below 0. Can't be cleansed or stolen. |
| **Focus / Dodge** | +1% accuracy / +1% evasion per stack. |
| **Swift** | +1% haste per stack. |
| **Waterdrop Cushion** | While below full HP: 1 stack heals 1% of max HP, up to full (§7). Seiren's "100% of max HP" = 100 stacks. Gaining stacks while hurt heals at once. |
| **Evade** | Every weapon attack against the holder misses. |
| Counters (Scream, Wish, Charge, Divine Grace, …) | Only what the gear that uses them says. |

### 8.3 Status damage and status crits

- **Damage** = stacks × ratio × ATK (whose ATK: see the table), × (1 + <status> DMG%) × (1 + All DMG% + Berserk DMG%), × crit, × Final DMG vs Bosses.
- **Crit chance** = the dealer's Crit Rate + the status's own crit chance + <status> Crit Rate − Crit Rate Reduction.
  - <status> Crit Rate is gained from Archwizard's Ring legendary: +3% per Burn damage event, and the gained part caps at 100%. [you]
  - At 100% or more, it always crits.
- **Crit damage** = Crit DMG + <status> Crit DMG + (<status> Crit DMG per Crit Rate × the **gained** Burn Crit Rate only). Archwizard mythic: ×2 of the gained rate, so up to +200%. [you] [config: `status_crit_dmg_per_rate_from: bonus`]
- **Crit repeat** (Primal Flame mythic): a crit status hit is dealt again as separate damage events, a tick apart (§5). Each event fires `on_status_damage`, so each one builds Archwizard's Burn Crit Rate.
- **"Activates <status> N times"**: N separate activations, a tick apart, each with the stacks at that moment.
- The results show each status's damage as its own row with its % of your damage. Items show the stacks they applied, plus the stacks they helped apply in brackets.

### 8.4 Removing stacks

- **Cleanse**, **remove** and **steal** "N debuffs/buffs" take **N random stacks** across all the holder's removable statuses of that kind. [you] [config: `removal_unit: stacks`] A named status takes only that one.
- **"Whichever of Focus or Dodge has more"** (Hunting Hawk, Eagle) picks the higher one when the effect fires.
- **Steal** moves the stacks to the stealer. Trixie's skill can turn a removal into a steal.
- **Consuming** stacks (paying a cost, e.g. "consumes Freeze") can be kept by Snowball Fight's chance.
- Each removal fires `on_status_removed`.

---

## 9. Healing and Block

- **Heal** = amount × (1 + Healing Power + Vamp Recovery for Vamp − Heal Amount Reduction), never below 0, capped at missing HP.
- Healing past max HP is **overheal**. `on_heal` passes it on as the event amount ("On Excess Heal").
  - The opponent can listen to your heals (Ice Reaper 4★ reacts to the enemy's heals, Regen ticks included). [reading]
- **Block gained** × (1 + Block Gain %). Block absorbs damage before HP and stays until used. "Remove Block" takes it away.
- **"Lose HP" from your own items** can't take you below 1 HP. [config: `self_hp_loss_floor`]

---

## 10. Berserk

These numbers are your observations; they aren't on the wiki.

- Starts at **10s** on the fight's clock.
- **Stack 1**: +25% DMG, +25% haste.
- **Each stack after that, every whole second**: +5% DMG, +5% haste, +5% accuracy.
- **In chapters only enemies berserk.** [you] Both sides berserk in PvP (Arena isn't simulated yet).
- Enemies with **Short Time Limit** never berserk. Typed-in enemies have a **Berserk** checkbox (on by default).
- **Gauntlet**: Berserk runs on the whole battle's clock. An enemy entering after 10s gets stack 1 at once, then +1 every whole second. [you]
- `on_berserk` fires once per fight, when the first fighter enters it.

---

## 11. Death and the killing blow

- A fighter at 0 HP **stops acting immediately**: the first killing blow wins. [you] [config: `death_timing: immediate`]
- With `death_timing: end_of_tick` instead, both finish the tick, and if both die, a seeded coin flip decides. [config: `mutual_kill_winner: random`]
- **Spike 1 HP bug** (a real game bug, simulated): when a weapon hit would kill a fighter who has Spike, their Spike still activates against the attacker first. If that Spike damage kills the attacker, the Spike holder survives on **1 HP** and wins. If the Spike doesn't kill the attacker, the holder dies as normal. It works both ways: you, or an enemy, can be the Spike holder. [you]
- **Before a killing blow lands**, the holder's `on_lethal` effects run. The blow is avoided if:
  - the holder is Invincible afterwards (Celestial Shield), or
  - the enemy died during those effects.
  - `prevent_lethal` pays stacks of a status to reduce the blow to 1 HP. The cost grows each time it's used.
- **Execute** effects kill outright, ignoring Block, when their condition holds.

---

## 12. Enemies

### 12.1 Simple enemies

- **Stats**: HP, ATK (only used for the statuses the enemy inflicts), Block, DMG Reduction, Boss.
- **Attacks** (damage, cooldown, accuracy, hits, crit), each attacking on its cooldown like an item.
- **Starting statuses**, plus resistances, vulnerabilities and immunities.
- **Traits** (Regen, Stun Attacks, …) are descriptions only: not simulated yet. Short Time Limit (no Berserk) is the exception.

### 12.2 Full-build enemies (new)

- The enemy is a whole build, built **exactly like you**: its own profile and bag.
  - **Profile**: base stats, heroes with stars, blessings and links, gear with rarities, pets with stars, owned auras.
  - **Bag**: items, gear, bag shape, enhanced cells.
- All your mechanics run for it, on the enemy side: hero skills, gear skills, pets, calculated stats, everything.
- HP, ATK, Block and attacks come from the build. Resistances, immunities and starting statuses typed in for the enemy still add on top.
- **How to make one:** Battle panel → enemy "Type one in…" → **Full build**. That starts as a copy of your build.
  - **Copy my build** or **Load a saved layout…** replaces it.
  - **Edit enemy build** switches the Bag and Profile tabs to the enemy's build. The top bar shows **Me / ⚔ Enemy**, and the bag gets a red outline while you edit the enemy.
- The enemy build is saved inside the layout.
- **Custom enemy items** (Item editor → Custom enemy items) can carry anything a player's items and gear can: stats, shape, any ability, and a gear-style skill (timer or Skill Gauge) that "On Skill Hit" abilities fire on. It's a sandbox, so a "monster" is simply a build without gear.

### 12.3 Monster or player

- **Enemy is a monster** (default for typed-in enemies): chapter rules. Only the enemy berserks.
- **Enemy is a player** (default for enemy builds): PvP rules. [you]
  - Both sides' base HP and Block are **×20**. [config: `pvp.hp_block_multiplier`]
  - Both sides berserk. [config: `berserk.sides.pvp`]
  - "Final DMG dealt in PvP" (Judicator's Blade aura) applies.
- Anything that scales with max HP (Block gains, heals, "lose x% HP") scales with the ×20 HP. [reading]

### 12.4 Rules that apply to both kinds

- An enemy marked as a boss gets your Final DMG vs Bosses.
- Berserk follows §10.

---

## 13. Battle modes

| Mode | Fights | Time limit | Bosses |
|---|---|---|---|
| **Stage** | 1 | 30s | Only if marked as one |
| **Gauntlet** | 4 | 60s for the whole run | Fight 4 |

Gauntlet notes:

- HP, cooldowns, statuses and everything else carry over between fights. [you]
- Berserk runs on the battle clock (§10).
- **Boss Rush**: one fight like a stage, the enemy is always a boss, always 30s.
- **Arena** and **Raid** come later.
- **Monte Carlo** runs the same battle many times with different seeds. All randomness comes from one seeded generator, so a seed always gives the same battle.

---

## 14. Triggers: how effects fire

- **Item events**: on_hit, on_weapon_hit, on_skill_hit, on_attack, on_activation, on_crit, on_skill_activation, on_stun, on_heal, … Which items' events an effect listens to:
  - **self**: this item
  - **dots**: items under this item's dots
  - **any**: any of my items
  - Defaults: "On [dot] Weapon Hit" = dots, everything else = self.
  - A filter can narrow it further (e.g. only Spirit weapons, or only the **fastest** / **strongest** weapon at that moment). [reading: fastest = shortest current cooldown, haste included; strongest = highest damage per attack]
- **Fighter events**: on_attacked, on_dodge, before_attacked, on_block_gained, on_berserk, on_lethal, on_status_damage, on_status_removed, on_status_resisted, on_self_hp_loss. An effect can listen to the **opponent's** events instead (`listen: enemy`).
- **Conditions** checked when the effect would fire:
  - has Block
  - has / lacks a status, or at least N stacks
  - HP above / below x%
  - "Spike over 10× the enemy's HP %"
  - "Focus + Dodge ≥ 30 in total"
- **Chances**: each effect rolls on its own. Effects sharing a `roll_group` share one roll ("25% chance to gain 1 Spike, and Haste +5%").
- **Limits**:
  - "N times per battle"
  - at most one `on_dodge` fire per tick
  - **internal cooldowns** ("can activate every 3s")
  - "every N stacks" thresholds
- **Passive per-stack bonuses** ("+2% DMG per Burn stack on the enemy", Phoenix's per-Burn debuffs) are worked out live at each hit, with their caps.
- **Readings I'm not sure of** are stored on the effect as an `assumption` and shown as a warning in every battle where that effect is active, so none are silent.

---

## 15. Pets

- Pets ignore Haste and Freeze: their timers are fixed. [you]
- Values shown in game include your unlocked stars. Star lines always **add** to the skill's numbers. [you]
- Each pet's skill is entered per star tier in `data/pets/manual/battle_effects.yaml` (Red Dragon is in `observed_batch_1.yaml`). Activation cost changes from stars are applied.
- **Open readings, each shown as a warning in battle:**
  - Pet attacks can crit. [you] Pet ATK hits (Raccoon, Golem, Polar Bear, Wolf Captain, Yeti's counter):
    - crit with **your Crit Rate** + the pet's own bonus (Raccoon / Polar Bear 4★: +50%) and **your Crit DMG**, like a normal weapon hit [you]
    - count as weapon damage against the enemy's reductions
    - get All DMG only
  - Fixed % of max HP hits (Red Dragon, Fire Fox, Raccoon's 2★ part) don't crit. [reading]
  - White Wolf Captain's 3-hit attack runs for the whole battle, every 3s. [you] The first one is at 3s. [reading]
  - Raccoon's 2★ "+10% of enemy max HP" is a separate fixed-damage hit.
  - Seiren: "healed amount" = the overheal. "When entering Berserk" = when the fight's Berserk starts.
  - Ice Reaper 5★ "activates once more" adds the Healing Reduction and 15 Freeze again (stacking).
  - Hunting Hawk 5★: the steal happens after the removal.
  - Jellyfish: "On Attacked" = being hit by a weapon (misses don't count).
  - Flora 5★: "HP Heal effect +30%" = Healing Power +30%.
  - Tiger: "All Weapon DMG" = Attack DMG Increase. Its 5★ Item Haste goes to all items.
  - Yeti: any resisted Stun counts, not only during the immunity.
  - Brown Wolf: "strongest weapon" and Phoenix: "fastest weapon" (§14).

---

## 16. Settings in config.yaml not yet checked in game

Each of these is a guess you can change in `data/config.yaml`:

- **Tick length** is 0.1s.
- **All DMG** multiplies type DMG separately: (1 + type) × (1 + all), not added to it.
- **Who acts first inside a tick**: your side (`side_order: player_first`). With immediate deaths this decides close fights.
- **Burn's 50% chance** per weapon hit comes from the wiki's status page (`data/statuses/wiki`), not from you.
- **Your own "Lose HP"** can't take you below 1 HP.
- **Waterdrop Cushion**: a part-percent missing uses a whole stack (`refill_rounding: ceil`).
- **Weapon bonus stats**: known for epic +0 (12.5%) and mythic +0 (50%). Every other rarity + tier needs the in-game value typed in (red warning until then).
- **Tag blessings** (`tag_bonuses_in_stat_details: false`). These are blessings that boost items with a tag, e.g. "[Sword] Weapon DMG +x%" or "[Fire] Magic DMG +x%", as opposed to plain stat blessings like "All DMG +x%". My guess is they **don't** show on the Stat Details screen, so the simulator adds them to each matching item. If they do show there, set this to `true`, so they aren't counted twice.

Confirmed and moved out of this list on 2026-10-16: Stun doesn't pause gear skills; re-stuns refresh to the longer duration; Waterdrop Cushion refills HP after Block.

## Optimize tab

- Improves the build loaded in the Battle tab (same layout panel, profile, hero, gear, pets and skins) against opponent builds picked from the saved layouts (and the Battle tab's enemy build). Opponents are PvP players.
- **Match score** = my HP % left − opponent HP % left, + `shield weight` (default 50) if my once-per-battle killing-blow save (Celestial Shield) is still unused at the end, − the same if the opponent's is. A build's score is the mean over opponents (each counts the same) of the mean over seeds.
- **Opponents**: picked from the saved layouts. If one of them is the Battle tab's enemy build (same name), the Battle tab's version is used, edits included; otherwise the saved file. Each opponent's calculated stats are shown next to it, and results say when they're out of date.
- **Diagnosis**: every build tried gets one from its battles: where my damage comes from (items and statuses), the worst matchup and what hurts me there (enemy statuses or weapon hits), and the shop items doing the least (damage + healing + Block + status / removed stacks × 0.1x ATK; items that boost other items are never "least").
- **Search**: simulated annealing with targeted changes. Item swaps (on by default, within the value budget) take out the item doing the least and put in one whose effects fit an idea: when losing, a counter to the worst matchup's main threat (buff removal vs Spike, Block / damage reduction / Dodge vs weapon hits, Cleanse vs Burn / Poison, healing); otherwise more of my main damage source (the same status, its boosts and triggers, or weapon boosts; a build that steals buffs also counts buff removal). The new item goes where its dots link with the most items. Moves, swaps, rotations and "re-place an item at its best-linked spot" refine the layout in between. An item whose replacement fails twice is left alone. Gear and starting equipment are moved but never replaced; shop-only items aren't offered. A change is kept if the score drops by no more than the temperature, which shrinks to 0 over the run. Every build plays the same seeds against every opponent.
- **Alternatives**: another item change tries a different item for an existing one: it must still match what the neighbouring items' dots look for (a Spell under Witch's Mirror and a staff stays a Spell) and still do what the old item did to the items under its own dots (an alternative to a spell-activating staff also activates Spells). Items sharing tags and roles with the old one are preferred.
- **Skin quests** (option "Keep skin quests", on by default): the quest of an equipped skin that the starting build meets is kept — builds that would break it aren't tried (Dream Eater's 30 Creature value, Rose's 90% filled bag, items to own). Quests that need rounds or the shop (Raven's 300 Focus, Venom's 150 Sword hits, Rebecca's designated slots …) can't be checked in one battle: a note says so and the layout's "quest done" tick decides. In every battle, a skin skill whose quest the bag doesn't meet is off.
- **Output**: every build tried (change and why it was tried, score, win rate, shield kept, value, kept or not), the best build's bag, full stats and diagnosis, a table of means against each opponent (start → shown build), the distribution of match scores, and the score of every build in order. "Use this build" puts it in the Battle tab unsaved.

## Arena and enemy kind

- **Arena**: 30 s (fixed), Berserk from 10 s as in stages, always PvP: both sides' HP and Block ×20, both berserk, Final DMG in PvP. Death wins; at the time limit the higher remaining HP % wins (a tie is settled like a mutual kill). An Arena enemy set to "a monster" still fights as a player, with a warning.
- **Enemy kind**: unless set, an enemy is a player (PvP) when its build has player items (shop items or gear) and a monster otherwise (no build, or only items made in the enemy item editor). Setting a monster while it has player items shows a yellow warning (and no ×20).

## Optimizer rules

- Rotations that give the same shape (1×1 items, symmetric items and gear) aren't tried.
- Layout-only moves (move, rotate, swap, re-place) are only tried if the layout keeps all its dot links. A build with fewer links is only kept when it scores strictly better, and between equal scores the better-linked build wins.
- Starting equipment can be swapped for another unlocked piece or one more brought, within Supply Ability (the weakest piece goes; pieces that fit the build's diagnosis are preferred). It doesn't count toward the coin value.
- The Optimize tab keeps its run and results while you switch tabs.
- **Balance matchups** (on by default): the search maximises the mean over opponents of balanced(matchup score), where balanced(s) = s for s ≤ 0 and 50·ln(1 + s/50) above 0. Winning a won matchup by more counts less and less, so value moves toward the matchups I lose. Targeted swaps also aim at the worst matchup first whenever any matchup is lost. The plain mean is still shown as "score".
- **Editing in the Optimize tab**: the shown build's bag can be edited (click an item for its stats, drag or arrow keys to move, space to rotate, Delete to remove; no adding). "Test score" scores the edited build on the same opponents, seeds and options as the run and adds it to the list; "Rerun from this build" starts a new optimization from it.
- **Idle items** (an item doing nothing where it sits: every effect needs dots and none reach a matching item, and it has no attack, e.g. Golden Pig with no Tool under its dots; or no battle effect at all) get fixed with one or two moves: put it where its dots reach what it needs, or, if one item is in the way of such a spot, move that item elsewhere too. Dot links never drop. During the search this is the most likely change while an idle item exists; after the search, the clean-up gives every idle item a turn (fix, or drop if nothing works), each fix scored and kept unless it costs more than 1 point.
- **Shake up when stuck** (off by default): after N builds without a better best, several changes are made at once starting from the best build and the result is kept even if it scores worse, then the search goes on from there. Each time it's stuck again the jump grows by one change; it goes back to the set size when the best improves. For long runs that settle on a good build too early.
- **Several search seeds**: the search can run with seeds N, N+1 … in one list (a Run column says which). Chained: each run starts from the best build so far (seed 1's best feeds seed 2 …). Separate: every run starts from my build.
- "Opponents use my base stats × N": every opponent gets my HP, ATK and Block times N (1 = the same as me) and my Stat Details (its hero, gear, pets, skins and bag stay its own), for a fair test of the builds themselves.
- The value budget follows the current build's value until it's set by hand ("reset" goes back to following it). If no allowed change can be found, the run stops early and says why.

