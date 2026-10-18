/** The build optimizer: match scores (HP margin + unused shields), and a search that finds a better layout. */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { type OptimizeOptions, boostsFor, countersFor, matchScore, optimize, rolesOf } from '../../src/engine/optimize';
import { DATA_, ENEMY, combatData, combatLoadout, combatProfile } from '../combat-fixture';

const OPTS: OptimizeOptions = { seeds: 1, iterations: 150, shieldWeight: 50, allowItemChanges: false, temperature: 0, seedBase: 1, searchSeed: 7, durationS: 4.5 };
const run = <T, R>(g: Generator<T, R>) => {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
};

describe('match score', () => {
  it('is my HP % left minus the enemy HP % left, plus the unused-shield term', () => {
    const r = runBattle(combatLoadout(['blade']), ENEMY({ hp: '1M', traits: ['short_time_limit'] }), { durationS: 2.5 });
    const s = matchScore(r, 50);
    expect(s.myHpPct).toBe(100);
    expect(s.foeHpPct).toBeCloseTo(90);
    expect(s.score).toBeCloseTo(10);
    expect(matchScore({ ...r, lethalSavesLeft: { player: 1, enemy: 0 } }, 50).score).toBeCloseTo(60);
    expect(matchScore({ ...r, lethalSavesLeft: { player: 0, enemy: 1 } }, 50).score).toBeCloseTo(-40);
  });
});

describe('optimize', () => {
  it('moves a spell under the staff that activates it, and records every candidate', () => {
    // Staff (#o) activates the spell under its dot; Bolt is a spell that only fires that way.
    const base = LayoutSchema.parse({
      placements: [
        { id: 'staff', item: 'staff', x: 0, y: 0 },
        { id: 'bolt', item: 'bolt', x: 5, y: 4 },
      ],
    });
    const opponents = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];
    const res = run(optimize(DATA_, combatProfile(), base, opponents, OPTS));
    expect(res.candidates.length).toBeGreaterThan(10);
    expect(res.best.meanScore).toBeGreaterThan(res.start.meanScore);
    const lo = buildLoadout(DATA_, combatProfile(), { ...base, placements: res.best.placements });
    const boltCell = lo.layout.items.get('bolt')!.cells[0]!;
    expect(lo.layout.items.get('staff')!.dots).toContainEqual(boltCell); // the bolt sits under the staff's dot
    expect(res.best.opponents[0]!.matches).toHaveLength(1);
  });

  it('replaces / adds shop items only within the value budget', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'blade', item: 'blade', x: 0, y: 0 }] });
    const opponents = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];
    const res = run(optimize(DATA_, combatProfile(), base, opponents, { ...OPTS, iterations: 40, allowItemChanges: true, valueBudget: 3 }));
    for (const c of res.candidates) expect(c.value).toBeLessThanOrEqual(3);
    expect(res.candidates.some((c) => c.change.startsWith('add ') || c.change.startsWith('replace '))).toBe(true);
  });
});

describe('diagnosis and targeted swaps', () => {
  const opp = (hp: string) => [{ name: 'Dummy', enemy: [ENEMY({ hp, traits: ['short_time_limit'] })] }];

  it('reads item roles from effects, and maps threats to counters and strengths to boosts', () => {
    expect([...rolesOf(DATA_.items.get('remover')!)]).toEqual(expect.arrayContaining(['strip_buffs', 'strip_spike']));
    expect([...rolesOf(DATA_.items.get('cleanser')!)]).toContain('cleanse');
    expect([...rolesOf(DATA_.items.get('shield')!)]).toContain('block');
    expect([...rolesOf(DATA_.items.get('blade')!)]).toContain('weapon');
    expect(countersFor('spike')[0]).toBe('strip_spike');
    expect(countersFor('weapon hits')).toContain('block');
    expect(boostsFor('spike', DATA_)).not.toContain('strip_buffs');
    expect(boostsFor('spike', DATA_, true)).toContain('strip_buffs'); // a stealing build gains Spike by taking it
  });

  it('credits removed / stolen stacks to the item and lists the items doing the least', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'blade', item: 'blade', x: 0, y: 0 }, { id: 'stealer', item: 'stealer', x: 2, y: 0 }, { id: 'potion', item: 'potion', x: 4, y: 0 }] });
    const opponents = [{ name: 'Spiky', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'], starting_statuses: [{ status: 'spike', stacks: 30 }] })] }];
    const res = run(optimize(DATA_, combatProfile(), base, opponents, { ...OPTS, iterations: 0, durationS: 3.5 }));
    const b = res.start.opponents[0]!.breakdown;
    expect(b.items.stealer!.moved).toBeGreaterThan(0);
    expect(res.start.diagnosis.strengths[0]!.source).toBe('Blade');
    expect(res.start.diagnosis.weakItems.map((w) => w.name)).toContain('Potion'); // full HP: its heals do nothing
  });

  it('reacts to the opponent: a tougher one scores lower', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'blade', item: 'blade', x: 0, y: 0 }] });
    const soft = run(optimize(DATA_, combatProfile(), base, opp('1M'), { ...OPTS, iterations: 0 }));
    const hard = run(optimize(DATA_, combatProfile(), base, opp('100M'), { ...OPTS, iterations: 0 }));
    expect(soft.start.meanScore).toBeGreaterThan(hard.start.meanScore);
  });

  it('says why each change was tried', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'blade', item: 'blade', x: 0, y: 0 }, { id: 'potion', item: 'potion', x: 2, y: 0 }] });
    const res = run(optimize(DATA_, combatProfile(), base, opp('10M'), { ...OPTS, iterations: 30, allowItemChanges: true, valueBudget: 2 }));
    expect(res.candidates.slice(1).every((c) => c.reason.length > 0)).toBe(true);
    expect(res.candidates.some((c) => c.reason.startsWith('push:') || c.reason.startsWith('counter:'))).toBe(true);
  });
});

describe('skin quests and alternatives in the optimizer', () => {
  const data = combatData([
    { path: 'heroes/manual/t.yaml', text: '- { id: wiz, name: Wiz, class: wizard, rarity: legendary, base_supply_ability: 10, source: manual, verified: true }' },
    {
      path: 'items/manual/t.yaml',
      text: `
- { id: critter, name: Critter, rarity: common, tags: [creature, weapon], footprint: "#", stats: { damage: { ratio: 0.1, scales_with: atk }, cooldown: 3, accuracy: 1000 }, value: 2, source: manual, verified: true }
- { id: zap, name: Zap, rarity: common, tags: [weapon, spell], footprint: "#", stats: { damage: { ratio: 4, scales_with: atk } }, value: 2, source: manual, verified: true }
`,
    },
    {
      path: 'skins/manual/t.yaml',
      text: `
- { id: pets, name: Pets, hero: wiz, skill: { name: Pets, quest: q, reward: r }, quest_check: { type: bag_value, tags_any: [creature], min: 4 }, available: { all: true }, status: complete,
    effects: [{ trigger: battle_start, target: player, action: apply_status, status: dodge, stacks: 1 }], source: manual, verified: true }
`,
    },
  ]);
  const prof = combatProfile('', data, ['heroes: [{ id: wiz, stars: 0 }]', 'active_hero: wiz', 'skins: [{ id: pets, stars: 0 }]', 'equipped_skins: [pets]'].join('\n'));
  const opp = [{ name: 'Dummy', enemy: [ENEMY({ hp: '10M', traits: ['short_time_limit'] })] }];

  it('keeps an equipped skin quest the starting build meets, and says so', () => {
    const base = LayoutSchema.parse({ placements: [{ id: 'c1', item: 'critter', x: 0, y: 0 }, { id: 'c2', item: 'critter', x: 2, y: 0 }] });
    const res = run(optimize(data, prof, base, opp, { ...OPTS, iterations: 40, allowItemChanges: true, valueBudget: 4, keepSkinQuests: true }));
    for (const c of res.candidates) expect(c.placements.filter((p) => p.item === 'critter')).toHaveLength(2);
    expect(res.warnings.some((w) => /builds that would break its quest \(creature value 4 \/ 4 now\) are skipped/.test(w))).toBe(true);
    const free = run(optimize(data, prof, base, opp, { ...OPTS, iterations: 40, allowItemChanges: true, valueBudget: 4, keepSkinQuests: false }));
    expect(free.candidates.some((c) => c.placements.filter((p) => p.item === 'critter').length < 2)).toBe(true); // Zap hits harder
  });

  it('tries alternatives that still fit what the neighbouring dots look for', () => {
    // The staff activates the Spell under its dot: an alternative to Bolt must be a Spell too.
    const base = LayoutSchema.parse({ placements: [{ id: 'staff', item: 'staff', x: 0, y: 0 }, { id: 'bolt', item: 'bolt', x: 1, y: 0 }] });
    const runs = [1, 2, 3, 4, 5, 6].map((searchSeed) => run(optimize(DATA_, combatProfile(), base, opp, { ...OPTS, iterations: 40, allowItemChanges: true, valueBudget: 2, searchSeed })));
    const all = runs.flatMap((r) => r.candidates);
    const alts = all.filter((c) => c.reason.startsWith('alternative to Bolt'));
    // Nothing else activates Spells under its dots, so while the Staff has a Spell under its dot it has no alternative.
    expect(all.some((c) => c.reason.startsWith('alternative to Staff') && c.reason.includes('does the same to its dots'))).toBe(false);
    expect(alts.length).toBeGreaterThan(0);
    for (const c of alts) {
      expect(c.reason).toContain('still fits Staff (spell)');
      const swapped = c.placements.find((p) => p.id !== 'staff' && p.item !== 'staff')!;
      expect(DATA_.items.get(swapped.item)!.tags).toContain('spell');
    }
  });
});

