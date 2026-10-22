# CLAUDE.md

Overgeared Hero backpack simulator. The full design is in `SPEC.md` — read it before starting any task. Game data lives in `docs/wiki-data/` (read its README, corrections.md, and REVIEW.md before touching data; corrections.md overrides the wiki).

## Rules
- Work one phase from SPEC.md §9 at a time. Stop after each phase and summarize; don't start the next until I say so.
- Items, gear, statuses, pets, and enemies live in `data/`. Never hardcode item-specific behaviour in engine code (pets are the one exception, see SPEC §4.7). If something needs new logic, add a generic effect type.
- Mechanics marked [UNVERIFIED] must stay configurable via `data/config.yaml`. Don't build anything marked [LATER] unless I ask.
- Keep "item effects" and "status effects" separate in code and naming.
- The classes are Warrior, Ranger, and Wizard (`wizard`). "Mage" is a hero, not a class.
- All randomness goes through `src/engine/rng.ts` with an explicit seed.
- Every new behaviour gets a Vitest test. Run the tests before saying a task is done.
- If a requirement is ambiguous or contradicts SPEC.md, ask me rather than guessing.

## Wiki and outside data — always report it
The game wiki may be outdated or badly translated, so I need to monitor everything taken from it.
- **Every time you fetch data from the wiki or any other website, tell me in your reply:** the URL, exactly what you extracted (item names, numbers, rules), and anything that looked unclear, contradictory, or mistranslated.
- Never silently fill in data from the web. If you're unsure what a translated description means, quote the original text and ask me.
- Watch for misspellings in names and references (e.g. `Spell_Theif`). Never fix them automatically: show me the misspelled name with your best guess and let me confirm.
- Where wiki numbers disagree with my in-game observations, keep my values and tell me about the conflict.
- Mark every entry that came from the web with `source: wiki`, the URL, and `verified: false`.
- Append each fetch to `data/SOURCES.md`: date, URL, what was extracted, and which data files changed.

## Pushing
- Whenever I ask you to push a patch, finish your reply with brief patch notes I can post on my community Discord: short, player-facing bullet points (what changed and how to use it), no code or file names, under 2000 characters (one Discord message), in a code block so the formatting copies.

## Commands
- Dev server: `npm run dev`
- Tests: `npm test`
- Headless sim: `npm run sim -- <command> <layout>`
