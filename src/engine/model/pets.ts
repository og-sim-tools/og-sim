/** Pets (SPEC §4.7). */
import { z } from 'zod';
import { Id, PetRarity, provenance } from './common';
import { ItemEffects } from './effects';

export const PetSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    rarity: PetRarity,
    activation_cost: z.number().int().min(1).max(3),
    skill: z.object({ name: z.string(), text: z.string() }).strict(),
    star_effects: z
      .array(
        z
          .object({
            stars: z.number().int().min(1),
            text: z.string(),
            /** e.g. -1 for "Activation cost is decreased by 1". */
            activation_cost_delta: z.number().int().optional(),
          })
          .strict(),
      )
      .default([]),
    /** bag_items / battle matter for the MVP; economy is [LATER]. */
    role: z.enum(['bag_items', 'battle', 'economy']),
    /** Never simulated (e.g. Golem). */
    ignored: z.boolean().default(false),
    /** Items this pet puts into empty bag cells at the start of battle, from a star level. */
    spawns: z.array(z.object({ item: Id, count: z.number().int().positive(), stars: z.number().int().min(0).default(0) }).strict()).default([]),
    /** The skill in battle (entered by hand); `min_stars` on an effect = from that star. Pets ignore Haste / Freeze. */
    effects: ItemEffects,
    /** From a star level, spawned items inflict `factor` times a status ("Summoned Spiders inflict x2 Poison"). */
    spawn_inflict_multiplier: z
      .array(z.object({ stars: z.number().int().min(0), status: Id, factor: z.number().positive() }).strict())
      .default([]),
    ...provenance,
  })
  .strict();
export type PetData = z.infer<typeof PetSchema>;
