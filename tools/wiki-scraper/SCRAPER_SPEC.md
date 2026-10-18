# Wiki Scraper — Specification (v2) — [LATER, optional]

> **Status:** not needed right now. The game data was transcribed directly into `docs/wiki-data/` (see its README). Build this only if the wiki changes often enough that re-transcribing by hand becomes a chore. The page layouts described below are still accurate as of 2026-10-15.

## 1. Purpose

A quick-and-dirty terminal tool that pulls game data from the [Overgeared Hero wiki](https://overgearedhero.fandom.com) into the simulator's data format. It lives in the same repo (`tools/wiki-scraper/`) so it can reuse the simulator's zod schemas, but it's a separate program with its own entry point and can ship as its own GitHub release.

It runs rarely (once now, again when the wiki updates). Correctness and loud reporting matter more than polish or speed.

The tool has one **mode per wiki page type** (§5). Each mode shares the same fetch, cache, report, and review machinery (§3, §4, §6, §7).

## 2. Rules

- **Report everything.** The CLAUDE.md wiki rule applies in full: every run prints and logs what was fetched and extracted (§7).
- **Never guess silently.** Anything that doesn't parse cleanly is kept as raw text, marked `needs_review: true`, and listed in the report.
- **Misspellings are flagged, never auto-fixed.** When a name doesn't match anything (e.g. `Spell_Theif.png`), the report lists it with the closest matches, and the review step (§6) asks me which one it is. My answer is saved in `tools/wiki-scraper/aliases.yaml` (`Spell_Theif: spell_thief`) and reused on later runs.
- **All output is `source: wiki`, with the page URL, `scraped_at`, and `verified: false`.**
- **Output only goes to `data/<category>/wiki/`.** Never touch `manual/` folders; they hold my corrections and override the wiki output.
- **Ignore ownership effects** everywhere (heroes, pets, auras, skins). Store them as raw text at most; the simulator never applies them.
- **Wizard, not Mage.** The class id is `wizard`. "Mage" is a hero name.

## 3. Fetching and caching

- Fetch the **page source (wikitext)** through the MediaWiki API, not the rendered HTML (the normal page URL can reject automated requests):
  `https://overgearedhero.fandom.com/api.php?action=parse&page=<Page>&prop=wikitext|links&format=json`
- Send a descriptive User-Agent, and wait at least 1 s between requests.
- Save every raw response to `tools/wiki-scraper/cache/<Page>.<date>.json` and commit it. Parsing always runs from cached files, so it can be re-run and tested offline (`--from-cache`).
- **Images:** for gear, fetch the in-game sprite (`Gear-Ingame-<Name>.png`) through the API (`action=query&titles=File:<name>&prop=imageinfo&iiprop=url`), download it to `data/images/gear/`, and record the path on the gear entry. The item editor shows it as a reference for drawing shape and dots. Optionally do the same for item sprites.
- If the API fails, print the error and stop. Don't retry in a loop or try to get around a block.

## 4. Shared parsing

All pages use plain wiki table markup and a few templates. Shared helpers:

- **Table splitter:** finds `{| ... |}` tables, reads the header row, splits rows on `|-`, and splits cells. Must handle `rowspan` (the Class blessings table uses it) and cells that start with `style="..." |` or `class="..." |`.
- **Layout checks:** each mode lists the headers it expects. If a table's headers or a row's cell count don't match, fail loudly with the page, table, and row. That's the signal the wiki layout changed.
- **Icon tokens:** replace every `[[File:<Name>-Description.png|...]]` with `{Name}` (normalise `_` to space), e.g. `{Burn}`, `{Block}`, `{Filled Socket}`. Keep a list of known icons; anything new is reported.
- **Rarity from colour:** `<span class="grade-<rarity>">...</span>` gives the rarity of the text inside it. Several pages list one span per rarity (gear effects, blessing values) — each span is the effect or value **for that rarity**, in ascending order.
- **Star counts:** a run of `[[File:Star-tier.png]]` icons before a line means "unlocks at N stars", where N is the number of icons (pets).
- **Italics** (`''...''`) are flavour or notes. Keep them in `notes`. Recognise a few meaningful ones: "Disappears after battle" → `temporary: true`; "Activates once per battle" → `limit: once_per_battle`; "Activates every N seconds" → skill timer.
- **Multipliers:** `Nx <word>` → `{ ratio: N, scales_with: <stat> }`. Mapping: `ATK DMG`/`ATK` → `atk`; `Max HP`/`HP` → `hp`; `Block` gained → `hp`; `Block` removed → `atk`. Anything else → `scales_with: unknown`, flagged.
- **Name resolution:** many cells reference other entries by sprite file name. Build a lookup from every scraped sprite and name (normalised: lowercase, `_` → space) to ids, plus `aliases.yaml`. Unresolved names are flagged as described in §2.

## 5. Modes

Each mode is a command: `npm run scrape -- <mode> [fetch|parse|review]`. `all` runs every mode in order.

### 5.1 `items` — [Items](https://overgearedhero.fandom.com/wiki/Items)

**Layout:** five tabs in a `<tabber>`, one table each: Universal, Warrior, Ranger, Wizard, Pet (~222 rows).

- Universal / Warrior / Ranger / Wizard headers: `Sprite | Name | Type | Stats | Effect | Footprint | Value | Merge Recipes | Components`
- Pet headers: `Sprite | Name | Type | Stats | Effect | Footprint | Value`

**Mapping:**

| Wiki | Output | How |
|---|---|---|
| Tab | `class_restriction`, `kind` | Universal → `[]`; Warrior/Ranger/Wizard → that class. Pet → `kind: pet_spawn`, `class_restriction: []`. |
| Sprite | `sprite` | file name |
| Name | `name`, `id`, `rarity` | `id` = slug. Rarity from the grade span. `grade-special-shop` → `special_shop: true` (keep the rarity if one is also given; flag it if not). |
| Type | `tags` | split on `<br>`, slugged: `Weapon<br>Blunted<br>Rock` → `[weapon, blunted, rock]` |
| Stats | `stats` | one line per `<br>`, by icon: `{Attack DMG} 1.5x ATK DMG` → `damage: { ratio: 1.5, scales_with: atk }`; `{Cooldown} 2.6s` → `cooldown: 2.6`; `{Accuracy} 80%` → `accuracy: 80`; `{Crit Rate} N%` → `crit_chance`. Unknown lines → `stats_raw`, flagged. Empty is normal for non-weapons. |
| Effect | `effect_text`, `notes`, `effects` | §6 |
| Footprint | `shape`, `dots` | below |
| Value | `value` | number after the coin icon; `?` → `0` |
| Merge Recipes / Components | `merges_into` / `components` | name resolution |

**Footprint → shape and dots.** A grid of spans; `<br>` starts a new row. `grid-filled` → shape cell; `grid-socket` → dot; `grid-empty` → nothing. Coordinates `(x, y)` from the top-left of the footprint. Checks (each failure → report + `needs_review`): at least one filled cell; rows of different lengths (pad, flag); unknown span class; socket icon in the effect text but no sockets in the footprint, or the reverse. Also run the simulator's own shape validator on the result.

**Duplicate names across tabs:** keep both, suffix the class version's id (`item__warrior`), and flag it.

### 5.2 `gear` — [Gear](https://overgearedhero.fandom.com/wiki/Gear)

**Layout:** a `<tabber>` with Weapons, Shields, Rings, Gloves, Auras.

- Weapons headers: `Sprite | In Game | Name | Bonus Stat | Skill | Gear Effect | Effect by Grade`
- Shields / Rings / Gloves headers: `Sprite | In Game | Name | Gear Effect | Effect by Grade`
- Auras headers: `Sprite | Name | Aura Skill | Aura Skill Effect | Ownership Effect | Source | Cost` → saved to `data/auras/wiki/` (skill name and effect text only; ownership, source, and cost ignored).

**Mapping (gear):**

| Wiki | Output | How |
|---|---|---|
| Tab | `slot` | `weapon`, `shield`, `ring`, `glove` |
| In Game | `reference_image` | download (§3) |
| Name | `name`, `id`, `s_rank` | `[[File:S Rank.png]]` after the name → `s_rank: true` |
| Bonus Stat | `bonus_stat_text` | stored for display only; already in Stat Details |
| Skill | `skill` | effect text (§6) plus the trigger from the italic note: "Activates every N seconds" → `timer: N`; "Activates whenever Skill Gauge reaches 100%" → `charge_gauge`. Multi-hit phrasing ("0.70x ATK DMG per hit, 3 times") → `ratio: 0.7, hits: 3`. |
| Gear Effect | `effect_text` | the base effect |
| Effect by Grade | `rarity_effects` | one entry per grade span, in order: `{ rarity: legendary, text: ... }`. Lines that are only a stat bonus (`ATK +25%`, `HP +10%`) → `stat_only: true` (already in Stat Details, so not applied). |

**Always missing from the wiki, and flagged as `needs_manual` on every gear entry:** `shape`, `dots`, and for weapons the basic attack stats (DMG ratio, cooldown, accuracy, crit rate, hits). I fill these in with the item editor.

**Gear-specific mechanics** in italic brackets (e.g. `''[Frostbite] - DMG taken increases by 5% per stack.''`, `[Divine Grace]`, `[Charge]`) → collect them into a `named_mechanics` list on the gear entry and into the report, so they can be defined as custom statuses (SPEC §4.5).

### 5.3 `blessings` — [Dragon's Blessing](https://overgearedhero.fandom.com/wiki/Dragon%27s_Blessing)

**Layout:** three list tables plus a level table.

| Table | Headers | Output |
|---|---|---|
| Level & rates | `Level | Slots | XP to Next Level | Blessing Drop Rate by Grade` | `data/blessings/wiki/levels.yaml`: level → slots (drop rates and XP are ignored) |
| Common | `Blessing | Value` | one entry per blessing; `ranges` from the grade spans, e.g. `+1 ~ 2%` → `{ rarity: common, min: 1, max: 2 }` |
| Class | `Class | Blessing | Value` | uses `rowspan`: class cells span 3 rows, the value cell spans all 9. Every class blessing gets the same ranges. `[Sword] Weapon DMG` → `{ class: warrior, tags: [sword], stat: weapon_dmg }`. `[Rock] & [Trap]` → both tags. |
| Unique | `Hero | Blessing | Effect & Value` | `rowspan` 2 per hero. Values are **fixed per rarity**, not ranges: `+10%/+20%/+30%` with grade spans → `{ epic: 10, legendary: 20, mythic: 30 }`. If the blessing has a skill icon and name (e.g. Giantization), set `buffs_skill: <skill id>` and mark it [LATER]. Otherwise it's a plain stat bonus with the hero icon. |

Parse the value text into a stat id where possible (`All DMG` → `all_dmg_increase`, matched against `data/stats.yaml`). Unmatched stat names are flagged so I can add them to the registry.

### 5.4 `heroes` — [Heroes](https://overgearedhero.fandom.com/wiki/Heroes) + each hero page

**Index:** read the `links` returned with the Heroes page, filtered to hero pages (the template `Template:Hero_List` lists 23). The Heroes page says there are 26 heroes, so report the mismatch every run.

**Rules from the Heroes page** (written to `data/heroes/wiki/rules.yaml`, then checked against `config.yaml`): base Supply Ability per grade (Rare 5, Epic 8, Legendary 10), +1 per star, stars 0–9, supply unlock stars (1, 3, 5, 7), skill link stars (4, 8). If any value differs from config, report it loudly; don't change config automatically.

**Each hero page** (`<Hero>`), fetched one at a time with the delay from §3:

| Source on the page | Output |
|---|---|
| `{{Hero Infobox}}`: `title`, `type`, `grade`, `supply_ability` | `name`, `class`, `rarity`, `base_supply_ability` (check against the rule) |
| `== Skills ==`: each `skill-block` (name in `skill-name`, text in `skill-description`) | `skills: [{ id, name, text }]` [LATER effects] |
| `== Exclusive Items ==`: each `exclusive-item-card` | `exclusive_items`: the item (resolved by sprite in `exclusive-item-output-icons`) and how it's obtained ("buy in Shop" or a merge recipe `A + B = C`). Also set `hero_exclusive: <hero>` on those items in the items output. |
| `{{Hero Supplies|grade=…|item1=…}}` | `supplies: [{ item, stars }]`. Star mapping comes from the template: Legendary item1–2 → 0, item3 → 1, item4 → 3, item5 → 5, item6 → 7; Epic item1 → 0, item2 → 1, item3 → 3, item4 → 5, item5 → 7; Rare item1 → 1, item2 → 3, item3 → 5, item4 → 7. Items resolved by sprite name. |
| `=== Skill Links ===`: `4: Skill Link Unlocked: [Name]` lines | `skill_links: { 4: <skill id>, 8: <skill id> }` |
| `{{Hero Ownership Effect}}` | ignored |
| `{{Hero Skin}}` | `skins: [{ name, obtainable }]` [LATER] |

### 5.5 `effects` — [Stats and Effects](https://overgearedhero.fandom.com/wiki/Stats_and_Effects)

**Layout:** tables with headers `Sprite | Stat | Description` under the sections Hero Stats, Weapon Stats, Effects, Buffs, Debuffs, Resistance & Immunity, Damage Modifiers, Removal & Cleansing; plus Enemy Traits with `Sprite | Trait | Description` and `! colspan="3"` category rows.

**Output:**

- Buffs, Debuffs, Resistance & Immunity, Damage Modifiers, Removal & Cleansing → `data/statuses/wiki/` with `name`, `category`, `kind` (buff/debuff/etc.), `description`, and any numbers parsed from the text (per-stack ratio, chance, interval, floors like "cannot be reduced below 25%").
- **These are compared against `data/statuses/manual/`, which holds my values.** Every difference is reported side by side. Known ones as of 2026-10-15:
  - Spike, Burn, Poison: wiki 0.01x ATK, manual 0.1x (wiki typo).
  - Vamp, Regen: wiki 0.01x HP, manual 0.005x (open question).
- Enemy Traits → `data/enemy_traits/wiki/`: `name`, `category` (from the colspan row above it), and `variants` (descriptions split on the `border-top` divider div). Description only; no effects.
- Hero Stats, Weapon Stats, Effects → stored as reference text only.

### 5.6 `pets` — [Pets](https://overgearedhero.fandom.com/wiki/Pets)

**Layout:** rules in prose (max 3 equipped, activation cost 1–3, 5 points per hero, max 6 stars) and one pet table.

- Headers: `Sprite | Name | Cost | Active Skill | Skill Description | Ownership Effect | Additional Effects by Grade`

| Wiki | Output | How |
|---|---|---|
| Name | `name`, `id`, `rarity` | grade span |
| Cost | `activation_cost` | count of `Icon-Activation Cost.png` icons |
| Active Skill | `skill_name` | text after the icon |
| Skill Description | `skill_text` | §6; spawned items ("summons 12 Venomous Spider Egg Sacks into your backpack") → `spawns: [{ item, count }]`, resolved against `pet_spawn` items |
| Ownership Effect | ignored | |
| Additional Effects by Grade | `star_effects` | one line per `<br>`; the number of star icons in front is the star level: `{ stars: 2, text: "Base Cooldown decreases by 2s." }`. Lines like "Activation Cost is decreased by 1" → `cost_change: -1`. |

The prose rules are checked against `config.yaml` like the hero rules.

## 6. Effects: two stages

Used by every mode that has effect text (items, gear, blessings, heroes, pets).

### 6.1 Stage 1 — normalised text (automatic)

Icons become tokens and markup is stripped, giving readable text such as:
`On {Filled Socket} Weapon Hit: Refunds 30% of Cooldown.`

### 6.2 Stage 2 — structured effects (rule-based draft + my review)

A small set of pattern rules turns common phrasings into the simulator's effect structure (SPEC §5.2). Start with:

| Phrase | Meaning |
|---|---|
| `On Hit:` | `on_hit` (this weapon hits) |
| `On Basic Attack Hit:` | `on_hit`, basic attack only (gear weapons) |
| `On Skill Hit:` | `on_skill_hit` |
| `On {Filled Socket} Weapon Hit:` | `on_weapon_hit`, from items under the dots, tag `weapon` |
| `Every Ns:` / `Activates every N seconds` | `timer`, interval N |
| `Start of Battle:` / `At Start of Battle` / `After start of battle within Ns` | `battle_start` (with delay N) |
| `When HP is below or equal to N%:` | `hp_below`, threshold N |
| `N% chance to` | `chance: N` |
| `Inflict N {Status}` | `apply_status` to enemy, N stacks |
| `Gain N {Status}` | `apply_status` to self, N stacks |
| `… for Ns` | `duration: N` |
| `{Stun} … for Ns` | stun with duration |
| `Removes Nx {Block}` | `remove_block`, ratio N of ATK |
| `Gain Nx {Block} Block` | `gain_block`, ratio N of HP |
| `{Heal} Heal Nx Max HP` | `heal`, ratio N of HP |
| `{Filled Socket} <Tag> <Stat> +N%` | `add_stat_pct` to items under the dots with that tag |
| `Deal Nx ATK DMG per hit, K times` | `deal_damage`, ratio N, `hits: K` |
| `Attack N times` | `hits: N` |

- A rule applies only if it covers the **whole sentence**. A partial parse is worse than none; anything not fully matched stays as text with `needs_review: true`.
- **Review mode** (`npm run scrape -- <mode> review`): a terminal loop over entries with `needs_review`, a new or changed effect, or an unresolved name. For each one it shows:
  - the name, page, and tab,
  - the footprint in ASCII (`#` filled, `o` socket, `.` empty) when there is one,
  - the raw wiki text,
  - the proposed structure as YAML, or for unresolved names, the closest matches.

  Keys: `a` accept, `e` edit in `$EDITOR`, `1`–`9` pick a suggested match, `s` skip, `q` quit and save progress. Answers are saved in `tools/wiki-scraper/reviewed.yaml` (keyed by id and a hash of the text) and `aliases.yaml`, and reused on later runs, so I only re-review entries whose wiki text changed.

## 7. Output and reporting

- **Data:** YAML files in `data/<category>/wiki/`. Validate with the simulator's zod schemas before writing; if validation fails, write nothing for that mode and print the errors.
- **Terminal report** at the end of every run, per mode:
  - Pages fetched (URLs) and cache files used.
  - Entry counts per table/tab.
  - A diff against the previous scrape: added, removed, and changed entries, with the changed fields.
  - Everything flagged: unparsed lines, new icons, unresolved or misspelled names, footprint problems, `scales_with: unknown`, `needs_manual` gear fields, named gear mechanics, rule mismatches against config, wiki-vs-manual status differences, duplicates, the hero count mismatch.
  - Effects auto-structured vs. needing review.
- The same report is saved to `tools/wiki-scraper/reports/<date>-<mode>.md`, and a summary is appended to `data/SOURCES.md` (date, URLs, what was extracted, which files changed).

## 8. Tech and commands

- TypeScript, run with `tsx`. Plain string handling and regexes; the markup is simple enough not to need a wikitext library.
- Commands:
  - `npm run scrape -- <mode> fetch` — download and cache.
  - `npm run scrape -- <mode> parse [--from-cache]` — parse, validate, write data, print the report.
  - `npm run scrape -- <mode> review` — interactive review (§6.2).
  - `npm run scrape -- all` — fetch and parse every mode.
  - `npm run scrape -- show <id>` — print one entry, with its ASCII footprint if it has one.
- **Tests** (Vitest), using real wikitext copied into `tests/fixtures/`:
  - Items: Spear, Whip (long socket row), Dagger, Stone Hammer (empty corner cell), Training Sword (flavour text), Poison Bug Egg (`?` value, Pet table).
  - Gear: Spiral Spear, Thunderbolt Spike (multi-hit, charge gauge), Everfrozen (named mechanic), Wooden Shield (once per battle), Frost Staff (no Gear Effect, grades start at Rare).
  - Blessings: one Common row, the Class table with rowspans, Bjorn's unique rows.
  - Heroes: Rose's page (infobox, skills, exclusive items with a merge recipe, Legendary supplies, skill links).
  - Effects: one row from each section, and an enemy trait with two variants.
  - Pets: Venomous Spider (spawns, star effects), Geezer (cost reduction).
  - Shared: icon tokens, rarity spans, star counting, name resolution including `Spell_Theif`, each Stage 2 pattern rule.

## 9. Build order

1. Shared machinery: fetch, cache, table splitter (with rowspan), icon tokens, rarity spans, report, `SOURCES.md`.
2. `items` mode, without effect structuring.
3. `effects` mode (statuses and the wiki-vs-manual comparison).
4. `heroes` mode.
5. `gear` mode, including image downloads.
6. `blessings` and `pets` modes.
7. Stage 2 pattern rules and review mode.

Stop after each step and show me the report from a real run.
