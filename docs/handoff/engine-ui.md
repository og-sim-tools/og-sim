# Engine & UI session

Start a new chat with:

> Read CLAUDE.md, SPEC.md and docs/handoff/engine-ui.md, then work through the Backlog below. Push when done, with patch notes.

(Drop "Push when done" if you want to check first.)

## Where things stand (2026-11-07)

- Live at https://og-sim-tools.github.io/og-sim/ (org og-sim-tools, repo og-sim). Pushing `main` deploys through GitHub Pages.
- Batch of 2026-11-06 done (not pushed yet): 0.02 s ticks, no minimum cooldown, the hit queue, Primal Flame's cast time, Meow Mage (save version 8), and four UI fixes (see Backlog). 686 tests (`npm test`, about two minutes). Default test time limit is 20 s because tests load the game data. `tests/ui/app-saves.test.tsx` "opens the last build from version-1 files" sometimes times out in a full run (passes on its own); it did before this batch too.
- Save format is version 8. **Saves must always load**: any change to what's saved needs a SAVE_VERSION bump, a new migration step (never edit old ones) and frozen fixtures in `tests/fixtures/saves/vN`.
- 0.02 s ticks make a fight about 2x slower to compute than 0.1 s did (optimizer too), and results shift (trixie anti-raven vs its enemy: 98.7% → 88.7% wins over 300 runs).

## Map of the code

- **Engine:** `src/engine/combat/battle.ts` runs the fight. Item effect handlers are in `src/engine/effects/handlers.ts`, config schema in `src/engine/model/config.ts`, rules in `data/config.yaml`.
- **Build tab:** `src/ui/App.tsx` holds layout state and the bag box, with undo history in `editLayout` and the Ctrl shortcuts. Bag grid: `src/ui/components/BagGrid.tsx`; storage: `Storage.tsx`.
- **Dragging:** `src/ui/drag.tsx` handles pointer drags, drop targets, the held item layer and the drop slide. Bag edit rules live in `src/ui/state/bagEdit.ts`.
- **Battle tab:** `BattleTab.tsx` and `BattlePanel.tsx`. The tab stays mounted while hidden, so use its `visible` prop to reset things. Runs started from the Build tab come in through `runRequest`.
- **Optimizer:** `OptimizePanel.tsx` and `src/engine/optimize.ts`.
- **Settings (gear icon):** `src/ui/settings.ts`, stored in the browser only.

## Rules decided recently (don't re-ask)

- **Hat recasts.** Each hat rolls on its own, and recasts chain (they can trigger the hats again). Tool spells act again in the same tick; weapon spells go in the weapon's hit queue (0.02 s apart since 2026-11-06). Spells that read statuses (Instant Freeze, Charm) act once per tick, and extra activations are wasted, but Witch's Mirror still sees them. Safety cap: 50 recasts per item per tick. All of this is configured under `combat.recast` in `data/config.yaml`.
- **Crit Rate has no cap**, status crit rates included. At 100% or more every hit crits once, but anything that scales with Crit Rate keeps growing. Effects whose text says "(Max N%)" keep their own max.
- **Copies and gear go in even with no room**, overlapping (no warning).
- **Typing anywhere on the Build tab goes to the item search.** Space, the arrows and Delete are left for the bag.
- **Time and the hit queue (2026-11-06).** Ticks are 0.02 s; no minimum cooldown (an item still acts once a tick at most). Hits that come at once queue 0.02 s apart (`timing.hit_queue_seconds`): multi-hits, "Activates Burn N times", crit repeats, a weapon activated several times at once (its next attack's hits wait for the last one's). Gear skills can have a cast time (`skill.cast_s`); the timer keeps its rhythm (Primal Flame 8 s + 1.2 s → 9.2, 17.2 …).
- **Feline Mage is Meow Mage** (ids `meow_mage…`, saves version 8 rename the old ids; `docs/wiki-data` says Meow Mage too, the wiki URL stays Feline_Mage).

## Still open (ask me)

- ⚠ **Cast times and hit-queue spacing are only measured for Primal Flame** (user, 2026-11-06). Every other item and gear skill uses 0.02 s spacing and no cast time until the user data-mines the game for them. Also unknown: whether the basic attack keeps going during a cast (it does now), whether "On Skill Activation" effects fire when the cast starts or ends (they fire at the end now), and whether gauge skills have the cast too (they do now).

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

- [x] **No 0.1 s minimum cooldown; simultaneous hits queue 0.02 s apart** (user, 2026-11-06, one in-game test with Primal Flame). A weapon activated several times at once, or a status set off several times at once (Primal Flame's "Activates Burn 9 times"), sends its hits from a queue, one every 0.02 s.
- [x] **Primal Flame skill has a 1.2 s cast time** after its 8 s cooldown: the skill hit, and so the 9 Burns, start at 9.2 s. ⚠ **Only measured for Primal Flame.** Cast times and queue spacing are needed for every item and gear skill; the user plans to data-mine the game for them.
- [x] **Feline Mage is called Meow Mage** in game: rename every instance.

### UI

- [x] **Duplicate keeps rotation.** Ctrl+D / copy of a turned item → the copy comes back unturned → it should keep the rotation.
- [x] **Changing gear doesn't update the Gear box.** Change a gear piece → only the piece in the backpack is replaced, the Gear section still shows the old one → both should change.
- [x] **New build: option to duplicate the current build** (with its unsaved changes) into the new build.
- [x] **Shift+drag selection box starting on an item.** Shift+press on an item and drag → it grabs the item → it should draw the selection box. Shift+click several items → should add each to the selection.
- [x] **Remove the cell count after the word "Bag"**: the bag size dropdown already shows it.
