/**
 * A build carries what's chosen per build: its hero, equipped gear (with rarity and tier), the pets it brings
 * (and which are active) and up to 2 skins (and whether their quest is done). Everything I own is
 * account-wide (user, 2026-10-18 and 2026-10-19): heroes with stars, skill links and Dragon's Blessings, pets'
 * and skins' stars, auras, and HP / ATK / Block. Builds saved before that also carry their own blessings,
 * stars and HP / ATK / Block; when they do, those win (so older files play as they did), and the app moves
 * them into the account when it opens the build (saves/legacy.ts).
 */
import type { LayoutData, Profile } from './model';

export type LayoutSetup = NonNullable<LayoutData['setup']>;

/** The setup to save with a build: its hero (or the active one), the gear, the pets it brings and the skins. */
export function setupFromProfile(profile: Profile, heroId?: string | null): LayoutSetup {
  const id = heroId ?? profile.active_hero;
  const hero = profile.heroes.find((h) => h.id === id);
  return {
    ...(hero ? { hero: { id: hero.id, stars: hero.stars, links: [...hero.links], skin: hero.skin } } : {}),
    gear: structuredClone(profile.gear),
    pets: profile.pets.map((p) => ({ id: p.id, active: p.active })),
    equipped_skins: [...(profile.equipped_skins ?? [])],
    skin_quests_done: [...(profile.skin_quests_done ?? [])],
    ...(profile.skin_quests_forced?.length ? { skin_quests_forced: [...profile.skin_quests_forced] } : {}),
  };
}

/**
 * The account's profile with a build's setup put in: its gear, its pets at the account's stars, its skins,
 * its hero made active (stars, links and blessings stay the account's; a hero I don't own isn't added).
 * An older build's own blessings, stars and HP / ATK / Block win when it has them.
 */
export function applySetup(profile: Profile, setup: LayoutSetup | undefined): Profile {
  if (!setup) return profile;
  const next = structuredClone(profile);
  const ownedStars = new Map(profile.owned_pets.map((p) => [p.id, p.stars]));
  if (setup.gear) next.gear = structuredClone(setup.gear);
  if (setup.pets) next.pets = setup.pets.map((p) => ({ id: p.id, active: p.active, stars: p.stars ?? ownedStars.get(p.id) ?? 0 }));
  if (setup.basic_stats) next.basic_stats = structuredClone(setup.basic_stats);
  if (setup.detailed_stats) next.detailed_stats = structuredClone(setup.detailed_stats);
  if (setup.equipped_skins) next.equipped_skins = [...setup.equipped_skins];
  if (setup.skin_quests_done) next.skin_quests_done = [...setup.skin_quests_done];
  next.skin_quests_forced = [...(setup.skin_quests_forced ?? [])];
  if (setup.skins?.length) next.skins = [...next.skins.filter((s) => !setup.skins!.some((x) => x.id === s.id)), ...structuredClone(setup.skins)];
  if (setup.hero) {
    const i = next.heroes.findIndex((h) => h.id === setup.hero!.id);
    if (i >= 0 && setup.hero.blessings) next.heroes[i] = { ...next.heroes[i]!, blessings: structuredClone(setup.hero.blessings) };
    next.active_hero = setup.hero.id;
  }
  return next;
}
