# Game data reference (from the wiki)

These markdown files are the **source of truth for game data** until it's converted to YAML in `data/`. They were transcribed from the [Overgeared Hero wiki](https://overgearedhero.fandom.com) on 2026-10-15.

| File | Contents |
|---|---|
| [items.md](items.md) | All 222 shop items by class (Universal, Warrior, Ranger, Wizard) plus the 6 pet-spawned items: rarity, tags, stats, effect, footprint with item dots, price, merge recipes, hero-exclusive marks |
| [gear.md](gear.md) | Gear slots, rarity/tier rules, all 38 gear pieces (weapons, shields, rings, gloves) with skills, gear effects, and effects by rarity; auras |
| [heroes.md](heroes.md) | All 23 heroes by class: rarity, base Supply Ability, skills, skill link order, exclusive items, supplies by star |
| [blessings.md](blessings.md) | Blessing slots by level; common, class, and unique blessings with values per rarity |
| [pets.md](pets.md) | All 28 pets: rarity, activation cost, active skill, star effects, and whether they matter for the MVP |
| [statuses.md](statuses.md) | Stats, buffs, debuffs, resistances, immunities, damage modifiers, removal effects, Berserk, and enemy traits — with my overrides |
| [corrections.md](corrections.md) | **My confirmed fixes and additions. Overrides every other file.** Missing items, shape/effect fixes, name variants |
| [REVIEW.md](REVIEW.md) | What was wrong with the wiki, what's resolved, what's still open |

## Conventions

- **Footprints:** `#` occupied cell, `o` item dot, `.` empty; rows separated by ` / `, top row first, unrotated.
- **`[dot]`** in effect text = "the items under this item's dots" (the wiki's socket icon).
- **Ratios:** `1.5x ATK` = 1.5 × ATK. Heals, HP, and Block gains scale with HP; Block removal scales with ATK.
- **❓** = a name the wiki references that matches no item (most are now in corrections.md §1).
- **🔒Hero** = hero-exclusive item.
- **`x`** in a skill = a value the wiki doesn't give (needs an in-game observation).
- **Where my observations disagree with the wiki, mine win.** Those are marked in statuses.md and listed in REVIEW.md.

## Converting to YAML (Claude Code)

When building phase 2, Claude Code converts these docs into `data/<category>/wiki/*.yaml`:

- Copy names, numbers, and footprints exactly, then apply `corrections.md` on top (as `manual/` entries). Don't fix anything else listed in REVIEW.md until I've answered it.
- Effects stay as text (`effect_text`) at first. Turning them into structured effects (SPEC §5.2) is done in small batches I review.
- Every entry gets `source: wiki`, the page URL, and `verified: false`.

## Refreshing

`tools/wiki-dump/wiki_dump.py` regenerates these files from cached wiki pages. It's a quick script, not maintained tooling; if the wiki changes a lot, it's probably easier to ask Claude to redo the transcription.
