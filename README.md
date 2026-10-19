# OG Backpack Simulator

**Open it here: https://og-sim-tools.github.io/og-sim/** (nothing to install, it runs in your browser)

A backpack and battle simulator for *Overgeared Hero: Merge RPG*. Enter your account once (stats, heroes,
blessings, pets, skins, auras), build bags in the Build tab, and test them in the Battle tab against monsters or
your other builds before you spend coins in the game. The Tutorial button walks you through every part.

## Your saves

- Everything you enter (your account and your saved builds) is kept **in your browser** on this site. Nothing is uploaded.
- **Export account** (top right) downloads one `.zip` with your account and every build. **Import account** brings it back
  on any browser or computer. Export now and then: clearing your browser data would delete your saves.
- The site always runs the latest version, and newer versions always load older saves.

## For developers

The full design is in [SPEC.md](SPEC.md). Game data lives in `data/` (see `docs/wiki-data/README.md`).

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173. Locally, saves are files in the project instead of browser storage: the account
is `profile/profile.yaml`, builds are `layouts/<name>.yaml`, and item editor changes go to
`data/<kind>/manual/user_edits.yaml`.

| Command | What it does |
|---|---|
| `npm run dev` | The app, saving to the project's files |
| `npm test` | All tests |
| `npm run sim -- battle layouts/<build>.yaml --runs 100` | Battles from the command line |
| `npm run build` | The static site, in `dist/` |
| `npm run site` | Builds the static site and serves it at http://127.0.0.1:4173, saving in the browser like the hosted one |

### Publishing

Every push to `main` runs `.github/workflows/deploy.yml`: it runs the tests, builds the site and publishes it on
GitHub Pages (repository **Settings → Pages → Source: GitHub Actions**). A failing test stops the publish.
A first visit starts with an empty account and one example build (`src/ui/starter/example.yaml`).

### Changing what's saved

A saved account or build must **never** become impossible to load in a newer version. If a change alters what
goes into the account or a build file:

1. raise `SAVE_VERSION` in `src/engine/saves/files.ts`,
2. add a migration step from the previous version in `src/engine/saves/migrate.ts` (never edit a released step),
3. add frozen example files of the new version in `tests/fixtures/saves/<version>/` (never edit old ones).

`tests/engine/saves.test.ts` loads every fixture of every version with the current code.
