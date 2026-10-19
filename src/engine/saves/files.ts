/**
 * The saved-file formats (version 3, 2026-10-19), and how they map to the engine's Profile and LayoutData.
 *
 * Account (profile/profile.yaml): everything I own, the same for every build — HP / ATK / Block as the game's
 * Stat Details screen shows them, the heroes I own with their stars, skill links and Dragon's Blessings, the
 * pets and skins I own with their stars, and my auras. Build (layouts/<name>.yaml): what's chosen per build —
 * hero, gear with rarity and tier, which pets (and which are active), up to 2 skins (and their quests), the
 * bag, the storage beside it and the battle settings.
 */
import { z } from 'zod';
import {
  Abbrev,
  BasicStatsSchema,
  DetailedStatsSchema,
  GearSetupSchema,
  HeroBlessingsSchema,
  Id,
  LayoutBattleSchema,
  type LayoutData,
  LayoutPlacementSchema,
  type Profile,
  ProfileSchema,
} from '../model';
import { BagMaskSchema, EnhancedCellsSchema, StoredItemSchema } from '../model/placement';

export const SAVE_VERSION = 3;

/** HP / ATK / Block before they're entered (an account with these hasn't entered its stats yet). */
export const DEFAULT_BASIC_STATS = { hp: '1M', atk: '100K', initial_block: 0 } as { hp: z.infer<typeof Abbrev>; atk: z.infer<typeof Abbrev>; initial_block: z.infer<typeof Abbrev> };

export const sameStats = (a: { hp: unknown; atk: unknown; initial_block: unknown }, b: { hp: unknown; atk: unknown; initial_block: unknown }) =>
  String(a.hp).toUpperCase() === String(b.hp).toUpperCase() && String(a.atk).toUpperCase() === String(b.atk).toUpperCase() && String(a.initial_block).toUpperCase() === String(b.initial_block).toUpperCase();

/** The account hasn't entered HP / ATK / Block yet. */
export const statsUnset = (s: { hp: unknown; atk: unknown; initial_block: unknown }) => sameStats(s, DEFAULT_BASIC_STATS);

export const AccountFileSchema = z
  .object({
    version: z.number().int().default(SAVE_VERSION),
    /** HP, ATK and Block as the game's Stat Details screen shows them. Left out: not entered yet. */
    stats: BasicStatsSchema.optional(),
    heroes: z
      .array(
        z
          .object({
            id: Id,
            stars: z.number().int().nonnegative(),
            links: z.array(Id).default([]),
            /** The hero's Dragon's Blessing level and blessings (one set per hero in game). */
            blessings: HeroBlessingsSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    /** Pets I own and their stars. */
    pets: z.array(z.object({ id: Id, stars: z.number().int().nonnegative() }).strict()).default([]),
    /** Skins I own and their stars (0–5). */
    skins: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(5) }).strict()).default([]),
    /** Auras I own and their stars: their ownership effects add to every build's stats. */
    auras: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(7) }).strict()).default([]),
    /** The equipped aura (its skill is economy [LATER]). */
    aura: Id.nullable().default(null),
    /** The whole version-1 profile this account came from, kept so version-1 builds load exactly as before (see migrate.ts). */
    migrated_from_v1: z.record(z.unknown()).optional(),
  })
  .strict();
export type AccountFile = z.infer<typeof AccountFileSchema>;

export const BuildPetSchema = z.object({ id: Id, active: z.boolean().default(true) }).strict();
export const BuildSkinSchema = z.object({ id: Id, quest_done: z.boolean().default(false) }).strict();

/**
 * What a version-2 build saved per build that's account-wide since version 3: kept when it's read (it wins over
 * the account's, so the build plays as it did) until the app moves it into the account. Never written.
 */
export const LegacySetupSchema = z
  .object({
    blessings: HeroBlessingsSchema.optional(),
    pets: z.array(z.object({ id: Id, stars: z.number().int().nonnegative() }).strict()).optional(),
    skins: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(5) }).strict()).optional(),
    basic_stats: BasicStatsSchema.optional(),
  })
  .strict();

export const BuildFileSchema = z
  .object({
    version: z.number().int().default(SAVE_VERSION),
    name: z.string().optional(),
    hero: Id.nullable().default(null),
    gear: GearSetupSchema.default({}),
    /** The pets brought (their stars are the account's). */
    pets: z.array(BuildPetSchema).default([]),
    /** Up to 2 skin skills brought; quest_done = the quest counts as done this run (their stars are the account's). */
    skins: z.array(BuildSkinSchema).max(2).default([]),
    /** Optional manual adjustment on top of the calculated stats (older files). */
    detailed_stats: DetailedStatsSchema.optional(),
    bag: BagMaskSchema.optional(),
    enhanced_cells: EnhancedCellsSchema.optional(),
    placements: z.array(LayoutPlacementSchema).default([]),
    /** Items set aside in the storage box beside the bag (not in battle). */
    storage: z.array(StoredItemSchema).optional(),
    battle: LayoutBattleSchema.optional(),
    legacy: LegacySetupSchema.optional(),
  })
  .strict();
export type BuildFile = z.infer<typeof BuildFileSchema>;

/** The account as the engine's Profile: no hero picked, no gear / pets brought / skins equipped (a build's setup brings those). */
export function accountToProfile(a: AccountFile): Profile {
  return ProfileSchema.parse({
    basic_stats: a.stats ?? DEFAULT_BASIC_STATS,
    heroes: a.heroes.map((h) => ({ id: h.id, stars: h.stars, links: h.links, ...(h.blessings ? { blessings: h.blessings } : {}) })),
    owned_pets: a.pets,
    skins: a.skins,
    auras: a.auras,
    aura: a.aura,
  });
}

/** The account-wide part of a Profile. */
export function profileToAccount(p: Profile, migratedFromV1?: Record<string, unknown> | null): AccountFile {
  return {
    version: SAVE_VERSION,
    ...(statsUnset(p.basic_stats) ? {} : { stats: structuredClone(p.basic_stats) }),
    heroes: p.heroes.map((h) => ({ id: h.id, stars: h.stars, links: [...h.links], ...(h.blessings ? { blessings: structuredClone(h.blessings) } : {}) })),
    pets: structuredClone(p.owned_pets ?? []),
    skins: structuredClone(p.skins ?? []),
    auras: structuredClone(p.auras),
    aura: p.aura,
    ...(migratedFromV1 ? { migrated_from_v1: migratedFromV1 } : {}),
  };
}

/** A build file as the engine's LayoutData (its setup is put into the account's profile with applySetup). */
export function buildFileToLayout(f: BuildFile): LayoutData {
  const lg = f.legacy;
  const petStars = new Map((lg?.pets ?? []).map((p) => [p.id, p.stars]));
  const skins = (lg?.skins ?? []).filter((s) => f.skins.some((x) => x.id === s.id));
  return {
    ...(f.name !== undefined ? { name: f.name } : {}),
    ...(f.hero ? { hero: f.hero } : {}),
    ...(f.bag ? { bag: f.bag } : {}),
    placements: f.placements,
    ...(f.storage?.length ? { storage: f.storage } : {}),
    ...(f.enhanced_cells ? { enhanced_cells: f.enhanced_cells } : {}),
    setup: {
      ...(f.hero ? { hero: { id: f.hero, stars: 0, links: [], skin: null, ...(lg?.blessings ? { blessings: lg.blessings } : {}) } } : {}),
      gear: f.gear,
      pets: f.pets.map((p) => ({ id: p.id, active: p.active, ...(petStars.has(p.id) ? { stars: petStars.get(p.id)! } : {}) })),
      ...(lg?.basic_stats ? { basic_stats: lg.basic_stats } : {}),
      ...(f.detailed_stats && Object.keys(f.detailed_stats).length ? { detailed_stats: f.detailed_stats } : {}),
      equipped_skins: f.skins.map((s) => s.id),
      skin_quests_done: f.skins.filter((s) => s.quest_done).map((s) => s.id),
      ...(skins.length ? { skins } : {}),
    },
    ...(f.battle ? { battle: f.battle } : {}),
  };
}

/** A LayoutData as a build file. What's account-wide (stars, blessings, HP / ATK / Block) isn't written. */
export function layoutToBuildFile(l: LayoutData): BuildFile {
  const s = l.setup ?? {};
  const hero = l.hero ?? s.hero?.id ?? null;
  const equipped = s.equipped_skins ?? [];
  return {
    version: SAVE_VERSION,
    ...(l.name !== undefined ? { name: l.name } : {}),
    hero,
    gear: structuredClone(s.gear ?? { weapon: null, shield: null, rings: [], gloves: [] }),
    pets: (s.pets ?? []).map((p) => ({ id: p.id, active: p.active })),
    skins: equipped.map((id) => ({ id, quest_done: (s.skin_quests_done ?? []).includes(id) })),
    ...(s.detailed_stats && Object.keys(s.detailed_stats).length ? { detailed_stats: structuredClone(s.detailed_stats) } : {}),
    ...(l.bag ? { bag: structuredClone(l.bag) } : {}),
    ...(l.enhanced_cells ? { enhanced_cells: structuredClone(l.enhanced_cells) } : {}),
    placements: structuredClone(l.placements),
    ...(l.storage?.length ? { storage: structuredClone(l.storage) } : {}),
    ...(l.battle ? { battle: structuredClone(l.battle) } : {}),
  };
}
