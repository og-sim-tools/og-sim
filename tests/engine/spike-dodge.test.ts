/** Spike and dodge archetypes (2026-10-17): batch 4 items, evade vs status damage, skill activations through dodge. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { markRepeats } from '../../src/ui/components/BagGrid';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const calm = { traits: ['short_time_limit'] };
const atk = (damage: string, accuracy = 1000, cooldown = 1) => [{ damage, cooldown, accuracy, hits: 1, crit_chance: 0 }];

describe('batch 4 items', () => {
  it('Spiked Armor: Max HP +40% (HP rises too), then 5 Spike every 3.5 s', () => {
    const r = runBattle(combatLoadout(['spiked_armor'], '', real), ENEMY({ hp: '100B', ...calm }), { durationS: 3.6 });
    expect(r.player.maxHp).toBeCloseTo(1_400_000);
    expect(r.player.hp).toBeCloseTo(1_400_000);
    expect(r.player.statuses.spike).toBe(5);
  });

  it('Shadow Hunter attacks (2 hits) on each dodge; Black Bow makes its next attack hit twice', () => {
    const fight = (items: string[]) => runBattle(combatLoadout(items, '', real), ENEMY({ hp: '100B', attacks: atk('1', 0, 0.5), ...calm }), { durationS: 1.95, log: true, seed: 2 });
    const hunter = fight(['shadow_hunter']);
    expect(hunter.items.shadow_hunter0!.attacks).toBeGreaterThan(0); // its own cooldown is 2 s: these attacks came from dodges
    const later = runBattle(combatLoadout(['black_bow'], '', real), ENEMY({ hp: '100B', attacks: atk('1', 0, 0.5), ...calm }), { durationS: 2.25, log: true, seed: 2 });
    expect(later.log.find((e) => e.type === 'attack' && e.source === 'black_bow0')!.detail).toContain('(2 hits)');
  });

  it('Black Feather: below 50% HP, evade for 1 s per Black Feather in the bag', () => {
    const r = runBattle(combatLoadout(['black_feather@0,0', 'black_feather@2,0'], '', real), ENEMY({ hp: '100B', attacks: atk('600K'), ...calm }), { durationS: 1.1, log: true });
    expect(r.log.some((e) => e.detail?.includes('evade on') && e.detail.includes('for 2s'))).toBe(true);
  });
});

describe('evade vs status damage and skills', () => {
  const data = combatData([
    {
      path: 'items/manual/skillburn.yaml',
      text: `- { id: burn_totem, name: Burn Totem, rarity: rare, tags: [tool], footprint: "#", value: 0, skill: { text: Flare, damage: { ratio: 0.01, scales_with: atk }, interval_s: 1, accuracy: 1000 }, effects: [{ trigger: on_skill_hit, target: enemy, action: trigger_status, status: burn, count: 2 }], source: manual, verified: true }`,
    },
  ]);
  it("a dodged skill hit still activates its Burn; Evade doesn't stop status damage", () => {
    const enemy = ENEMY({ hp: '100B', starting_statuses: [{ status: 'evade', stacks: 1, duration: 30 }], ...calm });
    const r = runBattle(combatLoadout(['burnstart', 'burn_totem@2,0'], '', data), enemy, { durationS: 1.35, log: true });
    expect(r.log.some((e) => e.detail?.includes('evades'))).toBe(true);
    expect(r.log.filter((e) => e.type === 'damage' && e.detail?.includes('(burn)')).length).toBe(2); // activated twice through Evade
  });
});

describe('dots', () => {
  it('a second dot on an item already touched is drawn hollow (it counts once)', () => {
    const out = markRepeats([
      { status: 'touches', target: 'bow' },
      { status: 'touches', target: 'bow' },
      { status: 'touches', target: 'gloves' },
      { status: 'empty' },
    ]);
    expect(out.map((d) => d.status)).toEqual(['touches', 'repeat', 'touches', 'empty']);
  });
});
