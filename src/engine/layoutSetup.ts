/**
 * A build carries its own setup (the hero's blessings, equipped gear, pets, up to 2 skins with their stars
 * and quests, HP / ATK / Block), so loading it brings that back. Hero ownership, stars and skill links, and
 * auras, are account-wide: they stay as the profile has them (user, 2026-10-18).
 */
import type { LayoutData, Profile } from './model';

export type LayoutSetup = NonNullable<LayoutData['setup']>;

/** The setup to save with a build: its hero (or the active one) with blessings, the gear, the pets, the base stats (the rest is calculated) and the skins. */
export function setupFromProfile(profile: Profile, heroId?: string | null): LayoutSetup {
  const id = heroId ?? profile.active_hero;
  const hero = profile.heroes.find((h) => h.id === id);
  const equipped = [...(profile.equipped_skins ?? [])];
  return {
    ...(hero ? { hero: structuredClone(hero) } : {}),
    gear: structuredClone(profile.gear),
    pets: structuredClone(profile.pets),
    basic_stats: structuredClone(profile.basic_stats),
    equipped_skins: equipped,
    skin_quests_done: [...(profile.skin_quests_done ?? [])],
    skins: equipped.flatMap((s) => {
      const owned = profile.skins?.find((x) => x.id === s);
      return owned ? [{ id: s, stars: owned.stars }] : [];
    }),
  };
}

/**
 * The profile with a build's setup put back: gear, pets, base stats and skins replaced; the hero made active
 * with the build's blessings (its stars and links stay the account's; a hero I don't own isn't added).
 */
export function applySetup(profile: Profile, setup: LayoutSetup | undefined): Profile {
  if (!setup) return profile;
  const next = structuredClone(profile);
  if (setup.gear) next.gear = structuredClone(setup.gear);
  if (setup.pets) next.pets = structuredClone(setup.pets);
  if (setup.basic_stats) next.basic_stats = structuredClone(setup.basic_stats);
  if (setup.detailed_stats) next.detailed_stats = structuredClone(setup.detailed_stats);
  if (setup.equipped_skins) next.equipped_skins = [...setup.equipped_skins];
  if (setup.skin_quests_done) next.skin_quests_done = [...setup.skin_quests_done];
  if (setup.skins) next.skins = structuredClone(setup.skins);
  if (setup.hero) {
    const i = next.heroes.findIndex((h) => h.id === setup.hero!.id);
    if (i >= 0) {
      const { blessings, ...own } = next.heroes[i]!;
      next.heroes[i] = { ...own, ...(setup.hero.blessings ? { blessings: structuredClone(setup.hero.blessings) } : {}) };
    }
    next.active_hero = setup.hero.id;
  }
  return next;
}
