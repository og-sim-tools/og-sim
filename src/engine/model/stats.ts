/** Stat registry, data/stats.yaml (SPEC §4.3). The GUI builds its stat inputs from this. */
import { z } from 'zod';
import { Id } from './common';

export const StatDefSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    /** raw: a basic stat entered as 4M / 1.34M; pct: a percentage; flat: a plain count. */
    unit: z.enum(['raw', 'pct', 'flat']),
    /** basic / detailed: the Stat Details screen. combat: only on combatants during battle (enemy resistances etc.). */
    group: z.enum(['basic', 'detailed', 'economy', 'combat']),
    default: z.number().default(0),
    cap: z.number().optional(),
    /** Shown on the in-game Stat Details screen, so entered in the profile. */
    in_stat_details: z.boolean().default(true),
    /** Type DMG % for items with any of these tags ("[Creature] DMG Increase" → creature). */
    item_tags: z.array(Id).optional(),
    /** [LATER] */
    later: z.boolean().default(false),
    notes: z.string().optional(),
  })
  .strict();
export type StatDef = z.infer<typeof StatDefSchema>;

export const StatRegistrySchema = z.object({ stats: z.array(StatDefSchema) }).strict();
