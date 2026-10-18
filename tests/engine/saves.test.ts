/**
 * Saved files must always load in newer versions (user's hard rule, 2026-10-18): every frozen fixture in
 * tests/fixtures/saves/<version>/ loads with today's code, version-1 builds play exactly as they did, and a
 * broken file loads what it can with notes instead of being refused.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { runBattle } from '../../src/engine/combat/battle';
import { resolveEnemies } from '../../src/engine/combat/montecarlo';
import { applySetup } from '../../src/engine/layoutSetup';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { type LayoutData, LayoutSchema, type Profile, ProfileSchema } from '../../src/engine/model';
import { SAVE_VERSION, readAccount, readBuild, writeAccount, writeBuild } from '../../src/engine/saves';

const ROOT = join(__dirname, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'saves');
const d = loadGameDataFromDir(join(ROOT, 'data')).data;
const read = (...p: string[]) => readFileSync(join(FIX, ...p), 'utf8');
const yamls = (...p: string[]) => readdirSync(join(FIX, ...p)).filter((f) => f.endsWith('.yaml'));

/** layoutSetup.applySetup as it was in version 1 (frozen copy): the whole hero (links and blessings) came from the layout, skin stars from the profile. */
function applySetupV1(profile: Profile, setup: LayoutData['setup']): Profile {
  if (!setup) return profile;
  const next = structuredClone(profile);
  if (setup.gear) next.gear = structuredClone(setup.gear);
  if (setup.pets) next.pets = structuredClone(setup.pets);
  if (setup.basic_stats) next.basic_stats = structuredClone(setup.basic_stats);
  if (setup.detailed_stats) next.detailed_stats = structuredClone(setup.detailed_stats);
  if (setup.equipped_skins) next.equipped_skins = [...setup.equipped_skins];
  if (setup.skin_quests_done) next.skin_quests_done = [...setup.skin_quests_done];
  if (setup.hero) {
    const i = next.heroes.findIndex((h) => h.id === setup.hero!.id);
    if (i >= 0) next.heroes[i] = { ...structuredClone(setup.hero), stars: next.heroes[i]!.stars };
    next.active_hero = setup.hero.id;
  }
  return next;
}

const DUMMY = { mode: 'stage', seed: 7, runs: 1, enemy: { id: 'custom_enemy', name: 'Dummy', hp: '200M', attacks: [{ damage: '200K', cooldown: 1.5, accuracy: 85 }] } };

/** What a battle with this profile and layout comes to (the layout's own enemy, or a dummy). */
function outcome(profile: Profile, layout: LayoutData) {
  const lo = buildLoadout(d, profile, layout);
  const battle = layout.battle?.enemy ? layout.battle : (LayoutSchema.parse({ battle: DUMMY }).battle as NonNullable<LayoutData['battle']>);
  const r = runBattle(lo, resolveEnemies(d, battle), { mode: battle.mode, durationS: battle.duration_s, seed: battle.seed });
  return { winner: r.winner, duration: r.duration, dealt: Math.round(r.player.damageDealt), taken: Math.round(r.enemy.damageDealt), hp: Math.round(r.player.hp), hero: lo.hero?.id ?? null };
}

describe('version-1 saves (the real files as of 2026-10-18)', () => {
  const v1ProfileText = read('v1', 'profile.yaml');
  const v1Profile = ProfileSchema.parse(parse(v1ProfileText));
  const account = readAccount(v1ProfileText);

  it('the account migrates without warnings and keeps only account-wide parts', () => {
    expect(account.version).toBe(1);
    expect(account.notes.filter((n) => n.level === 'warning')).toEqual([]);
    expect(account.profile.heroes.map((h) => [h.id, h.stars])).toEqual(v1Profile.heroes.map((h) => [h.id, h.stars]));
    expect(account.profile.heroes.every((h) => h.blessings === undefined)).toBe(true);
    expect(account.profile.auras).toEqual(v1Profile.auras);
    expect(account.profile.aura).toBe(v1Profile.aura);
    expect(account.profile.gear.weapon).toBeNull();
    expect(account.migratedFromV1).toEqual(parse(v1ProfileText));
  });

  for (const f of yamls('v1', 'builds')) {
    it(`"${f}" loads and plays exactly as in version 1`, () => {
      const text = read('v1', 'builds', f);
      const before = LayoutSchema.parse(parse(text));
      const after = readBuild(text, { v1Profile: account.migratedFromV1 });
      expect(after.version).toBe(1);
      expect(after.notes.filter((n) => n.level === 'warning')).toEqual([]);
      expect(after.layout.placements).toEqual(before.placements);
      expect(after.layout.battle).toEqual(before.battle);
      const oldProfile = applySetupV1(v1Profile, before.setup);
      const newProfile = applySetup(account.profile, after.layout.setup);
      for (const k of ['gear', 'pets', 'basic_stats', 'equipped_skins', 'skin_quests_done'] as const) expect(newProfile[k], k).toEqual(oldProfile[k]);
      const heroId = before.hero ?? oldProfile.active_hero;
      expect(newProfile.heroes.find((h) => h.id === heroId)?.blessings).toEqual(oldProfile.heroes.find((h) => h.id === heroId)?.blessings);
      expect(outcome(newProfile, after.layout)).toEqual(outcome(oldProfile, before));
    });
  }

  it('minimum erwen keeps its own extra blessing (blessings are per build)', () => {
    const l = readBuild(read('v1', 'builds', 'minimum erwen.yaml'), { v1Profile: account.migratedFromV1 }).layout;
    expect(l.setup?.hero?.blessings?.equipped.map((b) => b.id)).toEqual(['erwen_spirit_gain', 'item_haste']);
  });

  it('a version-1 build saved again as version 2 plays the same', () => {
    for (const f of yamls('v1', 'builds')) {
      const first = readBuild(read('v1', 'builds', f), { v1Profile: account.migratedFromV1 });
      const again = readBuild(writeBuild(first.layout));
      expect(again.version, f).toBe(SAVE_VERSION);
      expect(again.notes, f).toEqual([]);
      expect(again.layout, f).toEqual(first.layout);
    }
    const acc = readAccount(writeAccount(account.profile, account.migratedFromV1));
    expect(acc.notes).toEqual([]);
    expect(acc.profile).toEqual(account.profile);
    expect(acc.migratedFromV1).toEqual(account.migratedFromV1);
  });
});

describe('hand-written version-1 edge cases', () => {
  const spec = readAccount(read('v1', 'edge', 'spec-profile.yaml'));

  it('profiles of any shape load', () => {
    expect(spec.notes.filter((n) => n.level === 'warning')).toEqual([]);
    expect(spec.profile.heroes).toEqual([{ id: 'rose', stars: 6, links: ['parting_rose'], skin: null }]);
    const bare = readAccount(read('v1', 'edge', 'bare-profile.yaml'));
    expect(bare.notes.filter((n) => n.level === 'warning')).toEqual([]);
    expect(bare.profile.heroes).toEqual([]);
  });

  it('a layout with no setup takes it from the version-1 profile, as before', () => {
    const l = readBuild(read('v1', 'edge', 'bare-layout.yaml'), { v1Profile: spec.migratedFromV1 }).layout;
    expect(l.hero).toBe('rose');
    expect(l.setup?.hero?.blessings?.equipped[0]?.id).toBe('all_dmg');
    expect(l.setup?.gear?.weapon?.id).toBe('thunderbolt_spike');
    expect(l.setup?.pets).toEqual([{ id: 'venomous_spider', stars: 3, active: true }]);
    expect(l.setup?.detailed_stats).toEqual({ crit_rate: 50, item_haste: 14 });
    // An unknown item id is kept (the Checks panel reports it), never dropped.
    expect(l.placements).toEqual([{ item: 'wooden_sword', x: 0, y: 0, rotation: 0, supply: false }]);
  });

  it('without the version-1 profile, missing parts start empty and say so', () => {
    const r = readBuild(read('v1', 'edge', 'hero-only-layout.yaml'));
    expect(r.layout.hero).toBe('rose');
    expect(r.layout.setup?.gear).toEqual({ weapon: null, shield: null, rings: [], gloves: [] });
    expect(r.notes.map((n) => n.message).join('\n')).toMatch(/no gear equipped[\s\S]*no pets[\s\S]*HP \/ ATK \/ Block.*set to 1M \/ 100K \/ 0, enter yours/);
    expect(r.layout.setup?.basic_stats).toEqual({ hp: '1M', atk: '100K', initial_block: 0 });
  });

  it('a partial setup keeps what it saved and fills the rest from the profile', () => {
    const r = readBuild(read('v1', 'edge', 'partial-setup-layout.yaml'), { v1Profile: spec.migratedFromV1 });
    expect(r.notes.filter((n) => n.level === 'warning')).toEqual([]);
    expect(r.layout.setup?.gear?.weapon).toMatchObject({ rarity: 'epic', tier: 1 });
    expect(r.layout.setup?.hero?.blessings?.equipped).toEqual([{ id: 'all_dmg', rarity: 'rare', value: 4 }]);
    expect(r.layout.setup?.basic_stats).toEqual({ hp: '4M', atk: '1.34M', initial_block: '1.43M' });
    expect(r.layout.bag?.mask).toHaveLength(32);
    expect(r.layout.placements[0]).toMatchObject({ rotation: 90, supply: true });
  });
});

describe('frozen version-2 saves', () => {
  it('every one loads without warnings', () => {
    const acc = readAccount(read('v2', 'profile.yaml'));
    expect(acc.version).toBe(2);
    expect(acc.notes).toEqual([]);
    for (const f of yamls('v2', 'builds')) {
      const r = readBuild(read('v2', 'builds', f), { v1Profile: acc.migratedFromV1 });
      expect(r.version, f).toBe(2);
      expect(r.notes, f).toEqual([]);
    }
  });

  it('match what version 1 migrates to (the v2 fixtures were written from the v1 ones)', () => {
    const acc1 = readAccount(read('v1', 'profile.yaml'));
    expect(readAccount(read('v2', 'profile.yaml')).profile).toEqual(acc1.profile);
    for (const f of yamls('v2', 'builds')) {
      const from1 = readBuild(read('v1', 'builds', f), { v1Profile: acc1.migratedFromV1 }).layout;
      expect(readBuild(read('v2', 'builds', f)).layout, f).toEqual(from1);
    }
  });
});

describe('broken files still load', () => {
  const warns = (r: { notes: { level: string; message: string }[] }) => r.notes.filter((n) => n.level === 'warning').map((n) => n.message);

  it('a bad entry is dropped with a note; the rest stays', () => {
    const r = readBuild(`
version: 2
hero: erwen
gear: { weapon: { id: primal_flame, rarity: super, tier: 0 }, shield: { id: celestial_shield, rarity: legendary } }
pets: [{ id: flora, stars: 2 }, { id: seiren, stars: lots }]
skins: [{ id: a, stars: 1 }, { id: b, stars: 2 }, { id: c, stars: 3 }]
placements:
  - { item: hunters_bow, x: 0, y: 0 }
  - { item: hunters_bow, x: one, y: 0 }
  - { item: black_bow, x: 2, y: 0, glow: true }
battle: { mode: stage, seed: 1, runs: 0 }
some_future_setting: 42
`);
    expect(r.layout.hero).toBe('erwen');
    expect(r.layout.setup?.gear?.weapon).toBeNull();
    expect(r.layout.setup?.gear?.shield?.id).toBe('celestial_shield');
    expect(r.layout.setup?.pets?.map((p) => p.id)).toEqual(['flora']);
    expect(r.layout.setup?.equipped_skins).toEqual(['a', 'b']);
    expect(r.layout.placements.map((p) => p.item)).toEqual(['hunters_bow', 'black_bow']);
    expect(r.layout.battle?.runs).toBe(1);
    const w = warns(r).join('\n');
    for (const bit of ['some_future_setting', 'glow', 'gear.weapon', 'pets[1]', 'placements[1]', 'at most 2', 'battle.runs']) expect(w).toContain(bit);
  });

  it('not YAML, not a map, empty, or from a newer version', () => {
    expect(warns(readBuild('placements: [unclosed'))[0]).toMatch(/isn't valid YAML/);
    expect(readBuild('placements: [unclosed').layout.placements).toEqual([]);
    expect(warns(readBuild('- just\n- a list'))[0]).toMatch(/not a list of settings/);
    expect(readAccount('').profile.heroes).toEqual([]);
    expect(readAccount(null).notes).toEqual([]);
    const future = readAccount('version: 99\nheroes: [{ id: erwen, stars: 3 }]\nfriends: []\n');
    expect(future.profile.heroes[0]).toMatchObject({ id: 'erwen', stars: 3 });
    expect(warns(future).join('\n')).toMatch(/newer version[\s\S]*friends/);
  });
});
