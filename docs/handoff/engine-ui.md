# Engine & UI session

Start a new chat with:

> Read CLAUDE.md, SPEC.md and docs/handoff/engine-ui.md, then work through the Backlog below. Push when done, with patch notes.

(Drop "Push when done" if you want to check first.)

## Where things stand (2026-11-06)

- Live at https://og-sim-tools.github.io/og-sim/ (org og-sim-tools, repo og-sim). Pushing `main` deploys through GitHub Pages.
- Latest commit 6d8df5d; 646 tests pass (`npm test`, about a minute). Default test time limit is 20 s because tests load the game data.
- Save format is version 6. **Saves must always load**: any change to what's saved needs a SAVE_VERSION bump, a new migration step (never edit old ones) and frozen fixtures in `tests/fixtures/saves/vN`.

## Map of the code

- **Engine:** `src/engine/combat/battle.ts` runs the fight. Item effect handlers are in `src/engine/effects/handlers.ts`, config schema in `src/engine/model/config.ts`, rules in `data/config.yaml`.
- **Build tab:** `src/ui/App.tsx` holds layout state and the bag box, with undo history in `editLayout` and the Ctrl shortcuts. Bag grid: `src/ui/components/BagGrid.tsx`; storage: `Storage.tsx`.
- **Dragging:** `src/ui/drag.tsx` handles pointer drags, drop targets, the held item layer and the drop slide. Bag edit rules live in `src/ui/state/bagEdit.ts`.
- **Battle tab:** `BattleTab.tsx` and `BattlePanel.tsx`. The tab stays mounted while hidden, so use its `visible` prop to reset things. Runs started from the Build tab come in through `runRequest`.
- **Optimizer:** `OptimizePanel.tsx` and `src/engine/optimize.ts`.
- **Settings (gear icon):** `src/ui/settings.ts`, stored in the browser only.

## Rules decided recently (don't re-ask)

- **Hat recasts.** Each hat rolls on its own, and recasts chain (they can trigger the hats again). Tool spells act again in the same tick; weapon spells queue one tick apart. Spells that read statuses (Instant Freeze, Charm) act once per tick, and extra activations are wasted, but Witch's Mirror still sees them. Safety cap: 50 recasts per item per tick. All of this is configured under `combat.recast` in `data/config.yaml`.
- **Crit Rate has no cap**, status crit rates included. At 100% or more every hit crits once, but anything that scales with Crit Rate keeps growing. Effects whose text says "(Max N%)" keep their own max.
- **Copies and gear go in even with no room**, overlapping (no warning).
- **Typing anywhere on the Build tab goes to the item search.** Space, the arrows and Delete are left for the bag.

## Still open (ask me)

- `docs/combat-mechanics.md` dates from 2026-10-16 and misses recasts and the crit-cap change; it needs updating.
- Unverified mechanics are marked `[UNVERIFIED]` in `data/config.yaml`: tick length, all-DMG stacking, additional damage multiplier, self HP-loss floor, mutual kill winner, Waterdrop rounding, Archwizard's Ring rate source, tag blessings.
- The Fight button on phones goes to the fight step, so the yellow "no enemy" box can't be seen there.
- Should [Fire] blessings count the flame tag?
- Should gear become account-wide?
- Confirm the chapter-repeat reading (repeat_from 10, repeat_every 25) and the raid placeholder boss.
- CP has no known formula, so it isn't shown.

## Tips for Claude

- Write multi-line edits with the Write tool or a Python script file. Bash heredocs with apostrophes break here.
- Every new behaviour gets a Vitest test; UI tests live in `tests/ui/`, engine tests in `tests/engine/`.
- When a test leaves a drag unfinished, later tests in the same file see a stuck drag. Always end a drag with pointerup.

## Backlog

Add items here. For each: what you did → what happened → what you expected (+ screenshot path). For mechanics: the rule plus one example with numbers, and whether you saw it in game.

### Engine

-

### UI

-
