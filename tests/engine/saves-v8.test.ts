/**
 * Version 8 (user, 2026-11-06): the wiki's "Feline Mage" is called "Meow Mage" in game, so its ids are renamed
 * (hero, blessings, skin). Frozen version-8 fixtures load the same as version 7.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { readAccount, readBuild, writeAccount, writeBuild } from '../../src/engine/saves';

const ROOT = join(__dirname, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'saves');
const read = (...p: string[]) => readFileSync(join(FIX, ...p), 'utf8');
const yamls = (...p: string[]) => readdirSync(join(FIX, ...p)).filter((f) => f.endsWith('.yaml'));

describe('frozen version-8 saves', () => {
  it('every one loads without notes and the same as version 7', () => {
    const acc = readAccount(read('v8', 'profile.yaml'));
    expect(acc.version).toBe(8);
    expect(acc.notes).toEqual([]);
    expect(acc.profile).toEqual(readAccount(read('v7', 'profile.yaml')).profile);
    expect(acc.profile.heroes.some((h) => h.id === 'meow_mage')).toBe(true);
    for (const f of yamls('v8', 'builds')) {
      const r = readBuild(read('v8', 'builds', f));
      expect(r.version, f).toBe(8);
      expect(r.notes, f).toEqual([]);
      if (yamls('v7', 'builds').includes(f)) expect(r.layout, f).toEqual(readBuild(read('v7', 'builds', f)).layout);
    }
  });
});

describe('Feline Mage is Meow Mage', () => {
  it('version 7 → 8 renames every Feline Mage id (hero, blessings, skin) and nothing else', () => {
    const v7 = [
      'version: 7',
      'heroes:',
      '  - id: feline_mage',
      '    stars: 3',
      '    blessings: { level: 9, equipped: [{ id: feline_mage_meow, rarity: epic, value: 1 }, { id: feline_mage_item_haste, rarity: epic, value: 5 }, { id: all_dmg, rarity: epic, value: 7 }] }',
      'skins: [{ id: feline_mage_cool_splash, stars: 2 }]',
      '',
    ].join('\n');
    const acc = readAccount(v7);
    expect(acc.notes).toEqual([]);
    const h = acc.profile.heroes.find((x) => x.id === 'meow_mage')!;
    expect(h.blessings?.equipped.map((b) => b.id)).toEqual(['meow_mage_meow', 'meow_mage_item_haste', 'all_dmg']);
    expect(acc.profile.skins.map((s) => s.id)).toEqual(['meow_mage_cool_splash']);
    expect(writeAccount(acc.profile, null)).not.toMatch(/feline/);
    const b = readBuild('version: 7\nhero: feline_mage\nplacements: []\n');
    expect(b.layout.hero).toBe('meow_mage');
    expect(writeBuild(b.layout)).not.toMatch(/feline/);
  });

  it('the game data calls it Meow Mage, with its blessings and skin', () => {
    const d = loadGameDataFromDir(join(ROOT, 'data')).data;
    expect(d.heroes.get('meow_mage')!.name).toBe('Meow Mage');
    expect(d.heroes.has('feline_mage')).toBe(false);
    expect(d.blessings.get('meow_mage_meow')).toBeDefined();
    expect(d.blessings.get('meow_mage_item_haste')).toBeDefined();
    expect(d.skins.get('meow_mage_cool_splash')).toBeDefined();
  });
});
