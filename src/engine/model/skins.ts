/** Hero skins (SPEC §4.6): a skin skill with a quest, effects by grade (0–5★) and who may use it. */
import { z } from 'zod';
import { ClassId, Id, Rarity, provenance } from './common';
import { ItemEffects } from './effects';

export const SkinSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    /** The hero who wears the skin. */
    hero: Id,
    rarity: Rarity.optional(),
    /** How it's obtained (event name), as the wiki says. */
    obtainable: z.string().optional(),
    /** Only seen on enemies ("Summer"): no skill, can't be owned. */
    enemy_only: z.boolean().default(false),
    skill: z
      .object({
        name: z.string(),
        quest: z.string(),
        reward: z.string(),
        /** "Skin Skill by Grade" text; the slash-separated numbers are what each star (1…5) adds. */
        by_grade: z.string().optional(),
      })
      .strict()
      .optional(),
    /**
     * The quest as something the bag can be checked against: a minimum total value of items with these
     * tags, items to own, a share of open cells filled, or `run` (needs rounds / the shop, so one battle
     * can't tell; the profile's "quest done" tick decides).
     */
    quest_check: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('bag_value'), tags_any: z.array(Id).min(1), min: z.number().positive() }).strict(),
        z.object({ type: z.literal('bag_items'), items: z.array(z.object({ item: Id, count: z.number().int().positive() }).strict()).min(1) }).strict(),
        z.object({ type: z.literal('bag_fill'), min_pct: z.number().positive().max(100) }).strict(),
        z.object({ type: z.literal('run'), note: z.string() }).strict(),
      ])
      .optional(),
    /** Who can use the skill: everyone, these classes, or these heroes. */
    available: z.object({ all: z.boolean().optional(), classes: z.array(ClassId).optional(), heroes: z.array(Id).optional() }).strict().optional(),
    /** complete / partial (some text isn't simulated) / shop (no battle effect) / needs_values (numbers missing). */
    status: z.enum(['complete', 'partial', 'shop', 'needs_values']).default('shop'),
    /** The skill in battle; `min_stars` / `max_stars` pick the version for the skin's stars. */
    effects: ItemEffects,
    /** Items the skill puts into empty bag cells at the start of battle, from a star level ("summon 3 Blood Moon Familiar"). */
    spawns: z.array(z.object({ item: Id, count: z.number().int().positive(), stars: z.number().int().min(0).default(0) }).strict()).default([]),
    /** Ownership effect text (ignored: already in my Stat Details, SPEC §1). */
    ownership_text: z.string().optional(),
    ...provenance,
  })
  .strict();
export type SkinData = z.infer<typeof SkinSchema>;
