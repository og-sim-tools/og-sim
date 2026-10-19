/** Builds remember their hero, gear, pets and skins; stars, blessings and HP / ATK / Block are account-wide (2026-10-19). */
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { applySetup, setupFromProfile } from '../../src/engine/layoutSetup';
import { LayoutSchema, ProfileSchema } from '../../src/engine/model';
import { layoutToYaml, withIds } from '../../src/ui/state/layoutOps';

const profile = ProfileSchema.parse({
  basic_stats: { hp: '4M', atk: '700K', initial_block: 0 },
  heroes: [
    { id: 'rose', stars: 3, blessings: { level: 5, equipped: [{ id: 'all_dmg', rarity: 'epic', value: 7.4 }] } },
    { id: 'erwen', stars: 8, blessings: { level: 5, equipped: [{ id: 'erwen_spirit_gain', rarity: 'mythic', value: 50 }] } },
  ],
  active_hero: 'erwen',
  gear: { weapon: { id: 'primal_flame', rarity: 'legendary', tier: 2 }, gloves: [{ id: 'gloves_of_plague', rarity: 'epic' }, { id: 'gloves_of_plague', rarity: 'epic' }] },
  pets: [{ id: 'red_dragon', stars: 2 }],
  skins: [{ id: 'raven_apostle_of_death', stars: 2 }],
  equipped_skins: ['raven_apostle_of_death'],
  skin_quests_done: ['raven_apostle_of_death'],
});

describe('layout setup', () => {
  it('saves the hero, gear and pets and survives the YAML round trip', () => {
    const setup = setupFromProfile(profile, null);
    expect(setup.hero).toMatchObject({ id: 'erwen', stars: 8 });
    const back = LayoutSchema.parse(parse(layoutToYaml(withIds(LayoutSchema.parse({ placements: [], setup })))));
    expect(back.setup).toEqual(setup);
  });

  it('loading puts them back into a profile that has moved on, with its stars, blessings and HP / ATK / Block', () => {
    const setup = setupFromProfile(profile, null);
    // Account-wide since 2026-10-19: nothing of that is in the build.
    expect(setup.hero?.blessings).toBeUndefined();
    expect(setup.pets).toEqual([{ id: 'red_dragon', active: true }]);
    expect(setup.basic_stats).toBeUndefined();
    expect(setup.skins).toBeUndefined();
    const later = ProfileSchema.parse({
      basic_stats: { hp: '5M', atk: '1M', initial_block: '1M' },
      heroes: [{ id: 'rose', stars: 4 }, { id: 'erwen', stars: 9, blessings: { level: 6, equipped: [{ id: 'erwen_spirit_gain', rarity: 'mythic', value: 60 }] } }],
      active_hero: 'rose',
      owned_pets: [{ id: 'red_dragon', stars: 4 }],
      skins: [{ id: 'raven_apostle_of_death', stars: 5 }],
    });
    const restored = applySetup(later, setup);
    expect(restored.active_hero).toBe('erwen');
    expect(restored.heroes.map((h) => h.id)).toEqual(['rose', 'erwen']);
    expect(restored.heroes[1]!.stars).toBe(9);
    expect(restored.heroes[1]!.blessings!.equipped[0]!.value).toBe(60);
    expect(restored.skins).toEqual([{ id: 'raven_apostle_of_death', stars: 5 }]);
    expect(restored.equipped_skins).toEqual(['raven_apostle_of_death']);
    expect(restored.skin_quests_done).toEqual(['raven_apostle_of_death']);
    expect(restored.gear.gloves).toHaveLength(2);
    expect(restored.pets).toEqual([{ id: 'red_dragon', stars: 4, active: true }]);
    expect(restored.basic_stats).toEqual(later.basic_stats);
    expect(restored.heroes[0]!.stars).toBe(4);
    expect(applySetup(later, undefined)).toBe(later);
    // A pet I don't own (yet) plays at 0 stars.
    expect(applySetup(later, { pets: [{ id: 'seiren', active: true }] }).pets).toEqual([{ id: 'seiren', stars: 0, active: true }]);
  });

  it("an older build's own blessings, stars and HP / ATK / Block win, so it plays as it did; stars and links stay the account's", () => {
    const account = ProfileSchema.parse({
      basic_stats: profile.basic_stats,
      heroes: [{ id: 'erwen', stars: 9, links: ['parting_rose'], blessings: { level: 3, equipped: [{ id: 'all_dmg', rarity: 'rare', value: 3 }] } }],
      owned_pets: [{ id: 'red_dragon', stars: 1 }],
      skins: [{ id: 'raven_apostle_of_death', stars: 1 }],
    });
    const old = {
      hero: { id: 'erwen', stars: 0, links: [], skin: null, blessings: profile.heroes[1]!.blessings },
      pets: [{ id: 'red_dragon', stars: 2, active: true }],
      skins: [{ id: 'raven_apostle_of_death', stars: 2 }],
      equipped_skins: ['raven_apostle_of_death'],
      basic_stats: { hp: '9M', atk: '2M', initial_block: 0 },
    };
    const p = applySetup(account, old);
    expect(p.heroes[0]).toMatchObject({ stars: 9, links: ['parting_rose'] });
    expect(p.heroes[0]!.blessings?.equipped[0]?.id).toBe('erwen_spirit_gain');
    expect(p.pets[0]!.stars).toBe(2);
    expect(p.skins).toEqual([{ id: 'raven_apostle_of_death', stars: 2 }]);
    expect(p.basic_stats.hp).toBe('9M');
    // Without them, the account's.
    const now = applySetup(account, { hero: { id: 'erwen', stars: 0, links: [], skin: null }, pets: [{ id: 'red_dragon', active: true }] });
    expect(now.heroes[0]!.blessings?.equipped[0]?.id).toBe('all_dmg');
    expect(now.pets[0]!.stars).toBe(1);
  });

  it("doesn't add a hero I don't own", () => {
    const later = ProfileSchema.parse({ basic_stats: profile.basic_stats, heroes: [{ id: 'rose', stars: 4 }], active_hero: 'rose' });
    const restored = applySetup(later, setupFromProfile(profile, null));
    expect(restored.heroes.map((h) => h.id)).toEqual(['rose']);
    expect(restored.active_hero).toBe('erwen'); // the layout's hero; validation reports it isn't owned
  });
});
