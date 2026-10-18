/** Unique blessings that change hero skills; copy numbers for repeated items. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heroSkillSources } from '../../src/engine/combat/setup';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout, copyNumbers } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { aggregateStats } from '../../src/engine/stats';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const lo = (hero: string, blessings: string, placements: unknown[] = []) =>
  buildLoadout(
    real,
    loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: ${hero}, stars: 8, blessings: { level: 9, equipped: [${blessings}] } }]\nactive_hero: ${hero}\n` }, real).profile!,
    LayoutSchema.parse({ placements }),
  );
const effectsOf = (l: ReturnType<typeof lo>, skill: string) => heroSkillSources(l).find((s) => s.itemId === skill)!.effects.map((e) => e.effect);

describe('blessings that buff hero skills', () => {
  it('add their value to the skill number (Trixie reflect 20% → 40%, Raven Evade 3s → 5s)', () => {
    expect(effectsOf(lo('trixie', '{ id: trixie_consider_this_yours, rarity: mythic, value: 20 }'), 'consider_this_yours')[0]!.amount).toBe(40);
    expect(effectsOf(lo('trixie', '{ id: trixie_ill_be_having_that, rarity: mythic, value: 15 }'), 'ill_be_having_that')[0]!.amount).toBe(45);
    expect(effectsOf(lo('raven', '{ id: raven_outlaw_tactics, rarity: mythic, value: 2 }'), 'outlaw_tactics')[0]!.duration_s).toBe(5);
    expect(effectsOf(lo('trixie', ''), 'consider_this_yours')[0]!.amount).toBe(20); // without the blessing
  });

  it('scale damage (Flesh Burst Final DMG +100%) and raise caps (Gigantization 30% → 60%, rate 0.3 → 0.6)', () => {
    const fb = effectsOf(lo('bjorn', '{ id: bjorn_flesh_burst, rarity: mythic, value: 100 }'), 'flesh_burst')[2]!;
    expect(fb.value).toMatchObject({ ratio: 6 });
    expect(fb.bonus_per_removed_block).toMatchObject({ ratio: 0.8 });
    expect(effectsOf(lo('bjorn', '{ id: bjorn_gigantization, rarity: mythic, value: 30 }'), 'gigantization')[0]!.amount_from).toMatchObject({ max: 60, factor: 0.6 }); // same +100% HP for the cap, more DMG
  });

  it('are no longer reported as not simulated', () => {
    const issues = aggregateStats(lo('trixie', '{ id: trixie_consider_this_yours, rarity: mythic, value: 20 }, { id: trixie_ill_be_having_that, rarity: mythic, value: 15 }')).issues;
    expect(issues.filter((i) => i.code === 'blessing_not_simulated')).toEqual([]);
  });

  it("Raven's blessings: Outlaw Tactics lengthens the Evade, Evasion adds evasion; both simulated", () => {
    const l = lo('raven', '{ id: raven_outlaw_tactics, rarity: legendary, value: 1 }, { id: raven_evasion, rarity: mythic, value: 15 }');
    expect(effectsOf(l, 'outlaw_tactics')[0]!.duration_s).toBe(4);
    const s = aggregateStats(l);
    expect(s.player.detailed.evasion).toBe(15);
    expect(s.issues.filter((i) => i.code === 'blessing_not_simulated')).toEqual([]);
  });
});

describe('copy numbers', () => {
  it('numbers repeated items in bag order; single items get none', () => {
    const l = lo('trixie', '', [
      { id: 'b', item: 'rock', x: 3, y: 0 },
      { id: 'a', item: 'rock', x: 0, y: 1 },
      { id: 'c', item: 'rock', x: 1, y: 0 },
      { id: 'd', item: 'training_sword', x: 5, y: 0 },
    ]);
    const n = copyNumbers(l.layout);
    expect([n.get('c'), n.get('b'), n.get('a'), n.get('d')]).toEqual([1, 2, 3, undefined]);
    expect(aggregateStats(l).items.get('b')!.name).toBe('Rock #2');
  });
});
