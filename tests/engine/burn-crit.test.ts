/** Burn crits: status crit stats, "When dealing DMG with Burn" stacking, crit repeat; dot relevance; setup keeps Stat Details. */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { dotAffects } from '../../src/engine/effects/resolve';
import { applySetup, setupFromProfile } from '../../src/engine/layoutSetup';
import { ENEMY, combatData, combatLoadout, combatProfile } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const data = combatData([
  {
    path: 'items/manual/burncrit.yaml',
    text: `
- { id: crit_ring, name: Crit Ring, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_status_damage, params: { status: burn }, target: player, action: add_player_stat, player_stat: burn_crit_rate, amount: 3 }], ${P} }
- { id: twice, name: Twice, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: passive, target: player, action: add_player_stat, player_stat: burn_crit_repeat, amount: 1 }], ${P} }
- { id: scaler, name: Scaler, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: passive, target: player, action: add_player_stat, player_stat: burn_crit_dmg_per_crit_rate, amount: 200 }], ${P} }
- { id: igniter, name: Igniter, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 0.000001, scales_with: atk }, cooldown: 1, accuracy: 100, crit_chance: 0 }, ${P} }
- { id: wind, name: Wind, rarity: common, tags: [spirit], footprint: "#o", effects: [{ trigger: on_weapon_hit, watch: dots, watch_filter: { tags_any: [spirit] }, target: player, action: apply_status, status: swift, stacks: 1 }], ${P} }
- { id: flamer, name: Flamer, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: timer, at_s: 1, target: enemy, action: trigger_status, status: burn, count: 9 }], ${P} }
- { id: fsp, name: Fsp, rarity: common, tags: [weapon, spirit], footprint: "#", ${P} }
`,
  },
]);
const burnEvents = (items: string[], stats: string, durationS = 3.05) => {
  const lo = combatLoadout(items, stats, data);
  return runBattle(lo, ENEMY({ hp: '100B', starting_statuses: [] }), { durationS, log: true, seed: 3 });
};

describe('burn crits', () => {
  it('"When dealing DMG with Burn" raises Burn Crit Rate each time, so burns start critting', () => {
    const r = burnEvents(['burnstart', 'igniter', 'crit_ring'], 'crit_rate: 0', 40);
    const crits = r.log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)')).map((e) => !!e.crit);
    expect(crits.length).toBeGreaterThan(5);
    expect(crits[0]).toBe(false);
    expect(crits.some(Boolean)).toBe(true);
    expect(r.log.some((e) => e.detail?.includes('burn_crit_rate +3'))).toBe(true);
    // With no crit rate and no ring, no burn ever crits.
    const none = burnEvents(['burnstart', 'igniter'], 'crit_rate: 0', 40).log.filter((e) => e.type === 'damage' && e.crit);
    expect(none).toHaveLength(0);
  });

  it('a critical burn is dealt twice with crit repeat', () => {
    const one = burnEvents(['burnstart', 'igniter'], 'crit_rate: 100').log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)')).length;
    const two = burnEvents(['burnstart', 'igniter', 'twice'], 'crit_rate: 100').log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)')).length;
    expect(two).toBe(one * 2);
  });

  it('"Activates Burn 9 times" with crit repeat: 18 damage events, one tick each (Primal Flame mythic)', () => {
    const events = (items: string[], stats: string) =>
      burnEvents(items, stats, 4).log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)')).map((e) => e.t);
    const all = events(['burnstart', 'flamer', 'twice'], 'crit_rate: 100');
    expect(all).toHaveLength(18);
    all.forEach((t, i) => expect(t).toBeCloseTo(1 + i * 0.1));
    // Without crits: 9 events, still one tick apart.
    const plain = events(['burnstart', 'flamer', 'twice'], 'crit_rate: 0');
    expect(plain).toHaveLength(9);
    expect(plain.at(-1)).toBeCloseTo(1.8);
  });

  it('Burn Crit DMG grows with the Burn Crit Rate gained (not the base Crit Rate), with no cap', () => {
    const burns = (items: string[]) =>
      burnEvents(items, 'crit_rate: 100, crit_dmg: 100', 150)
        .log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)'))
        .map((e) => e.amount!);
    // Base Crit Rate alone doesn't feed it.
    expect(burns(['burnstart', 'igniter', 'scaler'])[0]! / burns(['burnstart', 'igniter'])[0]!).toBeCloseTo(1);
    // With the ring each burn adds 3% Burn Crit Rate → +6% Crit DMG per burn, with no cap (user, 2026-10-22):
    // past 100% Burn Crit Rate it keeps growing (beyond +200%).
    const withRing = burns(['burnstart', 'igniter', 'scaler', 'crit_ring']);
    const plain = burns(['burnstart', 'igniter', 'crit_ring']);
    expect(withRing[1]! / plain[1]!).toBeCloseTo((2 + 0.06) / 2);
    const last = withRing.length - 1;
    expect(last).toBeGreaterThan(34); // more than 100% Burn Crit Rate by then
    expect(withRing.at(-1)! / plain.at(-1)!).toBeCloseTo((2 + 0.06 * last) / 2);
    expect(withRing.at(-1)! / plain.at(-1)!).toBeGreaterThan(2);
  });
});

describe('dot relevance', () => {
  it('a Spirit-hit dot affects Spirit weapons only', () => {
    const lo = combatLoadout(['wind@0,0', 'fsp@1,0', 'shield@3,0'], '', data);
    const wind = lo.entries.get('wind0')!.def.effects;
    expect(dotAffects(wind, lo.entries.get('fsp1')!)).toBe(true);
    expect(dotAffects(wind, lo.entries.get('shield2')!)).toBe(false);
    expect(dotAffects(lo.entries.get('shield2')!.def.effects, lo.entries.get('fsp1')!)).toBeNull();
  });
});

describe('build setup', () => {
  it('keeps the base stats; percentages are calculated, not saved', () => {
    const p = combatProfile('crit_rate: 62.5');
    const setup = setupFromProfile(p);
    expect(setup.detailed_stats).toBeUndefined();
    const back = applySetup(combatProfile(), setup);
    expect(back.basic_stats).toEqual(p.basic_stats);
  });
});

describe('no Crit Rate cap (user, 2026-10-22)', () => {
  const crit = combatData([
    {
      path: 'items/manual/critcap.yaml',
      text: `
- { id: c100, name: C100, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000, crit_chance: 100 }, effects: [{ trigger: passive, target: self_item, action: add_stat_pct, stat: crit_damage_pct, amount: 0, amount_from: { target_crit: true, factor: 1 } }], ${P} }
- { id: c150, name: C150, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000, crit_chance: 150 }, effects: [{ trigger: passive, target: self_item, action: add_stat_pct, stat: crit_damage_pct, amount: 0, amount_from: { target_crit: true, factor: 1 } }], ${P} }
`,
    },
  ]);
  const hits = (id: string) =>
    runBattle(combatLoadout([id], 'crit_rate: 0', crit), ENEMY({ hp: '100B', attacks: [], traits: ['short_time_limit'] }), { durationS: 5.05, log: true, seed: 2 }).log.filter((e) => e.type === 'damage' && e.side === 'player');
  it('over 100% every hit crits once, and what scales with Crit Rate keeps growing past 100%', () => {
    const a = hits('c100');
    const b = hits('c150');
    expect(b.length).toBe(a.length);
    expect(b.every((e) => e.crit)).toBe(true);
    // Crit DMG + its Crit Rate: 150% gives more than 100% did.
    expect(b[0]!.amount!).toBeGreaterThan(a[0]!.amount!);
  });
});
