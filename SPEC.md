# Overgeared Hero Backpack Simulator — Specification (v4)

## 0. How to read this document

- **[UNVERIFIED]** marks a mechanic that is my best current understanding and may be wrong. Anything marked this way must be configurable (a value in `data/config.yaml` or a swappable rule), not hardcoded.
- **[LATER]** marks a feature that is planned but out of scope for the MVP. Design the data model so it can be added later without rewrites, but do not build it yet.
- Nothing in here is final. The effect and status system in particular will grow, so leave room for new types.
- **Game data comes from `docs/wiki-data/`**: markdown reference docs transcribed from the wiki (items, gear, heroes, blessings, pets, statuses), plus `corrections.md` (my confirmed fixes, which override the wiki) and `REVIEW.md` (known wiki problems). Phase 2 converts them to YAML. A full scraper (`tools/wiki-scraper/SCRAPER_SPEC.md`) is optional and [LATER].
- Terminology (keep it consistent in code and UI):
  - **Gear** — equipped in the main menu, brought into every battle automatically.
  - **Item** — bought in shops during a run.
  - **Starting equipment** — items unlocked through hero stars that can be brought into a battle. The wiki calls these **supplies**, and the capacity **Supply Ability**.
  - **Item dot** — the marker in a slot near an item showing where that item's effect reaches. The wiki calls these **sockets**.
  - **Item effect** vs **status effect** — two different things (see §5).
  - **Tick** — 0.1 seconds of combat time.
  - **Classes** — Warrior, Ranger, **Wizard** (internal ids `warrior`, `ranger`, `wizard`). Note that "Mage" is the name of a Rare Wizard *hero*, not a class.

## 1. Purpose and scope

A simulator for the backpack mechanics of *Overgeared Hero: Merge RPG* (5minlab / Krafton). Items of different shapes are placed on a grid backpack, interact with each other through item dots, and the hero then auto-battles in real time.

### MVP

1. Define items, gear, statuses, and my account profile as data.
2. Place items on a backpack grid in a local web UI and validate placements.
3. Compute final stats and show which effects apply where.
4. Run a deterministic real-time battle against a defined enemy using a **blank-slate class with no hero abilities**, and report results.

### [LATER]

- **Enemy builds:** enemies with their own stats, bag, items, and traits (the wiki's enemy traits list, §4.9).
- **Chapter planner:** chapters are 12 stages long and give gold that is spent on items. Plan a build for each stage that fits that stage's gold budget.
- **Automatic layout search**, including items only available from the Special Shop (§4.5).
- **Raid mode** and **Arena mode** (rules in §7.5).
- **Full class mechanics:** hero abilities, link abilities, skins, unique blessings that buff abilities (§4.6).
- **Economy effects:** coin gains, rerolls, interest, aura skills (§4.10).

### Non-goals

Graphics recreation, energy/idle/gacha systems, networking, reading game files or memory. **Ownership effects** (permanent account bonuses from owning heroes, pets, auras, and skins) are ignored: they're already included in the Stat Details numbers I enter.

## 2. Guiding principles

- **Data-driven.** Items, gear, statuses, enemies, pets, heroes, and blessings are defined in `data/`. Adding a new item should only touch data. A genuinely new kind of behaviour gets a new generic effect type in code, never an item-specific branch.
- **Unverified rules are configurable.**
- **Deterministic.** Same inputs + same RNG seed = same result. All randomness goes through one seeded RNG.
- **Every data entry records where it came from** (`source: manual | wiki | observed`, plus a URL for wiki data, and `verified: true/false`).
- **Wiki data is not trusted blindly.** Where my in-game observations disagree with the wiki, my observations win and the conflict is listed in §11.
- **Tested at every layer.** Grid, effect resolution, and combat each have unit tests. Behaviour I've confirmed in-game becomes a regression test (§10).

## 3. Tech stack

The simulator is a **local web app** that anyone can run on their own machine (`npm install && npm run dev`, then open localhost).

It's also published as a **static site on GitHub Pages** (user, 2026-10-18): `vite build` bundles `data/` (YAML and images) into the site, and saves (account, builds, item editor edits) live in the browser's storage, with account export / import as the backup (§4.8). `.github/workflows/deploy.yml` tests, builds and publishes on every push to `main`. A first visit gets an empty account and one starter build (`src/ui/starter/example.yaml`).

- TypeScript throughout, so the engine and UI share one codebase.
- Engine: pure TypeScript with no UI dependencies, so it can also run headless (tests, Monte Carlo, later optimizer).
- UI: React + Vite.
- Data: YAML files validated at load time with `zod`; validation errors name the file, entry, and field.
- Tests: Vitest.
- A small headless CLI (`npm run sim -- battle layouts/x.yaml --runs 1000`) for batch runs.

```
src/engine/
  bag.ts          # bag mask, shapes, rotation, placement, item-dot resolution
  model/          # zod schemas: items, gear, statuses, heroes, blessings, pets, auras, profile, enemies
  loader.ts
  stats.ts        # stat aggregation
  effects/        # effect resolution + one handler per generic effect type
  statuses/       # status effects and modifiers
  combat/         # tick-based battle simulation, battle modes
  rng.ts
src/ui/           # React app
src/cli.ts
docs/
  wiki-data/      # game data reference transcribed from the wiki (markdown) + REVIEW.md
tools/
  wiki-dump/      # the quick script that produced docs/wiki-data
  wiki-scraper/   # [LATER, optional] full scraper, own spec (SCRAPER_SPEC.md)
data/
  <category>/
    wiki/         # generated by the scraper, don't hand-edit
    manual/       # my own additions and overrides
  # categories: items, gear, heroes, blessings, pets, auras, statuses, enemy_traits, enemies
  stats.yaml      # stat registry
  config.yaml     # tunable rules
  SOURCES.md      # log of everything pulled from the wiki
  images/         # reference images downloaded by the scraper (gear in-game sprites, etc.)
profile/
  profile.yaml    # my account: stats, heroes + stars, gear, pets, blessings, aura
layouts/          # saved layouts
tests/
  observed/       # regression tests from in-game observations
```

Entries in a `manual/` folder with the same id as a `wiki/` entry override it field by field, so I can correct the wiki without the next scrape wiping my fix. The loader reports every override it applies.

## 4. Domain model

### 4.1 Backpack

- Full-size bag: **8 wide × 6 tall**.
- Smaller or irregular bags (before the maximum is unlocked) are a **binary mask**: a flat array where every 8 entries is a new row, `1` = usable slot, `0` = not. A full bag is 48 ones. The width is always 8; the height is `mask.length / 8`.

```yaml
bag:
  mask: [0,1,1,1,1,1,1,0,
         1,1,1,1,1,1,1,1,
         1,1,1,1,1,1,1,1,
         0,1,1,1,1,1,1,0]
```

- Coordinates: `(x, y)`, `(0, 0)` top-left.
- **Bag sizes by class** (user, 2026-10-19): besides the full bag, every class has three smaller bags named by their cell count, `x26`, `x32` and `x38`, in `data/config.yaml` (`bag.sizes`). The Bag box picks one for the build's hero class; Edit cells is still there for anything else.
- Items can sit at most **4 cells outside the bag** (they do nothing there); moving or dropping one further stops at that edge, so nothing is lost off the grid.
- **Storage** (user, 2026-10-19): a box beside the bag where items are set aside while rearranging, anywhere (not on a grid). Stored items don't fight or count towards the build's value; they're saved with the build (`storage`, positions as shares of the box).

### 4.2 Shapes, rotation, item dots

- Every item has a **shape**: a list of cells relative to its origin.
- **Every item is rotatable** in 90° steps. Symmetric shapes simply look the same after rotation.
- Items that interact with other items have **item dots**: a list of cells relative to the item's origin. The wiki gives one set of sockets per item; by default, every dot-based effect on that item uses that set.
- **Item dots rotate with the item.** Shape cells and dot cells go through the same rotation transform, so a dot to the right of a sword is below it after a 90° clockwise rotation. Test this for all four rotations, using an asymmetric shape with asymmetric dots.
- An item dot "touches" whatever item occupies that cell.
- **If one target item is covered by more than one of the source item's dots, it counts once** for that effect.
- **Item dots that land outside the bag or on a `0` cell touch nothing and do nothing.** No wrap-around, no errors, no null references. This needs explicit tests at every edge and corner, and with irregular masks.
- There is no general concept of adjacency for effects — only item dots decide what an effect reaches.
- **An item's dots can never land on the item's own cells** (in any rotation). This is a hard data error: the loader must reject such an item with a loud, clear error naming the item and the offending cells, and the engine must assert it never happens at runtime. Add tests for this.
- **Items without a shape** (e.g. gear scraped from the wiki before I've entered its dimensions) can't be placed. The UI lists them as "needs shape" with a shortcut to the item editor (§8.2).

### 4.3 Account stats and stat stacking

- **Account stats** are read from the in-game *Stat Details* screen and entered manually, exactly as shown. The simulator never computes them from hero stars, gear levels, pet levels, or anything else.
  - **Basic stats (raw numbers):** `HP`, `ATK`, `Initial Block`. The game shows them abbreviated (e.g. `4M`, `1.34M`), so inputs must accept `K`/`M`/`B` suffixes.
  - **Detailed stats (global):**

    | Stat | Unit | Notes |
    |---|---|---|
    | Crit Rate | % | caps at 100% |
    | Crit DMG | % | default 100% (crits deal 200%) |
    | Item Haste | % | |
    | Accuracy Bonus | % | |
    | Evasion | % | reduces enemy weapon accuracy; Dodge stacks add to it (§5.3) |
    | All DMG Increase | % | |
    | Attack DMG Increase | % | weapon damage |
    | Burn / Poison / Spike DMG Increase | % | status damage, one stat each |
    | [Creature] DMG Increase | % | damage from items tagged as creatures |
    | Burn / Freeze / Poison Inflict Increase | % | more stacks applied, one stat each |
    | Final DMG dealt to Bosses Increase | % | separate final multiplier, only vs. bosses (§7.3) |
    | Final DMG dealt in PvP Increase | % | separate final multiplier, arena only (§7.3) |
    | Bonus Coins | flat | economy [LATER] |
    | Free Reroll Per Round | flat | economy [LATER] |
    | Extra Coin Per Round | flat | economy [LATER] |
    | Interest Per 5 Coins Per Round | flat | economy [LATER] |

  - **More stats will appear** as new items unlock them (e.g. Healing Power Enhance, Block Gain, Vamp Recovery Amount, DMG against Stunned enemies from blessings). Define all stats in a registry (`data/stats.yaml`: id, display name, unit, group, cap, default) so a new stat only needs a registry entry. The GUI builds its input fields from this registry.
  - **The Stat Details values already include contributions from gear, blessings, hero stars, pets, and auras** (confirmed). The simulator must not add those passive bonuses on top again. Gear, blessings, and pets in the profile only matter for effects that happen in battle or in the bag. Make this a config switch, with double counting impossible either way.
- **No item, gear, or effect ever modifies a basic stat.** They are fixed inputs for the whole battle.
- **Max HP gains** during battle (e.g. Golden Pig, Lithinum) raise current HP by the same amount, so a hero at full HP stays at full HP.
- **Block** works like a second HP bar on top of health:
  - The basic stat **Initial Block** sets how much block you start the battle with.
  - During battle, items add block and some items remove the enemy's block. This changes the current block amount, not the basic stat.
  - Incoming damage depletes block first, then health.
  - Model block as a tracked resource on each combatant so effects can read and change it.

#### Scaling item values with basic stats

- Item values scale linearly with basic stats. Every scaled value is stored as a **ratio** of a basic stat:
  - **Damage** values scale with **ATK**.
  - **Block removal** (e.g. Spear's "Removes 1.2x Block") scales with **ATK**.
  - **Heals, HP boosts, and block gains** scale with **HP** by default (the wiki writes "0.10x Max HP").
  - The wiki writes ratios with a stat word attached (`1.5x ATK DMG`, `0.20x Block`, `0.10x Max HP`). The scraper maps known phrasings to a basic stat and flags any it can't map as `scales_with: unknown`.
- At simulation time: `value = ratio × current basic stat` from the profile. Changing stats in the profile rescales every item.
- A ratio can come from two places:
  1. **The wiki** (via the scraper): an exact ratio like `1.5`.
  2. **My in-game observations**: the in-game number shown on the item plus my relevant basic stat at the time. I only ever see values *after* scaling, so observations are how I check wiki data.

  ```yaml
  stats:
    damage:
      scales_with: atk
      ratio: 1.5                       # from the wiki
      observations:                    # optional, strings exactly as shown in-game
        - { shown: "2.01M", stat: "1.34M" }
  ```

- **Precision of observations:** displayed numbers are rounded, so each observation is really a range.
  - Store values **exactly as typed** (e.g. `"1.34M"`, `"812.5K"`). The number of digits shown tells the engine the precision. Below 1M the game shows an extra decimal place, so those observations are more precise.
  - The game **rounds** displayed numbers, so `1.34M` means 1.335M–1.345M. (Keep truncation as a config option just in case.)
  - Each observation gives a **ratio range**. Multiple observations are **intersected**; the simulator uses the midpoint.
  - If there's a wiki ratio, check that it falls inside the observation range and warn if not. That's how wrong wiki data gets caught.
  - If observation ranges don't overlap, show a clear error (typo, or the item doesn't scale as assumed).
  - The GUI shows each item's ratio, its range, and the relative uncertainty (± %).
  - Unit tests cover range parsing for `K`/`M`/`B` with different decimal counts, both rounding modes, and intersection.
- **Percentage stats** (haste, crit, accuracy, etc.) are not scaled.
- **Percentage bonuses stack additively, never multiplicatively.** Bonuses can be global (from Stat Details) or item-specific (from another item's effect). An item's final value is its own base + global bonuses + bonuses it receives.
  - Example: a leather glove gives 15% haste to items under its dots. Two gloves on one item = 30%, not 1.15². With 10% global haste, an item under one glove has 25% haste; items not under a glove have 10%.
- Store final stats **per item**, not just per hero, and keep the breakdown (where each bonus came from) for the UI.

### 4.4 Rarities (the wiki calls them grades)

- Items: Common → Uncommon → Rare → Epic → Legendary.
- Gear, blessings, and pets: up to Mythic (gear Common → Mythic; pets Rare → Mythic).
- Heroes: Rare, Epic, Legendary.
- Keep the rarity lists in config.

### 4.5 Items, gear, and starting equipment

**Common item fields** (all kinds):

| Field | Notes |
|---|---|
| `id`, `name` | |
| `rarity` | |
| `shape` | relative cells; may be missing for gear until I enter it |
| `dots` | relative cells (sockets) |
| `tags` | every item has tags; effects can filter by tag. "Weapon" always means the `weapon` tag. |
| `class_restriction` | list of classes that can use it (e.g. bows: `[ranger]`). Empty = any class. Must be shown clearly in the UI. |
| `hero_exclusive` | optional hero id; shown clearly in the UI with the hero's name |
| `stats` | e.g. `damage` (ratio of ATK), `cooldown` (seconds), and where relevant `accuracy`, `crit_chance` (default 0%), `crit_damage` (default +100%), `hits` (default 1) |
| `effects` | list of item effects (§5.2) |
| `source`, `verified` | provenance (§2) |

**Items (shop items)**

- Rarity Common to Legendary, **no tiers**.
- `value`: shop price in gold. If the wiki shows `?`, use `0`.
- **Sell value = `ceil(value / 2)`.** Computed, never taken from the wiki.
- `merges_into` / `components`: merge recipes. Recipes may differ by class. Data only — merging is not simulated; I place whatever result item I want directly.
- `special_shop: true` marks items only obtainable from the rare Special Shop. Ignore the flag for now; it matters for the [LATER] layout optimizer.

**Items without a cooldown (spells, tools, armor)**

- Only items with a `cooldown` attack or activate on their own timer.
- **Spells** (tag `spell`) mostly have no cooldown. They activate only when another item activates them through its dots, e.g. a staff's "On Attack: Activate [dot] Spell", Wyrd Branch's "3s after Start of Battle: Activates [dot] Spell", or Wizard's Hat's "On [dot] Spell Activation: 20% chance to activate again". Model this as an `activate_item` action targeting items under the dots, which fires the target's `on_activation` effects and attack. Confirmed in-game.
- **Some spells also have a cooldown** (e.g. Thunder Dragon is a Creature and a Spell with a 2.5 s cooldown). Those attack on their own timer like any weapon, and can also be activated by other items. An external activation is independent: it doesn't reset or change their cooldown.
- Some activations have conditions, e.g. Maestro only activates Spells if a Creature is under its dots.
- Other items without a cooldown act only through their effect triggers (start of battle, every N s, on hit, etc.).

**Pet-spawned items**

- Some pets put items into the bag (e.g. Venomous Spider Egg Sacks). The wiki lists them on the Items page under a "Pet" tab.
- Treat them as normal items with `kind: pet_spawn` and `value: 0`.
- When the pet that spawns them is active, they **fill empty bag cells at the start of battle**. Placement: scan the bag left to right, top to bottom, and place each item in the first spot it fits, unrotated (confirmed). I can also place them by hand.
- Items marked "Disappears after battle" are removed at the end of each fight (`temporary: true`).
- Some spawned items change during the battle (e.g. an egg hatches into a bug after a few seconds). Model this as an item effect that replaces the item in place.

**Gear**

- Equipped in the main menu and brought into every battle automatically.
- **Slots:** 1 Weapon, 1 Shield, 2 Rings, 2 Gloves. The profile and GUI enforce these limits.
- **Gear takes up bag slots just like regular items**: it has a shape, is placed on the grid, and can rotate.
- **The wiki doesn't list gear shapes or dots.** I enter them myself in the item editor (§8.2), using the in-game sprite the scraper downloads as a reference. Until then, the gear can't be placed (§4.2).
- Has `level`, `rarity` (Common to Mythic), and `tier` (e.g. "Legendary+3"). Tiers: Epic +0 to +2, Legendary +0 to +3, Mythic +0 to +4.
- **Effects by rarity:** each gear piece has a base effect plus one extra effect per rarity, listed separately for each gear item. The effect for a rarity applies when the gear is at that rarity or higher.
- **S-rank gear** is a special flag, generally stronger, and only obtainable from certain chests.
- **Gear weapons** have:
  - a **basic attack**. Its stats (DMG, cooldown, accuracy, crit rate) aren't on the wiki, so I enter them manually. Some basic attacks hit more than once (e.g. "Attack 2 times").
  - a **skill**: its own damage and trigger — a fixed timer ("Activates every 8 seconds"), a charge gauge ("Activates whenever Skill Gauge reaches 100%"), or both.
  - a **bonus stat** (e.g. All DMG +12.5%). Already included in Stat Details, so not applied again.
  - **Freeze does not slow gear weapon skills** (§5.3). Haste doesn't affect them either.
- **Shields, rings, gloves** have a gear effect and rarity effects, no attack.
- Gear effects can introduce **named, gear-specific mechanics** (e.g. Everfrozen's *Frostbite*, Divine Smite's *Divine Grace*, Omnicleaver's *Charge*). Define these as custom statuses in data, using the same stacking-status system, with their rules written out. If a mechanic doesn't fit, add it as a new generic effect type.

**Starting equipment (supplies)**

- Each hero unlocks specific supply items at certain star levels. Those are listed on each hero's wiki page (§4.6).
- **Supply Ability** (capacity) = **base by hero rarity + 1 per star**. Base: **Rare 5, Epic 8, Legendary 10**. Stars go from 0 to 9, so a 9-star Legendary has 19.
- Cost per item by rarity: Common 2, Uncommon 3, Rare 4, Epic 6, Legendary 8 (in config).
- **Capacity is a point budget:** the total cost of chosen starting equipment must be ≤ the hero's Supply Ability.
- **Only heroes of the matching class can take an item as starting equipment**, regardless of which hero's stars unlocked it.
- **Hero-exclusive items:**
  - Can be taken as starting equipment by **any hero of the same class**.
  - Cannot be used in merges.
  - Cannot appear in shops unless you're playing the correct hero.
- The simulator checks that the starting equipment chosen fits the hero's capacity and class, and shows a clear error if not.

### 4.6 Classes and heroes

- Three classes: **Warrior, Ranger, Wizard**. 23 playable heroes (listed in `docs/wiki-data/heroes.md`).
- Each hero has:
  - `class`, `rarity` (Rare, Epic, Legendary)
  - `stars`: **0–9**, entered in the profile.
  - **Supply unlocks** by star level:
    - Rare: one item each at stars 1, 3, 5, 7.
    - Epic: one at 0 stars, then one each at 1, 3, 5, 7.
    - Legendary: two at 0 stars, then one each at 1, 3, 5, 7.
  - **Hero-exclusive items** and their recipes (from the hero's page).
  - **Two skills** [LATER effects]. They're scraped now so the GUI can show them.
  - **Skill Links** [LATER effects]: a hero's own link slot 1 unlocks at 4 stars and slot 2 at 8 stars. A slot holds a skill from another hero in the same class. That hero shares one skill at 4 stars and the other at 8 stars; which skill comes at which star is listed per hero (e.g. Rose: Parting Rose at 4, Impale at 8).
  - **Skins** (built 2026-10-17, user asked): skin skills have quests and star levels (0–5) and say who can use them (all heroes, a class, a hero). Data in `data/skins/`. **The skins I own and their stars are account-wide** (user, 2026-10-19); **each build brings up to 2 skin skills and says whether their quest is done**. A skill works only for heroes it's available to, if owned, once its quest is done; star rows add to the 0★ reward.
  - **Enhanced slots** (Venom's Poison Coating, Cecilia's Instant Casting): random in game, so they're marked on the bag by hand. Each skill says in its data how many slots it enhances, their colour (Instant Casting green, Poison Coating purple; user, 2026-10-19) and what it does there; the Bag box only offers the build's hero's own (or linked) skill. Venom's Poison Coating blessing adds its value in slots.
  - **Ownership effect**: ignored (already in Stat Details).
- **Blessings** (Dragon's Blessing) are **per hero and account-wide** (user, 2026-10-19: "you get one per hero in game"; saved in the account, edited in the Profile tab or from the Build tab's Hero box, the same in every build with that hero):
  - Each hero has their own set of **up to 5 blessings**. (The wiki ties the slot count to Dragon's Blessing level; I just enter the blessings I have, so the simulator always offers 5 slots and doesn't ask for a level: user, 2026-10-20.)
  - **At most one of each unique blessing** per hero, at any rarity.
  - **Common blessings**: any hero. Each has a value range per rarity, Common to Mythic (e.g. All DMG: Common 1–2%, Mythic 15–20%). Some start at Uncommon.
  - **Class blessings**: tag-based (e.g. `[Sword] Weapon DMG`), Rare to Mythic, one value range for all of them. Only on heroes of that class.
  - **Unique blessings**: only on their own hero. Every hero has them except Fighter, Archer, and Mage. They have a **fixed value per rarity** (not a range), mostly Epic to Mythic. Many buff a hero skill [LATER]; the rest are plain stat bonuses.
  - **Linking a skill does not unlock its blessing.** A unique blessing that buffs a skill only applies to its own hero, even if another hero links that skill.
  - I enter the **exact value** of each blessing I own. The GUI shows the valid range for its rarity and warns (doesn't block) if the value is outside it.
- **MVP uses a blank-slate class with no abilities.** Class mechanics will be specified later.

### 4.7 Pets

- Up to **3 pets** equipped at once.
- Each pet has an **active skill** with an **activation cost** of 1–3 points. Each hero has **5 points** per run, so the GUI warns if the active pets cost more than 5.
- Stars: **0–6**. Extra effects unlock at certain stars (listed per pet; e.g. 1, 2, 4, 5 stars), and some reduce the activation cost.
- **The pets I own and their stars are account-wide** (user, 2026-10-19); a build picks up to 3 of them and which are active.
- Pet levels only raise HP/ATK, which are already in Stat Details, so they're ignored.
- Many pet skills only affect the shop or merging (e.g. Geezer's Special Shop, Mimic's auto-merge). Those are [LATER] economy effects.
- Pets that put items in the bag or act in battle are what the MVP cares about. Implement each as its own effect handler, configured by data (values per star level). This is the one place where per-entity code is acceptable.

### 4.8 Player profile

`profile/profile.yaml` holds everything about my account:

```yaml
basic_stats: { hp: "4M", atk: "1.34M", initial_block: "1.43M" }   # Stat Details screen
detailed_stats:                                  # keys come from data/stats.yaml
  crit_rate: 50
  crit_dmg: 100
  item_haste: 14
  evasion: 15
  all_dmg_increase: 6
  burn_dmg_increase: 56
  burn_inflict_increase: 50
  bonus_coins: 10
  final_dmg_pvp_increase: 10
heroes:                                          # all heroes I own
  - id: rose
    stars: 6
    links: [parting_rose]                        # chosen skill links [LATER effects]
    skin: null                                   # [LATER]
    blessings:                                   # per hero
      level: 5                                   # Dragon's Blessing level → slots
      equipped:
        - { id: all_dmg, rarity: epic, value: 7.4 }
        - { id: rose_spike_dmg, rarity: legendary, value: 25 }
active_hero: rose
gear:
  weapon:  { id: thunderbolt_spike, rarity: legendary, tier: 3, level: 40 }
  shield:  { id: wooden_shield, rarity: epic, tier: 0, level: 40 }
  rings:   []
  gloves:  []
pets:
  - { id: venomous_spider, stars: 3, active: true }
aura: aura_of_vitality                           # [LATER effects]
```

Everything in this file is editable from the GUI (§8.1); the file is just where it's saved.

**Saved-file format, version 2 (user, 2026-10-18).** The example above is version 1. Since version 2 the account and the builds are split:

- **Account** (`profile/profile.yaml`, Profile tab): only what's the same for every build — the heroes I own with their **stars and skill links**, and my **auras**. Saved automatically.
- **Build** (`layouts/<name>.yaml`, Battle tab): the hero, its **blessings**, **gear**, **pets** (with stars), up to 2 **skins** (with stars and quest done), **HP / ATK / Block**, the bag and the battle settings.
- **Hard rule: a file saved by any version must load in every later version.** Every file has a `version`; older versions migrate step by step (`src/engine/saves/migrate.ts`); anything that still doesn't fit is dropped with a note and the rest loads; unknown ids are kept and reported by the checks. Frozen fixtures of every released version live in `tests/fixtures/saves/<version>/` and must keep loading. A version-1 account keeps the whole old profile under `migrated_from_v1`, so version-1 builds are completed from it exactly as version 1 did.
- **Account export / import**: one `.zip` with `profile.yaml` and `builds/*.yaml`.

**Version 3 (user, 2026-10-19): everything I own is account-wide again.**

- **Account**: HP / ATK / Block as Stat Details shows them (`stats`; left out until entered), the heroes I own with their stars, skill links and **Dragon's Blessings**, the **pets** and **skins** I own with their stars, and auras.
- **Build**: the hero, gear (rarity and tier), which pets it brings (and which are active), up to 2 skins (and their quests), the bag, the storage and the battle settings.
- Migration: a version-2 account that came from version 1 takes these from the old profile kept inside it. A version-2 build keeps its own blessings, stars and HP / ATK / Block (under `legacy` when read, and they win so it plays as it did) until the app opens it: then they move into the account where the account has none yet, and where it already has other values the account's are used and a note says what the build had. Fixtures: `tests/fixtures/saves/v3/`.
- **Version 4** (2026-10-20): only new optional settings (the battle's chapter; typed-in attacks' on-hit statuses and % of max HP), so version 3 files move up unchanged. Fixtures: `tests/fixtures/saves/v4/`.
- **Version 5** (2026-10-20): a build's skin can have its skill **forced on** (`quest_forced`): it works even if the bag doesn't meet its quest now (met earlier in the run, e.g. Dream Eater's creatures sold since), and the optimizer neither guards nor mentions that quest.
- **Combat power (CP)**: not shown; no formula is known (the wiki only says opponents' CP is shown in the Arena, 2026-10-20).
- **Calculating HP / ATK / Block** from training level, gear level, pet and skin stars and gear rarity and tier (user, 2026-10-19) **isn't built**: the wiki has no training page and no stats per gear level (2026-10-19, see `data/SOURCES.md`). Until that data exists they're typed in.

### 4.9 Enemies

- MVP: enemy has HP, block, damage reduction, simple attacks (damage, cooldown, accuracy, hits per attack), a `boss` flag (set automatically for Gauntlet's 4th enemy and Boss Rush enemies), starting statuses, and resistances/immunities/vulnerabilities (§5.3).
- **Enemy traits**: the wiki lists ~60 enemy traits (e.g. Massive Block, Continuous Dodge Gain, Burn Counterattack, Low-HP Invincibility). The scraper saves them to `data/enemy_traits/` as descriptions. Turning them into effects is [LATER], one at a time, as I need specific enemies.
- [LATER]: enemy has a full bag with items, built from the same model as the player.

### 4.10 Auras [LATER]

- An account can equip one aura. Its **aura skill** is an economy effect (e.g. "Start of Game: Gain 1 Coin"), and its ownership effect is ignored.
- Scrape and store them now; the profile can select one; the effects only matter for the chapter planner.

## 5. Effects

### 5.1 Item effects vs status effects

These are **two different systems with similar names**. Keep them separate in code and in the UI.

- **Item effects** belong to items and gear. They modify stats, deal damage, or **apply status effects** to the player or the enemy.
- **Status effects** live on a combatant (player or enemy) and do things over the course of the battle.

### 5.2 Item effect structure

| Part | Description |
|---|---|
| `trigger` | `passive`, `battle_start`, `on_hit` (this weapon hits), `on_weapon_hit` (any weapon hits), `on_skill_hit`, `on_use`, `on_damage_dealt`, `on_attacked`, `on_dodge`, `on_crit`, `on_status_applied`, `on_block_gained`, `hp_below`, `timer`, … Usually written in-game as "when [item dot] item does X, do Y". |
| `uses_dots` | whether the effect reaches items under the item's dots |
| `filter` | optional tag / rarity / class filter on the items under the dots |
| `chance` | optional probability, e.g. 45% chance to stun |
| `condition` | optional, e.g. "if enemy has ≥ 5 burn", "while Block is active" |
| `limit` | optional, e.g. "once per battle" |
| `action` | `add_stat_pct`, `deal_damage`, `gain_block`, `remove_block`, `heal`, `lose_hp`, `apply_status`, `remove_status`, `cleanse`, `steal_status`, `refund_cooldown`, `charge_skill`, `spawn_item`, `transform_item`, … |
| `target` | `items_under_dots`, `self_item`, `player`, `enemy` |
| `duration` | optional; for time-limited stat changes or statuses |

Effects start as text copied from `docs/wiki-data`; converting them to this structure is done in small batches that I review. Leave room for new triggers and actions — this list will grow.

**Multi-hit attacks** (e.g. Thunderbolt Spike's skill: 0.70x ATK per hit, 3 times): the listed damage applies to each hit. [UNVERIFIED: in the game, hits are spread out over time. For now, all hits of one attack land in the **same tick**, one after another. Each hit is its own hit event (accuracy, crit, on-hit triggers, Burn and Spike). Keep the spacing configurable so it can be changed when I can measure it.] This is an exception to "a weapon deals damage at most once per tick" (§7.1).

### 5.3 Status effects

The wiki's *Stats and Effects* page is the main source for status rules. Where it conflicts with my own observations, my observations win (see notes below and §11). All statuses are defined in `data/statuses/` (per-stack values, trigger, chance, interval, caps/floors).

**General rules**

- Stacking statuses multiply their effect by their number of stacks.
- **A chance (e.g. 50%) is rolled once for all stacks together.** If it succeeds, the full stacked amount applies.
- Each status is a **buff** or a **debuff**. Either combatant can hold either kind.
- **Statuses last the whole battle by default.** Some items and gear apply time-limited stacks; track those stacks with their own expiry time.
- **Timed statuses (Poison, Regen) run on a global 2 s timer counting from battle start**, not from when they were applied.

**Buffs**

| Status | Effect per stack | Ratio | Notes |
|---|---|---|---|
| **Focus** | +1% accuracy on all the holder's items. | — | |
| **Dodge** | +1% Evasion: −1% accuracy on each of the opponent's weapons. Enemy accuracy can't drop below 25%. | — | |
| **Swift** | Items activate 1% faster (+1% haste). | — | |
| **Vamp** | On the holder's weapon hit, 50% chance to heal. | **1/200 HP** | Wiki says 0.01x HP — wrong, like its Burn/Poison/Spike numbers. Observed 20.0K at 4M HP. |
| **Regen** | Every 2 s, heal. | **1/200 HP** | Wiki says 0.01x HP — wrong. Observed 6 stacks healing 7.24M on a 241.6M HP enemy. |
| **Spike** | When the holder is hit by a weapon, 50% chance to deal damage to the attacker. | **1/10 ATK** | Wiki says 0.01x — a typo; observed 61.1K at 610.9K ATK. |
| **Invincible** | Take no damage; ignore all enemy attacks. | — | Usually has a duration. |

**Debuffs**

| Status | Effect per stack | Ratio | Notes |
|---|---|---|---|
| **Burn** | When the holder is hit by a weapon, 50% chance to take damage. | **1/10 ATK** of the inflicter | Wiki says 0.01x — a typo. |
| **Poison** | Every 2 s, take damage. | **1/10 ATK** of the inflicter | Wiki says 0.01x — a typo. |
| **Freeze** | Items activate 1% slower: a final cooldown multiplier (§7.3). No cap. Items only, not gear weapon skills. | — | |
| **Stun** | The holder's item cooldowns don't progress for the duration. | — | Non-stacking, has a duration. |
| **Seal** | A specific weapon or item is disabled for the duration. | — | Targets one item, not the whole combatant. |
| **Heal Amount Reduction** | Reduces healing from items, Vamp, and Regen by the listed %. | — | Healing-increase bonuses counter it additively: `heal × (1 + heal_bonus% − reduction%)`, floor 0. |

- Damage from Spike, Burn, and Poison is status damage: it gets that status's DMG Increase stat and can crit using the status-specific crit bonuses (§7.3).
- "Inflict Increase" stats (e.g. Burn Inflict Increase 50%) multiply the number of stacks applied.
- **Fractional stacks alternate** so they average out: 1.5 stacks per application gives 1, then 2, then 1, then 2. Implement it as a carried remainder per source item and status: each application adds the exact amount to a running total and applies `floor(total) − already_applied` stacks. Deterministic, no randomness. Test it with 1.5, 1.25, and 0.5.

**Resistances, immunities, vulnerabilities**

| Kind | Examples | Effect |
|---|---|---|
| Resistance | All Debuff Resist; Burn / Poison / Freeze Resistance | Reduces stacks of that debuff received by the listed %. All Debuff Resist covers Burn, Poison, and Freeze. |
| Stun Resistance | | Reduces the chance to be stunned. |
| Immunity | Burn / Poison / Freeze / Stun Immunity | That status can't be applied. |
| Damage-to-1 | Weapon Attack Immunity, Spike Immunity | That damage type is reduced to exactly 1 per hit. |
| Vulnerability | Attack DMG, Burn, Poison, Spike, Critical Hit Vulnerability | Increases damage taken from that source. |

**Removing, cleansing, and stealing statuses**

- **Cleanse:** remove **random** debuff(s) from me.
- **Remove Buff:** remove **random** buff(s) from the opponent.
- **Steal:** take buffs from the opponent: they lose the stacks and I gain them.
- These are generic item-effect actions (`cleanse`, `remove_status`, `steal_status`) with parameters for how many statuses and stacks. "Random" goes through the seeded RNG.

## 6. Resolution pipeline (before combat)

1. **Validate placement:** every item cell is on a `1` cell of the mask; no overlaps; class/hero restrictions pass; starting equipment fits capacity; gear slot limits; pet activation cost ≤ 5. Each failure gives a clear message.
2. **Resolve item dots** for every effect (§4.2).
3. **Aggregate stats** per item and for the player (§4.3), with a full breakdown.
4. **Synergy report:** for every item, the effects it gives, the effects it receives, and from which item.

## 7. Combat

### 7.1 Timing

- Real-time, simulated in **ticks of 0.1 s**. [UNVERIFIED: real frame timing varies by item; keep tick length in config.]
- **A weapon attacks at most once per tick.** Any cooldown is clamped to a minimum of 0.1 s. A multi-hit attack still counts as one attack (§5.2).
- **Triggered effects are not rate-limited by default.** Example: an item that gains block "when item under its dots deals damage", touching two 0.1 s weapons, gains block twice per tick.
- **Exception: `on_dodge`** triggers at most once per tick, even if the player dodges more than once in that tick.
- Make per-trigger rate limits configurable, since more exceptions will appear.

### 7.2 Battle start

At the start of battle, resolve in this order:

1. Pet-spawned items fill empty bag cells (§4.5).
2. Status and stat changes.
3. Damaging effects (e.g. certain pets).

### 7.3 Damage, accuracy, and speed

- **Damage types:** weapon damage (with subcategories), skill damage, and status damage. Keep the type and subtype on every damage event so effects can filter on them.
- **Damage reduction:** a flat percentage that multiplies incoming damage, e.g. 20% → ×0.8. **Multiple sources add together** (10% + 15% = 25% → ×0.75). **Damage taken can't drop below 25%**, so total reduction is capped at 75%. Type-specific reductions (Attack, Burn, Poison, Spike DMG Reduction) add to the general DMG Reduction for that type.
- **Vulnerability** adds to damage taken: `damage taken × (1 − reduction% + vulnerability%)`, with the 25% floor.
- **Accuracy:** each weapon has a hidden raw accuracy, which can go above 100%:
  `raw = weapon accuracy + attacker's Accuracy Bonus + attacker's Focus stacks − defender's Evasion (incl. Dodge stacks)`
  `hit chance = clamp(raw, 25%, 100%)`
  Clamping happens only at the end, so accuracy above 100% cancels out Dodge. Some attacks "always hit" and skip the roll. Floor and cap in config.
- **Cooldown:**
  `haste = item haste % + global Item Haste + Swift stacks`
  `cooldown = base_cooldown / (1 + haste) × (1 + Freeze stacks / 100)`
  then clamp to the 0.1 s minimum. 100 Freeze stacks doubles cooldowns; there is no cap. Freeze applies to items only, not gear weapon skills. Stun pauses cooldowns.
- **Damage formula** (from the game's community Discord):

  `damage = (base × damage_modifier × crit + additional_damage) × (1 + final%)`

  - **`base`**: the weapon's or effect's ratio × ATK.
  - **`damage_modifier`** = `(1 + Σ type%) × (1 + all%)`:
    - `type%` adds together all type-specific increases: Attack DMG Increase for weapon hits, Burn/Poison/Spike DMG Increase for that status, [Creature] DMG Increase for creature items, and item-specific % bonuses.
    - `all%` is All DMG Increase, including Berserk's DMG bonus (§7.6). It multiplies the type bonuses rather than adding to them, e.g. 56% Burn DMG and 6% All DMG give `1.56 × 1.06` for burn. [UNVERIFIED — config switch to add it into `type%` instead.]
  - **`crit`**: 1, or `1 + crit DMG%` on a crit.
  - **`additional_damage`**: flat extra damage from effects, added after the modifier and crit, e.g. Maestro's "+0.6x ATK DMG", Erwen's Bow's "0.2x ATK per Swift stack", Plate Helmet's "15% of current Block". [UNVERIFIED: whether it's affected by `final%` — default yes, as in the formula.]
  - **`final%`**: Final DMG dealt to Bosses (vs. bosses) and Final DMG dealt in PvP (arena).
- **Crits:**
  - Weapons start at 0% crit rate unless raised by items, gear, or Stat Details. Crit chance caps at 100%. Crit damage is uncapped. Default crit damage is +100% (×2).
  - Some statuses (Burn, Spike, Poison so far) have their own crit chance/damage bonuses; these are **added** to the global values.
- After the formula: reduction/vulnerability → damage-to-1 immunities → absorbed by block → remaining damage to health. Invincible holders take nothing.
- **All damage, weapon and status alike, goes through block first.**
- Exception: the Warrior hero **Rose**'s skill *Impale* makes her Spike, Poison, and Burn ignore block. Skills are [LATER], but build the damage pipeline now with an `ignores_block` flag on damage events.

### 7.4 Output

- Winner, duration, remaining HP and block.
- Per-item damage, healing, block, and statuses applied.
- Optional timestamped event log.
- Monte Carlo mode: N runs with different seeds → win rate and distribution of damage per second.

### 7.5 Battle modes

The maximum battle duration is set per mode in config and can be overridden in the GUI.

| Mode | Duration | Rules |
|---|---|---|
| **Stage** | 30 s | One enemy. Enemies go berserk from 10 s (§7.6). If nobody dies by the time limit, it's a loss. |
| **Gauntlet** | 60 s total | 4 enemies in a row. My statuses carry over between fights. Battle-start effects trigger **only once**, at the start of the first fight. My HP and block carry over. **The 4th enemy is a boss.** |
| **Boss Rush** | 30 s per fight, 5 fights | Chapters that are multiples of 5: 5 bosses in a row, every enemy is a boss. Each fight has its own 30 s limit (and its own Berserk timer). Same carry-over rules as Gauntlet. Bosses also appear as the 4th fight of every Gauntlet (rounds 4, 8, 12 of a chapter). [UNVERIFIED: time limit — config.] |
| **Arena** (built 2026-10-17) | 30 s, fixed | Against another player's build; always PvP (HP and Block ×20 for both, PvP Berserk at 10 s, Final DMG in PvP). If nobody dies, whoever has the higher remaining HP % wins (user, 2026-10-17). |
| **Raid** (built 2026-10-20) | 15 s, fixed | Against a fixed boss; the result is total damage dealt. Boss final multiplier applies. The raid boss can't die, ignores Execute effects, and is immune to damage based on HP (`immunities: [execute, hp_based]`). Its hits are weak, based on % of my max HP (no more than 5% over the fight), and when time is up I'm defeated, whatever protects me (config `timeout_kills`). **The boss is a placeholder** (`data/enemies/manual/raid.yaml`) until the real one is entered; whether raids have Berserk isn't known, so it's off. A raid bag has no shop items in game (only gear and starting equipment): the Battle tab warns. |

**Chapters** (user, 2026-10-20; config `chapters`): 120 chapters; 12 enemies each, 5 in every 5th chapter (a Boss Rush); from chapter 10 the enemies repeat every 25 chapters (35 has chapter 10's enemies, with other base stats) [UNVERIFIED reading of "every 25 chapters from 10 to 120 have the same layout"]. Which enemies a chapter has isn't entered yet, so the Battle tab says so in red and a stand-in is fought (sandbox). A full playthrough is [LATER].

Typed-in enemies (simple stats) can have attacks that inflict statuses on hit, and attacks that deal a % of my max HP.

Battles in all modes are deterministic given the seed.

### 7.6 Berserk

From my observations (not on the wiki):

- At **10.00 s** on the battle timer, Berserk starts at stack 1: **+25% DMG, +25% Item Haste, +0% Accuracy**.
- Each further stack adds **+5** to each of those three (stack 2: +30% / +30% / +5%; stack n: +(20 + 5n)% DMG, +(20 + 5n)% Item Haste, +5(n − 1)% Accuracy).
- One more stack **every 1 s**.
- **Who:** in chapter modes (Stage, Gauntlet, Boss Rush) only the enemy goes berserk. In PvP (Arena) both sides do. Gear like Meteor Hammer ("activates when berserk is active") only matters in PvP.
- Enemies with the trait *Short Time Limit* never go berserk.
- The start time, per-stack values, and interval all live in config. Berserk adds to the existing stats the same way other % bonuses do: DMG into All DMG, haste into haste, accuracy into raw accuracy.

## 8. Web UI

- **Bag grid** rendered from the mask; unavailable cells clearly greyed out.
- **Tabs** (user, 2026-10-19): **Build** (only for building the bag), **Battle** (my bag and the opponent's side by side, each with its hero, blessings, gear rarities, pets, skins and auras under it, then the fight), Optimize, Profile, Item editor, Data.
- **Battle tab** (user, 2026-10-20): a bar picks **Arena** (PvP against a build only: one of mine, a copy of mine, or a build file; both bags can be rearranged), **Raid** (the raid boss) or **Chapter** (pick the chapter and one of its enemies). Items moved in the Battle tab are a try-out: Keep puts them in the build, Undo forgets them. Each side folds away **Detailed stats** (HP / ATK / Block, every calculated stat, every item's final numbers with its breakdown). The results show my breakdown and the opponent's side by side. The Build tab has no Stats box.
- **Searching** (items, starting equipment, builds, the item editor) goes word by word: "h b" finds Hunter's Bow (each word typed starts a word of the name, in order); text inside a name as typed matches too.
- The border around the bag grows only for item cells outside it, never for dots (turning an item doesn't shift the bag); dots further out aren't drawn.
- **Optimize** (user, 2026-10-20): 0 builds to try tests my build as it is. Opponents can be **weighted** (a weighted mean of the scores). Several runs: parallel, series, or **parallel then series / series then parallel**, a first runs and b of the other kind from each one's best (3 and 3 = 3 + 9 runs).
- **Phones** (user, 2026-10-20): one section at a time, in order (Profile → Hero & blessings → Gear → Pets → Skins → Opponent → Items & bag → Fight), with Back / Next.
- **Build box** across the top: one dropdown of saved builds with a search box; the **temp build** first (a scratch build that isn't in the list, kept as it's edited until it's saved under a name); per build a white pencil (rename), green arrow (save over) and red bin (delete), each asking first; **Preview bag** shows each build's bag under its name, 3 to a row.
- **Searchable item browser:** search by name, filter by class, hero, tag and kind (shop item / pet spawn); gear isn't listed (the Gear box places it). A **Sort** menu: alphabetical, value (cheapest first), rarity (common → legendary; hovering it offers one rarity only). The starting equipment tab has the same search and filters. Class and hero restrictions visible on each entry; items that still need a shape are marked.
- **Placement:**
  - Clicking an item in a list puts it straight into the first free spot (unrotated); if there's none, a message says so.
  - Drag with the mouse, a pen or a finger (the app's own dragging, not the browser's, so keys work while dragging): the whole item shows under the pointer and where it would land is outlined in the bag; **space turns it while it's held**, Escape puts it back. Drop it on the storage box (beside the bag) to set it aside, or on the bin (under the bag) to remove it. Items in the storage box have Item details too (their numbers on their own).
  - The starting equipment list puts what's in use first, marked, with a button to take it out.
  - Whose bag the Bag box edits (mine, or the opponent's when it has a build) is chosen in the Bag box itself.
  - Click an item in the bag to select it, click it again to rotate it. A click anywhere else in the Bag box lets go. **Item details** (a button at the top of the box) opens its stats in a compact side panel.
  - Keyboard: arrow keys move the selected item, space rotates, delete/backspace removes.
- **Overlaps and invalid placements highlighted in red.**
- **Item dots shown** on the grid for the selected or hovered item, including which items they touch. Dots outside the bag can be shown faded but must do nothing.
- **Stats panel:** player stats and per-item final stats with the breakdown from §4.3.
- **Battle panel:** choose a mode, adjust max duration, run a battle, see the result summary and event log.
- Save / load builds. Locally (`npm run dev`) they're files in `layouts/` and the account is `profile/profile.yaml`; on the hosted static site they're kept in the browser. Unsaved build changes are kept as a draft, so closing the tab loses nothing (§4.8).

### 8.1 Profile and loadout editor

All account details are entered in the GUI and saved automatically (§4.8). The whole account (profile and every build) can be exported and imported as one `.zip`.

- **Account stats** (first in the Profile tab): HP, ATK and Block as Stat Details shows them, with `K`/`M`/`B` suffixes. The other stats are calculated (§4.3).
- **Pets and skins owned**, with their stars (Profile tab).
- **Heroes owned:** all my heroes with their stars (0–9). Used to work out unlocked supply items and available skill links.
- **Active hero:** pick a hero (grouped by class).
  - **Skill links:** only offer slots and skills unlocked by the star rules in §4.6. Saved now; effects are [LATER].
  - **Skins**: a Profile panel to own skins (0–5★), tick "quest done" and equip up to 2 skin skills.
- **Blessings (per hero):** for each owned hero, set the Dragon's Blessing level, then add blessings up to the slot limit. For each: pick the blessing, its rarity, and the **exact value**. Show the valid range (or fixed value) for that rarity and warn if it doesn't match. Class blessings only appear for heroes of that class; unique blessings only for their own hero.
- **Gear:** one weapon, one shield, two rings, two gloves. Set each piece's level, rarity, and tier. S-rank gear is marked.
- **Pets:** up to 3, each with stars (0–6) and an active toggle. Show the total activation cost against the 5-point budget.
- **Aura** [LATER effects]: select one.
- **Starting equipment:** chosen in a loadout step before any battle.
  - Only shows items unlocked by my heroes' stars and allowed for the active hero's class.
  - Shows a running total like `14 / 16 points` and blocks adding an item that would exceed capacity.
  - Chosen items then appear in the bag for placement.
- **Bag shape:** the full 8×6 bag or the class's x26 / x32 / x38, or toggle cells on/off by hand.
- **Enemy:** pick an enemy from `data/enemies/` or enter stats directly (HP, block, damage reduction, attacks, boss flag, starting statuses, resistances/immunities).
- **Battle settings:** mode, max duration, RNG seed, number of Monte Carlo runs.

### 8.2 Item editor

A form for adding or correcting items, gear, and pets without hand-editing YAML: name, rarity, class/hero restrictions, tags, shape and item dots (drawn by clicking cells on a small grid), stats, and effects.

- Shows the item's reference image next to the grid when the scraper downloaded one (`data/images/`), e.g. a gear piece's in-game sprite, so I can copy its shape and dots.
- A **"needs shape" queue** lists every item and gear piece without a shape, so I can work through them in one go.
- For gear weapons, also has fields for the basic attack stats (DMG ratio, cooldown, accuracy, crit rate, hits).
- Ratios can be typed directly or entered as in-game observations (shown number + basic stat); the form shows the resulting ratio range.
- Saves to the matching `manual/` folder with `source: observed` or `manual`, overriding the wiki version field by field.

## 9. Build phases

One phase at a time. Each phase ends with passing tests and a short summary. Wait for my review before starting the next.

1. **Bag and placement engine.** Mask, shapes, rotation, item-dot resolution (with out-of-bag and multi-dot tests), placement validation.
2. **Data models and loader.** Schemas for items, gear, statuses, heroes, blessings, pets, auras, profile, enemies; YAML loading with clear errors; provenance fields; manual-overrides-wiki merging. **Convert `docs/wiki-data/*.md` to `data/<category>/wiki/*.yaml`** (items with shapes and dots, gear, heroes, blessings, pets, statuses), keeping effects as text. Apply `docs/wiki-data/corrections.md` as `manual/` overrides. Follow `docs/wiki-data/README.md`, and don't change anything else listed in `REVIEW.md` unless I've answered it.
3. **Stat aggregation and synergy report.** Additive % stacking, ratio scaling and observation ranges, per-item breakdowns, class/hero/starting-equipment/gear-slot/pet-cost validation.
4. **Web UI.** Grid, item browser, placement controls, red overlap highlighting, dot display, stats panel, the profile/loadout editor (§8.1), and the item editor with the "needs shape" queue (§8.2).
5. **Combat MVP.** Blank-slate class, tick loop, cooldowns with haste and Freeze, spell activation by other items, accuracy, crits, damage reduction with the 25% floor, block, simple enemy, the stacking statuses in §5.3, global 2 s timer, multi-hit, battle-start order, Berserk, Stage mode, Monte Carlo.
6. **Combat breadth.** Stun, Seal, Invincible, Heal Amount Reduction, resistances/immunities/vulnerabilities, timed statuses, cleanse/remove/steal, trigger rate limits, gear rarity effects, gear weapon basic attacks and skills, gear-specific mechanics, pet-spawned items, blessings (stat and tag kinds), Gauntlet mode.
7. **[LATER]** Hero skills and skill links (including Rose's *Impale*); unique blessings that buff skills; skins; enemy traits and enemy bags; Arena and Raid modes; auras and economy effects; chapter planner with gold budgets; automatic layout search including Special Shop items.

## 10. Verifying against the real game

- `tests/observed/` holds tests built from things I've checked in-game, each noting the game version.
- When the simulator disagrees with the game, fix the general rule or config, not the individual item.
- Wiki data stays `verified: false` until I confirm it, either by marking it in the GUI or by an in-game observation that matches its ratio.

## 11. Open questions

Answered questions have been folded into the sections above. Still open:

- [ ] **Additional damage** (§7.3): is it multiplied by Final DMG increases? (Default yes.)
- [ ] **All DMG** as a separate multiplier vs. added into type bonuses (current guess: separate).
- [ ] **Multi-hit timing:** hits are spread out in-game; currently all in one tick.
- [ ] **Wiki "%" damage bonuses that are really flat** (Maestro's "+60%" was +0.6x ATK). Check other items as they come up.
- [ ] **Values to observe in-game** (`x` on the wiki): see `docs/wiki-data/REVIEW.md`.
- [ ] [LATER] Gold per stage (chapter planner).
- [ ] [LATER] Hero skill effects (the skill text is already in `docs/wiki-data/heroes.md`).
