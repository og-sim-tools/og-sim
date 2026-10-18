/** Enemies built like a player: bag, gear, hero, pets — all simulated on the enemy side. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { EnemyInput } from '../../src/engine/combat/setup';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { DEFAULT_PROFILE } from '../../src/ui/App';
import { ENEMY, combatLoadout } from '../combat-fixture';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;

function builtEnemy(placements: EnemyInput['build'] extends infer B ? (B extends { placements: infer P } ? P : never) : never, profile: Partial<typeof DEFAULT_PROFILE> = {}): Partial<EnemyInput> {
  return {
    name: 'Mirror',
    hp: '1',
    traits: ['short_time_limit'],
    build: { profile: { ...DEFAULT_PROFILE, basic_stats: { hp: '10M', atk: '10K', initial_block: 0 }, ...profile }, placements },
  };
}

function run(enemy: Partial<EnemyInput>, pets = '', durationS = 6.05) {
  const lo = combatLoadout([], 'crit_rate: 0', real, pets ? `pets: [${pets}]\n` : '');
  return runBattle(lo, ENEMY(enemy), { durationS, log: true, seed: 3 });
}

describe('enemy builds', () => {
  it('PvP (enemy is a player): both sides get HP and Block ×20, both berserk; a monster gets neither', () => {
    const hammer = [{ id: 'h', item: 'stone_hammer', x: 0, y: 0, rotation: 0 as const, supply: false }];
    const pvp = run({ ...builtEnemy(hammer), traits: [] }, '', 11);
    expect(pvp.player.maxHp).toBe(1_000_000 * 20);
    expect(pvp.enemy.maxHp).toBe(10_000_000 * 20);
    expect(pvp.log.some((e) => e.type === 'berserk' && e.side === 'player')).toBe(true);
    const mob = run({ ...builtEnemy(hammer), traits: [], kind: 'monster' }, '', 11);
    expect(mob.player.maxHp).toBe(1_000_000);
    expect(mob.enemy.maxHp).toBe(10_000_000);
    expect(mob.log.some((e) => e.type === 'berserk' && e.side === 'player')).toBe(false);
    expect(run({ ...ENEMY({ hp: '5M' }), kind: 'player' }, '', 0.1).enemy.maxHp).toBe(100_000_000); // a typed-in player too
  });

  it("a player is never a boss, and monster-only settings don't apply to it (with a warning)", () => {
    const hammer = [{ id: 'h', item: 'stone_hammer', x: 0, y: 0, rotation: 0 as const, supply: false }];
    const tough = { boss: true, damage_reduction: 50, immunities: ['stun' as const], resistances: { burn_resistance: 50 }, starting_statuses: [{ status: 'dodge', stacks: 30 }] };
    const pvp = run({ ...builtEnemy(hammer), traits: [], ...tough }, '', 2);
    expect(pvp.fights[0]!.boss).toBe(false);
    expect(pvp.enemy.statuses.dodge ?? 0).toBe(0);
    expect(pvp.warnings.join('\n')).toMatch(/Mirror is a player, so its DMG reduction, starting statuses, resistances, immunities don't apply/);
    // The same enemy as a monster keeps all of it.
    const mob = run({ ...builtEnemy(hammer), traits: [], kind: 'monster', ...tough }, '', 2);
    expect(mob.fights[0]!.boss).toBe(true);
    expect(mob.enemy.statuses.dodge).toBe(30);
    expect(mob.warnings.join('\n')).not.toMatch(/is a player/);
  });

  it("takes HP and ATK from the enemy's build; its bag items fight on the enemy side", () => {
    const r = run(builtEnemy([{ id: 'h', item: 'stone_hammer', x: 0, y: 0, rotation: 0, supply: false }]));
    expect(r.enemy.maxHp).toBe(10_000_000 * 20); // a build enemy is a player by default: PvP HP ×20
    const hammer = r.items['enemy:h']!;
    expect(hammer).toMatchObject({ side: 'enemy', name: 'Stone Hammer' });
    expect(hammer.attacks).toBeGreaterThan(0);
    expect(r.player.damageTaken).toBeGreaterThan(0);
  });

  it('runs gear skills and the effects of the enemy gear', () => {
    const r = run(
      builtEnemy([{ id: 'w', item: 'primal_flame', x: 0, y: 0, rotation: 0, supply: false }], {
        gear: { weapon: { id: 'primal_flame', rarity: 'epic', tier: 0, level: 1 }, shield: null, rings: [], gloves: [] },
      }),
      '',
      8.05,
    );
    expect(r.items['enemy:w']!.skillActivations).toBe(1);
    expect(r.log.some((e) => e.type === 'status' && e.target === 'player' && e.detail?.includes('burn'))).toBe(true);
  });

  it("Yeti resists the enemy hammer's Stun and counterattacks, at most once per 3 s", () => {
    let checked = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const lo = combatLoadout([], 'crit_rate: 0', real, 'pets: [{ id: yeti, stars: 4, active: true }]\n');
      const r = runBattle(lo, ENEMY(builtEnemy([{ id: 'h', item: 'stone_hammer', x: 0, y: 0, rotation: 0, supply: false }])), { durationS: 20, log: true, seed });
      const resists = r.log.filter((e) => e.detail?.includes('resists Stun')).length;
      const counters = r.log.filter((e) => e.type === 'damage' && e.source === 'pet:yeti').map((e) => e.t);
      if (resists === 0) continue;
      checked++;
      expect(counters.length).toBeGreaterThan(0);
      expect(counters.length).toBeLessThanOrEqual(resists);
      for (let i = 1; i < counters.length; i++) expect(counters[i]! - counters[i - 1]!).toBeGreaterThanOrEqual(3 - 1e-9);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
