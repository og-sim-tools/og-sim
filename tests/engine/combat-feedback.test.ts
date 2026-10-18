/** Rules confirmed in review after phase 6: dot counts, conditions, lethal hits, same-tick deaths, start order. */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { BattleEvent } from '../../src/engine/combat/types';
import { aggregateStats } from '../../src/engine/stats';
import { DATA_, ENEMY, combatData, combatLoadout, fight } from '../combat-fixture';

const hits = (log: BattleEvent[], side: 'player' | 'enemy', prefix = 'weapon') =>
  log.filter((e) => e.type === 'damage' && e.side === side && e.detail?.startsWith(prefix)).map((e) => Math.round(e.amount!));
const ATK = (damage: string, cooldown = 1) => [{ damage, cooldown, accuracy: 1000, hits: 1, crit_chance: 0 }];
const calm = { traits: ['short_time_limit'] };

describe('"per [dot] X" counts', () => {
  it('multiplies start-of-battle bonuses by the matching items under the dots', () => {
    const lo = combatLoadout(['plate@0,0', 'greatblade@1,0', 'reducer@3,0']); // dots at x=0 and x=2: one armor
    expect(aggregateStats(lo).items.get('greatblade1')!.damage!.typePct.total).toBe(18);
    const both = combatLoadout(['plate@0,0', 'greatblade@1,0', 'reducer@2,0']);
    expect(aggregateStats(both).items.get('greatblade1')!.damage!.typePct.total).toBe(36);
  });

  it('counts an item under two dots once', () => {
    // Dots at (1,0) and (1,1) both land on the tall armor.
    const lo = combatLoadout(['tallcount@0,0', 'tallarmor@1,0']);
    expect(aggregateStats(lo).items.get('tallcount0')!.damage!.typePct.total).toBe(18);
  });

  it('multiplies battle effects (Spirit Stone: Burn per [dot] Spirit) and skips them with none', () => {
    expect(fight(['spirit@0,0', 'spiritstone@1,0', 'spirit@2,0'], calm, { durationS: 1 }).enemy.statuses.burn).toBe(8);
    expect(fight(['spiritstone@1,0'], calm, { durationS: 1 }).enemy.statuses.burn).toBeUndefined();
  });
});

describe('conditions', () => {
  it('fire only when the condition holds ("If you have Block")', () => {
    expect(hits(fight(['magicshield'], { attacks: ATK('100K'), ...calm }, { durationS: 1 }).log, 'enemy')).toEqual([100_000]);
    expect(hits(fight(['magicshield', 'shield'], { attacks: ATK('100K'), ...calm }, { durationS: 1 }).log, 'enemy')).toEqual([60_000]);
  });
});

describe('statuses that behave like stats', () => {
  it("Heal Amount Reduction, Scream and Wish can't be cleansed or stolen", () => {
    expect(fight(['harself', 'cleanser'], calm, { durationS: 1.5 }).player.statuses.heal_amount_reduction).toBe(50);
    const r = fight(['stealer'], { starting_statuses: [{ status: 'wish', stacks: 5 }], ...calm }, { durationS: 1.5 });
    expect(r.enemy.statuses.wish).toBe(5);
    expect(r.player.statuses.wish).toBeUndefined();
  });
});

describe('the hit that would kill me', () => {
  it('Celestial Shield style: become Invincible, avoid the blow, heal up (unless healing is reduced)', () => {
    const r = fight(['angel'], { attacks: ATK('2M', 1), ...calm }, { durationS: 1.5 });
    expect(r.winner).toBe('enemy'); // time limit, but alive
    expect(r.reason).toBe('timeout');
    expect(r.player.hp).toBe(1_000_000);
    expect(r.log.some((e) => e.detail?.includes('avoids the killing blow'))).toBe(true);
    // Heal Amount Reduction 50%: the heal is halved, the blow is still avoided.
    expect(fight(['angel', 'harself'], { attacks: ATK('2M', 1), ...calm }, { durationS: 1.5 }).player.hp).toBe(1_000_000);
  });

  it('only once per battle', () => {
    const r = fight(['angel'], { attacks: ATK('2M', 1), ...calm }, { durationS: 5 });
    expect(r).toMatchObject({ winner: 'enemy', reason: 'death' });
  });

  it('Deathrattle style: charge Scream from crits, release it on the killing blow', () => {
    // 4 crits of 200K by t=4, a 5th at t=5 before the lethal 2M hit: Scream = 500K.
    const lose = fight(['screamer'], { hp: '10M', attacks: ATK('2M', 5), ...calm }, { durationS: 10, stats: 'crit_rate: 100' });
    expect(lose).toMatchObject({ winner: 'enemy', reason: 'death' });
    expect(lose.log.some((e) => e.detail?.includes('releases 500000 scream'))).toBe(true);
    // If the Scream kills the enemy, I survive the blow and win.
    const win = fight(['screamer'], { hp: '1.4M', attacks: ATK('2M', 5), ...calm }, { durationS: 10, stats: 'crit_rate: 100' });
    expect(win).toMatchObject({ winner: 'player', reason: 'death' });
    expect(win.player.hp).toBe(1_000_000);
  });

  it('Wish counts re-stuns; the skill gets one more hit per Wish', () => {
    const r = fight(['stunner', 'wisher'], calm, { durationS: 3 });
    expect(r.player.statuses.wish).toBe(2); // stunned at 1, re-stunned at 2 and 3
    const m = runBattle(combatLoadout(['meteor'], '', DATA_, 'gear: { weapon: { id: meteor, rarity: epic } }\n'), ENEMY(calm), { durationS: 2.3, log: true });
    expect(hits(m.log, 'player', 'skill')).toHaveLength(3);
  });
});

describe('same-tick actions', () => {
  it('end_of_tick: both act in the tick and a tie is decided by config (coin flip by default); immediate: first kill wins', () => {
    const lo = combatLoadout(['rock']);
    const tie = (winner: 'player' | 'enemy' | 'random', seed = 1, timing: 'immediate' | 'end_of_tick' = 'end_of_tick') => {
      const cfg = structuredClone(DATA_.config!);
      cfg.combat.mutual_kill_winner = winner;
      cfg.combat.death_timing = timing;
      return runBattle({ ...lo, data: { ...lo.data, config: cfg } }, ENEMY({ hp: '100K', attacks: ATK('1M', 1), ...calm }), { durationS: 3, seed });
    };
    expect(DATA_.config!.combat.mutual_kill_winner).toBe('random');
    const r = tie('enemy');
    expect(r).toMatchObject({ winner: 'enemy', reason: 'death' });
    expect(r.player.hp).toBe(0);
    expect(r.enemy.hp).toBe(0);
    expect(tie('player').winner).toBe('player');
    const flips = Array.from({ length: 20 }, (_, i) => tie('random', i + 1).winner);
    expect(new Set(flips)).toEqual(new Set(['player', 'enemy']));
    expect(tie('random', 5).winner).toBe(tie('random', 5).winner); // same seed, same result
    // Immediate deaths (the default): the first killing blow wins, the dead fighter doesn't strike back.
    expect(DATA_.config!.combat.death_timing).toBe('immediate');
    const now = tie('enemy', 1, 'immediate');
    expect(now.player.hp > 0 || now.enemy.hp > 0).toBe(true);
    expect(now.log.some((e) => e.detail?.startsWith('Both fall in the same tick'))).toBe(false);
  });

  it("known bug: if my killing hit triggers their Spike and it kills me, they survive on 1 HP", () => {
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const r = fight(['rock'], { hp: '100K', atk: '10M', starting_statuses: [{ status: 'spike', stacks: 10 }], ...calm }, { durationS: 3, seed });
      if (r.log.some((e) => e.detail?.includes('survives on 1 HP'))) {
        found = true;
        expect(r).toMatchObject({ winner: 'enemy', reason: 'death' });
        expect(r.enemy.hp).toBe(1);
      }
    }
    expect(found).toBe(true);
  });
});

describe('start-of-battle order', () => {
  it('statuses go before hits; gear weapons hit at the start; an effect can set its own priority', () => {
    const r = runBattle(combatLoadout(['skillblade', 'burnstart'], '', DATA_, 'gear: { weapon: { id: skillblade, rarity: epic } }\n'), ENEMY(calm), { durationS: 0.1, log: true });
    const firstStatus = r.log.findIndex((e) => e.type === 'status');
    const firstHit = r.log.findIndex((e) => e.type === 'hit');
    expect(firstStatus).toBeLessThan(firstHit);
    expect(r.log[firstHit]!.t).toBe(0);
    const early = fight(['burnstart', 'earlybird'], calm, { durationS: 0.1 });
    expect(early.log.findIndex((e) => e.type === 'attack')).toBeLessThan(early.log.findIndex((e) => e.type === 'status'));
  });

  it('effect damage can count as weapon damage (pets)', () => {
    const red = { resistances: { attack_dmg_reduction: 50 }, ...calm };
    expect(fight(['bomb'], red, { durationS: 0.1 }).enemy.damageTaken).toBe(50_000);
    expect(fight(['softbomb'], red, { durationS: 0.1 }).enemy.damageTaken).toBe(100_000);
  });
});

describe('conditional blessings (Darkan, Cecilia)', () => {
  const data = combatData([
    {
      path: 'heroes/manual/t.yaml',
      text: '- { id: dark, name: Dark, class: warrior, rarity: legendary, base_supply_ability: 10, skills: [{ id: s1, name: S1, text: "" }], supplies: [], source: manual, verified: true }\n',
    },
    {
      path: 'blessings/manual/t.yaml',
      text:
        '- { id: low_hp_dmg, name: Low HP DMG, kind: unique, hero: dark, unit: pct, values: { epic: { value: 25 } }, combat_bonus: { stat: all_dmg_increase, when: { hp_below_pct: 50 } }, source: manual, verified: true }\n' +
        '- { id: high_hp_dmg, name: High HP DMG, kind: unique, hero: dark, unit: pct, values: { epic: { value: 40 } }, combat_bonus: { stat: all_dmg_increase, when: { hp_above_pct: 80 } }, source: manual, verified: true }\n',
    },
  ]);
  const profile = (b: string) => `heroes: [{ id: dark, stars: 0, blessings: { level: 5, equipped: [{ id: ${b}, rarity: epic, value: ${b === 'low_hp_dmg' ? 25 : 40} }] } }]
active_hero: dark
`;

  it('adds All DMG only while my HP is below 50% (Darkan)', () => {
    const lo = combatLoadout(['blade', 'halfstone'], '', data, profile('low_hp_dmg'));
    // Halfstone puts me at exactly 50%, so the bonus applies.
    expect(hits(runBattle(lo, ENEMY(calm), { durationS: 2, log: true }).log, 'player')).toEqual([125_000]);
    const full = combatLoadout(['blade'], '', data, profile('low_hp_dmg'));
    expect(hits(runBattle(full, ENEMY(calm), { durationS: 2, log: true }).log, 'player')).toEqual([100_000]);
  });

  it('adds All DMG only while my HP is above 80% (Cecilia)', () => {
    const full = combatLoadout(['blade'], '', data, profile('high_hp_dmg'));
    expect(hits(runBattle(full, ENEMY(calm), { durationS: 2, log: true }).log, 'player')).toEqual([140_000]);
    const hurt = combatLoadout(['blade', 'halfstone'], '', data, profile('high_hp_dmg'));
    expect(hits(runBattle(hurt, ENEMY(calm), { durationS: 2, log: true }).log, 'player')).toEqual([100_000]);
  });
});
