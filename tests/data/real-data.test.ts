/** The real data/ folder: loads cleanly, corrections are applied, generated files are up to date. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { applySetup } from '../../src/engine/layoutSetup';
import { loadProfile } from '../../src/engine/loader';
import { buildLoadout } from '../../src/engine/loadout';
import { readAccount, readBuild } from '../../src/engine/saves';
import { aggregateStats } from '../../src/engine/stats';
import { supplySummary, validateLoadout } from '../../src/engine/validate';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildWikiYaml } from '../../tools/wiki-to-yaml/build';

const ROOT = join(__dirname, '..', '..');
const res = loadGameDataFromDir(join(ROOT, 'data'));
const d = res.data;

describe('real game data', () => {
  it('loads without errors', () => {
    expect(res.errors).toEqual([]);
  });

  it('has the expected number of entries', () => {
    expect(d.items.size).toBe(222 + 9 + 1); // wiki + items added in corrections.md §1 + Blood Moon Familiar (skin)
    expect(d.skins.size).toBe(7 + 4 + 3); // wiki skins with skills + Summer (enemy only) + upcoming from screenshots
    expect(d.gear.size).toBe(38);
    expect(d.heroes.size).toBe(23);
    expect(d.skills.size).toBe(46);
    expect(d.blessings.size).toBe(13 + 9 + 40);
    expect(d.pets.size).toBe(28);
    expect(d.auras.size).toBe(6);
    expect(d.statuses.size).toBe(13 + 7); // + gear mechanics (Frostbite, Divine Grace, …) and Evade
    expect(d.enemy_traits.size).toBe(70);
  });

  it('marks every wiki entry with source, URL and verified: false', () => {
    for (const map of [d.items, d.gear, d.heroes, d.blessings, d.pets, d.auras, d.statuses, d.enemy_traits]) {
      for (const e of map.values() as Iterable<{ source: string; url?: string; verified: boolean; meta: { origins: string[] } }>) {
        if (e.meta.origins[0]!.includes('/wiki/')) {
          expect(e.source).toBe('wiki');
          expect(e.url).toMatch(/^https:\/\/overgearedhero\.fandom\.com\/wiki\//);
          expect(e.verified).toBe(false);
        }
      }
    }
  });

  it('applies corrections.md field by field (Spider Fang)', () => {
    const fang = d.items.get('spider_fang')!;
    expect(fang.shape).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    expect(fang.dots).toHaveLength(6);
    expect(fang.effect_text).toMatch(/Poison Inflict \+15%/);
    expect(fang.stats.damage).toEqual({ ratio: 0.8, scales_with: 'atk' }); // still the wiki's
    const fromCorrections = fang.meta.overrides.filter((o) => o.file === 'items/manual/corrections.yaml');
    expect(fromCorrections.map((o) => o.field)).toEqual(['footprint', 'effect_text']);
    expect(fromCorrections.every((o) => o.source === 'observed' && o.verified)).toBe(true);
  });

  it('renames Deluge to Heavy Rain and redirects its references', () => {
    expect(d.items.has('transformation_magic_deluge')).toBe(false);
    const rain = d.items.get('transformation_magic_heavy_rain')!;
    expect(rain.name).toBe('Transformation Magic: Heavy Rain');
    expect(rain.merges_into).toEqual([]);
    expect(rain.tags).toEqual(['tool', 'spell']);
    expect(d.items.get('transformation_magic_drizzle')!.merges_into).toEqual(['transformation_magic_heavy_rain']);
    expect(d.heroes.get('feline_mage')!.supplies.find((s) => s.stars === 7)!.item).toBe('transformation_magic_heavy_rain');
  });

  it('applies the other confirmed fixes', () => {
    expect(d.items.get('large_crow')!.value).toBe(15);
    expect(d.items.get('flame_robe')!.components).toEqual(['leather_armor', 'blazing_hound']);
    expect(d.items.get('clone_potion')!.effect_values.heal!.ratio).toBe(0.15);
    expect(d.items.get('true_sight')!.components).toEqual(['trackers_bow', 'hawk_feather_talisman']);
    expect(d.items.get('plate_helmet')!.dots).toEqual([{ x: -1, y: 0 }]);
    expect(d.statuses.get('vamp')!.amount_per_stack).toEqual({ ratio: 0.005, scales_with: 'hp', of: 'holder' });
    expect(d.statuses.get('burn')!.amount_per_stack).toEqual({ ratio: 0.1, scales_with: 'atk', of: 'inflicter' });
    expect(d.blessings.get('venom_poison_trigger_interval')!.values.mythic).toEqual({ value: -0.6 });
    expect(d.blessings.get('bjorn_gigantization')!.buffs_skill).toBe('gigantization');
    expect(d.blessings.has('erwen_spirit_gain')).toBe(true);
    // Golem un-ignored by the user once in-game data showed a Start of Battle trigger.
    expect(d.pets.get('golem')!.ignored).toBe(false);
    expect(d.gear.get('elderwood_bow')!.gear_effect_text).toBe('On Basic Attack Hit: Inflict 1 Poison.');
  });

  it('every item and gear piece reachable from corrections has a valid shape', () => {
    for (const id of ['big_spike', 'steel_spike', 'lithinum', 'lithinum_greatshield', 'spirit_stone', 'erwens_bow', 'fire_spirit', 'wind_spirit', 'greatdog']) {
      expect(d.items.get(id)!.shape, id).not.toBeNull();
    }
    expect([...d.gear.values()].every((g) => g.shape !== null)).toBe(true);
    expect([...d.items.values()].every((i) => i.shape !== null)).toBe(true);
  });

  it('only warns about the [Fire] blessings (no item is tagged "fire")', () => {
    // "Also set at …" = my editor edits overriding an earlier manual file, which is expected.
    const warnings = res.issues.filter((i) => i.level === 'warning' && !i.message.startsWith('Also set at'));
    expect(warnings.map((w) => w.entry).sort()).toEqual(['fire_mage_fire_magic_dmg', 'fire_magic_dmg']);
  });

  it('gives gear that shares a name with an item a _gear id', () => {
    expect(d.gear.get('wooden_shield_gear')!.name).toBe('Wooden Shield');
    expect(d.gear.get('spiked_shield_gear')!.name).toBe('Spiked Shield');
    expect(d.gear.has('wooden_shield')).toBe(false);
    for (const id of d.gear.keys()) expect(d.items.has(id), id).toBe(false);
  });

  it('tags every gear weapon as a weapon, with its type where known', () => {
    const weapons = [...d.gear.values()].filter((g) => g.slot === 'weapon');
    expect(weapons).toHaveLength(20);
    for (const w of weapons) expect(w.tags, w.id).toContain('weapon');
    const type = (id: string) => d.gear.get(id)!.tags.filter((t) => t !== 'weapon');
    expect(type('spiral_spear')).toEqual(['spear']);
    expect(type('omnicleaver')).toEqual(['spear']);
    expect(type('primal_flame')).toEqual(['sword']);
    expect(type('thunderbolt_spike')).toEqual(['sword']);
    expect(type('staff_of_vitality')).toEqual(['staff']);
    expect(type('everfrozen')).toEqual(['staff']);
    expect(type('elderwood_bow')).toEqual(['bow']);
    expect(type('deathrattle')).toEqual(['bow']);
    expect(type('meteor_hammer')).toEqual(['blunted']);
    expect(type('divine_smite')).toEqual(['blunted']);
    // The Elderwood Bow keeps its other corrections from the same manual entry.
    expect(d.gear.get('elderwood_bow')!.gear_effect_text).toBe('On Basic Attack Hit: Inflict 1 Poison.');
  });

  it('gives Greatdog a 2.99x ratio inside its observation range', () => {
    expect(d.items.get('greatdog')!.stats.damage).toMatchObject({ ratio: 2.99, scales_with: 'atk' });
  });

  it('lowers pet activation cost from star effects', () => {
    expect(d.pets.get('red_dragon')!.star_effects.find((s) => s.stars === 1)!.activation_cost_delta).toBe(-1);
    expect(d.pets.get('geezer')!.star_effects.find((s) => s.stars === 5)!.activation_cost_delta).toBe(-1);
  });

  it('loads effects batches 1 and 2 as unverified manual overrides', () => {
    const withEffects = [...d.items.values()].filter((i) => i.effects.length > 0);
    // Every item with effect text is fully simulated (batches 1–5; shop-only and flavour texts have no battle effects).
    const notDone = [...d.items.values()].filter((i) => i.effect_text.trim() && i.effects_status !== 'complete').map((i) => i.id);
    expect(notDone).toEqual([]);
    expect(withEffects.length).toBeGreaterThan(200);
    for (const i of withEffects) {
      const rec = i.meta.overrides.find((o) => o.field === 'effects') ?? { verified: i.verified, source: i.source }; // manual-only items have no wiki layer
      // My readings are unverified; effects confirmed from the user's in-game screenshots are 'observed' and verified.
      expect(rec.verified, i.id).toBe(rec.source === 'observed');
      expect(i.effects_status, i.id).toMatch(/^(partial|complete)$/);
      for (const e of i.effects) expect(i.effect_text.replace(/\s+/g, ' '), i.id).toContain(e.text!);
    }
  });

  // profile/ and layouts/ are the user's own files (edited from the app), so only check they load and
  // every placed item is known and in the bag — not which hero, items or numbers they hold.
  // Skipped where the personal files aren't checked out (e.g. a public repo without them).
  const mine = existsSync(join(ROOT, 'profile', 'profile.yaml')) && existsSync(join(ROOT, 'layouts', 'example.yaml'));
  it.skipIf(!mine)('validates and aggregates the saved example layout', () => {
    // Either file may be in any saved-file version (src/engine/saves).
    const account = readAccount(readFileSync(join(ROOT, 'profile', 'profile.yaml'), 'utf8'));
    const layout = readBuild(readFileSync(join(ROOT, 'layouts', 'example.yaml'), 'utf8'), { v1Profile: account.migratedFromV1 }).layout;
    const loadout = buildLoadout(d, applySetup(account.profile, layout.setup), layout);
    const codes = validateLoadout(loadout).map((i) => i.code);
    for (const bad of ['unknown_item', 'out_of_bounds', 'masked_cell', 'overlap', 'bad_footprint', 'needs_shape']) expect(codes).not.toContain(bad);
    const stats = aggregateStats(loadout).items;
    expect(stats.size).toBe(layout.placements.length);
    expect(supplySummary(loadout) === null || supplySummary(loadout)!.capacity > 0).toBe(true);
  });

  it.skipIf(!mine)('loads my profile and every saved layout without problems', () => {
    const account = readAccount(readFileSync(join(ROOT, 'profile', 'profile.yaml'), 'utf8'));
    expect(account.notes.filter((n) => n.level === 'warning')).toEqual([]);
    expect(loadProfile({ path: 'profile/profile.yaml', text: stringify(account.profile) }, d).issues).toEqual([]);
    for (const f of readdirSync(join(ROOT, 'layouts')).filter((x) => x.endsWith('.yaml'))) {
      const r = readBuild(readFileSync(join(ROOT, 'layouts', f), 'utf8'), { v1Profile: account.migratedFromV1 });
      expect(r.notes.filter((n) => n.level === 'warning'), f).toEqual([]);
    }
  });

  it('generated wiki YAML is in sync with docs/wiki-data (run `npm run convert-wiki` if this fails)', () => {
    const built = buildWikiYaml((name) => readFileSync(join(ROOT, 'docs', 'wiki-data', name), 'utf8'));
    const onDisk = new Map(readDataDir(join(ROOT, 'data')).filter((f) => f.path.includes('/wiki/')).map((f) => [f.path, f.text]));
    expect([...onDisk.keys()].sort()).toEqual(built.files.map((f) => f.path).sort());
    for (const f of built.files) expect(onDisk.get(f.path), f.path).toBe(f.content);
  });
});
