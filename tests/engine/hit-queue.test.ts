/**
 * The hit queue (user, 2026-11-06, from one in-game test with Primal Flame): there's no 0.1 s minimum cooldown; the
 * fight runs in 0.02 s ticks; hits that come at once (a weapon activated by several items in the same tick, the
 * steps of "Activates Burn 9 times") go out of a queue one every 0.02 s; Primal Flame's skill has a 1.2 s cast
 * time after its 8 s timer, which keeps its own rhythm.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const data = combatData([
  {
    path: 'items/queue.yaml',
    text: `
- { id: lstaff, name: Left Staff, rarity: common, tags: [weapon, staff], footprint: "o#", stats: { damage: { ratio: 0.5, scales_with: atk }, cooldown: 2, accuracy: 1000 }, effects: [{ trigger: on_attack, uses_dots: true, target: items_under_dots, filter: { tags_any: [spell] }, action: activate_item }], ${P} }
- { id: tri_spell, name: Tri Spell, rarity: common, tags: [weapon, spell], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, accuracy: 1000, hits: 3 }, ${P} }
`,
  },
]);
const attacks = (items: string[], durationS = 2.3) =>
  runBattle(combatLoadout(items, '', data), ENEMY({ traits: ['short_time_limit'], hp: '100B' }), { durationS, log: true }).log;

describe('the hit queue', () => {
  it('runs in 0.02 s ticks with no minimum cooldown; the queue is 0.02 s (config)', () => {
    const t = data.config!.timing;
    expect(t.tick_seconds).toBe(0.02);
    expect(t.min_cooldown_seconds).toBeNull();
    expect(t.hit_queue_seconds).toBe(0.02);
  });

  it('a weapon spell activated by two staffs at once attacks twice, 0.02 s apart', () => {
    const log = attacks(['staff@0,0', 'bolt@1,0', 'lstaff@2,0']);
    const at = log.filter((e) => e.type === 'attack' && e.source === 'bolt1').map((e) => e.t);
    expect(at).toEqual([2, 2.02]);
  });

  it("a multi-hit weapon activated twice at once: the second attack's hits queue after the first's", () => {
    const log = attacks(['staff@0,0', 'tri_spell@1,0', 'lstaff@2,0']);
    const hits = log.filter((e) => e.type === 'hit' && e.source === 'tri_spell1').map((e) => e.t);
    expect(hits).toEqual([2, 2.02, 2.04, 2.06, 2.08, 2.1]);
  });
});

describe("Primal Flame's cast time (user, 2026-11-06)", () => {
  const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
  const fightWith = (durationS: number) => {
    const profile = loadProfile(
      { path: 'p.yaml', text: 'basic_stats: { hp: 4M, atk: 1M, initial_block: 0 }\ndetailed_stats: { crit_rate: 0 }\ngear:\n  weapon: { id: primal_flame, rarity: common, tier: 0 }\n' },
      real,
    ).profile!;
    const lo = buildLoadout(real, profile, LayoutSchema.parse({ placements: [{ item: 'primal_flame', x: 0, y: 0, rotation: 0 }] }));
    return runBattle(lo, ENEMY({ hp: '900B', traits: ['short_time_limit'] }), { durationS, log: true });
  };

  it('the skill hit lands 1.2 s after the 8 s timer, and the timer keeps its 8 s rhythm (9.2 s, 17.2 s)', () => {
    expect(real.gear.get('primal_flame')!.skill!.cast_s).toBe(1.2);
    const log = fightWith(17.5).log;
    const skill = log.filter((e) => e.type === 'activation' && e.detail?.includes('skill activates')).map((e) => e.t);
    expect(skill).toEqual([9.2, 17.2]);
    expect(log.filter((e) => e.detail?.includes('skill casting')).map((e) => e.t)).toEqual([8, 16]);
  });

  it('its 9 Burns start at 9.2 s and go out 0.02 s apart', () => {
    const log = fightWith(9.6).log;
    const burns = log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)') && e.t >= 9.2).map((e) => e.t);
    expect(burns).toHaveLength(9);
    burns.forEach((t, i) => expect(t).toBeCloseTo(9.2 + i * 0.02, 6));
  });
});
