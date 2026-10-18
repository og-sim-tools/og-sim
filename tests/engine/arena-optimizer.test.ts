/** Arena mode, the enemy kind from its items, and the optimizer's rotation / link / starting-equipment rules. */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { enemyKind, hasPlayerItems } from '../../src/engine/combat/setup';
import { LayoutSchema } from '../../src/engine/model';
import { type OptimizeOptions, activity, balanced, distinctRotations, fixIdle, optimize, optimizeMany, tryLayout, withMyBaseStats } from '../../src/engine/optimize';
import { buildLoadout } from '../../src/engine/loadout';
import { DATA_, ENEMY, combatData, combatLoadout, combatProfile } from '../combat-fixture';

const run = <T, R>(g: Generator<T, R>) => {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
};

describe('arena', () => {
  it('lasts 30 s and, if nobody dies, the higher remaining HP % wins; always PvP', () => {
    // I hit for 0.1x ATK a second; the enemy never hits back: more HP % left at the time limit.
    const r = runBattle(combatLoadout(['sure']), ENEMY({ hp: '100B', attacks: [] }), { mode: 'arena' });
    expect(r.reason).toBe('timeout');
    expect(r.duration).toBe(30);
    expect(r.winner).toBe('player');
    expect(r.player.maxHp).toBe(1e6 * DATA_.config!.pvp.hp_block_multiplier); // PvP ×20 for me too
    const lose = runBattle(combatLoadout([]), ENEMY({ hp: '100B', attacks: [{ damage: '1K', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }] }), { mode: 'arena' });
    expect(lose.winner).toBe('enemy');
  });

  it('warns when an Arena enemy is set to a monster (it still fights as a player)', () => {
    const r = runBattle(combatLoadout([]), ENEMY({ hp: '1M', kind: 'monster' }), { mode: 'arena', durationS: 1 });
    expect(r.warnings.some((w) => /arena is PvP: Dummy is set to a monster but fights as a player/.test(w))).toBe(true);
    expect(r.enemy.maxHp).toBe(20e6);
  });
});

describe('enemy kind from its items', () => {
  const data = combatData([
    { path: 'items/manual/k.yaml', text: '- { id: claw, name: Claw, rarity: common, tags: [weapon], footprint: "#", enemy_item: true, value: 0, source: manual, verified: true }' },
  ]);
  const build = (items: string[]) => ({ profile: combatProfile('', data), placements: items.map((item, i) => ({ id: `${item}${i}`, item, x: i, y: 0, rotation: 0 as const, supply: false })) });

  it('a build with player items (shop items, gear) makes a player; enemy-editor items alone keep a monster', () => {
    expect(hasPlayerItems(data, { build: build(['claw']) })).toBe(false);
    expect(enemyKind({ build: build(['claw']) }, data)).toBe('monster');
    expect(enemyKind({ build: build(['claw', 'blade']) }, data)).toBe('player');
    expect(enemyKind({ build: build(['blade']), kind: 'monster' }, data)).toBe('monster'); // set by hand wins (with a warning)
  });

  it('warns when an enemy with player items is set to a monster', () => {
    const r = runBattle(combatLoadout([], '', data), ENEMY({ hp: '1M', kind: 'monster', build: build(['blade']) }), { durationS: 1 });
    expect(r.warnings.some((w) => /has player items but is set to a monster/.test(w))).toBe(true);
  });
});

describe('optimizer rules', () => {
  const OPTS: OptimizeOptions = { seeds: 1, iterations: 40, shieldWeight: 50, allowItemChanges: false, temperature: 5, seedBase: 1, searchSeed: 3, durationS: 4.5 };
  const opp = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];

  it('only tries rotations that change the shape', () => {
    expect(distinctRotations(DATA_, 'blade')).toEqual([0]); // 1 cell, no dots
    expect(distinctRotations(DATA_, 'staff')).toHaveLength(4); // #o: the dot points four ways
    const base = LayoutSchema.parse({ placements: [{ id: 'b', item: 'blade', x: 0, y: 0 }, { id: 's', item: 'sure', x: 2, y: 0 }] });
    const res = run(optimize(DATA_, combatProfile(), base, opp, OPTS));
    expect(res.candidates.some((c) => c.change.startsWith('rotate'))).toBe(false);
  });

  it('never keeps a layout move that loses dot links unless it scores better', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'staff', item: 'staff', x: 0, y: 0 }, { id: 'bolt', item: 'bolt', x: 1, y: 0 }, { id: 'b', item: 'blade', x: 4, y: 2 }] });
    const res = run(optimize(DATA_, combatProfile(), base, opp, { ...OPTS, iterations: 60 }));
    const byId = new Map(res.candidates.map((c) => [c.id, c]));
    for (const c of res.candidates) {
      const parent = c.parent === null ? null : byId.get(c.parent)!;
      if (!parent || !/^(move|rotate|swap)/.test(c.change)) continue;
      expect(c.links).toBeGreaterThanOrEqual(parent.links); // layout-only moves that lose links aren't even tried
    }
  });

  it('swaps or adds starting equipment within Supply Ability', () => {
    const data = combatData([
      {
        path: 'heroes/manual/s.yaml',
        text: '- { id: war, name: War, class: warrior, rarity: legendary, base_supply_ability: 10, supplies: [{ stars: 0, item: blade }, { stars: 0, item: shield }, { stars: 0, item: potion }], source: manual, verified: true }',
      },
    ]);
    const prof = combatProfile('', data, ['heroes: [{ id: war, stars: 0 }]', 'active_hero: war'].join('\n'));
    const base = LayoutSchema.parse({ placements: [{ id: 'b', item: 'blade', x: 0, y: 0, supply: true }] });
    const res = run(optimize(data, prof, base, opp, { ...OPTS, iterations: 30, allowItemChanges: true, valueBudget: 0 }));
    expect(res.candidates.some((c) => c.change.startsWith('starting equipment:') || c.change.startsWith('bring '))).toBe(true);
    for (const c of res.candidates) expect(c.placements.filter((p) => p.supply).length).toBeLessThanOrEqual(3);
    for (const c of res.candidates) expect(c.placements.every((p) => p.supply)).toBe(true); // budget 0: no shop items
  });
});

describe('optimizer: opponents with my base stats', () => {
  it('gives the opponent my HP / ATK / Block and Stat Details, keeping its own bag', () => {
    const me = combatProfile('crit_rate: 12');
    const theirs = { profile: { ...combatProfile(), basic_stats: { hp: '50M', atk: '9M', initial_block: '3M' } }, placements: [{ item: 'blade', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    const b = withMyBaseStats(theirs, me);
    expect(b.profile.basic_stats).toEqual(me.basic_stats);
    expect(b.profile.detailed_stats).toEqual({ crit_rate: 12 });
    expect(b.placements).toBe(theirs.placements);
    expect(theirs.profile.basic_stats.hp).toBe('50M'); // the original isn't changed
  });

  it('can scale my base stats for the opponents (a multiple of my HP, ATK and Block)', () => {
    const me = combatProfile('crit_rate: 12'); // HP 1M, ATK 100K, Block 0
    const b = withMyBaseStats({ profile: combatProfile(), placements: [] }, me, 2.5);
    expect(b.profile.basic_stats).toEqual({ hp: 2.5e6, atk: 250e3, initial_block: 0 });
    expect(b.profile.detailed_stats).toEqual({ crit_rate: 12 }); // percentages stay as mine
  });

  it('a stronger opponent scores lower than the same one with my base stats', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'b', item: 'blade', x: 0, y: 0 }] });
    const strong = { profile: { ...combatProfile(), basic_stats: { hp: '50M', atk: '1M', initial_block: 0 } }, placements: [{ id: 's', item: 'sure', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    const mk = (build: typeof strong) => [{ name: 'X', enemy: [ENEMY({ hp: '1M', kind: 'player', build, traits: ['short_time_limit'] })] }];
    const opts = { seeds: 1, iterations: 0, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 1, durationS: 5 };
    const hard = run(optimize(DATA_, combatProfile(), base, mk(strong), opts));
    const fair = run(optimize(DATA_, combatProfile(), base, mk(withMyBaseStats(strong, combatProfile())), opts));
    expect(fair.start.meanScore).toBeGreaterThan(hard.start.meanScore);
  });
});

describe('optimizer clean-up of idle items', () => {
  const data = combatData([
    {
      path: 'items/manual/idle.yaml',
      text: `
- { id: pig, name: Pig, rarity: common, tags: [tool], footprint: "#o", effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 1, per_dot: { tags_any: [tool] } }], value: 1, source: manual, verified: true }
- { id: card, name: Card, rarity: common, tags: [armor], footprint: "#", value: 1, source: manual, verified: true }
`,
    },
  ]);
  const opp = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];

  it('activity: 0 when every effect needs dots and none reach a match', () => {
    const lo = (pigX: number) => buildLoadout(data, combatProfile('', data), LayoutSchema.parse({ placements: [{ id: 'pig', item: 'pig', x: pigX, y: 0 }, { id: 'sp', item: 'spiker', x: 4, y: 0 }, { id: 'card', item: 'card', x: 0, y: 3 }] }));
    expect(activity(lo(0), 'pig')).toBe(0);
    expect(activity(lo(3), 'pig')).toBe(1); // its dot is on the Spiker (a Tool)
    expect(activity(lo(0), 'card')).toBe(0);
  });

  it('moves an idle item to where it works, and drops one that works nowhere', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'b', item: 'blade', x: 7, y: 5 }, { id: 'pig', item: 'pig', x: 0, y: 0 }, { id: 'sp', item: 'spiker', x: 4, y: 3 }, { id: 'card', item: 'card', x: 0, y: 5 }] });
    const res = run(optimize(data, combatProfile('', data), base, opp, { seeds: 1, iterations: 0, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 1, durationS: 2 }));
    expect(res.candidates.map((c) => c.change)).toEqual(expect.arrayContaining([expect.stringMatching(/^move Pig to/), 'drop Card']));
    const lo = buildLoadout(data, combatProfile('', data), { ...base, placements: res.best.placements });
    expect(activity(lo, 'pig')).toBeGreaterThan(0);
    expect(res.best.placements.some((p) => p.item === 'card')).toBe(false);
  });
});

describe('balanced objective (help the matchups I lose)', () => {
  it('has diminishing returns above 0 and counts losses in full', () => {
    expect(balanced(-40)).toBe(-40);
    expect(balanced(0)).toBe(0);
    expect(balanced(50)).toBeCloseTo(34.66, 1);
    expect(balanced(150) - balanced(100)).toBeLessThan(balanced(50) - balanced(0));
    // +60 in a won matchup and -60 in a lost one: improving the lost one by 20 beats padding the won one by 20.
    const mean = (a: number, b: number) => (balanced(a) + balanced(b)) / 2;
    expect(mean(60, -40)).toBeGreaterThan(mean(80, -60));
  });

  it('the search maximises it; meanScore stays the plain mean; Test score scores a build without searching or cleaning up', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'b', item: 'blade', x: 0, y: 0 }, { id: 'card', item: 'potion', x: 2, y: 0 }] });
    const opps = [
      { name: 'Soft', enemy: [ENEMY({ hp: '1M', traits: ['short_time_limit'] })] },
      { name: 'Hard', enemy: [ENEMY({ hp: '100M', traits: ['short_time_limit'], attacks: [{ damage: '200K', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }] })] },
    ];
    const res = run(optimize(DATA_, combatProfile(), base, opps, { seeds: 1, iterations: 0, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 1, durationS: 5, cleanup: false }));
    const s = res.start;
    expect(res.candidates).toHaveLength(1); // nothing searched, nothing cleaned up
    expect(s.meanScore).toBeCloseTo((s.opponents[0]!.meanScore + s.opponents[1]!.meanScore) / 2);
    expect(s.objective).toBeCloseTo((balanced(s.opponents[0]!.meanScore) + balanced(s.opponents[1]!.meanScore)) / 2);
    const plain = run(optimize(DATA_, combatProfile(), base, opps, { seeds: 1, iterations: 0, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 1, durationS: 5, cleanup: false, balance: false }));
    expect(plain.start.objective).toBeCloseTo(plain.start.meanScore);
  });
});

describe('idle items: one- or two-move fixes, and several search seeds', () => {
  const data = combatData([
    { path: 'items/manual/idle2.yaml', text: '- { id: pig, name: Pig, rarity: common, tags: [tool], footprint: "#o", effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 1, per_dot: { tags_any: [tool] } }], value: 1, source: manual, verified: true }' },
  ]);
  const prof = combatProfile('', data);

  it('moves the item in the way when the only spots where an idle item works are taken', () => {
    // The Spiker (the only Tool) is boxed in by four Blades: the Pig can only work if one of them moves.
    const placements = [
      { id: 'pig', item: 'pig', x: 0, y: 0, rotation: 0 as const, supply: false },
      { id: 'sp', item: 'spiker', x: 4, y: 3, rotation: 0 as const, supply: false },
      ...[[3, 3], [5, 3], [4, 2], [4, 4]].map(([x, y], i) => ({ id: `b${i}`, item: 'blade', x: x!, y: y!, rotation: 0 as const, supply: false })),
    ];
    const base = LayoutSchema.parse({ placements });
    const fits = (ps: Parameters<typeof tryLayout>[3]) => tryLayout(data, prof, base, ps);
    const fix = fixIdle(data, prof, base, fits, placements, 0, 0)!;
    expect(fix).not.toBeNull();
    expect(fix.change).toMatch(/^move Blade to \(\d,\d\) and Pig to/);
    expect(activity(fix.lo, 'pig')).toBeGreaterThan(0);
  });

  const opp = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];
  const OPTS: OptimizeOptions = { seeds: 1, iterations: 6, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 1, durationS: 3, cleanup: false };
  const base = LayoutSchema.parse({ placements: [{ id: 'staff', item: 'staff', x: 0, y: 0 }, { id: 'bolt', item: 'bolt', x: 5, y: 4 }, { id: 'b', item: 'blade', x: 3, y: 2 }] });

  it('chained: each run starts from the best build so far', () => {
    const res = run(optimizeMany(DATA_, combatProfile(), base, opp, OPTS, 3, true));
    expect(new Set(res.candidates.map((c) => c.id)).size).toBe(res.candidates.length);
    expect([...new Set(res.candidates.map((c) => c.run))]).toEqual([1, 2, 3]);
    const starts = res.candidates.filter((c) => c.change.startsWith('start of run'));
    expect(starts).toHaveLength(2);
    for (const s of starts) {
      const parent = res.candidates.find((c) => c.id === s.parent)!;
      expect(parent.run!).toBeLessThan(s.run!); // the best build of the runs before
      expect(s.placements).toEqual(parent.placements);
    }
    expect(res.best.objective).toBe(Math.max(...res.candidates.map((c) => c.objective)));
  });

  it('separate: every run starts from my build', () => {
    const res = run(optimizeMany(DATA_, combatProfile(), base, opp, OPTS, 3, false));
    const starts = res.candidates.filter((c) => c.change === 'starting build');
    expect(starts).toHaveLength(3);
    for (const s of starts) expect(s.parent).toBeNull();
  });
});

describe('shake up when stuck', () => {
  it('after N builds without a better best, makes several changes at once from the best, keeps them, and grows the jump', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'staff', item: 'staff', x: 0, y: 0 }, { id: 'bolt', item: 'bolt', x: 1, y: 0 }, { id: 'b', item: 'blade', x: 3, y: 2 }, { id: 's', item: 'sure', x: 5, y: 4 }] });
    const opp = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];
    const res = run(optimize(DATA_, combatProfile(), base, opp, { seeds: 1, iterations: 40, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 2, durationS: 3, cleanup: false, shakeUp: { patience: 4, size: 2 } }));
    const shakes = res.candidates.filter((c) => c.reason.startsWith('shake-up'));
    expect(shakes.length).toBeGreaterThan(1);
    for (const s of shakes) {
      expect(s.accepted).toBe(true); // kept even if worse
      expect(s.reason).toMatch(/^shake-up: \d+ builds without a better best/);
    }
    const sizes = shakes.map((s) => s.change.split('; ').length);
    expect(sizes[0]).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sizes)).toBeGreaterThan(sizes[0]!); // stuck again: a bigger jump
    const off = run(optimize(DATA_, combatProfile(), base, opp, { seeds: 1, iterations: 40, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 2, durationS: 3, cleanup: false }));
    expect(off.candidates.some((c) => c.reason.startsWith('shake-up'))).toBe(false);
  });
});

