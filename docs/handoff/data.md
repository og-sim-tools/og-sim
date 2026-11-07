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

- Stat calculation data: training level, gear level, pet levels per rarity, and the Power (CP) formula.
- Widow Spider: the dots are below as `## / ## / oo`. Flip it if the game has them on the other side.
- Venomous Spider 2★ "Base Cooldown decreases by 2s": which cooldown? Not simulated yet.

## Backlog

For each entry give the item / gear / pet name exactly as the game spells it, what's wrong, and the correct value (shape, numbers, text). Say whether you saw it in game; a screenshot path helps.

-
