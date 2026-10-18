/** Generic effect types added for the gear (gear effects batch 1), and the real gear data. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { BattleEvent } from '../../src/engine/combat/types';
import { formatIssue, loadGameData, loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildLoadout, nextGearDef } from '../../src/engine/loadout';
import { LayoutSchema, RARITIES } from '../../src/engine/model';
import { aggregateStats } from '../../src/engine/stats';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const G = 'source: manual, verified: true';
const BA = 'basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 100, accuracy: 1000 }';
const data = combatData([
  {
    path: 'items/manual/gear-effects.yaml',
    text: `
- { id: spike10, name: Spike 10, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 10 }], ${P} }
- { id: spike12, name: Spike 12, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 12 }], ${P} }
- { id: spiketrig, name: Spike Trigger, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, priority: 90, target: player, action: trigger_status, status: spike, count: 3 }], ${P} }
- { id: poison10, name: Poison 10, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: poison, stacks: 10 }], ${P} }
- { id: popone, name: Pop One, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, priority: 90, target: enemy, action: trigger_status, status: poison }], ${P} }
- { id: popthree, name: Pop Three, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, priority: 90, target: enemy, action: trigger_status, status: poison, amount: 3 }], ${P} }
- { id: grow20, name: Grow 20, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, priority: 90, target: enemy, action: multiply_status, status: poison, pct: 20 }], ${P} }
- { id: freezer, name: Freezer, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 0.01, scales_with: atk }, cooldown: 1, accuracy: 1000 }, effects: [{ trigger: on_hit, target: enemy, action: apply_status, status: freeze, stacks: 30 }], ${P} }
- { id: biter, name: Biter, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_status_applied, watch: any, params: { status: freeze }, every: 100, target: enemy, action: apply_status, status: frostbite, stacks: 1 }], ${P} }
- { id: blazer, name: Blazer, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 0.01, scales_with: atk }, cooldown: 1, accuracy: 1000 }, effects: [
    { trigger: on_status_applied, watch: any, params: { status: burn }, every: 35, target: self_item, action: attack },
    { trigger: on_hit, target: enemy, action: apply_status, status: burn, stacks: 20 } ], ${P} }
- { id: blocker, name: Blocker, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: player, action: gain_block, value: { ratio: 0.4, scales_with: hp } }], ${P} }
- { id: gracemaker, name: Graceful, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_block_gained, every: { ratio: 1, scales_with: hp }, target: player, action: apply_status, status: divine_grace, stacks: 1 }], ${P} }
- { id: blockrage, name: Rager, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: passive, condition: { has_block: true }, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount: 30 }], ${P} }
- { id: converter, name: Converter, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_heal, watch: any, target: player, action: gain_block, event_pct: 25 }], ${P} }
- { id: lastspike, name: Last Spike, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: on_lethal, target: player, action: prevent_lethal, status: spike, stacks: 5, stacks_growth: 5 }], ${P} }
- { id: frosty, name: Frosty, rarity: common, tags: [tool, spell], footprint: "#", stats: { cooldown: 1 }, effects: [
    { trigger: on_activation, target: enemy, action: apply_status, status: freeze, stacks: 3 },
    { trigger: on_activation, condition: { who: enemy, status: freeze, min_stacks: 25 }, target: enemy, action: apply_status, status: stun, stacks: 1, duration_s: 0.25 },
    { trigger: on_activation, condition: { who: enemy, status: freeze, min_stacks: 25 }, target: enemy, action: remove_status, status: freeze, count: 25, count_unit: stacks, consume: true } ], ${P} }
- { id: stunrod, name: Stun Rod, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_stun, target: all_items, filter: { tags_any: [spell] }, action: activate_item }], ${P} }
- { id: savior, name: Savior, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: on_lethal, limit: { per_battle: 1 }, target: player, action: apply_status, status: invincible, stacks: 1, duration_s: 1 }], ${P} }
- { id: atkup, name: ATK Up, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: add_atk_pct, amount: 50 }], ${P} }
- { id: quick, name: Quick, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 2, accuracy: 1000 }, effects: [{ trigger: passive, target: self_item, action: add_cooldown_s, amount: -1.5 }], ${P} }
- { id: tooquick, name: Too Quick, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 2, accuracy: 1000 }, effects: [{ trigger: passive, target: self_item, action: add_cooldown_s, amount: -5 }], ${P} }
- { id: berserkpoison, name: Berserk Poison, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_berserk, target: enemy, action: apply_status, status: poison, stacks: 10 }], ${P} }
- { id: plague, name: Plague, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, pick: most_stacks_debuff, stacks: 2 }], ${P} }
- { id: unstun, name: Unstun, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 0.01, scales_with: atk }, cooldown: 0.1, accuracy: 1000 }, effects: [{ trigger: on_hit, target: enemy, action: add_combatant_stat, combat_stat: stun_resistance, amount: -5, max_stacks: 5 }], ${P} }
`,
  },
  {
    path: 'gear/manual/gear-effects.yaml',
    text: `
- { id: refundblade, name: Refund Blade, slot: weapon, tags: [weapon], footprint: "#", ${BA}, skill: { text: "", damage: { ratio: 2, scales_with: atk }, hits: 2, interval_s: 2, always_hit: true }, effects: [{ trigger: on_skill_activation, target: self_item, action: charge_skill, pct: 50 }], ${G} }
- { id: twinskill, name: Twin Skill, slot: weapon, tags: [weapon], footprint: "#", ${BA}, skill: { text: "", damage: { ratio: 2, scales_with: atk }, hits: 2, interval_s: 2, always_hit: true }, effects: [{ trigger: passive, target: self_item, action: add_skill_hits, amount: 1, gear_min_rarity: mythic }], ${G} }
- { id: growskill, name: Grow Skill, slot: weapon, tags: [weapon], footprint: "#", ${BA}, skill: { text: "", damage: { ratio: 1, scales_with: atk }, hits: 1, interval_s: 1, always_hit: true }, effects: [{ trigger: on_skill_activation, target: self_item, action: add_skill_hits, amount: 1, max_stacks: 2 }], ${G} }
- { id: doubleskill, name: Double Skill, slot: weapon, tags: [weapon], footprint: "#", ${BA}, skill: { text: "", damage: { ratio: 2, scales_with: atk }, hits: 1, interval_s: 2, always_hit: true }, effects: [{ trigger: passive, target: self_item, action: scale_skill_damage, amount: 2 }], ${G} }
- { id: tiered, name: Tiered, slot: shield, tags: [armor], footprint: "#", effects: [
    { trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 1, gear_max_rarity: rare },
    { trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 5, gear_min_rarity: epic, gear_max_rarity: legendary },
    { trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 20, gear_min_rarity: mythic } ], ${G} }
`,
  },
]);

const calm = { traits: ['short_time_limit'] };
const ATK = (damage: string, cooldown = 1) => [{ damage, cooldown, accuracy: 1000, hits: 1, crit_chance: 0 }];
const hits = (log: BattleEvent[], side: 'player' | 'enemy', prefix = 'weapon') =>
  log.filter((e) => e.type === 'damage' && e.side === side && e.detail?.startsWith(prefix)).map((e) => Math.round(e.amount!));
const run = (items: string[], enemy = {}, durationS = 1, profileExtra = '') =>
  runBattle(combatLoadout(items, '', data, profileExtra), ENEMY({ ...calm, ...enemy }), { durationS, log: true });
const gear = (slot: string, id: string, rarity = 'epic') =>
  slot === 'weapon' || slot === 'shield' ? `gear: { ${slot}: { id: ${id}, rarity: ${rarity} } }\n` : `gear: { ${slot}: [{ id: ${id}, rarity: ${rarity} }] }\n`;

describe('gear rarity ranges', () => {
  it('uses the version for the gear rarity (gear_min_rarity … gear_max_rarity)', () => {
    const spikes = (r: string) => run(['tiered'], {}, 0.1, gear('shield', 'tiered', r)).player.statuses.spike;
    expect(spikes('common')).toBe(1);
    expect(spikes('rare')).toBe(1);
    expect(spikes('epic')).toBe(5);
    expect(spikes('legendary')).toBe(5);
    expect(spikes('mythic')).toBe(20);
  });
});

describe('trigger_status and multiply_status', () => {
  it('"Activates Spike 3 times": Spike hits the enemy 3 times, one tick apart', () => {
    const r = run(['spike10', 'spiketrig'], {}, 0.3);
    expect(hits(r.log, 'player', 'status')).toEqual([100_000, 100_000, 100_000]); // 10 × 0.1 ATK each
  });

  it('"3 times the Poison DMG" is one damage instance of 3 ticks', () => {
    const one = run(['poison10', 'popone'], {}, 0.1).enemy.damageTaken;
    const three = run(['poison10', 'popthree'], {}, 0.1);
    expect(three.enemy.damageTaken).toBeCloseTo(3 * one);
    expect(hits(three.log, 'player', 'status')).toHaveLength(1);
  });

  it("raises the enemy's stacks by a percentage", () => {
    expect(run(['poison10', 'grow20'], {}, 0.1).enemy.statuses.poison).toBe(12);
  });
});

describe('"every N" triggers', () => {
  it('"On Inflicting 100 Freeze": one Frostbite per 100 Freeze, leftovers carry over', () => {
    expect(run(['freezer', 'biter'], {}, 3.5).enemy.statuses.frostbite).toBeUndefined(); // 90 Freeze
    expect(run(['freezer', 'biter'], {}, 4.5).enemy.statuses.frostbite).toBe(1); // 120
    expect(run(['freezer', 'biter'], {}, 7.5).enemy.statuses.frostbite).toBe(2); // 210
  });

  it('"Every 1.0x Block gained": one Divine Grace per max HP of Block', () => {
    expect(run(['blocker', 'gracemaker'], {}, 2.5).player.statuses.divine_grace).toBeUndefined(); // 0.8x
    expect(run(['blocker', 'gracemaker'], {}, 5.5).player.statuses.divine_grace).toBe(2); // 2.0x
  });

  it('an effect that feeds its own count fires once per threshold, not forever (Blazing Spirit)', () => {
    // Hits at 1s, 2s, 3s inflict 20 Burn each; at 40 and 45 the extra attack fires (20 more each time).
    const r = run(['blazer'], {}, 3.5);
    expect(r.log.filter((e) => e.type === 'attack' && e.side === 'player')).toHaveLength(5);
    expect(r.enemy.statuses.burn).toBe(100);
  });
});

describe('add_player_stat', () => {
  it('passive with a condition: "While Block is active, all DMG +30%"', () => {
    expect(hits(run(['rock', 'blockrage'], {}, 1.5).log, 'player')).toEqual([100_000]);
    expect(hits(run(['rock', 'blockrage', 'shield'], {}, 1.5).log, 'player')).toEqual([130_000]);
  });

  it('on a trigger: from then on (Berserk → enemy Poison here)', () => {
    expect(run(['berserkpoison'], { traits: [] }, 9.5).enemy.statuses.poison).toBeUndefined();
    expect(run(['berserkpoison'], { traits: [] }, 10.5).enemy.statuses.poison).toBe(10);
  });
});

describe('on_heal and event_pct', () => {
  it('turns 25% of the overheal into Block', () => {
    const r = run(['potion', 'converter'], {}, 1.5);
    expect(r.log.some((e) => e.type === 'block' && Math.round(e.amount!) === 25_000)).toBe(true);
  });
});

describe('skills', () => {
  it('"Refunds 50% Skill Charge" moves a timer skill forward', () => {
    const plain = runBattle(combatLoadout(['skillblade'], '', data, gear('weapon', 'skillblade')), ENEMY(calm), { durationS: 4.25, log: true });
    expect(hits(plain.log, 'player', 'skill')).toHaveLength(4); // t = 2, 4
    const r = runBattle(combatLoadout(['refundblade'], '', data, gear('weapon', 'refundblade')), ENEMY(calm), { durationS: 4.25, log: true });
    expect(hits(r.log, 'player', 'skill')).toHaveLength(6); // t = 2, 3, 4
  });

  it('add_skill_hits: passive (gated at mythic) and per activation with a cap', () => {
    const at = (r: string) => hits(run(['twinskill'], {}, 2.35, gear('weapon', 'twinskill', r)).log, 'player', 'skill').length;
    expect(at('epic')).toBe(2);
    expect(at('mythic')).toBe(3);
    // Hits 2, 3, 3, 3 at t = 1, 2, 3, 4 (max 2 extra).
    expect(hits(run(['growskill'], {}, 4.35, gear('weapon', 'growskill')).log, 'player', 'skill')).toHaveLength(11);
  });

  it('scale_skill_damage doubles the skill', () => {
    expect(hits(run(['doubleskill'], {}, 2.05, gear('weapon', 'doubleskill')).log, 'player', 'skill')).toEqual([400_000]);
  });
});

describe('the killing blow, Total ATK, cooldowns, debuff picks', () => {
  it('prevent_lethal pays a growing Spike cost to take 1 damage instead', () => {
    const r = run(['spike12', 'lastspike'], { attacks: ATK('2M', 1) }, 5);
    expect(r.log.filter((e) => e.detail?.includes('reduced to 1'))).toHaveLength(1); // 5 paid; 10 not affordable
    expect(r.statusMoves.player.spent).toEqual({ spike: 5 }); // shown as "Spent" in Buffs & debuffs
    expect(r.items.lastspike1!.spent).toEqual({ spike: 5 });
    expect(r).toMatchObject({ winner: 'enemy', reason: 'death' });
    expect(r.fights[0]!.duration).toBe(2);
  });

  it('prevent_lethal pays nothing when another on_lethal effect already made me Invincible', () => {
    const r = run(['spike12', 'savior', 'lastspike'], { attacks: ATK('2M', 1) }, 5);
    const lethal = r.log.filter((e) => e.detail?.includes('killing blow') || e.detail?.includes('consumes'));
    expect(lethal[0]!.detail).toContain('avoids the killing blow'); // Savior's Invincible, no Spike paid
    expect(r.log.find((e) => e.detail?.includes('consumes'))!.detail).toContain('consumes 5 spike');
    expect(r.lethalSavesLeft.player).toBe(0); // Savior's once-per-battle save was used
    expect(run(['savior'], {}, 0.5).lethalSavesLeft).toEqual({ player: 1, enemy: 0 });
  });

  it('an item set off by an activation goes after it: Stun → Rod → Instant Freeze runs out of Freeze on its own', () => {
    // 100 Freeze: +3, Stun (queues Frosty again), spend 25 → 78 … until under 25. No endless loop, no cut-off.
    const r = run(['frosty', 'stunrod'], { starting_statuses: [{ status: 'freeze', stacks: 100 }] }, 1.05);
    expect(r.items.frosty0!.activations).toBe(5);
    expect(r.log.filter((e) => e.detail?.includes('loses 25 freeze'))).toHaveLength(4);
    expect(r.statusMoves.player).toMatchObject({ spent: { freeze: 100 }, removed: 0, stolen: 0 }); // a cost, not a removal
    expect(r.warnings.filter((w) => /endless loop/.test(w))).toEqual([]);
  });

  it('add_atk_pct raises weapon damage from then on', () => {
    expect(hits(run(['rock', 'atkup'], {}, 1.5).log, 'player')).toEqual([150_000]);
  });

  it('add_cooldown_s changes the base cooldown, not below the minimum', () => {
    const s = aggregateStats(combatLoadout(['quick', 'tooquick'], '', data)).items;
    expect(s.get('quick0')!.cooldown!.base).toBe(0.5);
    expect(s.get('tooquick1')!.cooldown!.base).toBe(data.config!.timing.min_cooldown_seconds);
  });

  it("picks the enemy's most common debuff", () => {
    const r = run(['plague'], { starting_statuses: [{ status: 'burn', stacks: 5 }, { status: 'poison', stacks: 8 }] }, 0.1);
    expect(r.enemy.statuses).toMatchObject({ burn: 5, poison: 10 });
  });

  it('add_combatant_stat respects max_stacks', () => {
    const r = run(['unstun'], {}, 1.05);
    expect(r.log.filter((e) => e.detail?.includes('stun_resistance -5'))).toHaveLength(5);
  });
});

// ---------------------------------------------------------------- the real gear data

describe('real gear effects (batch 1)', () => {
  // The real data plus a stand-in 1-cell shape and basic attack for every gear piece.
  const files = readDataDir(join(__dirname, '..', '..', 'data'));
  const base = loadGameData(files);
  const stand = [...base.data.gear.values()]
    .map((g) => `- { id: ${g.id}, footprint: "#"${g.slot === 'weapon' || g.slot === 'ring' ? `, basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 3, accuracy: 100${g.basic_attack?.hits ? `, hits: ${g.basic_attack.hits}` : ''} }` : ''}, source: manual, verified: false }`)
    .join('\n');
  const res = loadGameData([...files, { path: 'gear/manual/zz_test_shapes.yaml', text: stand }]);

  it('loads, and every gear piece has structured effects or a structured skill', () => {
    expect(res.errors.map(formatIssue)).toEqual([]);
    for (const g of res.data.gear.values()) {
      expect(g.effects.length > 0 || g.skill?.interval_s !== undefined, g.id).toBe(true);
      expect(g.effects_status, g.id).toBeDefined();
    }
  });

  it('every gear piece runs a battle at every rarity using only simulated actions', () => {
    for (const g of res.data.gear.values()) {
      const slot = { weapon: 'weapon', shield: 'shield', ring: 'rings', glove: 'gloves' }[g.slot];
      for (const rarity of RARITIES) {
        const pr = loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\n${gear(slot, g.id, rarity)}` }, res.data);
        expect(pr.issues.filter((i) => i.level === 'error').map(formatIssue), g.id).toEqual([]);
        const lo = buildLoadout(res.data, pr.profile!, LayoutSchema.parse({ placements: [{ id: 'g', item: g.id, x: 0, y: 0, rotation: 0, supply: false }] }));
        const r = runBattle(lo, ENEMY({ hp: '50M', attacks: ATK('100K', 2) }), { durationS: 20, seed: 1 });
        const bad = r.warnings.filter((w) => /isn't simulated|unknown|can't work out|only works with|without/.test(w));
        expect(bad, `${g.id} @ ${rarity}`).toEqual([]);
      }
    }
  });
});

describe('rarity footprints (gloves +2 dot slots)', () => {
  const files = readDataDir(join(__dirname, '..', '..', 'data'));
  const real = loadGameData(files).data;
  const dotsAt = (rarity: string) => {
    const pr = loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\ngear: { gloves: [{ id: brawlers_gloves, rarity: ${rarity} }] }\n` }, real);
    const lo = buildLoadout(real, pr.profile!, LayoutSchema.parse({ placements: [{ id: 'g', item: 'brawlers_gloves', x: 3, y: 0, rotation: 0, supply: false }] }));
    return lo.layout.items.get('g')!.dots.map((d) => d.x).sort();
  };

  it('uses o#o below epic and oo#oo from epic', () => {
    expect(dotsAt('rare')).toEqual([2, 4]);
    expect(dotsAt('epic')).toEqual([1, 2, 4, 5]);
    expect(dotsAt('mythic')).toEqual([1, 2, 4, 5]);
  });

  it('gives every ring the standard basic attack', () => {
    expect(real.gear.get('natures_ring')!.basic_attack).toMatchObject({ cooldown: 6, accuracy: 85, crit_chance: 0, hits: 1 });
    expect(real.gear.get('gold_ring')!.tags).toEqual(['weapon']);
    expect(real.gear.get('brawlers_gloves')!.tags).toEqual(['armor']);
  });
});

describe('S gear wiki values are the epic version', () => {
  const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
  it('no S gear effect is capped below epic or re-adds a ≤rare number already in the base', () => {
    const low = ['common', 'uncommon', 'rare'];
    for (const g of real.gear.values()) {
      if (!g.s_rank) continue;
      for (const e of g.effects) expect(low.includes(e.gear_max_rarity ?? 'mythic'), `${g.id}: ${e.text}`).toBe(false);
    }
    const plague = real.gear.get('gloves_of_plague')!.effects.filter((e) => e.trigger === 'on_weapon_hit');
    expect(plague.map((e) => e.chance_pct)).toEqual([50]);
    expect(real.gear.get('brawlers_gloves')!.effects.filter((e) => e.stat === 'crit_chance_pct').map((e) => e.amount)).toEqual([15]);
  });

  it('the next glove to place has the footprint for its equipped rarity', () => {
    const profile = loadProfile(
      { path: 'p.yaml', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\ngear:\n  gloves: [{ id: gloves_of_plague, rarity: epic, tier: 0 }]\n' },
      real,
    ).profile!;
    const lo = buildLoadout(real, profile, LayoutSchema.parse({ placements: [] }));
    expect(nextGearDef(lo, 'gloves_of_plague')!.footprint).toBe('oo#oo');
  });
});
