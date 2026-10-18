import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { resolveEnemies } from '../../src/engine/combat/montecarlo';
import { withPetSpawns } from '../../src/engine/combat/setup';
import type { BattleEvent } from '../../src/engine/combat/types';
import type { Combatant } from '../../src/engine/combat/types';
import { addStacks, expireStacks, removeStacks, setNonStacking } from '../../src/engine/statuses/runtime';
import { DATA_, ENEMY, combatLoadout, fight } from '../combat-fixture';

const times = (log: BattleEvent[], type: BattleEvent['type'], source?: RegExp) =>
  log.filter((e) => e.type === type && (!source || source.test(e.source ?? ''))).map((e) => e.t);
const hits = (log: BattleEvent[], side: 'player' | 'enemy', prefix = 'weapon') =>
  log.filter((e) => e.type === 'damage' && e.side === side && e.detail?.startsWith(prefix)).map((e) => Math.round(e.amount!));
const ATK = (damage = '100K', cooldown = 1, hitsN = 1) => [{ damage, cooldown, accuracy: 1000, hits: hitsN, crit_chance: 0 }];
const calm = { traits: ['short_time_limit'] }; // no Berserk, so numbers stay put

const blank = (): Combatant => ({
  side: 'enemy',
  name: 'x',
  maxHp: 1,
  hp: 1,
  block: 0,
  atk: 0,
  stats: {},
  combatStats: {},
  timedStats: [],
  immunities: new Set(),
  boss: false,
  statuses: new Map(),
  items: [],
  berserkEnabled: false,
  berserkStacks: 0,
  conditionalStats: [],
  atkPct: 0,
});

describe('status stacks: permanent and timed', () => {
  it('expires timed stacks and keeps permanent ones', () => {
    const c = blank();
    addStacks(c, 'burn', 5, 'player');
    addStacks(c, 'burn', 3, 'player', 30);
    expect(c.statuses.get('burn')!.stacks).toBe(8);
    expect(expireStacks(c, 29)).toEqual([]);
    expect(expireStacks(c, 30)).toEqual(['burn']);
    expect(c.statuses.get('burn')!.stacks).toBe(5);
  });

  it('removes permanent stacks first, then the timed ones that expire soonest', () => {
    const c = blank();
    addStacks(c, 'dodge', 2, 'enemy');
    addStacks(c, 'dodge', 3, 'enemy', 50);
    addStacks(c, 'dodge', 3, 'enemy', 20);
    expect(removeStacks(c, 'dodge', 4)).toBe(4);
    expect(c.statuses.get('dodge')!.timed).toEqual([
      { stacks: 1, until: 20 },
      { stacks: 3, until: 50 },
    ]);
    expect(removeStacks(c, 'dodge', 99)).toBe(4);
    expect(c.statuses.has('dodge')).toBe(false);
  });

  it('keeps the longer duration for non-stacking statuses (or adds them)', () => {
    const c = blank();
    setNonStacking(c, 'stun', 'player', 0, 15, 'longest');
    setNonStacking(c, 'stun', 'player', 10, 20, 'longest');
    expect(c.statuses.get('stun')).toMatchObject({ stacks: 1, timed: [{ stacks: 1, until: 20 }] });
    setNonStacking(c, 'stun', 'player', 10, 20, 'add');
    expect(c.statuses.get('stun')!.timed[0]!.until).toBe(30);
  });

  it('timed statuses wear off in battle', () => {
    const r = fight(['timedburn'], calm, { durationS: 5 });
    expect(r.log.find((e) => e.detail?.includes('burn wears off'))!.t).toBe(3);
    expect(r.enemy.statuses.burn).toBeUndefined();
  });
});

describe('Stun, Seal, Invincible', () => {
  it('Stun stops the holder’s cooldowns; reapplying keeps the longer duration', () => {
    expect(times(fight([], { attacks: ATK('1'), ...calm }, { durationS: 5 }).log, 'attack')).toEqual([1, 2, 3, 4, 5]);
    // Stunned at 1.0 for 1.5 s, re-stunned every second: the enemy never gets a full cooldown.
    expect(times(fight(['stunner'], { attacks: ATK('1'), ...calm }, { durationS: 5 }).log, 'attack', /^enemy/)).toEqual([]);
  });

  it('fires on_stun when I stun the enemy', () => {
    expect(fight(['stunner', 'stunwatch'], calm, { durationS: 3 }).items.stunwatch1!.block).toBeCloseTo(3 * 10_000);
  });

  it('Stun Resistance lowers the chance; immunity blocks it', () => {
    expect(fight(['stunner'], { resistances: { stun_resistance: 100 }, ...calm }, { durationS: 3 }).enemy.statuses.stun).toBeUndefined();
    const r = fight(['stunner'], { immunities: ['stun'], ...calm }, { durationS: 3 });
    expect(r.log.some((e) => e.detail?.includes('immune to stun'))).toBe(true);
  });

  it('Seal disables the item that hit me', () => {
    // The enemy attack hits at 1.0 and is sealed for 2.5 s: no progress until 3.5, so next attack at 4.5.
    expect(times(fight(['sealer'], { attacks: ATK('1'), ...calm }, { durationS: 5 }).log, 'attack')).toEqual([1, 4.5]);
  });

  it('Invincible: no damage and enemy attacks are ignored', () => {
    const r = fight(['invincer'], { attacks: ATK('100K'), ...calm }, { durationS: 3 });
    expect(hits(r.log, 'enemy')).toEqual([100_000]); // only the hit at 3.0, after 2.5 s
    expect(r.player.hp).toBe(900_000);
  });
});

describe('healing modifiers', () => {
  it('Heal Amount Reduction cuts healing; Healing Power Enhance counters it additively', () => {
    const heal = (items: string[], stats = '') => fight(items, calm, { durationS: 1, stats }).items.potion1!.healing;
    expect(heal(['halfstone', 'potion'])).toBeCloseTo(100_000);
    expect(heal(['halfstone', 'potion', 'harself'])).toBeCloseTo(50_000);
    expect(heal(['halfstone', 'potion', 'harself'], 'healing_power_enhance: 20')).toBeCloseTo(70_000);
  });

  it('Block Gain increases block gained', () => {
    expect(fight(['shield'], calm, { durationS: 1, stats: 'block_gain: 10' }).player.block).toBeCloseTo(550_000);
  });
});

describe('resistances, immunities, vulnerabilities (SPEC §5.3, §7.3)', () => {
  it('resistance reduces stacks received; All Debuff Resist adds to it', () => {
    expect(fight(['burnstart'], { resistances: { burn_resistance: 50 }, ...calm }, { durationS: 1 }).enemy.statuses.burn).toBe(5);
    expect(fight(['poisoner'], { resistances: { poison_resistance: 30, all_debuff_resist: 20 }, ...calm }, { durationS: 1 }).enemy.statuses.poison).toBe(5);
    expect(fight(['poisoner'], { immunities: ['poison'], ...calm }, { durationS: 1 }).enemy.statuses.poison).toBeUndefined();
  });

  it('typed reductions add to DMG Reduction; vulnerabilities add back; 25% floor', () => {
    expect(hits(fight(['blade'], { damage_reduction: 20, resistances: { attack_dmg_reduction: 30 }, ...calm }, { durationS: 2 }).log, 'player')).toEqual([50_000]);
    expect(hits(fight(['blade'], { vulnerabilities: { attack_dmg_vulnerability: 20 }, ...calm }, { durationS: 2 }).log, 'player')).toEqual([120_000]);
    expect(hits(fight(['blade'], { resistances: { attack_dmg_reduction: 95 }, ...calm }, { durationS: 2 }).log, 'player')).toEqual([25_000]);
    expect(hits(fight(['blade'], { vulnerabilities: { crit_vulnerability: 50 }, ...calm }, { durationS: 2, stats: 'crit_rate: 100' }).log, 'player')).toEqual([300_000]);
  });

  it('status-specific reductions only reduce that status', () => {
    const r = fight(['poisoner', 'blade'], { resistances: { poison_dmg_reduction: 50 }, ...calm }, { durationS: 2 });
    expect(hits(r.log, 'player', 'status (poison)')).toEqual([50_000]);
    expect(hits(r.log, 'player')).toEqual([100_000]);
  });

  it('damage-to-1 immunities', () => {
    expect(hits(fight(['blade'], { immunities: ['weapon_attack'], ...calm }, { durationS: 2 }).log, 'player')).toEqual([1]);
    const spike = fight(['spiker'], { attacks: ATK('1', 0.1), immunities: ['spike'], ...calm }, { durationS: 10 });
    expect(hits(spike.log, 'player', 'status (spike)').every((d) => d === 1)).toBe(true);
  });
});

describe('gear-specific mechanics as statuses', () => {
  it('Frostbite: +5% damage taken per stack', () => {
    expect(hits(fight(['blade'], { starting_statuses: [{ status: 'frostbite', stacks: 4 }], ...calm }, { durationS: 2 }).log, 'player')).toEqual([120_000]);
  });

  it('Divine Grace: each stack turns one damage instance into 1', () => {
    expect(hits(fight(['graceful'], { attacks: ATK(), ...calm }, { durationS: 3 }).log, 'enemy')).toEqual([1, 1, 100_000]);
  });

  it("Waterdrop Cushion only refills HP: damage Block soaks up doesn't use it (user)", () => {
    const r = fight(['cushion', 'shield'], { attacks: ATK(), ...calm }, { durationS: 2 });
    expect(r.player.statuses.waterdrop_cushion).toBe(50);
    expect(r.player.block).toBeLessThan(500_000);
    expect(r.player.hp).toBe(r.player.maxHp);
  });
});

describe('cleanse, remove, steal', () => {
  it('cleanses random debuff stacks (or whole statuses) from me', () => {
    const left = (r: ReturnType<typeof fight>) => (r.player.statuses.poison ?? 0) + (r.player.statuses.freeze ?? 0);
    // selfpoison also puts 4 Freeze on me, so the 1 s cleanser fires at 1.1 s.
    expect(left(fight(['selfpoison', 'cleanser'], calm, { durationS: 1.5 }))).toBe(14 - 5);
    expect(Object.keys(fight(['selfpoison', 'purger'], calm, { durationS: 1.5 }).player.statuses)).toHaveLength(1);
  });

  it('removes enemy buffs, random or by name', () => {
    expect(fight(['remover'], { starting_statuses: [{ status: 'dodge', stacks: 10 }], ...calm }, { durationS: 1 }).enemy.statuses.dodge).toBe(7);
    expect(fight(['dodgebreaker'], { starting_statuses: [{ status: 'dodge', stacks: 10 }], ...calm }, { durationS: 1 }).enemy.statuses.dodge).toBeUndefined();
  });

  it('steals: they lose the stacks and I gain them', () => {
    const r = fight(['stealer'], { starting_statuses: [{ status: 'spike', stacks: 10 }], ...calm }, { durationS: 1 });
    expect(r.enemy.statuses.spike).toBe(7);
    expect(r.player.statuses.spike).toBe(3);
  });

  it('stolen stacks keep their remaining time', () => {
    const start = [{ status: 'dodge', stacks: 2, duration: 2 }];
    expect(fight(['stealer'], { starting_statuses: start, ...calm }, { durationS: 1.5 }).player.statuses.dodge).toBe(2); // stolen at 1 s
    expect(fight(['stealer'], { starting_statuses: start, ...calm }, { durationS: 2.5 }).player.statuses.dodge).toBeUndefined();
  });

  it("Invincible can't be removed or stolen", () => {
    const r = fight(['stealer'], { starting_statuses: [{ status: 'invincible', stacks: 1, duration: 5 }], ...calm }, { durationS: 1.5 });
    expect(r.enemy.statuses.invincible).toBe(1);
    expect(r.player.statuses.invincible).toBeUndefined();
  });

  it("Waterdrop Cushion can't be stolen (user): the steal takes other buffs instead", () => {
    const start = [{ status: 'waterdrop_cushion', stacks: 20 }, { status: 'spike', stacks: 10 }];
    const r = fight(['stealer'], { starting_statuses: start, ...calm }, { durationS: 1.5 });
    expect(r.enemy.statuses.waterdrop_cushion).toBe(20);
    expect(r.player.statuses.waterdrop_cushion).toBeUndefined();
    expect(r.player.statuses.spike).toBe(3);
  });

  it("Waterdrop Cushion can't be removed either (user)", () => {
    const r = fight(['remover'], { starting_statuses: [{ status: 'waterdrop_cushion', stacks: 20 }], ...calm }, { durationS: 1.5 });
    expect(r.enemy.statuses.waterdrop_cushion).toBe(20);
  });
});

describe('damage reduction effects', () => {
  it('reduces the incoming hit (before_attacked), adding to other reductions with the floor', () => {
    expect(hits(fight(['reducer'], { attacks: ATK(), ...calm }, { durationS: 1 }).log, 'enemy')).toEqual([50_000]);
    expect(hits(fight(['plate'], { attacks: ATK(), ...calm }, { durationS: 1 }).log, 'enemy')).toEqual([70_000]);
    expect(hits(fight(['reducer', 'plate'], { attacks: ATK(), damage_reduction: 0, ...calm }, { durationS: 1 }).log, 'enemy')).toEqual([25_000]);
  });
});

describe('combat-time item bonuses', () => {
  it('timed bonuses expire', () => {
    expect(hits(fight(['rager'], calm, { durationS: 4 }).log, 'player')).toEqual([200_000, 200_000, 100_000, 100_000]);
  });

  it('bonuses per status stack follow the stacks', () => {
    expect(hits(fight(['spiky'], calm, { durationS: 1 }).log, 'player')).toEqual([150_000]);
  });
});

describe('gear weapon skills', () => {
  const gearProfile = (id: string) => `gear: { weapon: { id: ${id}, rarity: epic } }\n`;
  const run = (id: string, stats = '', extraItems: string[] = []) =>
    runBattle(combatLoadout([id, ...extraItems], stats, DATA_, gearProfile(id)), ENEMY(calm), { durationS: 4.15, log: true });

  it('fires on a fixed timer, hits several times, and ignores haste and Freeze', () => {
    // The gear weapon's basic attack hits at the start (t = 0), then the skill every 2 s (2 hits a tick apart).
    expect(times(run('skillblade').log, 'hit')).toEqual([0, 2, 2.1, 4, 4.1]);
    expect(hits(run('skillblade').log, 'player', 'skill')).toEqual([200_000, 200_000, 200_000, 200_000]);
    expect(times(run('skillblade', 'item_haste: 100').log, 'hit')).toEqual([0, 2, 2.1, 4, 4.1]);
    expect(times(run('skillblade', '', ['selfpoison']).log, 'hit')).toEqual([0, 2, 2.1, 4, 4.1]);
  });

  it('fills a Skill Gauge with charge_skill and fires at 100%', () => {
    const r = run('gaugeblade');
    expect(hits(r.log, 'player', 'skill')).toEqual([300_000, 300_000]);
    // Basic hits at 0 (gear hits at the start), 1, 2, 3, 4: +50% each → skill at 1 and 3.
    expect(times(r.log.filter((e) => e.detail?.includes('skill activates')), 'activation')).toEqual([1, 3]);
  });
});

describe('pet-spawned items', () => {
  const pet = (stars: number) => `pets: [{ id: spawner, stars: ${stars}, active: true }]\n`;

  it('fill empty cells left to right, top to bottom, unrotated', () => {
    const lo = combatLoadout(['blade@0,0'], '', DATA_, pet(0));
    const s = withPetSpawns(lo);
    expect([...s.loadout.layout.items.values()].filter((i) => i.def.id === 'egg').map((i) => [i.placement.x, i.placement.y])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('count the ones I placed by hand and warn when there is no room', () => {
    expect([...withPetSpawns(combatLoadout(['egg@5,5'], '', DATA_, pet(0))).loadout.entries.values()].filter((e) => e.def.id === 'egg')).toHaveLength(3);
    const tiny = withPetSpawns(combatLoadout(['blade@0,0'], '', DATA_, pet(0), [1, 1, 0, 0, 0, 0, 0, 0]));
    expect(tiny.warnings[0]).toMatch(/No room for 2 more Egg/);
  });

  it('hatch in place and inflict with the pet star multiplier', () => {
    const r = runBattle(combatLoadout([], '', DATA_, pet(1)), ENEMY(calm), { durationS: 2, log: true });
    expect(r.log.filter((e) => e.detail?.endsWith('becomes Bug'))).toHaveLength(3);
    expect(r.enemy.statuses.poison).toBe(3 * 2);
  });
});

describe('Gauntlet and Boss Rush (SPEC §7.5)', () => {
  const weak = (name: string) => ENEMY({ name, hp: '300K', attacks: ATK('50K', 1) });

  it('fights 4 enemies in a row; the 4th is a boss; HP, block and statuses carry over', () => {
    const r = runBattle(combatLoadout(['sure', 'shield', 'spiker']), [weak('A'), weak('B'), weak('C'), weak('D')], { mode: 'gauntlet', log: true });
    expect(r.winner).toBe('player');
    expect(r.fights.map((f) => [f.enemy, f.winner, f.boss])).toEqual([
      ['A', 'player', false],
      ['B', 'player', false],
      ['C', 'player', false],
      ['D', 'player', true],
    ]);
    // Battle-start effects once: the shield's block is gained once.
    expect(r.items.shield1!.block).toBe(500_000);
    expect(r.player.statuses.spike).toBe(10);
  });

  it('loses on the total time limit', () => {
    const tough = ENEMY({ name: 'T', hp: '1B', ...calm });
    const r = runBattle(combatLoadout(['blade']), [tough, tough, tough, tough], { mode: 'gauntlet' });
    expect(r).toMatchObject({ winner: 'enemy', reason: 'timeout', duration: 60 });
    expect(r.fights).toHaveLength(1);
  });

  it('Boss Rush: one fight like a stage (shop breaks between bosses), always a boss, always 30 s', () => {
    const tough = ENEMY({ name: 'T', hp: '1B', attacks: ATK('1', 1) });
    const r = runBattle(combatLoadout(['sure']), tough, { mode: 'boss_rush', log: true, durationS: 12 });
    expect(r.fights).toHaveLength(1);
    expect(r.fights[0]).toMatchObject({ boss: true, reason: 'timeout', duration: 30 }); // the 12 s override is ignored
    expect(r.log.find((e) => e.type === 'berserk')!.t).toBe(10);
  });

  it('Gauntlet Berserk runs on the battle clock: a late enemy gets stack 1 at once, then +1 every whole second', () => {
    // 1M damage per second: enemy 1 dies at 12.3 s; enemy 2 enters at 12.4 s.
    const enemies = [ENEMY({ name: 'A', hp: '12.3M' }), ENEMY({ name: 'B', hp: '1B' }), ENEMY({ name: 'C' }), ENEMY({ name: 'D' })];
    const r = runBattle(combatLoadout(['sure']), enemies, { mode: 'gauntlet', log: true, durationS: 14.5 });
    const bz = r.log.filter((e) => e.type === 'berserk').map((e) => [e.t, e.amount]);
    expect(bz).toEqual([
      [10, 1],
      [11, 2],
      [12, 3],
      [12.4, 1],
      [13, 2],
      [14, 3],
    ]);
    expect(r.fights[1]).toMatchObject({ enemy: 'B', reason: 'timeout' });
    expect(r.duration).toBe(14.5); // the total limit doesn't extend
  });

  it('removes temporary items after the first fight', () => {
    const r = runBattle(combatLoadout([], '', DATA_, `pets: [{ id: spawner, stars: 0, active: true }]\n`), [weak('A'), weak('B'), weak('C'), weak('D')], {
      mode: 'gauntlet',
      log: true,
      durationS: 20,
    });
    expect(r.log.some((e) => e.detail?.includes('temporary item(s) disappear'))).toBe(true);
  });

  it('picks the enemies from battle settings', () => {
    expect(() => resolveEnemies(DATA_, { mode: 'gauntlet', enemies: [ENEMY()] })).toThrow(/gauntlet needs 4 enemies/);
    expect(resolveEnemies(DATA_, { mode: 'gauntlet', enemies: [ENEMY(), ENEMY(), ENEMY(), ENEMY()] })).toHaveLength(4);
    expect(resolveEnemies(DATA_, { mode: 'stage', enemy: ENEMY({ name: 'S' }) })[0]!.name).toBe('S');
  });
});
