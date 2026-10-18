/** Hero skills in battle: skill sources, links, and the generic mechanics they needed. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { heroSkillSources } from '../../src/engine/combat/setup';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import type { EnemyInput } from '../../src/engine/combat/setup';
import { LayoutSchema } from '../../src/engine/model';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const calm = { traits: ['short_time_limit'] };
const ATK = (damage = '100K', cooldown = 1) => [{ damage, cooldown, accuracy: 1000, hits: 1, crit_chance: 0 }];

/** Data with a hero "tester" whose only skill has these effects (YAML flow list items). */
function withSkill(effects: string[], extraItems = '', extraSkill?: { effects: string[] }) {
  const second = extraSkill
    ? `\n- { id: helper, name: Helper, class: warrior, rarity: rare, base_supply_ability: 10, skills: [{ id: h_skill, name: H Skill, text: "" }], skill_links: [{ stars: 4, skill: h_skill }], skill_effects: { h_skill: { status: complete, effects: [${extraSkill.effects.join(', ')}] } }, ${P.replace('value: 1, ', '')} }`
    : '';
  return combatData([
    {
      path: 'heroes/manual/test.yaml',
      text: `- { id: tester, name: Tester, class: warrior, rarity: legendary, base_supply_ability: 10, skills: [{ id: t_skill, name: T Skill, text: "" }], skill_effects: { t_skill: { status: complete, effects: [${effects.join(', ')}] } }, ${P.replace('value: 1, ', '')} }${second}`,
    },
    ...(extraItems ? [{ path: 'items/manual/hero-test.yaml', text: extraItems }] : []),
  ]);
}
const heroProfile = (links = '') => `heroes: [{ id: tester, stars: 8${links ? `, links: [${links}]` : ''} }, { id: helper, stars: 8 }]\nactive_hero: tester\n`;
const fightWith = (data: ReturnType<typeof withSkill>, items: string[], enemy: Partial<EnemyInput> = {}, durationS = 3, stats = '', links = '') =>
  runBattle(combatLoadout(items, stats, data, heroProfile(links)), ENEMY({ hp: '900B', ...calm, ...enemy }), { durationS, log: true, seed: 2 });
const playerHits = (r: ReturnType<typeof runBattle>) => r.log.filter((e) => e.type === 'damage' && e.side === 'player' && e.detail?.startsWith('weapon')).map((e) => e.amount!);

describe('hero skill sources', () => {
  it('runs the active hero\'s skill effects (passive All DMG)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount: 100 }']);
    const lo = combatLoadout(['blade'], '', data, heroProfile());
    expect(heroSkillSources(lo).map((s) => s.name)).toEqual(['Tester: T Skill']);
    expect(playerHits(fightWith(data, ['blade']))[0]).toBe(200_000);
  });

  it('also runs linked skills from other heroes', () => {
    const data = withSkill([], '', { effects: ['{ trigger: passive, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount: 50 }'] });
    expect(playerHits(fightWith(data, ['blade'], {}, 3, '', 'h_skill'))[0]).toBe(150_000);
    expect(playerHits(fightWith(data, ['blade']))[0]).toBe(100_000);
  });

  it('warns about skills that need numbers', () => {
    const data = combatData([
      {
        path: 'heroes/manual/test.yaml',
        text: `- { id: tester, name: Tester, class: warrior, rarity: legendary, base_supply_ability: 10, skills: [{ id: t_skill, name: T Skill, text: "" }], skill_effects: { t_skill: { status: needs_values, effects: [], notes: "x?" } }, source: manual, verified: true }`,
      },
    ]);
    const warnings: string[] = [];
    heroSkillSources(combatLoadout([], '', data, heroProfile()), warnings);
    expect(warnings.join(' ')).toMatch(/T Skill.*not simulated: x\?/);
  });
});

describe('mechanics for hero skills', () => {
  it('evade: every enemy attack misses while it lasts (Outlaw Tactics)', () => {
    const data = withSkill(['{ trigger: battle_start, target: player, action: apply_status, status: evade, stacks: 1, duration_s: 3 }']);
    const r = fightWith(data, [], { attacks: ATK('100K', 1) }, 5);
    const enemyHits = r.log.filter((e) => e.type === 'damage' && e.side === 'enemy').map((e) => e.t);
    expect(enemyHits.every((t) => t > 3)).toBe(true);
    expect(enemyHits.length).toBeGreaterThan(0);
  });

  it('prevent_lethal with avoid pays Focus to evade the killing blow, cost growing (Survival Instinct)', () => {
    const data = withSkill([
      '{ trigger: battle_start, target: player, action: apply_status, status: focus, stacks: 12 }',
      '{ trigger: on_lethal, target: player, action: prevent_lethal, status: focus, stacks: 5, stacks_growth: 5, avoid: true }',
    ]);
    const r = fightWith(data, [], { attacks: ATK('5M', 1) }, 4);
    const evades = r.log.filter((e) => e.detail?.includes('to evade the attack'));
    expect(evades).toHaveLength(1); // 5 paid, then 10 > the 7 left
    expect(r.winner).toBe('enemy');
  });

  it('execute: Spike above 10 × the enemy HP % kills (Parting Rose)', () => {
    const data = withSkill(['{ trigger: passive, condition: { who: self, status_over_foe_hp: { status: spike, factor: 10 } }, target: enemy, action: execute }']);
    const r = fightWith(data, ['spiker'], { hp: '1M' }, 2);
    // 10 Spike > 10 × 0%? No: the enemy is at 100% until something brings it under 1%.
    expect(r.winner).not.toBe('player');
    const low = fightWith(data, ['spiker', 'blade'], { hp: '105K' }, 3); // one hit → enemy at ~4.8% → 10 > 10 × 4.8? no
    expect(low.log.some((e) => e.detail?.includes('executes'))).toBe(false);
    const lower = fightWith(data, ['spiker', 'blade'], { hp: '101K' }, 3); // one hit → ~1% → 10 > 9.9 → execute
    expect(lower.log.some((e) => e.detail?.includes('executes'))).toBe(true);
    expect(lower.winner).toBe('player');
  });

  it('roll_group: both parts happen together or not at all (Battle Cry)', () => {
    const data = withSkill([
      '{ trigger: on_attacked, chance_pct: 50, roll_group: cry, target: player, action: apply_status, status: spike, stacks: 1 }',
      '{ trigger: on_attacked, chance_pct: 50, roll_group: cry, target: player, action: apply_status, status: focus, stacks: 1 }',
    ]);
    const r = fightWith(data, [], { attacks: ATK('1', 1) }, 20);
    expect(r.player.statuses.spike ?? 0).toBe(r.player.statuses.focus ?? 0);
    expect(r.player.statuses.spike ?? 0).toBeGreaterThan(0);
  });

  it('debuff reflect: part of what the enemy gives me goes back (Consider This Yours)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: debuff_reflect_pct, amount: 20 }']);
    const r = fightWith(data, [], { starting_statuses: [] }, 1);
    expect(r.enemy.statuses.poison ?? 0).toBe(0);
    const items = `- { id: badgift, name: Bad Gift, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: poison, stacks: 10 }], ${P} }`;
    const d2 = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: debuff_reflect_pct, amount: 20 }'], items);
    // My own item poisoning me isn't from the enemy: nothing reflected.
    expect(fightWith(d2, ['badgift'], {}, 1).enemy.statuses.poison ?? 0).toBe(0);
  });

  it('steal instead of remove (I\'ll Be Having That)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: steal_on_remove_pct, amount: 100 }']);
    const r = fightWith(data, ['dodgebreaker'], { starting_statuses: [{ status: 'dodge', stacks: 20 }] }, 1);
    expect(r.enemy.statuses.dodge ?? 0).toBe(0);
    expect(r.player.statuses.dodge).toBe(20);
  });

  it('weapon crit bonus: a chance for crits to deal more (Hawk Eye)', () => {
    const data = withSkill([
      '{ trigger: passive, target: player, action: add_player_stat, player_stat: weapon_crit_proc_chance, amount: 100 }',
      '{ trigger: passive, target: player, action: add_player_stat, player_stat: weapon_crit_proc_dmg, amount: 100 }',
    ]);
    expect(playerHits(fightWith(data, ['blade'], {}, 3, 'crit_rate: 100'))[0]).toBe(400_000);
  });

  it('statuses ignore Block (Impale)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: status_ignores_block, amount: 1 }']);
    const r = fightWith(data, ['poisoner'], { block: '10M' }, 2.05);
    expect(r.enemy.block).toBe(10_000_000);
    expect(r.enemy.hp).toBeLessThan(r.enemy.maxHp);
  });

  it('per_bag inverse: amount ÷ number of matching item kinds (Short-term Memory)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount: 30, per_bag: { tags_all: [weapon, spell], inverse: true } }']);
    expect(playerHits(fightWith(data, ['blade']))[0]).toBe(130_000); // no spells → full 30%
    expect(playerHits(fightWith(data, ['blade', 'bolt', 'echo']))[0]).toBeCloseTo(115_000); // two spell kinds → 15%
  });

  it('amount_from missing HP grows as HP drops (Forbidden Power)', () => {
    const data = withSkill(['{ trigger: passive, target: all_items, filter: { tags_any: [weapon] }, action: add_stat_pct, stat: damage_pct, amount: 25, amount_from: { missing_hp: true, factor: 0.25, max: 25 } }']);
    expect(playerHits(fightWith(data, ['blade']))[0]).toBe(100_000);
    expect(playerHits(fightWith(data, ['halfstone', 'blade']))[0]).toBeCloseTo(112_500);
  });

  it('enhanced cells + add_inflict_pct (Poison Coating)', () => {
    const data = withSkill(['{ trigger: battle_start, target: all_items, filter: { enhanced: true }, action: add_inflict_pct, status: poison, amount: 50 }']);
    const layout = (enhanced: boolean) =>
      LayoutSchema.parse({ placements: [{ id: 'p', item: 'poisoner', x: 0, y: 0, rotation: 0 }], ...(enhanced ? { enhanced_cells: [{ x: 0, y: 0 }] } : {}) });
    const run = (enhanced: boolean) => {
      const base = combatLoadout([], '', data, heroProfile());
      return runBattle(buildLoadout(data, base.profile, layout(enhanced)), ENEMY({ hp: '900B', ...calm }), { durationS: 0.1 }).enemy.statuses.poison;
    };
    expect(run(false)).toBe(10);
    expect(run(true)).toBe(15);
  });

  it('on_status_removed with every, and pick_random (Backmasking)', () => {
    const data = withSkill(['{ trigger: on_status_removed, params: { statuses: [dodge] }, every: 20, target: all_items, filter: { tags_any: [spell] }, action: activate_item, pick_random: 1 }']);
    const r = fightWith(data, ['dodgebreaker', 'bolt', 'echo'], { starting_statuses: [{ status: 'dodge', stacks: 20 }] }, 0.5);
    const acts = r.log.filter((e) => e.type === 'activation' && /Bolt|Echo/.test(e.detail ?? ''));
    expect(acts).toHaveLength(1);
  });

  it('min_event_amount: On Over Heal only fires with overheal (Fairy Wisdom)', () => {
    const data = withSkill(['{ trigger: on_heal, watch: any, min_event_amount: 0, target: player, action: apply_status, status: focus, stacks: 3 }']);
    expect(fightWith(data, ['potion'], {}, 2.05).player.statuses.focus).toBe(6); // full HP: every heal overheals
    expect(fightWith(data, ['bloodstone', 'potion'], {}, 2.05, '').player.statuses.focus ?? 0).toBe(0);
  });

  it('stun rate adds points to chances to Stun (Electrostatic Force)', () => {
    const items = `- { id: shaky, name: Shaky, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000, crit_chance: 0 }, effects: [{ trigger: on_hit, chance_pct: 0, target: enemy, action: apply_status, status: stun, stacks: 1, duration_s: 0.5 }], ${P} }`;
    const without = withSkill([], items);
    const withRate = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: stun_rate, amount: 100 }'], items);
    const stuns = (d: ReturnType<typeof withSkill>) => fightWith(d, ['shaky'], {}, 3).log.filter((e) => e.detail?.includes('stun on')).length;
    expect(stuns(without)).toBe(0);
    expect(stuns(withRate)).toBe(3);
  });

  it('status duration bonus makes timed Burn last longer (Snowball Fight)', () => {
    const data = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: burn_duration_bonus_s, amount: 1 }']);
    const r = fightWith(data, ['timedburn'], {}, 3.5);
    expect(r.enemy.statuses.burn).toBe(10); // 3s + 1s
    expect(fightWith(withSkill([]), ['timedburn'], {}, 3.5).enemy.statuses.burn ?? 0).toBe(0);
  });
});

describe('skills finished with in-game numbers', () => {
  it('Flesh Burst: losing HP myself removes 50% / 10% Block and deals 3x ATK + 0.4x ATK per 100% max HP of Block removed', () => {
    const data = withSkill([
      '{ trigger: on_self_hp_loss, target: player, action: remove_block, pct_of_current: 50 }',
      '{ trigger: on_self_hp_loss, target: enemy, action: remove_block, pct_of_current: 10 }',
      '{ trigger: on_self_hp_loss, target: enemy, action: deal_damage, damage_type: weapon, value: { ratio: 3.0, scales_with: atk }, bonus_per_removed_block: { ratio: 0.4, scales_with: atk } }',
    ]);
    // HP 1M, ATK 100K. Two Shields give me 1M Block → 500K removed; enemy Block 5M → 500K removed. 1M removed = 100% of max HP → +40K.
    const r = fightWith(data, ['shield', 'shield', 'halfstone'], { block: '5M' }, 0.1);
    expect(r.player.block).toBeCloseTo(500_000);
    const burst = r.log.find((e) => e.type === 'damage' && e.side === 'player')!;
    expect(burst.detail).toMatch(/weapon/);
    expect(burst.amount).toBeCloseTo(340_000); // all of it into the enemy's remaining Block
  });

  it("Spearman's Pride: +30%, -10% per non-Spear weapon item (not gear), not below 0", () => {
    const items = `- { id: spike_spear, name: Spike Spear, rarity: common, tags: [weapon, spear], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000, crit_chance: 0 }, ${P} }`;
    const data = withSkill(['{ trigger: passive, target: all_items, filter: { tags_any: [spear] }, action: add_stat_pct, stat: damage_pct, amount: 30, per_bag_reduce: { tags_any: [weapon], tags_none: [spear], exclude_gear: true, step: 10, min: 0 } }'], items);
    const spearHit = (extra: string[]) => fightWith(data, ['spike_spear', ...extra], {}, 1.05).log.find((e) => e.type === 'damage' && e.source === 'spike_spear0')!.amount;
    expect(spearHit([])).toBeCloseTo(130_000);
    expect(spearHit(['rock'])).toBeCloseTo(120_000);
    expect(spearHit(['rock', 'rock', 'rock', 'rock'])).toBeCloseTo(100_000);
  });

  it('Snowball Fight: a chance to keep Freeze an item would consume', () => {
    const items = `- { id: icebreaker, name: Icebreaker, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, priority: 90, target: enemy, action: remove_status, status: freeze, count: 100, consume: true }], ${P} }`;
    const keep = withSkill(['{ trigger: passive, target: player, action: add_player_stat, player_stat: freeze_keep_on_consume_pct, amount: 100 }'], items);
    const plain = withSkill([], items);
    expect(fightWith(keep, ['froster', 'icebreaker'], {}, 0.1).enemy.statuses.freeze).toBe(100);
    expect(fightWith(plain, ['froster', 'icebreaker'], {}, 0.1).enemy.statuses.freeze ?? 0).toBe(0);
  });
});

describe('real hero data', () => {
  const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
  it('every hero skill is entered (effects, shop, or waiting on numbers)', () => {
    for (const h of real.heroes.values()) for (const s of h.skills) expect(h.skill_effects[s.id], `${h.id}.${s.id}`).toBeDefined();
  });

  it("Erwen's Chasing Arrow: every 10 Swift gained → 3 Focus", () => {
    const profile = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 4M, atk: 1M, initial_block: 0 }\nheroes: [{ id: erwen, stars: 5 }]\nactive_hero: erwen\n' }, real).profile!;
    const lo = buildLoadout(
      real,
      profile,
      LayoutSchema.parse({ placements: [{ item: 'wind_spirit', x: 2, y: 2, rotation: 0 }, { item: 'spirit_stone', x: 3, y: 1, rotation: 0 }] }),
    );
    const r = runBattle(lo, ENEMY({ hp: '900B', ...calm }), { durationS: 0.1, log: true });
    const swift = r.player.statuses.swift ?? 0;
    expect(swift).toBeGreaterThanOrEqual(10);
    expect(r.player.statuses.focus).toBe(3 * Math.floor(swift / 10));
  });
});

describe('pet battle effects', () => {
  const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
  const run = (stars: number) => {
    const profile = loadProfile(
      { path: 'p.yaml', text: `basic_stats: { hp: 4M, atk: 1M, initial_block: 0 }\npets: [{ id: red_dragon, stars: ${stars}, active: true }]\n` },
      real,
    ).profile!;
    const lo = buildLoadout(real, profile, LayoutSchema.parse({ placements: [] }));
    return runBattle(lo, ENEMY({ hp: '1B', ...calm }), { durationS: 0.1 });
  };
  it("Red Dragon's Dragon Fire deals % of the enemy's max HP at its star level, shown as its own row", () => {
    const dmg = (stars: number) => Object.values(run(stars).items).find((i) => i.name === 'Red Dragon: Dragon Fire')!.damage;
    expect(dmg(0)).toBeCloseTo(300_000_000);
    expect(dmg(2)).toBeCloseTo(400_000_000);
    expect(dmg(5)).toBeCloseTo(500_000_000);
    expect(run(4).enemy.statuses.burn).toBe(10);
  });
});

describe('debuff reflect skips stat-like debuffs (user, 2026-10-18)', () => {
  it("Heal Amount Reduction can't be reflected; Burn still is", async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parse } = await import('yaml');
    const { runBattle } = await import('../../src/engine/combat/battle');
    const { resolveEnemies } = await import('../../src/engine/combat/montecarlo');
    const { loadProfile } = await import('../../src/engine/loader');
    const { loadGameDataFromDir } = await import('../../src/engine/loader-node');
    const { applySetup } = await import('../../src/engine/layoutSetup');
    const { buildLoadout } = await import('../../src/engine/loadout');
    const { LayoutSchema } = await import('../../src/engine/model');
    const root = join(__dirname, '..', '..');
    const data = loadGameDataFromDir(join(root, 'data')).data;
    const prof = loadProfile({ path: 'p', text: readFileSync(join(root, 'profile/profile.yaml'), 'utf8') }, data).profile!;
    const me = LayoutSchema.parse(parse(readFileSync(join(root, 'layouts/trixie spike.yaml'), 'utf8')));
    const lo = buildLoadout(data, applySetup(prof, me.setup), me);
    const enemy = resolveEnemies(data, { mode: 'stage', enemy: me.battle!.enemy } as never);
    const r = runBattle(lo, enemy, { mode: 'stage', seed: 12, log: true });
    expect(r.enemy.statuses.heal_amount_reduction ?? 0).toBe(0);
    expect(r.log.some((e) => /reflects \d+ heal_amount_reduction/.test(e.detail ?? ''))).toBe(false);
    expect(r.log.some((e) => /reflects \d+ burn/.test(e.detail ?? ''))).toBe(true);
  }, 30_000);
});
