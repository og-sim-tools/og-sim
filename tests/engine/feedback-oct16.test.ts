/** User feedback 2026-10-16: Waterdrop Cushion refills HP, enemy Berserk toggle, Mithril Ingot, skills on custom items, stun vs gear skills. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const calm = { traits: ['short_time_limit'] };
const hit = (dmg = '100K') => [{ damage: dmg, cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }];

describe('Waterdrop Cushion', () => {
  it('refills lost HP to full after each hit, 1 stack per 1% of max HP', () => {
    const lo = combatLoadout([], '', real, 'pets: [{ id: seiren, stars: 0, active: true }]\n');
    const r = runBattle(lo, ENEMY({ hp: '100B', attacks: hit('100K'), ...calm }), { durationS: 1.05, log: true });
    expect(r.player.hp).toBe(r.player.maxHp); // 100K of 1M = 10% refilled
    expect(r.player.statuses.waterdrop_cushion).toBe(90);
  });

  it('uses a whole stack for a part-percent, and runs out', () => {
    const lo = combatLoadout([], '', real, 'pets: [{ id: seiren, stars: 0, active: true }]\n');
    const r = runBattle(lo, ENEMY({ hp: '100B', attacks: hit('305K'), ...calm }), { durationS: 4.05 });
    // 30.5% per hit → 31 stacks each: 100 → 69 → 38 → 7 → the 4th hit only gets 7%.
    expect(r.player.statuses.waterdrop_cushion ?? 0).toBe(0);
    expect(r.player.hp).toBeCloseTo(1_000_000 - 305_000 + 70_000);
  });
});

describe('enemy Berserk toggle', () => {
  it('on by default, off when unticked', () => {
    const lo = combatLoadout([]);
    const on = runBattle(lo, ENEMY({ hp: '100B' }), { durationS: 11, log: true });
    const off = runBattle(lo, ENEMY({ hp: '100B', berserk: false }), { durationS: 11, log: true });
    expect(on.log.some((e) => e.type === 'berserk')).toBe(true);
    expect(off.log.some((e) => e.type === 'berserk')).toBe(false);
  });
});

describe('Mithril Ingot', () => {
  it("reduces Attack DMG taken by 5% per Armor under its dots, other items don't count", () => {
    const taken = (items: string[]) => runBattle(combatLoadout(items, '', real), ENEMY({ hp: '100B', attacks: hit('100K'), ...calm }), { durationS: 1.05 }).player.damageTaken;
    const base = taken(['mithril_ingot@1,0']);
    expect(taken(['mithril_ingot@1,0', 'leather_helmet@0,0', 'leather_helmet@2,0']) / base).toBeCloseTo(0.9);
    expect(taken(['mithril_ingot@1,0', 'rock@0,0', 'rock@2,0']) / base).toBeCloseTo(1);
  });
});

describe('gear-style skills', () => {
  const data = combatData([
    {
      path: 'items/manual/skilled.yaml',
      text: `- { id: ogre_totem, name: Ogre Totem, rarity: rare, tags: [tool], footprint: "#", value: 0, enemy_item: true, skill: { text: Smash, damage: { ratio: 0.01, scales_with: atk }, interval_s: 1, accuracy: 1000 }, effects: [{ trigger: on_skill_hit, target: enemy, action: apply_status, status: burn, stacks: 2 }], source: manual, verified: true }`,
    },
  ]);
  it('a custom item can have a skill; "On Skill Hit" abilities fire on it', () => {
    const r = runBattle(combatLoadout(['ogre_totem'], '', data), ENEMY({ hp: '100B', ...calm }), { durationS: 3.05 });
    expect(r.items.ogre_totem0!.skillActivations).toBe(3);
    expect(r.enemy.statuses.burn).toBe(6);
  });

  it("Stun doesn't pause gear skill timers (user)", () => {
    expect(data.config!.combat.stun_pauses_gear_skills).toBe(false);
    expect(data.config!.combat.stun_reapply).toBe('longest');
  });
});
