# Data corrections session

Start a new chat with:

> Read CLAUDE.md, docs/wiki-data/README.md, docs/wiki-data/corrections.md, docs/wiki-data/REVIEW.md and docs/handoff/data.md, then work through the Backlog below. Push when done, with patch notes.

## How data works

- **Game data** lives in `data/` (items, gear, pets, skins, heroes, statuses, enemies, auras, blessings).
  - `wiki/` folders hold what came from the wiki.
  - `manual/` folders hold corrections and effects, and override the wiki field by field.
- **Shape and value corrections** go in `data/items/manual/corrections.yaml` with `source: observed` and `verified: true`, plus a comment giving the date and what the wiki said. Example: Widow Spider `## / ## / oo` (2026-10-22).
- **Item effects** live in `data/items/manual/effects_batch_*.yaml`, and gear effects in `data/gear/manual/`. They use generic effect types only; nothing item-specific goes in the engine code.
- **Your in-game numbers beat the wiki.** Claude keeps your value and tells you about the conflict.
- **Anything from the web** gets `source: wiki`, its URL and `verified: false`, and is logged in `data/SOURCES.md`. Claude reports every fetch (URL, what it took, anything unclear) and never fixes a misspelled name on its own.
- **Unknown values** aren't guessed; they're left out or flagged where you can see them.
- **Check with** `npm test` (the loader tests catch broken data) and the Data tab in the app.

## Facts to keep

- S-rank gear starts at epic. S gear numbers you quote already include the rare-and-below bonuses.
- Pets: in-game values beat the wiki, and the values shown include stars. Repeated "+%" bonuses add up. Pets ignore haste and Freeze.
- "Additionally increases by Y%" adds points (15% becomes 35%).
- Blood Moon Familiar: a skin item that isn't released yet. Its shape (`#`) is a guess and it has no image; finish it on release.
- Raid builds use gear and starting equipment only (no shop items).
- Stats are calculated (gear + blessings + auras). Only HP, ATK and Initial Block are typed in.

## Still open (ask me)

- **Training rank names:** `data/training.yaml` uses the CSV's names (Apprentice, Adventurer, Elite, Master, Warrior, GMaster, Hero). What does the game show? (You wrote "Champion 12"; is that Warrior?) Only `name:` needs changing.
- **Training formula check:** a stat = rank bonus + its own track at tier 10 × rank level + its upgrades; "Defence" = Initial Block. Confirm with one in-game training number.
- **Blood Moon Familiar:** sprite drawn from your screenshot; its shape (`#`, one cell) is still a guess. Is it one cell in game?
- **Calculated stats, still stubs:** gear HP / ATK / Block (formula unknown); pet levels (the wiki's Pet Food table has HP / ATK per level, but pet levels aren't in the profile yet and the table's rarity is unclear, see SOURCES 2026-10-19); pet ownership "+x% Total HP / ATK"; hero ownership effects; how HP % / ATK % lines apply. Power (CP): not needed (user, 2026-11-06).

## Done

- 2026-11-06: Widow Spider dots confirmed below (`## / ## / oo`).
- 2026-11-06: Venomous Spider 2★ "Base Cooldown decreases by 2s" = the hatched spiders' cooldown, small and big (6s → 4s), via the generic pet field `spawn_cooldown_delta`.
- 2026-11-06: Combat Training from the user's CSVs (`data/training.yaml`, regenerate with `tools/training-csv/convert.py`); Profile tab "Type in / Calculate" for HP / ATK / Block (save version 7). Calculated mode always warns that gear isn't counted.

- 2026-11-06: Flame Staff base cooldown 2.6s (in game; wiki 2.1).
- 2026-11-06: unique blessings: the value is fixed to the wiki's per rarity (not typed in); a differing saved value shows a "Use x" button.
- 2026-11-06: one of each pet (picker greys out pets in another slot; validation error `pet_duplicate`).
- 2026-11-06: pet and skin spawns are real items in the bag while the pet / skin skill is on (first free spots, movable, removed when turned off; no room = placed at the start of battle as before). Blood Moon Familiar sprite redrawn from the user's screenshot.

## Backlog

For each entry give the item / gear / pet name exactly as the game spells it, what's wrong, and the correct value (shape, numbers, text). Say whether you saw it in game; a screenshot path helps.

-
