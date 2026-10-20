/**
 * "Activate again" (Wizard's / Mage's Hats), user 2026-10-20: every hat pointing at a spell rolls on its own;
 * a tool spell acts again in the same tick, a weapon spell queues its recasts; a spell that reads statuses
 * (Instant Freeze, Charm) acts once per tick and its extra activations that tick are wasted, while what watches
 * spell activations (Witch's Mirror) still sees each one. Hat spam can't blow up.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { BattleEvent } from '../../src/engine/combat/types';
import { isRecast } from '../../src/engine/effects/handlers';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const hat = (id: string, pct: number) =>
  `- { id: ${id}, name: Hat ${pct}, rarity: common, tags: [armor], footprint: "o / #", effects: [{ trigger: on_activation, watch: dots, watch_filter: { tags_any: [spell] }, chance_pct: ${pct}, target: event_item, action: activate_item }], ${P} }`;
const data = combatData([
  {
    path: 'items/manual/recast.yaml',
    text: `
- { id: tspell, name: Tool Spell, rarity: common, tags: [tool, spell], footprint: "###", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: player, action: gain_block, value: { ratio: 0.01, scales_with: hp } }], ${P} }
- { id: wspell, name: Weapon Spell, rarity: common, tags: [weapon, spell], footprint: "###", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000 }, ${P} }
- { id: charm, name: Charm, rarity: common, tags: [tool, spell], footprint: "###", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: enemy, action: remove_status, count: 3 }], ${P} }
- { id: mirror, name: Mirror, rarity: common, tags: [armor], footprint: ".o. / .#.", effects: [{ trigger: on_activation, watch: dots, watch_filter: { tags_any: [spell] }, target: enemy, action: remove_status, count: 3 }], ${P} }
${hat('hat100', 100)}
${hat('hat30', 30)}
${hat('hat50', 50)}
`,
  },
]);
const cfg = data.config!.combat.recast;
const run = (items: string[], durationS = 1.05, enemy = {}) =>
  runBattle(combatLoadout(items, '', data), ENEMY({ traits: ['short_time_limit'], attacks: [], hp: '100B', ...enemy }), { durationS, log: true, seed: 7 });
const acts = (log: BattleEvent[], name: string) => log.filter((e) => e.type === 'activation' && e.detail?.startsWith(`${name} activated`));
/** Hats in a row under a 3-wide spell, each pointing at it. */
const under = (spell: string, hats: string[]) => [`${spell}@0,0`, ...hats.map((h, i) => `${h}@${i},1`)];
const withChain = <T,>(chain: boolean, fn: () => T): T => {
  const was = cfg.chain;
  cfg.chain = chain;
  try {
    return fn();
  } finally {
    cfg.chain = was;
  }
};

describe('activate again', () => {
  it('every hat rolls on its own: 2 sure hats = 2 recasts of a tool spell, in the same tick', () => {
    const r = withChain(false, () => run(under('tspell', ['hat100', 'hat100'])));
    expect(r.items.tspell0!.activations).toBe(3); // its own + one per hat
    const again = acts(r.log, 'Tool Spell').filter((e) => e.detail!.includes('again'));
    expect(again).toHaveLength(2);
    expect(new Set(again.map((e) => e.t))).toEqual(new Set([1]));
  });

  it('a weapon spell queues its recasts: one tick apart, each its own attack', () => {
    const r = withChain(false, () => run(under('wspell', ['hat100', 'hat100']), 1.2));
    const attacks = r.log.filter((e) => e.type === 'attack' && e.detail?.startsWith('Weapon Spell'));
    expect(attacks).toHaveLength(3);
    const ts = attacks.map((e) => e.t);
    const tick = data.config!.timing.tick_seconds;
    expect(ts[1]! - ts[0]!).toBeCloseTo(tick * cfg.weapon_spacing_ticks, 6);
    expect(ts[2]! - ts[1]!).toBeCloseTo(tick * cfg.weapon_spacing_ticks, 6);
  });

  it('two 30% hats: about 0.6 recasts per activation (separate rolls, no chain)', () => {
    const r = withChain(false, () => runBattle(combatLoadout(under('tspell', ['hat30', 'hat30']), '', data), ENEMY({ attacks: [], hp: '100B' }), { durationS: 400, log: true, seed: 7 }));
    const again = acts(r.log, 'Tool Spell').filter((e) => e.detail!.includes('again')).length;
    const own = r.items.tspell0!.activations - again;
    expect(own).toBeGreaterThan(300);
    expect(again / own).toBeGreaterThan(0.5);
    expect(again / own).toBeLessThan(0.7);
  });

  it("hat spam doesn't blow up: chained recasts with more than 100% in total stay bounded", () => {
    // Three 50% hats = 1.5 expected recasts per activation: a chain that never ends on its own.
    const t0 = Date.now();
    const w = withChain(true, () => run(under('wspell', ['hat50', 'hat50', 'hat50']), 5));
    // Weapon recasts queue one tick apart: at most one recast attack per tick.
    const perTick = new Map<number, number>();
    for (const e of w.log.filter((x) => x.type === 'attack' && x.detail?.startsWith('Weapon Spell'))) perTick.set(e.t, (perTick.get(e.t) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBeLessThanOrEqual(2); // its own + one queued
    // Tool spells act again in the same tick: the guard cuts the chain off and says so.
    const t = withChain(true, () => run(under('tspell', ['hat100', 'hat100', 'hat100']), 1.05));
    expect(t.items.tspell0!.activations).toBeLessThanOrEqual(cfg.max_per_tick + 1);
    expect(t.warnings.some((x) => /activated again more than/.test(x))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('a spell that reads statuses acts once per tick; Witch\'s Mirror still sees every activation', () => {
    const enemy = { starting_statuses: [{ status: 'spike', stacks: 50 }] };
    const r = withChain(false, () => run(['charm@0,0', 'hat100@0,1', 'hat100@2,1', 'mirror@1,1'], 1.05, enemy));
    expect(r.items.charm0!.activations).toBe(3);
    expect(acts(r.log, 'Charm').filter((e) => e.detail!.includes('wasted'))).toHaveLength(2);
    const charmRemoves = r.log.filter((e) => e.source?.startsWith('charm') && e.type === 'effect');
    expect(charmRemoves).toHaveLength(1);
    const mirrorRemoves = r.log.filter((e) => e.source?.startsWith('mirror') && e.type === 'effect');
    expect(mirrorRemoves).toHaveLength(3);
  });
});

describe('the real hats', () => {
  it("Wizard's, Flame and Frost Mage's Hats are 'activate again' effects", () => {
    const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
    for (const id of ['wizards_hat', 'flame_mages_hat', 'frost_mages_hat']) {
      expect(real.items.get(id)!.effects.some(isRecast), id).toBe(true);
    }
  });
});
