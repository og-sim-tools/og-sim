import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DataLoadError,
  type Issue,
  type SourceFile,
  formatIssue,
  loadGameData,
  loadGameDataOrThrow,
  loadProfile,
  mergeEntry,
} from '../../src/engine/loader';
import { sellValue, slugify } from '../../src/engine/model';

const DATA = join(__dirname, '..', '..', 'data');
const BASE: SourceFile[] = [
  { path: 'config.yaml', text: readFileSync(join(DATA, 'config.yaml'), 'utf8') },
  { path: 'stats.yaml', text: readFileSync(join(DATA, 'stats.yaml'), 'utf8') },
];

const load = (...files: SourceFile[]) => loadGameData([...BASE, ...files]);
const f = (path: string, text: string): SourceFile => ({ path, text });
const errors = (issues: Issue[]) => issues.filter((i) => i.level === 'error');

const WIKI_ITEMS = `
- id: sword
  name: Sword
  rarity: rare
  tags: [weapon, sword]
  footprint: "# / # / #"
  stats:
    damage: { ratio: 1.5, scales_with: atk }
    cooldown: 2
    accuracy: 80
  effect_text: "On Hit: something."
  value: 5
  merges_into: [big_sword]
  source: wiki
  url: https://overgearedhero.fandom.com/wiki/Items
  verified: false
- id: big_sword
  name: Big Sword
  rarity: epic
  tags: [weapon]
  footprint: "o#o"
  value: 10
  components: [sword, sword]
  source: wiki
  url: https://overgearedhero.fandom.com/wiki/Items
  verified: false
  notes: from the wiki
`;

describe('loading wiki entries', () => {
  it('validates entries, fills defaults and parses footprints into cells', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS));
    expect(res.errors).toEqual([]);
    const sword = res.data.items.get('sword')!;
    expect(sword.kind).toBe('item');
    expect(sword.class_restriction).toEqual([]);
    expect(sword.shape).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
    expect(sword.dots).toEqual([]);
    expect(sword.meta.origins).toEqual(['items/wiki/a.yaml:2']);
    expect(sellValue(res.data.items.get('big_sword')!)).toBe(5);
  });

  it('names the file, line, entry and field of schema errors', () => {
    const res = load(
      f(
        'items/wiki/a.yaml',
        `- id: bad
  name: Bad
  rarity: mythic
  footprnt: "#"
  value: 1
  source: wiki
  verified: false
`,
      ),
    );
    const msgs = res.errors.map(formatIssue);
    expect(msgs.some((m) => m.startsWith('ERROR items/wiki/a.yaml:1 › bad › rarity:'))).toBe(true);
    expect(msgs.some((m) => /items\/wiki\/a\.yaml:1 › bad: Unrecognized key\(s\) in object: 'footprnt'/.test(m))).toBe(true);
    expect(res.data.items.has('bad')).toBe(false);
  });

  it('reports YAML syntax errors with the line', () => {
    const res = load(f('items/wiki/a.yaml', '- id: x\n  name: [unclosed\n'));
    expect(res.errors[0]!.file).toBe('items/wiki/a.yaml');
    expect(res.errors[0]!.line).toBeGreaterThan(0);
    expect(res.errors[0]!.message).toMatch(/YAML syntax error/);
  });

  it('rejects duplicate ids, naming both places', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('items/wiki/b.yaml', WIKI_ITEMS));
    expect(res.errors.map((e) => e.message)).toContain('Duplicate id (also at items/wiki/a.yaml:2).');
  });

  it('rejects items whose dots land on their own cells, naming the item and cells', () => {
    const res = load(
      f(
        'items/wiki/a.yaml',
        `- { id: bad, name: Bad, rarity: rare, shape: [[0, 0], [1, 0]], dots: [[1, 0]], value: 1, source: wiki, verified: false }\n`,
      ),
    );
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.message).toMatch(/"bad" \(Bad\): item dots land on the item's own cells at \(1,0\)/);
  });

  it('rejects footprint and shape on the same entry', () => {
    const res = load(
      f('items/wiki/a.yaml', `- { id: x, name: X, rarity: rare, footprint: "#", shape: [[0, 0]], value: 1, source: wiki, verified: false }\n`),
    );
    expect(res.errors[0]!.message).toMatch(/either `footprint` or `shape`/);
  });

  it('reports unknown references', () => {
    const res = load(
      f('items/wiki/a.yaml', `- { id: x, name: X, rarity: rare, value: 1, components: [nope], source: wiki, verified: false }\n`),
    );
    expect(res.errors.map(formatIssue)).toEqual(['ERROR items/wiki/a.yaml:1 › x › components.0: Unknown items id "nope".']);
  });

  it('warns about files outside <category>/wiki|manual', () => {
    const res = load(f('items/a.yaml', '[]'), f('weapons/wiki/a.yaml', '[]'));
    expect(res.issues.filter((i) => i.level === 'warning')).toHaveLength(2);
  });

  it('keeps items without a shape but marks them unplaceable', () => {
    const res = load(f('items/wiki/a.yaml', `- { id: x, name: X, rarity: rare, value: 1, source: wiki, verified: false }\n`));
    expect(res.data.items.get('x')!.shape).toBeNull();
  });

  it('throwing variant lists every error', () => {
    expect(() => loadGameDataOrThrow([...BASE, f('items/wiki/a.yaml', '- { id: x }\n')])).toThrow(DataLoadError);
    expect(() => loadGameDataOrThrow([f('items/wiki/a.yaml', '[]')])).toThrow(/Missing config\.yaml/);
  });
});

describe('manual overrides', () => {
  const MANUAL = `
- id: sword
  footprint: "o#"
  stats:
    damage: { ratio: 1.6 }
  merges_into: []
  effect_text: null
  source: observed
  verified: true
  notes: checked in-game
`;

  it('overrides field by field: objects merge, lists and values replace, null deletes', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('items/manual/m.yaml', MANUAL));
    expect(res.errors).toEqual([]);
    const s = res.data.items.get('sword')!;
    expect(s.stats.damage).toEqual({ ratio: 1.6, scales_with: 'atk' });
    expect(s.stats.cooldown).toBe(2);
    expect(s.merges_into).toEqual([]);
    expect(s.effect_text).toBe(''); // deleted, then the schema default
    expect(s.shape).toEqual([{ x: 0, y: 0 }]);
    expect(s.dots).toEqual([{ x: -1, y: 0 }]);
    // The entry's own provenance stays the wiki's; the overridden fields carry the manual provenance.
    expect(s.source).toBe('wiki');
    expect(s.verified).toBe(false);
    expect(s.notes).toBe('checked in-game');
    expect(s.meta.origins).toEqual(['items/wiki/a.yaml:2', 'items/manual/m.yaml:2']);
  });

  it('reports every override with old and new values', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('items/manual/m.yaml', MANUAL));
    const byField = Object.fromEntries(res.overrides.map((o) => [o.field, o]));
    expect(Object.keys(byField).sort()).toEqual(['effect_text', 'footprint', 'merges_into', 'stats.damage.ratio']);
    expect(byField['stats.damage.ratio']).toMatchObject({ from: 1.5, to: 1.6, source: 'observed', verified: true, file: 'items/manual/m.yaml', line: 2 });
    expect(byField['effect_text']!.to).toBeUndefined();
    expect(res.data.items.get('sword')!.meta.overrides).toHaveLength(4);
  });

  it('replaces geometry as a whole', () => {
    const res = load(
      f('items/wiki/a.yaml', WIKI_ITEMS),
      f('items/manual/m.yaml', `- { id: sword, shape: [[0, 0]], dots: [[1, 0]], source: observed, verified: true }\n`),
    );
    expect(res.errors).toEqual([]);
    expect(res.overrides.map((o) => o.field)).toEqual(['footprint', 'shape', 'dots']);
    expect(res.data.items.get('sword')!.dots).toEqual([{ x: 1, y: 0 }]);
  });

  it('adds manual-only entries', () => {
    const res = load(
      f('items/wiki/a.yaml', WIKI_ITEMS),
      f('items/manual/m.yaml', `- { id: new_thing, name: New, rarity: common, footprint: "#", value: 2, source: observed, verified: true }\n`),
    );
    expect(res.data.items.get('new_thing')!.source).toBe('observed');
  });

  it('validates the merged entry and names both files', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('items/manual/m.yaml', `- { id: sword, value: -3, source: observed, verified: true }\n`));
    expect(res.errors.map(formatIssue)[0]).toMatch(/^ERROR items\/wiki\/a\.yaml:2 \+ items\/manual\/m\.yaml:1 › sword › value:/);
  });

  it('warns when a manual entry changes nothing', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('items/manual/m.yaml', `- { id: sword, value: 5, source: observed, verified: true }\n`));
    expect(res.issues.some((i) => i.level === 'warning' && /overrides nothing/.test(i.message))).toBe(true);
  });

  it('renames with `replaces` and redirects references', () => {
    const res = load(
      f('items/wiki/a.yaml', WIKI_ITEMS),
      f('items/manual/m.yaml', `- { id: great_sword, replaces: big_sword, name: Great Sword, source: observed, verified: true }\n`),
    );
    expect(res.errors).toEqual([]);
    expect(res.data.items.has('big_sword')).toBe(false);
    const g = res.data.items.get('great_sword')!;
    expect(g.name).toBe('Great Sword');
    expect(g.meta.replaces).toBe('big_sword');
    expect(res.data.items.get('sword')!.merges_into).toEqual(['great_sword']);
    expect(res.data.aliases.items.get('big_sword')).toBe('great_sword');
    expect(res.issues.filter((i) => i.level === 'info').map((i) => i.message)).toEqual([
      'Renamed wiki entry "big_sword" to "great_sword".',
      'Reference "big_sword" redirected to renamed entry "great_sword".',
    ]);
  });

  it('rejects `replaces` of an unknown entry or onto an existing id, and duplicate manual entries', () => {
    const res = load(
      f('items/wiki/a.yaml', WIKI_ITEMS),
      f(
        'items/manual/m.yaml',
        `- { id: z, replaces: nope, source: observed, verified: true }
- { id: sword, replaces: big_sword, source: observed, verified: true }
- { id: big_sword, value: 11, source: observed, verified: true }
- { id: big_sword, value: 12, source: observed, verified: true }
`,
      ),
    );
    expect(errors(res.issues).map((e) => e.message)).toEqual([
      'No wiki entry "nope" to replace.',
      'Can\'t rename "big_sword" to "sword": a wiki entry already has that id.',
      'Duplicate manual entry (also at items/manual/m.yaml:3).',
    ]);
  });

  it('mergeEntry never touches provenance or id fields', () => {
    const recs: string[] = [];
    const out = mergeEntry({ id: 'a', source: 'wiki', verified: false, x: 1 }, { id: 'b', source: 'observed', verified: true, x: 2 }, (fld) => recs.push(fld));
    expect(out).toEqual({ id: 'a', source: 'wiki', verified: false, x: 2 });
    expect(recs).toEqual(['x']);
  });
});

describe('hero, blessing and profile checks', () => {
  const HEROES = `
- id: alpha
  name: Alpha
  class: warrior
  rarity: rare
  base_supply_ability: 6
  skills:
    - { id: smash, name: Smash, text: "" }
    - { id: bash, name: Bash, text: "" }
  skill_links: [{ stars: 4, skill: smash }, { stars: 8, skill: other }]
  supplies: [{ stars: 1, item: sword }]
  source: wiki
  verified: false
- id: beta
  name: Beta
  class: warrior
  rarity: rare
  base_supply_ability: 5
  skills: [{ id: smash, name: Smash, text: "" }]
  source: wiki
  verified: false
`;

  it('checks skill links, global skill ids, supply ability and supply stars', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('heroes/wiki/h.yaml', HEROES));
    const msgs = res.issues.map((i) => `${i.level} ${i.entry} ${i.field ?? ''} ${i.message}`);
    expect(msgs).toContain('error alpha skill_links.1.skill "other" is not one of Alpha\'s skills (smash, bash).');
    expect(msgs).toContain('error beta skills Skill id "smash" is also used by hero "alpha".');
    expect(msgs).toContain("warning alpha base_supply_ability 6 doesn't match the rare base in config (5).");
    expect(msgs.some((m) => m.startsWith('warning alpha supplies Supply unlock stars [1]'))).toBe(true);
  });

  it('checks that blessings buff a skill of their own hero', () => {
    const res = load(
      f('heroes/wiki/h.yaml', HEROES.replace('[{ stars: 1, item: sword }]', '[]')),
      f(
        'blessings/wiki/b.yaml',
        `- { id: beta_smash, name: Smash, kind: unique, hero: beta, buffs_skill: bash, unit: pct, values: { epic: { value: 5 } }, source: wiki, verified: false }
- { id: oops, name: Oops, kind: class, unit: pct, values: {}, source: wiki, verified: false }
`,
      ),
    );
    const msgs = errors(res.issues).map((i) => `${i.entry} ${i.field}: ${i.message}`);
    expect(msgs).toContain('beta_smash buffs_skill: Skill "bash" belongs to alpha, not beta.');
    expect(msgs).toContain('oops class: class blessings need a `class`');
    expect(msgs).toContain('oops values: needs at least one rarity');
  });

  it('loads a profile and checks every id it names', () => {
    const res = load(f('items/wiki/a.yaml', WIKI_ITEMS), f('heroes/wiki/h.yaml', HEROES));
    const ok = loadProfile(
      f('profile.yaml', `basic_stats: { hp: "4M", atk: "1.34M", initial_block: 812.5K }\ndetailed_stats: { crit_rate: 50 }\nheroes: [{ id: alpha, stars: 3, links: [bash] }]\nactive_hero: alpha\n`),
      res.data,
    );
    expect(ok.issues).toEqual([]);
    expect(ok.profile!.gear.rings).toEqual([]);

    const bad = loadProfile(
      f(
        'profile.yaml',
        `basic_stats: { hp: "4M", atk: "1.34M", initial_block: "1.4MM" }\n`,
      ),
      res.data,
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]!.field).toBe('basic_stats.initial_block');

    const refs = loadProfile(
      f(
        'profile.yaml',
        `basic_stats: { hp: 1, atk: 1, initial_block: 0 }
detailed_stats: { nope: 1, hp: 2, dmg_reduction: 5 }
heroes: [{ id: alpha, stars: 12, links: [zzz] }]
active_hero: beta
gear: { weapon: { id: no_gear, rarity: epic } }
pets: [{ id: no_pet, stars: 1 }]
aura: no_aura
`,
      ),
      res.data,
    );
    expect(refs.issues.map((i) => `${i.field}: ${i.message}`)).toEqual([
      'detailed_stats.nope: Unknown stat "nope" (not in data/stats.yaml).',
      'detailed_stats.hp: "hp" is a basic stat; put it under basic_stats.',
      'detailed_stats.dmg_reduction: "dmg_reduction" isn\'t on the Stat Details screen.',
      'heroes.0.stars: Stars must be 0–9.',
      'heroes.0.links.0: Unknown skill "zzz".',
      'active_hero: "beta" is not among the heroes listed in the profile.',
      'gear.weapon.id: Unknown gear "no_gear".',
      'pets.0.id: Unknown pet "no_pet".',
      'aura: Unknown aura "no_aura".',
    ]);
  });
});

describe('ids', () => {
  it('slugifies display names', () => {
    expect(slugify("Hero's Longsword")).toBe('heros_longsword');
    expect(slugify('Transformation Magic: Charm')).toBe('transformation_magic_charm');
    expect(slugify('Mr. Snowman')).toBe('mr_snowman');
    expect(slugify("That's Mine!")).toBe('thats_mine');
    expect(slugify('[Rock] & [Trap] Weapon DMG')).toBe('rock_trap_weapon_dmg');
  });
});
