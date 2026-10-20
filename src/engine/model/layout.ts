/** A build as the engine and UI use it: a bag, what's placed in it, and its setup (SPEC §4.1, §8). Saved files: src/engine/saves. */
import { z } from 'zod';
import { Id } from './common';
import { InlineEnemySchema } from './enemies';
import { BagMaskSchema, EnhancedCellsSchema, LayoutPlacementSchema, StoredItemSchema } from './placement';
import { BasicStatsSchema, DetailedStatsSchema, GearSetupSchema, OwnedHeroSchema } from './profile';

export { LayoutPlacementSchema };

/**
 * The setup a build is played with (its hero, equipped gear, the pets and skins it brings); it's put into the
 * account's profile with applySetup. Stars, blessings and HP / ATK / Block are the account's (2026-10-19); the
 * fields marked "older files" only come from builds saved before that, and win over the account's when present.
 */
export const LayoutSetupSchema = z
  .object({
    hero: OwnedHeroSchema.optional(),
    gear: GearSetupSchema.optional(),
    /** The pets brought; stars only in older files (else the account's). */
    pets: z.array(z.object({ id: Id, stars: z.number().int().nonnegative().optional(), active: z.boolean().default(true) }).strict()).optional(),
    /** Older files: Stat Details as shown with this hero and gear. */
    basic_stats: BasicStatsSchema.optional(),
    detailed_stats: DetailedStatsSchema.optional(),
    /** The skin skills brought with this build (up to 2). */
    equipped_skins: z.array(z.string()).max(2).optional(),
    /** Skins whose quest is done in this run. */
    skin_quests_done: z.array(z.string()).optional(),
    /** Skins whose skill is on even if the bag doesn't meet the quest now. */
    skin_quests_forced: z.array(z.string()).optional(),
    /** Older files: this build's skins and their stars (0–5). */
    skins: z.array(z.object({ id: Id, stars: z.number().int().min(0).max(5) }).strict()).max(2).optional(),
  })
  .strict();

/** Battle settings (SPEC §8.1). */
export const LayoutBattleSchema = z
  .object({
    mode: z.string().default('stage'),
    /** Overrides the mode's time limit (seconds per fight). */
    duration_s: z.number().positive().optional(),
    seed: z.union([z.number().int(), z.string()]).default(1),
    runs: z.number().int().positive().default(1),
    /** An enemy id from data/enemies, or an enemy typed in here. */
    enemy: z.union([Id, InlineEnemySchema]).optional(),
    /** Gauntlet / Boss Rush: the enemies in order. */
    enemies: z.array(z.union([Id, InlineEnemySchema])).optional(),
    /** Chapter mode: which chapter, sandbox (one of its enemies) or a full playthrough [later], and which enemy (1-based). */
    chapter: z
      .object({
        number: z.number().int().positive(),
        play: z.enum(['sandbox', 'playthrough']).default('sandbox'),
        fight: z.number().int().positive().default(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const LayoutSchema = z
  .object({
    name: z.string().optional(),
    /** Defaults to the profile's active hero. */
    hero: Id.optional(),
    /** Defaults to the full 8 × 6 bag. */
    bag: BagMaskSchema.optional(),
    placements: z.array(LayoutPlacementSchema).default([]),
    /** Items set aside in the storage box beside the bag (not in battle). */
    storage: z.array(StoredItemSchema).optional(),
    /** Bag cells enhanced by a hero skill this run (Venom's Poison Coating, Cecilia's Instant Casting are random in game, so pick them). */
    enhanced_cells: EnhancedCellsSchema.optional(),
    /** The setup this build is played with; loading the build puts it into the profile. */
    setup: LayoutSetupSchema.optional(),
    battle: LayoutBattleSchema.optional(),
  })
  .strict();
export type LayoutData = z.infer<typeof LayoutSchema>;
