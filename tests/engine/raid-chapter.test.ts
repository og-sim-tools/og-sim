/** Raids (15 s, weak %-of-HP hits, defeated when time is up), typed-in attacks' on-hit statuses, and chapter rules. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chapterInfo } from '../../src/engine/chapters';
import { runBattle } from '../../src/engine/combat/battle';
import { resolveEnemies } from '../../src/engine/combat/montecarlo';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';

const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const profile = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 5M, atk: 1.5M, initial_block: 0 }\nheroes: [{ id: erwen, stars: 3 }]\nactive_hero: erwen\n' }, data).profile!;
const lo = buildLoadout(data, profile, LayoutSchema.parse({ placements: [{ item: 'hunters_bow', x: 0, y: 0 }] }));
const battle = (b: Record<string, unknown>) => LayoutSchema.parse({ battle: b }).battle!;

describe('raids', () => {
  const b = battle({ mode: 'raid', enemy: 'raid_boss', seed: 3 });
  const r = runBattle(lo, resolveEnemies(data, b), { mode: 'raid', seed: 3, log: true });

  it('last 15 s, and when time is up I am defeated', () => {
    expect(r.duration).toBeCloseTo(15, 1);
    expect(r.winner).toBe('enemy');
    expect(r.player.hp).toBe(0);
    expect(r.log.some((e) => /Time is up: the raid boss defeats you/.test(e.detail ?? ''))).toBe(true);
  });

  it("the boss's hits take no more than 5% of my HP over the fight, and the damage I deal is reported", () => {
    expect(r.enemy.damageDealt).toBeGreaterThan(0);
    expect(r.enemy.damageDealt).toBeLessThanOrEqual(0.05 * r.player.maxHp);
    expect(r.player.damageDealt).toBeGreaterThan(0);
    expect(Object.values(r.items).some((i) => i.side === 'player' && i.damage > 0)).toBe(true);
  });

  it('the raid boss is a placeholder, fought in raids only', () => {
    const boss = data.enemies.get('raid_boss')!;
    expect(boss.raid).toBe(true);
    expect(boss.name).toMatch(/placeholder/i);
    expect(data.items.get(boss.image_item!)?.image).toBeTruthy();
  });
});

describe("a typed-in enemy's attacks", () => {
  it('can inflict a status on every hit', () => {
    const b = battle({
      mode: 'stage',
      seed: 1,
      enemy: { name: 'Burner', hp: '900B', attacks: [{ damage: 1, cooldown: 1, accuracy: 100, on_hit: [{ status: 'burn', stacks: 3 }] }] },
    });
    const r = runBattle(lo, resolveEnemies(data, b), { mode: 'stage', durationS: 5.05, seed: 1, log: true });
    const hits = r.log.filter((e) => e.side === 'enemy' && e.type === 'hit').length;
    expect(hits).toBeGreaterThan(0);
    expect(r.log.some((e) => e.side === 'enemy' && /burn/i.test(e.detail ?? '') && /3/.test(e.detail ?? ''))).toBe(true);
  });

  it('or have the attacker gain the status (Spike) instead of inflicting it on me', () => {
    const b = battle({
      mode: 'stage',
      seed: 1,
      enemy: { name: 'Spiky', hp: '900B', attacks: [{ damage: 1, cooldown: 1, accuracy: 100, on_hit: [{ status: 'spike', stacks: 2, self: true }] }] },
    });
    const r = runBattle(lo, resolveEnemies(data, b), { mode: 'stage', durationS: 3.05, seed: 1 });
    expect(r.enemy.statuses.spike ?? 0).toBeGreaterThan(0);
    expect(r.player.statuses.spike ?? 0).toBe(0);
  });

  it('can deal a % of my max HP', () => {
    const b = battle({ mode: 'stage', seed: 1, enemy: { name: 'Pct', hp: '900B', attacks: [{ pct_max_hp: 10, cooldown: 1, accuracy: 100 }] } });
    const r = runBattle(lo, resolveEnemies(data, b), { mode: 'stage', durationS: 1.05, seed: 1 });
    expect(r.enemy.damageDealt).toBeCloseTo(0.1 * r.player.maxHp, -3);
  });
});

describe('chapters', () => {
  it('12 enemies, 5 in every 5th chapter; from chapter 10 the enemies repeat every 25 chapters', () => {
    expect(chapterInfo(data, 1)).toEqual({ number: 1, enemies: 12, bossChapter: false, sameAs: null, known: false });
    expect(chapterInfo(data, 15)).toMatchObject({ enemies: 5, bossChapter: true, sameAs: null });
    expect(chapterInfo(data, 34).sameAs).toBeNull();
    expect(chapterInfo(data, 35).sameAs).toBe(10);
    expect(chapterInfo(data, 61).sameAs).toBe(11);
    expect(chapterInfo(data, 120)).toMatchObject({ sameAs: 20, enemies: 5 });
    expect(chapterInfo(data, 999).number).toBe(120);
  });
});

describe('the raid boss (SPEC §7.5)', () => {
  it("ignores Execute and takes nothing from damage based on its HP", async () => {
    const { buildEnemy } = await import('../../src/engine/combat/setup');
    const boss = data.enemies.get('raid_boss')!;
    expect(boss.immunities).toEqual(expect.arrayContaining(['execute', 'hp_based']));
    expect(boss.boss).toBe(true);
    const c = buildEnemy(boss, 100).enemy;
    expect(c.immunities.has('execute')).toBe(true);
  });
});

describe('immune to HP-based damage', () => {
  it("a value worked out from the enemy's max HP (Red Dragon's 40%) does nothing to it", () => {
    const withPet = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 5M, atk: 1.5M, initial_block: 0 }\nheroes: [{ id: erwen, stars: 3 }]\nactive_hero: erwen\npets: [{ id: red_dragon, stars: 0, active: true }]\n' }, data).profile!;
    const plo = buildLoadout(data, withPet, LayoutSchema.parse({ placements: [] }));
    const against = (immunities: string[]) =>
      runBattle(plo, resolveEnemies(data, battle({ mode: 'stage', seed: 1, enemy: { name: 'T', hp: '900B', attacks: [], immunities } })), { mode: 'stage', durationS: 1.05, seed: 1 });
    expect(against([]).player.damageDealt).toBeGreaterThan(100e9);
    expect(against(['hp_based']).player.damageDealt).toBeLessThan(1);
  });
});
