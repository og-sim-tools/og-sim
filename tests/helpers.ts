/** Small in-memory game data for engine tests (real config.yaml and stats.yaml). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type GameData, type SourceFile, formatIssue, loadGameData, loadProfile } from '../src/engine/loader';
import { type Loadout, buildLoadout } from '../src/engine/loadout';
import { LayoutSchema, type Profile } from '../src/engine/model';

const DATA = join(__dirname, '..', 'data');
const BASE: SourceFile[] = [
  { path: 'config.yaml', text: readFileSync(join(DATA, 'config.yaml'), 'utf8') },
  { path: 'stats.yaml', text: readFileSync(join(DATA, 'stats.yaml'), 'utf8') },
];

const prov = 'source: manual, verified: true';

/** Test items: footprints, tags and effects chosen to exercise the engine. */
export const ITEMS = `
- { id: sword, name: Sword, rarity: common, tags: [weapon, sword], class_restriction: [warrior], footprint: "# / #", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 2, accuracy: 80 }, value: 4, ${prov} }
- { id: pup, name: Pup, rarity: rare, tags: [weapon, creature], footprint: "#", stats: { damage: { ratio: 2, scales_with: atk }, cooldown: 3, accuracy: 85, crit_chance: 10, hits: 2 }, value: 4, ${prov} }
- { id: bow, name: Bow, rarity: rare, tags: [weapon, bow], class_restriction: [ranger], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 55 }, value: 4, ${prov} }
- { id: rock, name: Rock, rarity: common, tags: [tool], footprint: "#", value: 1, ${prov} }
- id: glove
  name: Glove
  rarity: rare
  tags: [armor]
  footprint: "o#o"
  effects:
    - { trigger: battle_start, uses_dots: true, target: items_under_dots, action: add_stat_pct, stat: haste_pct, amount: 15 }
  value: 5
  ${prov.replace(', ', '\n  ')}
- id: stone
  name: Stone
  rarity: uncommon
  tags: [tool]
  footprint: "ooo / o#o / ooo"
  effects:
    - { trigger: battle_start, uses_dots: true, target: items_under_dots, filter: { tags_any: [weapon] }, action: add_stat_pct, stat: damage_pct, amount: 30 }
    - { trigger: battle_start, uses_dots: true, target: items_under_dots, filter: { tags_any: [creature] }, action: add_stat_pct, stat: crit_damage_pct, amount: 40 }
    - { trigger: on_hit, uses_dots: true, target: items_under_dots, action: add_stat_pct, stat: haste_pct, amount: 99 }
  value: 3
  ${prov.replace(', ', '\n  ')}
- { id: scope, name: Scope, rarity: uncommon, tags: [tool], footprint: "o##", effects: [{ trigger: battle_start, uses_dots: true, target: items_under_dots, filter: { tags_any: [weapon] }, action: add_stat_pct, stat: accuracy_pct, amount: 45 }], value: 6, ${prov} }
- { id: potion, name: Potion, rarity: common, tags: [tool, potion], footprint: "#", effect_values: { heal: { ratio: 0.1, scales_with: hp } }, value: 3, ${prov} }
- { id: relic, name: Relic, rarity: epic, tags: [tool], class_restriction: [warrior], hero_exclusive: alpha, footprint: "#", value: 0, ${prov} }
- { id: legend, name: Legend, rarity: legendary, tags: [tool], footprint: "#", value: 9, ${prov} }
- { id: egg, name: Egg, rarity: common, kind: pet_spawn, tags: [creature], footprint: "#", value: 0, ${prov} }
`;

export const HEROES = `
- id: alpha
  name: Alpha
  class: warrior
  rarity: legendary
  base_supply_ability: 10
  skills: [{ id: smash, name: Smash, text: "" }, { id: roar, name: Roar, text: "" }]
  skill_links: [{ stars: 4, skill: smash }, { stars: 8, skill: roar }]
  exclusive_items: [{ item: relic }]
  supplies: [{ stars: 0, item: sword }, { stars: 0, item: rock }, { stars: 1, item: relic }, { stars: 3, item: legend }, { stars: 5, item: pup }, { stars: 7, item: stone }]
  ${prov.replace(', ', '\n  ')}
- id: beta
  name: Beta
  class: warrior
  rarity: rare
  base_supply_ability: 5
  skills: [{ id: kick, name: Kick, text: "" }, { id: shout, name: Shout, text: "" }]
  skill_links: [{ stars: 4, skill: kick }, { stars: 8, skill: shout }]
  supplies: [{ stars: 1, item: glove }, { stars: 3, item: scope }, { stars: 5, item: potion }, { stars: 7, item: legend }]
  ${prov.replace(', ', '\n  ')}
- id: gamma
  name: Gamma
  class: ranger
  rarity: rare
  base_supply_ability: 5
  skills: [{ id: aim, name: Aim, text: "" }, { id: dash, name: Dash, text: "" }]
  skill_links: [{ stars: 4, skill: aim }, { stars: 8, skill: dash }]
  supplies: [{ stars: 1, item: bow }, { stars: 3, item: rock }, { stars: 5, item: potion }, { stars: 7, item: scope }]
  ${prov.replace(', ', '\n  ')}
`;

export const GEAR = `
- { id: blade, name: Blade, slot: weapon, tags: [weapon, sword], footprint: "##o", basic_attack: { damage: { ratio: 1, scales_with: atk }, cooldown: 2, accuracy: 90 }, effects: [{ trigger: battle_start, uses_dots: true, target: items_under_dots, action: add_stat_pct, stat: haste_pct, amount: 10, gear_min_rarity: epic }], ${prov} }
- { id: band, name: Band, slot: ring, ${prov} }
- { id: buckler_gear, name: Buckler, slot: shield, footprint: "#", ${prov} }
`;

export const BLESSINGS = `
- { id: all_dmg, name: All DMG, kind: common, stat: all_dmg_increase, unit: pct, values: { epic: { min: 6, max: 10 } }, ${prov} }
- { id: sword_dmg, name: "[Sword] DMG", kind: class, class: warrior, target_tags: [sword], unit: pct, values: { rare: { min: 6, max: 9 } }, ${prov} }
- { id: bow_dmg, name: "[Bow] DMG", kind: class, class: ranger, unit: pct, values: { rare: { min: 6, max: 9 } }, ${prov} }
- { id: alpha_bonus, name: Alpha bonus, kind: unique, hero: alpha, unit: pct, values: { legendary: { value: 25 } }, ${prov} }
`;

export const PETS = `
- { id: wolf, name: Wolf, rarity: legendary, activation_cost: 3, skill: { name: Howl, text: "" }, star_effects: [{ stars: 1, text: "Activation cost is decreased by 1.", activation_cost_delta: -1 }], role: battle, ${prov} }
- { id: cat, name: Cat, rarity: rare, activation_cost: 3, skill: { name: Purr, text: "" }, role: battle, ${prov} }
- { id: rockpet, name: Rock Pet, rarity: rare, activation_cost: 2, skill: { name: Sit, text: "" }, role: battle, ignored: true, ${prov} }
`;

export function makeData(extra: SourceFile[] = []): GameData {
  const res = loadGameData([
    ...BASE,
    { path: 'items/manual/test.yaml', text: ITEMS },
    { path: 'heroes/manual/test.yaml', text: HEROES },
    { path: 'gear/manual/test.yaml', text: GEAR },
    { path: 'blessings/manual/test.yaml', text: BLESSINGS },
    { path: 'pets/manual/test.yaml', text: PETS },
    ...extra,
  ]);
  if (!res.ok) throw new Error(res.errors.map(formatIssue).join('\n'));
  return res.data;
}

export const PROFILE = `
basic_stats: { hp: "4M", atk: "1M", initial_block: "1M" }
detailed_stats: { item_haste: 10, crit_rate: 20, all_dmg_increase: 10, attack_dmg_increase: 5 }
heroes:
  - { id: alpha, stars: 6 }
  - { id: beta, stars: 4 }
  - { id: gamma, stars: 1 }
active_hero: alpha
`;

export function makeProfile(data: GameData, yaml = PROFILE): Profile {
  const res = loadProfile({ path: 'profile.yaml', text: yaml }, data);
  if (!res.ok || !res.profile) throw new Error(res.issues.map(formatIssue).join('\n'));
  return res.profile;
}

export function makeLoadout(data: GameData, profile: Profile, layoutYaml: string): Loadout {
  return buildLoadout(data, profile, LayoutSchema.parse(parse(layoutYaml)));
}
