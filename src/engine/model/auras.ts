/** Auras (SPEC §4.10). Ownership effects count for every hero; the equipped aura's skill is economy [LATER]. */
import { z } from 'zod';
import { Id, Rarity, provenance } from './common';

export const AuraSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    rarity: Rarity,
    skill_name: z.string(),
    skill_text: z.string(),
    /** Ownership effect: `stat` + amount at 0★, then the amount at 1★ … 7★ (from the game). */
    ownership: z.object({ stat: Id, base: z.number(), by_stars: z.array(z.number()) }).strict().optional(),
    ...provenance,
  })
  .strict();
export type AuraData = z.infer<typeof AuraSchema>;
