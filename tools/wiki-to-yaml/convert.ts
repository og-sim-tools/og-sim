/**
 * Convert docs/wiki-data/*.md into data/<category>/wiki/*.yaml.
 *
 *   npm run convert-wiki
 *
 * Only writes wiki/ folders (regenerated whole); never touches manual/. Prints everything it
 * flagged. Reads local files only — no web requests.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWikiYaml } from './build';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = join(ROOT, 'docs', 'wiki-data');
const DATA = join(ROOT, 'data');

const res = buildWikiYaml((name) => readFileSync(join(DOCS, name), 'utf8'));

for (const category of new Set(res.files.map((f) => f.category))) {
  const dir = join(DATA, category, 'wiki');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.yaml')) rmSync(join(dir, f));
}
console.log('Wrote:');
for (const f of res.files) {
  writeFileSync(join(DATA, f.path), f.content);
  console.log(`  data/${f.path} (${f.count})`);
}
console.log(`\nBlessing slots by level (for config.yaml): ${JSON.stringify(res.blessingSlotsByLevel)}`);
console.log(`\nFlags (${res.flags.length}):`);
for (const f of res.flags) console.log(`  ${f.file} › ${f.entry}: ${f.message}`);
