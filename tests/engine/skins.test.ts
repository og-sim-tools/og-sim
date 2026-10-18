/** Skin skills: availability, quest, stars, up to 2 equipped, spawns, and the generic effects they needed. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import type { BattleEvent } from '../../src/engine/combat/types';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { ProfileSchema } from '../../src/engine/model';
import { validateLoadout } from '../../src/engine/validate';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

const P = 'value: 1, source: manual, verified: true';
const data = combatData([
  {
    path: 'heroes/manual/test.yaml',
    text: `
- { id: wiz, name: Wiz, class: wizard, rarity: legendary, base_supply_ability: 10, source: manual, verified: true }
- { id: war, name: War, class: warrior, rarity: legendary, base_supply_ability: 10, source: manual, verified: true }
`,
  },
  {
    path: 'items/manual/skins-test.yaml',
    text: `
- { id: mirror, name: Mirror, rarity: common, tags: [armor], footprint: "#", ${P} }
- { id: lsword, name: Legend Sword, rarity: legendary, tags: [weapon, sword], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 100, accuracy: 1000 }, ${P} }
- { id: csword, name: Common Sword, rarity: common, tags: [weapon, sword], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 100, accuracy: 1000 }, ${P} }
- { id: hitter, name: Hitter, rarity: common, tags: [weapon], footprint: "#", stats: { damage: { ratio: 1, scales_with: atk }, cooldown: 1, accuracy: 1000 }, ${P} }
- { id: critter, name: Critter, rarity: common, tags: [creature], footprint: "#", value: 2, source: manual, verified: true }
- { id: minion, name: Minion, kind: skin_spawn, rarity: rare, tags: [creature], footprint: "#", ${P} }
`,
  },
  {
    path: 'skins/manual/test.yaml',
    text: `
- id: spiky_skin
  name: Spiky Skin
  hero: wiz
  skill: { name: Spiky, quest: q, reward: r }
  available: { classes: [wizard] }
  status: complete
  effects:
    - { trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 1, max_stars: 0 }
    - { trigger: battle_start, target: player, action: apply_status, status: spike, stacks: 5, min_stars: 1 }
  source: manual
  verified: true
- id: warrior_skin
  name: Warrior Skin
  hero: war
  skill: { name: Warry, quest: q, reward: r }
  available: { classes: [warrior] }
  status: complete
  effects: [{ trigger: battle_start, target: player, action: apply_status, status: dodge, stacks: 3 }]
  source: manual
  verified: true
- id: everyone_skin
  name: Everyone Skin
  hero: war
  skill: { name: Minions, quest: q, reward: r }
  available: { all: true }
  status: complete
  effects: []
  spawns: [{ item: minion, count: 2, stars: 0 }, { item: minion, count: 1, stars: 2 }]
  source: manual
  verified: true
- id: stripper
  name: Stripper
  hero: wiz
  skill: { name: Strip, quest: q, reward: r }
  available: { all: true }
  status: complete
  effects:
    - { trigger: battle_start, priority: 90, target: enemy, action: remove_status, status: spike, count: 2, count_unit: stacks, count_per_item: mirror }
    - { trigger: passive, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount_from: { removed: spike, factor: 10 } }
  source: manual
  verified: true
- id: sides
  name: Sides
  hero: war
  skill: { name: Sides, quest: q, reward: r }
  available: { all: true }
  status: complete
  effects:
    - { trigger: battle_start, target: all_items, filter: { tags_any: [sword], rarity: [legendary] }, action: attack, times: 0, times_per_bag: { tags_any: [sword], rarity: [legendary] } }
  source: manual
  verified: true
- id: storm
  name: Storm
  hero: wiz
  skill: { name: Storm, quest: q, reward: r }
  available: { all: true }
  status: complete
  effects:
    - { trigger: battle_start, target: player, action: apply_status, status: dodge, stacks: 7 }
    - { trigger: on_status_applied, watch: any, params: { status: dodge }, target: player, action: apply_status, status: focus, event_pct: 100 }
  source: manual
  verified: true
- id: pet_lover
  name: Pet Lover
  hero: wiz
  skill: { name: Pets, quest: own creatures worth 3, reward: r }
  quest_check: { type: bag_value, tags_any: [creature], min: 3 }
  available: { all: true }
  status: complete
  effects: [{ trigger: battle_start, target: player, action: apply_status, status: dodge, stacks: 4 }]
  source: manual
  verified: true
- id: echo_ball
  name: Echo Ball
  hero: wiz
  skill: { name: Ball, quest: q, reward: r }
  available: { all: true }
  status: complete
  effects: [{ trigger: on_hit, watch: any, target: enemy, action: deal_damage, event_pct: 50, damage_type: effect }]
  source: manual
  verified: true
`,
  },
]);

/** Equipped skins have their quest done unless listed in `notDone`. */
const prof = (hero: string, skins: string, equipped: string[], notDone: string[] = []) =>
  `heroes: [{ id: ${hero}, stars: 0 }]\nactive_hero: ${hero}\nskins: [${skins}]\nequipped_skins: [${equipped.join(', ')}]\nskin_quests_done: [${equipped.filter((s) => !notDone.includes(s)).join(', ')}]\n`;
const run = (items: string[], hero: string, skins: string, equipped: string[], enemy = {}, durationS = 0.1, notDone: string[] = []) =>
  runBattle(combatLoadout(items, '', data, prof(hero, skins, equipped, notDone)), ENEMY({ traits: ['short_time_limit'], ...enemy }), { durationS, log: true });
const hits = (log: BattleEvent[]) => log.filter((e) => e.type === 'damage' && e.side === 'player').map((e) => Math.round(e.amount!));

describe('skin skills', () => {
  it('use the version for the skin stars', () => {
    expect(run([], 'wiz', '{ id: spiky_skin, stars: 0 }', ['spiky_skin']).player.statuses.spike).toBe(1);
    expect(run([], 'wiz', '{ id: spiky_skin, stars: 3 }', ['spiky_skin']).player.statuses.spike).toBe(5);
  });

  it('only work for heroes they are available to, once the quest is done, and when owned', () => {
    const r = run([], 'wiz', '{ id: warrior_skin, stars: 0 }', ['warrior_skin']);
    expect(r.player.statuses.dodge).toBeUndefined();
    expect(r.warnings.some((w) => /isn't available to Wiz/.test(w))).toBe(true);
    expect(run([], 'war', '{ id: warrior_skin, stars: 0 }', ['warrior_skin']).player.statuses.dodge).toBe(3);
    expect(run([], 'war', '{ id: warrior_skin, stars: 0 }', ['warrior_skin'], {}, 0.1, ['warrior_skin']).player.statuses.dodge).toBeUndefined();
    expect(run([], 'war', '', ['warrior_skin']).player.statuses.dodge).toBeUndefined();
    const issues = validateLoadout(combatLoadout([], '', data, prof('wiz', '{ id: warrior_skin, stars: 0 }', ['warrior_skin'])));
    expect(issues.map((i) => i.code)).toContain('skin_unavailable');
  });

  it('two at most can be equipped, and both work', () => {
    expect(() => ProfileSchema.parse({ basic_stats: { hp: 1, atk: 1, initial_block: 0 }, equipped_skins: ['a', 'b', 'c'] })).toThrow();
    const r = run([], 'war', '{ id: warrior_skin, stars: 0 }, { id: spiky_skin, stars: 0 }', ['warrior_skin', 'spiky_skin']);
    expect(r.player.statuses.dodge).toBe(3); // spiky_skin is wizard-only, so only one works for War
    expect(r.player.statuses.spike).toBeUndefined();
  });

  it('summon items into empty cells, more with stars (hand-placed copies count)', () => {
    const count = (stars: number, items: string[] = []) =>
      Object.values(run(items, 'war', `{ id: everyone_skin, stars: ${stars} }`, ['everyone_skin']).items).filter((i) => i.name.startsWith('Minion')).length;
    expect(count(0)).toBe(2);
    expect(count(2)).toBe(3);
    expect(count(2, ['minion'])).toBe(3);
  });
});

describe('generic effects added for skins', () => {
  it('count_per_item: remove 2 Spike for each Mirror; amount_from.removed counts what was removed', () => {
    const r = run(['mirror', 'mirror', 'hitter'], 'wiz', '{ id: stripper, stars: 0 }', ['stripper'], { starting_statuses: [{ status: 'spike', stacks: 10 }] }, 1.05);
    expect(r.enemy.statuses.spike).toBe(6);
    expect(hits(r.log)[0]).toBe(140_000); // 4 removed × 10% = All DMG +40%
  });

  it('attack: times + one per matching item in the bag, with a rarity filter', () => {
    const r = run(['lsword', 'lsword', 'csword'], 'war', '{ id: sides, stars: 0 }', ['sides']);
    expect(r.items.lsword0!.attacks).toBe(2);
    expect(r.items.lsword1!.attacks).toBe(2);
    expect(r.items.csword2!.attacks).toBe(0);
  });

  it('on_status_applied passes the stacks as the event amount: "gain the same amount of Focus"', () => {
    expect(run([], 'wiz', '{ id: storm, stars: 0 }', ['storm']).player.statuses).toMatchObject({ dodge: 7, focus: 7 });
  });

  it('on_hit passes the hit damage as the event amount (event_pct)', () => {
    const r = run(['hitter'], 'wiz', '{ id: echo_ball, stars: 0 }', ['echo_ball'], {}, 1.05);
    expect(hits(r.log)).toEqual([100_000, 50_000]);
  });
});

describe('real skin data', () => {
  const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
  it('has the wiki skins, the Summer enemy skins and the upcoming ones', () => {
    expect([...d.skins.keys()].sort()).toEqual(
      [
        'bjorn_little_valcan', 'rebecca_red_sun', 'erwen_romantic_date', 'venom_missha_karlstein', 'lua_summer_vacation', 'cecilia_arua_raven', 'feline_mage_cool_splash',
        'rose_summer', 'darkan_summer', 'talin_summer', 'trixie_summer', 'raven_apostle_of_death', 'rose_eternal_red_moon', 'trixie_dream_eater',
      ].sort(),
    );
    expect(d.items.get('blood_moon_familiar')!.kind).toBe('skin_spawn');
  });

  it('every star level from 0 to 5 has exactly one version of each starred effect', () => {
    for (const s of d.skins.values()) {
      const groups = new Map<string, number[]>();
      for (const e of s.effects) {
        if (e.min_stars === undefined && e.max_stars === undefined) continue;
        const key = `${e.trigger}|${e.action}|${e.player_stat ?? e.combat_stat ?? e.status ?? ''}|${e.watch_filter?.tags_any ?? ''}|${(e.params as { status?: string })?.status ?? ''}`;
        for (let k = e.min_stars ?? 0; k <= Math.min(5, e.max_stars ?? 5); k++) groups.set(key, [...(groups.get(key) ?? []), k]);
      }
      for (const [key, ks] of groups) expect(ks.sort(), `${s.id} ${key}`).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});

describe('skin quests checked against the bag', () => {
  it('a skill whose quest the bag does not meet is off, whatever the quest-done tick says', () => {
    expect(run(['critter'], 'wiz', '{ id: pet_lover, stars: 0 }', ['pet_lover']).player.statuses.dodge).toBeUndefined(); // value 2 / 3
    const r = run(['critter'], 'wiz', '{ id: pet_lover, stars: 0 }', ['pet_lover']);
    expect(r.warnings.some((w) => /doesn't meet its quest \(creature value 2 \/ 3\)/.test(w))).toBe(true);
    expect(run(['critter', 'critter'], 'wiz', '{ id: pet_lover, stars: 0 }', ['pet_lover'], {}, 0.1, ['pet_lover']).player.statuses.dodge).toBe(4); // met: no tick needed
  });

  it('real data: Dream Eater needs 30 Creature value, Rose 90% of open cells filled, Raven a whole run', async () => {
    const { checkSkinQuest } = await import('../../src/engine/skinQuests');
    const { buildLoadout } = await import('../../src/engine/loadout');
    const { LayoutSchema } = await import('../../src/engine/model');
    const { combatProfile } = await import('../combat-fixture');
    const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
    const lo = (items: string[]) => buildLoadout(d, combatProfile('', d), LayoutSchema.parse({ placements: items.map((item, i) => ({ id: `${item}${i}`, item, x: (i * 2) % 8, y: Math.floor((i * 2) / 8) * 2 })) }));
    const de = d.skins.get('trixie_dream_eater')!;
    expect(checkSkinQuest(lo(['fairy_dragon']), de)).toMatchObject({ status: 'not_met', detail: 'creature value 17 / 30' });
    expect(checkSkinQuest(lo(['fairy_dragon', 'fairy_dragon']), de).status).toBe('met');
    expect(checkSkinQuest(lo(['fairy_dragon']), d.skins.get('rose_eternal_red_moon')!).status).toBe('not_met');
    expect(checkSkinQuest(lo([]), d.skins.get('raven_apostle_of_death')!).status).toBe('run');
  });
});

