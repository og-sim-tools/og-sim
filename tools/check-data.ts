/**
 * Load data/ and profile/profile.yaml and print every error, warning, override and rename.
 *
 *   npm run check-data            # errors and warnings
 *   npm run check-data -- --all   # also every override and info line
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { formatIssue, loadProfile } from '../src/engine/loader';
import { readAccount } from '../src/engine/saves';
import { loadGameDataFromDir } from '../src/engine/loader-node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = process.argv.includes('--all');
const res = loadGameDataFromDir(join(ROOT, 'data'));
const d = res.data;

console.log(
  `Loaded ${d.items.size} items, ${d.gear.size} gear, ${d.heroes.size} heroes, ${d.skills.size} skills, ` +
    `${d.blessings.size} blessings, ${d.pets.size} pets, ${d.auras.size} auras, ${d.statuses.size} statuses, ` +
    `${d.enemy_traits.size} enemy traits, ${d.enemies.size} enemies, ${d.stats.size} stats.`,
);
const needShape = [...d.items.values(), ...d.gear.values()].filter((x) => x.shape === null).length;
console.log(`${needShape} items/gear still need a shape. ${res.overrides.length} manual overrides applied.`);

const shown = res.issues.filter((i) => all || i.level !== 'info');
for (const i of shown) console.log(formatIssue(i));
if (all) {
  console.log('\nOverrides:');
  const fmt = (v: unknown) => (v === undefined ? '(none)' : JSON.stringify(v));
  for (const o of res.overrides) {
    console.log(`  ${o.category}/${o.id} › ${o.field}: ${fmt(o.from)} → ${fmt(o.to)}  [${o.source}${o.verified ? ', verified' : ''}] ${o.file}:${o.line}`);
  }
}

const profilePath = join(ROOT, 'profile', 'profile.yaml');
// The account file (any version) with no build: hero ownership, stars, links and auras.
const account = readAccount(readFileSync(profilePath, 'utf8'));
for (const n of account.notes) console.log(`${n.level.toUpperCase()} profile/profile.yaml: ${n.message}`);
const profile = loadProfile({ path: 'profile/profile.yaml', text: stringify(account.profile) }, d);
for (const i of profile.issues) console.log(formatIssue(i));
console.log(profile.ok ? 'Profile OK.' : 'Profile has errors.');

if (!res.ok || !profile.ok) {
  console.log(`\n${res.errors.length} data error(s).`);
  process.exit(1);
}
console.log('Data OK.');
