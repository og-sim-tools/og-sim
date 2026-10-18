/** Pet skills in battle (data/pets/manual/battle_effects.yaml) and the generic mechanics they needed. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { EnemyInput } from '../../src/engine/combat/setup';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { ENEMY, combatLoadout } from '../combat-fixture';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const calm = { traits: ['short_time_limit'] };

/** A battle with these real items and pets ("id:stars"). */
function run(items: string[], pets: string[], enemy: Partial<EnemyInput> = {}, durationS = 4.05, stats = 'crit_rate: 0') {
  const list = pets.map((p) => {
    const [id, stars] = p.split(':');
    return `{ id: ${id}, stars: ${stars ?? 0}, active: true }`;
  });
  const lo = combatLoadout(items, stats, real, `pets: [${list.join(', ')}]\n`);
  return runBattle(lo, ENEMY({ hp: '100B', ...calm, ...enemy }), { durationS, log: true, seed: 7 });
}
const petRow = (r: ReturnType<typeof run>, name: string) => Object.entries(r.items).find(([, i]) => i.name.startsWith(name))!;

describe('pet skills', () => {
  it('block, Spike, Poison and Healing Reduction at the start, by star level', () => {
    expect(petRow(run([], ['sheep:0'], {}, 0.1), 'Sheep')[1].block).toBeCloseTo(0.25 * 1_000_000);
    expect(petRow(run([], ['sheep:4'], {}, 0.1), 'Sheep')[1].block).toBeCloseTo(0.4 * 1_000_000);
    expect(run([], ['hedgehog:1'], {}, 0.1).player.statuses.spike).toBe(10);
    expect(run([], ['poison_mushroom:2'], {}, 0.1).enemy.statuses.poison).toBe(24);
    expect(run([], ['skeleton_reaper:2'], {}, 0.1).enemy.statuses.heal_amount_reduction).toBe(45);
  });

  it('Raccoon hits for 6x ATK at 1★ and adds 10% of the enemy max HP at 2★, with no assumption warnings', () => {
    const one = run([], ['raccoon:1'], {}, 0.1);
    expect(petRow(one, 'Raccoon')[1].damage).toBeCloseTo(6 * 100_000);
    expect(petRow(run([], ['raccoon:2'], {}, 0.1), 'Raccoon')[1].damage).toBeCloseTo(6 * 100_000 + 0.1 * 100e9);
    expect(one.warnings.some((w) => w.startsWith('Assumption — Raccoon'))).toBe(false); // pet-hit reading confirmed by the user
    expect(run([], ['raccoon:2'], {}, 0.1).warnings.some((w) => w.startsWith('Assumption'))).toBe(false); // the 2★ extra hit is confirmed too
  });

  it("White Wolf Captain's 3-hit attack lands one tick apart every 3 s and never stops", () => {
    const r = run([], ['white_wolf_captain:2'], {}, 16);
    const [id] = petRow(r, 'White Wolf Captain');
    const times = r.log.filter((e) => e.type === 'damage' && e.source === id).map((e) => e.t);
    expect(times).toEqual([3, 3.1, 3.2, 6, 6.1, 6.2, 9, 9.1, 9.2, 12, 12.1, 12.2, 15, 15.1, 15.2]);
  });

  it('pet attacks crit with my Crit Rate (+ their bonus) and my Crit DMG', () => {
    // 50% Crit Rate + Raccoon 4★'s 50% = always crits; Crit DMG 100% → double.
    const r = run([], ['raccoon:4'], {}, 0.1, 'crit_rate: 50, crit_dmg: 100');
    const [, row] = petRow(r, 'Raccoon');
    expect(row.crits).toBe(1);
    expect(row.damage).toBeCloseTo(2 * 6 * 100_000 + 0.1 * 100e9);
    expect(petRow(run([], ['raccoon:1'], {}, 0.1, 'crit_rate: 0'), 'Raccoon')[1].crits).toBe(0);
  });

  it('Brown Wolf hastes only the strongest weapon', () => {
    const base = run(['training_sword@0,0', 'club@1,0'], [], {}, 10.05);
    const wolf = run(['training_sword@0,0', 'club@1,0'], ['brown_wolf:0'], {}, 10.05);
    expect(wolf.items.club1!.attacks).toBeGreaterThan(base.items.club1!.attacks);
    expect(wolf.items.training_sword0!.attacks).toBe(base.items.training_sword0!.attacks);
  });

  it('Phoenix burns on the fastest weapon only', () => {
    const r = run(['training_sword@0,0', 'club@1,0'], ['phoenix:0'], {}, 6.05);
    expect(petRow(r, 'Phoenix')[1].statuses.burn).toBe(r.items.training_sword0!.hits);
  });

  it('Phoenix 4★: the enemy takes 1% more damage per Burn stack', () => {
    const hit = (pets: string[]) => run(['club@0,0'], pets, {}, 2.05).log.find((e) => e.type === 'damage' && e.source === 'club0')!.amount!;
    expect(hit(['fire_fox:0', 'phoenix:4']) / hit(['fire_fox:0'])).toBeCloseTo(1.05);
  });

  it('Hunting Hawk removes from whichever of Focus / Dodge is higher, and hastes weapons while they total 30+', () => {
    const enemy = { starting_statuses: [{ status: 'focus', stacks: 20 }, { status: 'dodge', stacks: 15 }] };
    const r = run([], ['hunting_hawk:0'], enemy, 4.05);
    expect(r.enemy.statuses).toMatchObject({ focus: 10, dodge: 15 });
    const fast = run(['training_sword@0,0'], ['hunting_hawk:2'], enemy, 3.9);
    const slow = run(['training_sword@0,0'], [], enemy, 3.9);
    expect(fast.items.training_sword0!.attacks).toBeGreaterThan(slow.items.training_sword0!.attacks);
  });

  it("Ice Reaper 4★ reacts to the enemy's heals (listen: enemy)", () => {
    const r = run([], ['ice_reaper:4'], { starting_statuses: [{ status: 'regen', stacks: 10 }] }, 4.05);
    expect(r.enemy.statuses.freeze).toBe(15 + 2 * 2); // Regen heals at 2 s and 4 s
  });
});

describe('Flora Debuff Resist (user, in game)', () => {
  it("Flora 2★ + two legendary Forest Keeper's Gloves = 70% Debuff Resist", async () => {
    const { loadGameDataFromDir } = await import('../../src/engine/loader-node');
    const { join } = await import('node:path');
    const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
    const flora = d.pets.get('flora')!.effects.filter((e) => e.combat_stat === 'all_debuff_resist' && (e.min_stars ?? 0) <= 2 && (e.max_stars ?? 9) >= 2);
    const gloves = d.gear.get('forest_keepers_gloves')!.effects.filter((e) => e.combat_stat === 'all_debuff_resist');
    expect(flora.reduce((a, e) => a + e.amount!, 0) + 2 * gloves.reduce((a, e) => a + e.amount!, 0)).toBe(70);
  });
});

