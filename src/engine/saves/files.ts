/**
 * The saved-file formats (version 2, 2026-10-18), and how they map to the engine's Profile and LayoutData.
 *
 * Account (profile/profile.yaml): only what's the same for every build — the heroes I own with their stars and
 * skill links, and my auras. Build (layouts/<name>.yaml): everything chosen per build — hero, its blessings,
 * gear, pets, up to 2 skins with stars, HP / ATK / Block, the bag and the battle settings.
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
  PetsSchema,
  type Profile,
  ProfileSchema,
} from '../model';
import { BagMaskSchema, EnhancedCellsSchema } from '../model/placement';

export const SAVE_VERSION = 2;

/** HP / ATK / Block when a build has none (a new account's first build). */
export const DEFAULT_BASIC_STATS = { hp: '1M', atk: '100K', initial_block: 0 } as { hp: z.infer<typeof Abbrev>; atk: z.infer<typeof Abbrev>; initial_block: z.infer<typeof Abbrev> };

export const AccountFileSchema = z
  .object({
    version: z.number().int().default(SAVE_VERSION),
    heroes: z.array(z.object({ id: Id, stars: z.number().int().nonnegative(), links: z.array(Id).default([]) }).strict()).default([]),
    /** Auras I own and their stars: their ownership effects add to every build's stats. */
    auras: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(7) }).strict()).default([]),
    /** The equipped aura (its skill is economy [LATER]). */
    aura: Id.nullable().default(null),
    /** The whole version-1 profile this account came from, kept so version-1 builds load exactly as before (see migrate.ts). */
    migrated_from_v1: z.record(z.unknown()).optional(),
  })
  .strict();
export type AccountFile = z.infer<typeof AccountFileSchema>;

export const BuildSkinSchema = z.object({ id: Id, stars: z.number().int().min(0).max(5), quest_done: z.boolean().default(false) }).strict();

export const BuildFileSchema = z
  .object({
    version: z.number().int().default(SAVE_VERSION),
    name: z.string().optional(),
    hero: Id.nullable().default(null),
    /** The hero's Dragon's Blessing level and blessings, for this build. */
    blessings: HeroBlessingsSchema.optional(),
    gear: GearSetupSchema.default({}),
    pets: PetsSchema.default([]),
    /** Up to 2 skin skills brought, with their stars; quest_done = the quest counts as done this run. */
    skins: z.array(BuildSkinSchema).max(2).default([]),
    /** HP, ATK and Block as the game shows them with this hero and gear. */
    basic_stats: BasicStatsSchema.default(DEFAULT_BASIC_STATS),
    /** Optional manual adjustment on top of the calculated stats (older files). */
    detailed_stats: DetailedStatsSchema.optional(),
    bag: BagMaskSchema.optional(),
    enhanced_cells: EnhancedCellsSchema.optional(),
    placements: z.array(LayoutPlacementSchema).default([]),
    battle: LayoutBattleSchema.optional(),
  })
  .strict();
export type BuildFile = z.infer<typeof BuildFileSchema>;

/** The account as the engine's Profile: no hero picked, no gear / pets / skins (a build's setup brings those). */
export function accountToProfile(a: AccountFile): Profile {
  return ProfileSchema.parse({
    basic_stats: DEFAULT_BASIC_STATS,
    heroes: a.heroes.map((h) => ({ id: h.id, stars: h.stars, links: h.links })),
    auras: a.auras,
    aura: a.aura,
  });
}

/** The account-wide part of a Profile. */
export function profileToAccount(p: Profile, migratedFromV1?: Record<string, unknown> | null): AccountFile {
  return {
    version: SAVE_VERSION,
    heroes: p.heroes.map((h) => ({ id: h.id, stars: h.stars, links: [...h.links] })),
    auras: structuredClone(p.auras),
    aura: p.aura,
    ...(migratedFromV1 ? { migrated_from_v1: migratedFromV1 } : {}),
  };
}

/** A build file as the engine's LayoutData (its setup is put into the account's profile with applySetup). */
export function buildFileToLayout(f: BuildFile): LayoutData {
  return {
    ...(f.name !== undefined ? { name: f.name } : {}),
    ...(f.hero ? { hero: f.hero } : {}),
    ...(f.bag ? { bag: f.bag } : {}),
    placements: f.placements,
    ...(f.enhanced_cells ? { enhanced_cells: f.enhanced_cells } : {}),
    setup: {
      ...(f.hero ? { hero: { id: f.hero, stars: 0, links: [], skin: null, ...(f.blessings ? { blessings: f.blessings } : {}) } } : {}),
      gear: f.gear,
      pets: f.pets,
      basic_stats: f.basic_stats,
      ...(f.detailed_stats && Object.keys(f.detailed_stats).length ? { detailed_stats: f.detailed_stats } : {}),
      equipped_skins: f.skins.map((s) => s.id),
      skin_quests_done: f.skins.filter((s) => s.quest_done).map((s) => s.id),
      skins: f.skins.map((s) => ({ id: s.id, stars: s.stars })),
    },
    ...(f.battle ? { battle: f.battle } : {}),
  };
}

/** A LayoutData as a build file. Its setup should be complete (the UI always keeps it so). */
export function layoutToBuildFile(l: LayoutData): BuildFile {
  const s = l.setup ?? {};
  const hero = l.hero ?? s.hero?.id ?? null;
  const equipped = s.equipped_skins ?? [];
  return {
    version: SAVE_VERSION,
    ...(l.name !== undefined ? { name: l.name } : {}),
    hero,
    ...(s.hero && s.hero.id === hero && s.hero.blessings ? { blessings: structuredClone(s.hero.blessings) } : {}),
    gear: structuredClone(s.gear ?? { weapon: null, shield: null, rings: [], gloves: [] }),
    pets: structuredClone(s.pets ?? []),
    skins: equipped.map((id) => ({ id, stars: s.skins?.find((x) => x.id === id)?.stars ?? 0, quest_done: (s.skin_quests_done ?? []).includes(id) })),
    basic_stats: structuredClone(s.basic_stats ?? DEFAULT_BASIC_STATS),
    ...(s.detailed_stats && Object.keys(s.detailed_stats).length ? { detailed_stats: structuredClone(s.detailed_stats) } : {}),
    ...(l.bag ? { bag: structuredClone(l.bag) } : {}),
    ...(l.enhanced_cells ? { enhanced_cells: structuredClone(l.enhanced_cells) } : {}),
    placements: structuredClone(l.placements),
    ...(l.battle ? { battle: structuredClone(l.battle) } : {}),
  };
}
