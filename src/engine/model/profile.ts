/** profile/profile.yaml — my account (SPEC §4.8). Rule checks (capacity, class, slots) come in phase 3. */
import { z } from 'zod';
import { Abbrev, Id, Rarity } from './common';

export const GearRef = z
  .object({
    id: Id,
    rarity: Rarity,
    tier: z.number().int().nonnegative().default(0),
    level: z.number().int().nonnegative().default(1),
    /** The weapon's bonus stat as the game shows it (Crit Rate +18.75% → 18.75). Always wins; needed for any
     * rarity + tier not in config gear.bonus_stat_known. */
    bonus_value: z.number().nonnegative().optional(),
  })
  .strict();

/** The Stat Details screen: basic stats plus the detailed lines (keys from data/stats.yaml). */
export const BasicStatsSchema = z.object({ hp: Abbrev, atk: Abbrev, initial_block: Abbrev }).strict();
export const DetailedStatsSchema = z.record(Id, z.number());

/** A hero's Dragon's Blessing level and the blessings equipped on it. */
export const HeroBlessingsSchema = z
  .object({
    level: z.number().int().min(1),
    equipped: z.array(z.object({ id: Id, rarity: Rarity, value: z.number() }).strict()).default([]),
  })
  .strict();

export const OwnedHeroSchema = z
  .object({
    id: Id,
    stars: z.number().int().nonnegative(),
    /** Linked skill ids [LATER effects]. */
    links: z.array(Id).default([]),
    skin: z.string().nullable().default(null),
    blessings: HeroBlessingsSchema.optional(),
  })
  .strict();

export const GearSetupSchema = z
  .object({
    weapon: GearRef.nullable().default(null),
    shield: GearRef.nullable().default(null),
    rings: z.array(GearRef).default([]),
    gloves: z.array(GearRef).default([]),
  })
  .strict();

export const PetsSchema = z.array(z.object({ id: Id, stars: z.number().int().nonnegative(), active: z.boolean().default(true) }).strict());
/** Pets I own and their stars (account-wide): a build's pets are played at these stars. */
export const OwnedPetsSchema = z.array(z.object({ id: Id, stars: z.number().int().nonnegative() }).strict());

export const ProfileSchema = z
  .object({
    basic_stats: BasicStatsSchema,
    /** Keys come from data/stats.yaml. */
    detailed_stats: DetailedStatsSchema.default({}),
    heroes: z.array(OwnedHeroSchema).default([]),
    active_hero: Id.nullable().default(null),
    gear: GearSetupSchema.default({}),
    /** The pets brought (up to 3) with their stars and whether their skill is used. */
    pets: PetsSchema.default([]),
    /** Pets I own and their stars (account-wide); the brought pets take their stars from here. */
    owned_pets: OwnedPetsSchema.default([]),
    /** The equipped aura (its skill is economy [LATER]). */
    aura: Id.nullable().default(null),
    /** Auras I own and their stars: their ownership effects add to my stats. */
    auras: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(7) }).strict()).default([]),
    /** Skins I own and their stars (0–5). Account-wide, like hero ownership and stars. */
    skins: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(5) }).strict()).default([]),
    /** Skin skills I bring (up to 2): each works only for heroes it's available to, and only if owned. Saved per build. */
    equipped_skins: z.array(Id).max(2).default([]),
    /** Skins whose quest is done in this run: their skill only works then. Saved per layout (setup). */
    skin_quests_done: z.array(Id).default([]),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;
