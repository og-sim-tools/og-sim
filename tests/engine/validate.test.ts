import { describe, expect, it } from 'vitest';
import type { LoadoutIssue } from '../../src/engine/loadout';
import { petCost, supplySummary, validateLoadout } from '../../src/engine/validate';
import { makeData, makeLoadout, makeProfile } from '../helpers';

const data = makeData();

const BASE_PROFILE = `basic_stats: { hp: "4M", atk: "1M", initial_block: "1M" }
active_hero: alpha
`;
const HEROES = `heroes:
  - { id: alpha, stars: 6 }
  - { id: beta, stars: 4 }
  - { id: gamma, stars: 1 }
`;

function check(layout: string, extraProfile = '', heroes = HEROES): LoadoutIssue[] {
  const profile = makeProfile(data, BASE_PROFILE + heroes + extraProfile);
  return validateLoadout(makeLoadout(data, profile, layout));
}
const codes = (issues: LoadoutIssue[]) => issues.map((i) => `${i.level}:${i.code}`);
const placements = (...rows: string[]) =>
  rows.length === 0 ? 'placements: []\n' : `placements:\n${rows.map((r, i) => `  - { x: ${i}, y: 0, ${r} }`).join('\n')}\n`;

describe('loadout validation', () => {
  it('accepts a valid loadout', () => {
    const layout = placements('item: sword, supply: true', 'item: rock, supply: true', 'item: relic, supply: true', 'item: pup', 'item: glove');
    expect(check(layout)).toEqual([]);
  });

  it('reports bag placement problems from the bag engine', () => {
    const issues = check(`placements:\n  - { item: sword, x: 0, y: 0 }\n  - { item: pup, x: 0, y: 1 }\n  - { item: nope, x: 5, y: 5 }\n`);
    expect(codes(issues)).toEqual(['error:unknown_item', 'error:overlap']);
    expect(issues[1]!.cells).toEqual([{ x: 0, y: 1 }]);
    expect(issues[1]!.instanceIds).toEqual(['sword#1', 'pup#1']);
  });

  describe('class and hero restrictions', () => {
    it('rejects items of another class', () => {
      const issues = check(placements('item: bow'));
      expect(issues.map((i) => i.message)).toEqual(['Bow is ranger only; Alpha is a warrior.']);
    });

    it("rejects another hero's exclusive item from the shop", () => {
      const issues = check(`hero: beta\n${placements('item: relic')}`);
      expect(issues.map((i) => i.message)).toEqual([
        "Relic is Alpha's exclusive item: only in the shop when playing Alpha (or bring it as starting equipment).",
      ]);
    });

    it('allows hero-exclusive items as starting equipment for any hero of the class', () => {
      expect(check(`hero: beta\n${placements('item: relic, supply: true')}`)).toEqual([]);
    });

    it('requires the hero to be owned', () => {
      expect(codes(check(`hero: gamma\n${placements()}`, '', 'heroes: [{ id: alpha, stars: 1 }]\n'))).toEqual(['error:hero_not_owned']);
    });
  });

  describe('starting equipment', () => {
    it("is unlocked by any owned same-class hero's stars", () => {
      // Glove and Scope come from Beta (4★): Glove at 1★, Scope at 3★.
      expect(check(placements('item: glove, supply: true', 'item: scope, supply: true'))).toEqual([]);
    });

    it('rejects supplies not unlocked yet, naming where they unlock', () => {
      const issues = check(placements('item: stone, supply: true', 'item: potion, supply: true'));
      expect(issues.map((i) => i.message)).toEqual([
        "Stone isn't unlocked as starting equipment for warriors (unlocked by Alpha 7★).",
        // Gamma unlocks the potion at 5★, but Gamma is a ranger.
        "Potion isn't unlocked as starting equipment for warriors (unlocked by Beta 5★, Gamma 5★).",
      ]);
    });

    it('checks Supply Ability capacity (legendary base 10 + 1 per star)', () => {
      const layout = placements('item: legend, supply: true', 'item: relic, supply: true', 'item: sword, supply: true', 'item: rock, supply: true');
      const issues = check(layout);
      expect(issues.map((i) => i.message)).toEqual(['Starting equipment uses 18 / 16 Supply Ability points.']);
      expect(issues[0]!.instanceIds).toHaveLength(4);
      const profile = makeProfile(data, BASE_PROFILE + HEROES);
      expect(supplySummary(makeLoadout(data, profile, layout))).toEqual({ used: 18, capacity: 16 });
    });

    it('rejects pet-spawned items and gear as starting equipment', () => {
      const issues = check(placements('item: egg, supply: true', 'item: buckler_gear, supply: true'), 'gear: { shield: { id: buckler_gear, rarity: rare } }\n');
      expect(codes(issues)).toEqual(['error:supply_pet_spawn', 'error:supply_gear']);
    });
  });

  describe('gear', () => {
    it('checks slots, counts, rarity tiers', () => {
      const issues = check(
        placements(),
        `gear:
  weapon: { id: band, rarity: legendary, tier: 4 }
  rings: [{ id: band, rarity: rare, tier: 1 }, { id: band, rarity: epic }, { id: band, rarity: epic, tier: 2 }]
`,
      );
      expect(issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
        'gear.weapon: Band is a ring, not a weapon.',
        'gear.weapon: Band is legendary+4, but legendary goes up to +3.',
        '3 rings equipped; the limit is 2.',
        'gear.rings[0]: Band is rare+1, but rare goes up to +0.',
      ]);
      expect(issues.filter((i) => i.level === 'warning').map((i) => i.code)).toEqual(['gear_needs_shape']);
    });

    it('warns when equipped gear with a shape is not in the bag', () => {
      expect(codes(check(placements(), 'gear: { shield: { id: buckler_gear, rarity: rare } }\n'))).toEqual(['warning:gear_not_placed']);
    });

    it('rejects gear placed but not equipped', () => {
      expect(codes(check(placements('item: blade')))).toEqual(['error:gear_not_equipped']);
      expect(check(placements('item: blade'), 'gear: { weapon: { id: blade, rarity: epic } }\n')).toEqual([]);
    });
  });

  describe('pets', () => {
    it('lowers activation cost with star effects', () => {
      const profile = makeProfile(data, BASE_PROFILE + HEROES);
      const loadout = makeLoadout(data, profile, placements());
      expect(petCost(loadout, 'wolf', 0)).toBe(3);
      expect(petCost(loadout, 'wolf', 1)).toBe(2);
      expect(petCost(loadout, 'nope', 1)).toBeNull();
    });

    it('checks count, stars and the 5-point budget; warns about ignored pets', () => {
      const issues = check(
        placements(),
        `pets:
  - { id: wolf, stars: 1 }
  - { id: cat, stars: 7 }
  - { id: rockpet, stars: 0 }
  - { id: cat, stars: 0, active: false }
`,
      );
      expect(issues.map((i) => `${i.level}:${i.message}`)).toEqual([
        'error:4 pets equipped; the limit is 3.',
        'error:Cat: 7★, the maximum is 6★.',
        "warning:Rock Pet is active but isn't simulated.",
        'warning:Active pets cost 7 points; each hero has 5 per run.',
      ]);
    });
  });

  describe('blessings', () => {
    it('checks count, duplicates, class, hero, rarity and value range', () => {
      const heroes = `heroes:
  - id: alpha
    stars: 6
    blessings:
      level: 5
      equipped:
        - { id: all_dmg, rarity: epic, value: 12 }
        - { id: all_dmg, rarity: epic, value: 7 }
        - { id: bow_dmg, rarity: rare, value: 7 }
        - { id: alpha_bonus, rarity: legendary, value: 20 }
        - { id: sword_dmg, rarity: epic, value: 10 }
        - { id: sword_dmg, rarity: rare, value: 7 }
  - id: beta
    stars: 4
    blessings: { level: 1, equipped: [{ id: alpha_bonus, rarity: legendary, value: 25 }] }
`;
      const issues = check(placements(), '', heroes);
      expect(issues.map((i) => `${i.level}:${i.message}`)).toEqual([
        'error:Alpha has 6 blessings; the maximum is 5.',
        'warning:Alpha: All DMG epic is 6 ~ 10, but you entered 12.',
        'error:Alpha has All DMG more than once (at most one of each blessing).',
        'error:[Bow] DMG is a ranger blessing; Alpha is a warrior.',
        'warning:Alpha: Alpha bonus legendary is 25, but you entered 20.',
        "error:Alpha: [Sword] DMG doesn't exist at epic (available: rare).",
        'error:Alpha has [Sword] DMG more than once (at most one of each blessing).',
        "error:Alpha bonus is Alpha's blessing, not Beta's.",
      ]);
    });
  });

  describe('skill links', () => {
    it('only allows unlocked slots and skills of other same-class heroes with enough stars', () => {
      const heroes = `heroes:
  - { id: alpha, stars: 6, links: [smash, kick] }
  - { id: beta, stars: 9, links: [shout, smash, aim] }
  - { id: gamma, stars: 1, links: [] }
`;
      const issues = check(placements(), '', heroes);
      expect(issues.map((i) => i.message)).toEqual([
        'Alpha at 6★ has 1 link slot but 2 links are set.',
        "Alpha can't link their own skill Smash.",
        'Beta at 9★ has 2 link slots but 3 links are set.',
        "Beta can't link their own skill Shout.",
        'Aim is a ranger skill (Gamma); Beta is a warrior.',
        'Aim needs Gamma at 4★ (you have 1★).',
      ]);
    });

    it('accepts a link unlocked by the other hero', () => {
      expect(check(placements(), '', 'heroes:\n  - { id: alpha, stars: 4, links: [kick] }\n  - { id: beta, stars: 4 }\n')).toEqual([]);
    });
  });
});

describe('layout building', () => {
  it('generates instance ids and looks up items and gear', () => {
    const profile = makeProfile(data, BASE_PROFILE + HEROES + 'gear: { weapon: { id: blade, rarity: mythic } }\n');
    const loadout = makeLoadout(data, profile, placements('item: pup', 'item: pup', 'id: mine, item: blade'));
    expect([...loadout.entries.keys()]).toEqual(['pup#1', 'pup#2', 'mine']);
    expect(loadout.entries.get('mine')).toMatchObject({ kind: 'gear', gearRarity: 'mythic' });
  });

  it('reports a bad bag mask and falls back to the full bag', () => {
    const profile = makeProfile(data, BASE_PROFILE + HEROES);
    const loadout = makeLoadout(data, profile, `bag: { mask: [1, 1, 1] }\n${placements()}`);
    expect(loadout.issues.map((i) => i.code)).toEqual(['bag_mask']);
    expect(loadout.bag.height).toBe(6);
  });
});
