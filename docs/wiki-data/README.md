# Game data reference (from the wiki)

These markdown files were transcribed from the [Overgeared Hero wiki](https://overgearedhero.fandom.com) on 2026-10-15. **They're reference now, not the source of truth:** since 2026-11-07 the game data lives in one database per category (`data/<category>.yaml`), with the wiki's data and every correction merged in (corrections win; the wiki's value is kept under each entry's `corrections`). Change the databases, not these files.

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

## Converting to YAML (history)

Until 2026-11-07 these docs were converted into `data/<category>/wiki/*.yaml`, with `corrections.md` applied as `manual/` files on top. That converter is gone; the merged databases replaced both layers.

## Refreshing

`tools/wiki-dump/wiki_dump.py` regenerates these files from cached wiki pages. It's a quick script, not maintained tooling; if the wiki changes a lot, it's probably easier to ask Claude to redo the transcription.
