/** Small game data for combat tests: real config / stats / statuses, test items. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type BattleOptions, runBattle } from '../src/engine/combat/battle';
import type { EnemyInput } from '../src/engine/combat/setup';
import { type GameData, type SourceFile, formatIssue, loadGameData, loadProfile } from '../src/engine/loader';
import { buildLoadout } from '../src/engine/loadout';
import { LayoutSchema } from '../src/engine/model';

const DATA = join(__dirname, '..', 'data');
const read = (p: string): SourceFile => ({ path: p, text: readFileSync(join(DATA, p), 'utf8') });
const statusFiles = ['statuses/wiki', 'statuses/manual'].flatMap((d) => readdirSync(join(DATA, d)).map((f) => read(`${d}/${f}`)));

const P = 'value: 1, source: manual, verified: true';
const W = (dmg: number, cd: number | null, acc = 1000, extra = '') =>
  `stats: { damage: { ratio: ${dmg}, scales_with: atk }${cd !== null ? `, cooldown: ${cd}` : ''}, accuracy: ${acc}${extra} }`;

export const COMBAT_ITEMS = `
- { id: blade, name: Blade, rarity: common, tags: [weapon, sword], footprint: "#", ${W(1, 2, 100)}, ${P} }
- { id: sure, name: Sure Shot, rarity: common, tags: [weapon], footprint: "#", ${W(1, 0.1)}, ${P} }
- { id: blind, name: Blind Shot, rarity: common, tags: [weapon], footprint: "#", ${W(1, 0.1, 0)}, ${P} }
- { id: true_shot, name: True Shot, rarity: common, tags: [weapon], footprint: "#", ${W(1, 0.1, 100)}, ${P} }
- { id: triple, name: Triple, rarity: common, tags: [weapon], footprint: "#", ${W(1, 2, 1000, ', hits: 3')}, ${P} }
- { id: rock, name: Rock, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1, 1000, ', max_attacks: 1')}, ${P} }
- { id: staff, name: Staff, rarity: common, tags: [weapon, staff], footprint: "#o", ${W(0.5, 2)}, effects: [{ trigger: on_attack, uses_dots: true, target: items_under_dots, filter: { tags_any: [spell] }, action: activate_item }], ${P} }
- { id: bolt, name: Bolt, rarity: common, tags: [weapon, spell], footprint: "#", ${W(2, null)}, ${P} }
- { id: echo, name: Echo, rarity: common, tags: [weapon, spell], footprint: "#", ${W(1, null)}, effects: [{ trigger: on_hit, target: self_item, action: activate_item }], ${P} }
- { id: burner, name: Burner, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: on_hit, target: enemy, action: apply_status, status: burn, stacks: 1.5 }], ${P} }
- { id: froster, name: Froster, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: freeze, stacks: 100 }], ${P} }
- { id: poisoner, name: Poisoner, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: poison, stacks: 10 }], ${P} }
- { id: burnstart, name: Burn Start, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: burn, stacks: 10 }], ${P} }
- { id: spiker, name: Spiker, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 10 }], ${P} }
- { id: vamper, name: Vamper, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: vamp, stacks: 10 }], ${P} }
- { id: swifter, name: Swifter, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: swift, stacks: 25 }], ${P} }
- { id: focuser, name: Focuser, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: focus, stacks: 50 }], ${P} }
- { id: shield, name: Shield, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: battle_start, target: player, action: gain_block, value: { ratio: 0.5, scales_with: hp } }], ${P} }
- { id: breaker, name: Breaker, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: on_hit, target: enemy, action: remove_block, value: { ratio: 1, scales_with: atk } }], ${P} }
- { id: potion, name: Potion, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: player, action: heal, value: heal }], effect_values: { heal: { ratio: 0.1, scales_with: hp } }, ${P} }
- { id: bloodstone, name: Bloodstone, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: lose_hp, value: { ratio: 2, scales_with: hp } }], ${P} }
- { id: halfstone, name: Halfstone, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: lose_hp, value: { ratio: 0.5, scales_with: hp } }], ${P} }
- { id: dog, name: Dog, rarity: common, tags: [weapon, creature], footprint: "#o", ${W(1, 100)}, effects: [{ trigger: on_weapon_hit, watch: dots, watch_filter: { tags_any: [weapon] }, target: self_item, action: attack }], ${P} }
- { id: dagger, name: Dagger, rarity: common, tags: [weapon], footprint: "o#", ${W(1, 10)}, effects: [{ trigger: on_weapon_hit, watch: dots, target: self_item, action: refund_cooldown, pct: 50 }], ${P} }
- { id: lowhp, name: Last Stand, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: hp_below, hp_pct: 50, target: player, action: heal, value: { ratio: 0.3, scales_with: hp }, limit: { per_battle: 1 } }], ${P} }
- { id: dodger, name: Dodger, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_dodge, target: player, action: gain_block, value: { ratio: 0.01, scales_with: hp } }], ${P} }
- { id: opener, name: Opener, rarity: common, tags: [weapon], footprint: "#", ${W(1, 100)}, effects: [{ trigger: battle_start, target: self_item, action: attack }], ${P} }
- { id: weird, name: Weird, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: spawn_item, item: rock }, { trigger: battle_start, target: player, action: gain_block, value: { ratio: 1, scales_with: hp }, condition: { who: enemy, status: burn } }], ${P} }
- { id: hasty, name: Hasty, rarity: common, tags: [tool], footprint: "o#", effects: [{ trigger: battle_start, uses_dots: true, target: items_under_dots, action: add_stat_pct, stat: haste_pct, amount: 25 }], ${P} }
- { id: stunner, name: Stunner, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: on_hit, target: enemy, action: apply_status, status: stun, stacks: 1, duration_s: 1.5 }], ${P} }
- { id: stunwatch, name: Stun Watch, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_stun, target: player, action: gain_block, value: { ratio: 0.01, scales_with: hp } }], ${P} }
- { id: sealer, name: Sealer, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: on_attacked, target: event_item, action: seal_item, duration_s: 2.5 }], ${P} }
- { id: invincer, name: Invincer, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: invincible, stacks: 1, duration_s: 2.5 }], ${P} }
- { id: harself, name: Bad Luck, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: heal_amount_reduction, stacks: 50 }], ${P} }
- { id: timedburn, name: Timed Burn, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: burn, stacks: 10, duration_s: 3 }], ${P} }
- { id: selfpoison, name: Self Poison, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: poison, stacks: 10 }, { trigger: battle_start, target: player, action: apply_status, status: freeze, stacks: 4 }], ${P} }
- { id: cleanser, name: Cleanser, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: player, action: cleanse, count: 5 }], ${P} }
- { id: purger, name: Purger, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: player, action: cleanse, count: 1, count_unit: statuses }], ${P} }
- { id: remover, name: Remover, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: enemy, action: remove_status, count: 3 }], ${P} }
- { id: dodgebreaker, name: Dodge Breaker, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: remove_status, status: dodge, count: 20 }], ${P} }
- { id: stealer, name: Stealer, rarity: common, tags: [tool], footprint: "#", stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: enemy, action: steal_status, count: 3 }], ${P} }
- { id: reducer, name: Reducer, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: before_attacked, target: player, action: reduce_hit_damage, pct: 50 }], ${P} }
- { id: plate, name: Plate, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: passive, target: player, action: add_combatant_stat, combat_stat: attack_dmg_reduction, amount: 30 }], ${P} }
- { id: rager, name: Rager, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: battle_start, target: self_item, action: add_stat_pct, stat: damage_pct, amount: 100, duration_s: 2.5 }], ${P} }
- { id: spiky, name: Spiky, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 5 }, { trigger: passive, target: self_item, action: add_stat_pct, stat: damage_pct, amount: 10, per_status: { status: spike, on: self } }], ${P} }
- { id: graceful, name: Graceful, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: divine_grace, stacks: 2 }], ${P} }
- { id: cushion, name: Cushion, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: apply_status, status: waterdrop_cushion, stacks: 50 }], ${P} }
- { id: egg, name: Egg, rarity: common, kind: pet_spawn, tags: [creature], footprint: "#", temporary: true, effects: [{ trigger: timer, at_s: 1, target: self_item, action: transform_item, item: bug }], value: 0, source: manual, verified: true }
- { id: bug, name: Bug, rarity: common, kind: pet_spawn, tags: [creature], footprint: "#", temporary: true, stats: { cooldown: 1 }, effects: [{ trigger: on_activation, target: enemy, action: apply_status, status: poison, stacks: 1 }], value: 0, source: manual, verified: true }
- { id: greatblade, name: Great Blade, rarity: common, tags: [weapon], footprint: "o#o", ${W(1, 1)}, effects: [{ trigger: battle_start, target: self_item, action: add_stat_pct, stat: damage_pct, amount: 18, per_dot: { tags_any: [armor] } }], ${P} }
- { id: tallcount, name: Tall Count, rarity: common, tags: [weapon], footprint: "#o / .o", ${W(1, 1)}, effects: [{ trigger: battle_start, target: self_item, action: add_stat_pct, stat: damage_pct, amount: 18, per_dot: { tags_any: [armor] } }], ${P} }
- { id: tallarmor, name: Tall Armor, rarity: common, tags: [armor], footprint: "# / #", ${P} }
- { id: spiritstone, name: Spirit Stone, rarity: common, tags: [tool], footprint: "o#o", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: burn, stacks: 4, per_dot: { tags_any: [spirit] } }], ${P} }
- { id: spirit, name: Spirit, rarity: common, tags: [tool, spirit], footprint: "#", ${P} }
- { id: magicshield, name: Magic Shield, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: before_attacked, target: player, action: reduce_hit_damage, pct: 40, condition: { has_block: true } }], ${P} }
- { id: angel, name: Angel, rarity: common, tags: [armor], footprint: "#", effects: [{ trigger: on_lethal, target: player, action: apply_status, status: invincible, stacks: 1, duration_s: 2, limit: { per_battle: 1 } }, { trigger: on_lethal, target: player, action: heal, value: { ratio: 1, scales_with: hp }, limit: { per_battle: 1 } }], ${P} }
- { id: screamer, name: Screamer, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: on_crit, target: player, action: charge_counter, status: scream, pct: 50 }, { trigger: on_lethal, target: enemy, action: release_counter, status: scream }], ${P} }
- { id: wisher, name: Wisher, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: on_restun, target: player, action: apply_status, status: wish, stacks: 1 }], ${P} }
- { id: earlybird, name: Early Bird, rarity: common, tags: [weapon], footprint: "#", ${W(1, 100)}, effects: [{ trigger: battle_start, target: self_item, action: attack, priority: 1 }], ${P} }
- { id: bomb, name: Bomb, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: deal_damage, value: { ratio: 1, scales_with: atk }, damage_type: weapon }], ${P} }
- { id: softbomb, name: Soft Bomb, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: deal_damage, value: { ratio: 1, scales_with: atk } }], ${P} }
- { id: whipper, name: Whipper, rarity: common, tags: [weapon], footprint: "#", ${W(1, 1)}, effects: [{ trigger: on_hit, target: self_item, action: add_stat_pct, stat: damage_pct, amount: 10, max_stacks: 3 }], ${P} }
`;

export const COMBAT_GEAR = `
- { id: skillblade, name: Skill Blade, slot: weapon, tags: [weapon, sword], footprint: "#", basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 100, accuracy: 1000 }, skill: { text: "", damage: { ratio: 2, scales_with: atk }, hits: 2, interval_s: 2, always_hit: true }, source: manual, verified: true }
- { id: meteor, name: Meteor, slot: weapon, tags: [weapon], footprint: "#", basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 100, accuracy: 1000 }, skill: { text: "", damage: { ratio: 1, scales_with: atk }, hits: 1, interval_s: 2, always_hit: true, extra_hits_per_status: wish }, effects: [{ trigger: battle_start, target: player, action: apply_status, status: wish, stacks: 2 }], source: manual, verified: true }
- { id: gaugeblade, name: Gauge Blade, slot: weapon, tags: [weapon], footprint: "#", basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000 }, skill: { text: "", damage: { ratio: 3, scales_with: atk }, gauge: true, always_hit: true }, effects: [{ trigger: on_hit, target: self_item, action: charge_skill, pct: 50 }], source: manual, verified: true }
`;

export const COMBAT_PETS = `
- { id: spawner, name: Spawner, rarity: rare, activation_cost: 1, skill: { name: Eggs, text: "" }, role: bag_items, spawns: [{ item: egg, count: 3, stars: 0 }], spawn_inflict_multiplier: [{ stars: 1, status: poison, factor: 2 }], source: manual, verified: true }
`;

export function combatData(extra: SourceFile[] = []): GameData {
  const res = loadGameData([
    read('config.yaml'),
    read('stats.yaml'),
    ...statusFiles,
    { path: 'items/manual/test.yaml', text: COMBAT_ITEMS },
    { path: 'gear/manual/test.yaml', text: COMBAT_GEAR },
    { path: 'pets/manual/test.yaml', text: COMBAT_PETS },
    ...extra,
  ]);
  if (!res.ok) throw new Error(res.errors.map(formatIssue).join('\n'));
  return res.data;
}

export const DATA_ = combatData();

/** Profile: HP 1M, ATK 100K, no block, everything else 0 unless given. `extra` is more profile YAML. */
export function combatProfile(detailed = '', data = DATA_, extra = '') {
  const res = loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\ndetailed_stats: { ${detailed} }\n${extra}` }, data);
  if (!res.profile) throw new Error(res.issues.map(formatIssue).join('\n'));
  return res.profile;
}

/** Items in a row on the top line of the bag (x = index), or explicit "id@x,y". */
export function combatLoadout(items: string[], detailed = '', data = DATA_, profileExtra = '', mask?: number[]) {
  const placements = items.map((s, i) => {
    const [id, at] = s.split('@');
    const [x, y] = at ? at.split(',').map(Number) : [i * 2 % 8, Math.floor((i * 2) / 8)];
    return { id: `${id}${i}`, item: id!, x: x!, y: y!, rotation: 0 as const, supply: false };
  });
  return buildLoadout(data, combatProfile(detailed, data, profileExtra), LayoutSchema.parse({ placements, ...(mask ? { bag: { mask } } : {}) }));
}

export const ENEMY = (patch: Partial<EnemyInput> = {}): EnemyInput => ({
  id: 'dummy',
  name: 'Dummy',
  hp: '1B',
  atk: '100K',
  block: 0,
  damage_reduction: 0,
  attacks: [],
  boss: false,
  starting_statuses: [],
  resistances: {},
  vulnerabilities: {},
  immunities: [],
  traits: [],
  ...patch,
});

export function fight(items: string[], enemy: Partial<EnemyInput> = {}, opts: BattleOptions & { stats?: string } = {}) {
  const { stats, ...o } = opts;
  return runBattle(combatLoadout(items, stats), ENEMY(enemy), { log: true, ...o });
}

export const parseLayout = (yaml: string) => LayoutSchema.parse(parse(yaml));
