/** Layouts remember the hero's links/blessings, gear, pets and skin choices; hero and skin ownership and stars are account-wide. */
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

  it('loading puts them back into a profile that has moved on, keeping account-wide ownership and stars', () => {
    const setup = setupFromProfile(profile, null);
    const later = ProfileSchema.parse({ basic_stats: profile.basic_stats, heroes: [{ id: 'rose', stars: 4 }, { id: 'erwen', stars: 9 }], active_hero: 'rose', gear: {}, pets: [], skins: [{ id: 'raven_apostle_of_death', stars: 5 }] });
    const restored = applySetup(later, setup);
    expect(restored.active_hero).toBe('erwen');
    expect(restored.heroes.map((h) => h.id)).toEqual(['rose', 'erwen']);
    expect(restored.heroes[1]!.stars).toBe(9); // stars are account-wide, not the layout's 8
    expect(restored.heroes[1]!.blessings!.equipped[0]!.value).toBe(50);
    // Skins, their stars and quests are per build now (user, 2026-10-18): the layout's 2★, not the profile's 5★.
    expect(restored.skins).toEqual([{ id: 'raven_apostle_of_death', stars: 2 }]);
    expect(restored.equipped_skins).toEqual(['raven_apostle_of_death']);
    expect(restored.skin_quests_done).toEqual(['raven_apostle_of_death']);
    expect(restored.gear.gloves).toHaveLength(2);
    expect(restored.pets).toEqual([{ id: 'red_dragon', stars: 2, active: true }]);
    // Other heroes and basic stats untouched; no setup = no change.
    expect(restored.heroes[0]!.stars).toBe(4);
    expect(applySetup(later, undefined)).toBe(later);
  });

  it("blessings come from the build; the hero's stars and skill links stay the account's", () => {
    const setup = setupFromProfile(ProfileSchema.parse({ ...profile, heroes: [{ id: 'erwen', stars: 8, links: ['impale'], blessings: profile.heroes[1]!.blessings }] }), null);
    const account = ProfileSchema.parse({ basic_stats: profile.basic_stats, heroes: [{ id: 'erwen', stars: 9, links: ['parting_rose'] }] });
    const hero = applySetup(account, setup).heroes[0]!;
    expect(hero).toMatchObject({ stars: 9, links: ['parting_rose'] });
    expect(hero.blessings?.equipped[0]?.id).toBe('erwen_spirit_gain');
    // A build with no blessings for its hero has none (they don't leak in from anywhere else).
    const bare = applySetup(ProfileSchema.parse({ ...account, heroes: [{ id: 'erwen', stars: 9, blessings: { level: 3, equipped: [{ id: 'all_dmg', rarity: 'rare', value: 3 }] } }] }), { hero: { id: 'erwen', stars: 0, links: [], skin: null } });
    expect(bare.heroes[0]!.blessings).toBeUndefined();
  });

  it("doesn't add a hero I don't own", () => {
    const later = ProfileSchema.parse({ basic_stats: profile.basic_stats, heroes: [{ id: 'rose', stars: 4 }], active_hero: 'rose' });
    const restored = applySetup(later, setupFromProfile(profile, null));
    expect(restored.heroes.map((h) => h.id)).toEqual(['rose']);
    expect(restored.active_hero).toBe('erwen'); // the layout's hero; validation reports it isn't owned
  });
});
