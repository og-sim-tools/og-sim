# OG Backpack Simulator

A backpack and battle simulator for *Overgeared Hero: Merge RPG*. Place items in the bag, set up your hero,
blessings, gear, pets and skins, and test the build against monsters or other players' builds before you
spend coins in the game.

The full design is in [SPEC.md](SPEC.md). Game data lives in `data/` (see `docs/wiki-data/README.md`).

## Using the hosted site

Everything you enter (your account and your saved builds) stays **in your browser** on that site. Nothing is
uploaded. Use **Export account** (top right) now and then: it downloads one `.zip` with your account and every
build, which **Import account** brings back on any browser or computer. Every saved file says which format
version it is, and newer versions of the simulator always load older files.

## Running it on your own computer

```bash
npm install
npm run dev
```

Then open the address it prints (http://127.0.0.1:5173). Locally, saves are files in the project instead of
browser storage: the account is `profile/profile.yaml`, builds are `layouts/<name>.yaml`, and item editor
changes go to `data/<kind>/manual/user_edits.yaml`.

| Command | What it does |
|---|---|
| `npm run dev` | The app, saving to the project's files |
| `npm test` | All tests |
| `npm run sim -- battle layouts/example.yaml --runs 100` | Battles from the command line |
| `npm run build` | The static site, in `dist/` |
| `npm run site` | Builds the static site and serves it at http://127.0.0.1:4173, saving in the browser like the hosted one |

## Publishing on GitHub Pages (free)

1. Create a repository on GitHub and push this project to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`: it runs the tests, builds the site and publishes it
   at `https://<your-user>.github.io/<repository>/`. A failing test stops the publish.

A first visit to the site starts with an empty account and one example build (`src/ui/starter/example.yaml`).

## Changing what's saved

A saved account or build must **never** become impossible to load in a newer version. If a change alters what
goes into the account or a build file:

1. raise `SAVE_VERSION` in `src/engine/saves/files.ts`,
2. add a migration step from the previous version in `src/engine/saves/migrate.ts` (never edit a released step),
3. add frozen example files of the new version in `tests/fixtures/saves/<version>/` (never edit old ones).

`tests/engine/saves.test.ts` loads every fixture of every version with the current code.
