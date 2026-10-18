/** Enemy traits — descriptions only; effects are [LATER] (SPEC §4.9). */
import { z } from 'zod';
import { Id, provenance } from './common';

export const EnemyTraitSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    group: z.string(),
    /** Variants of the wiki text ("… / or: …"). */
    descriptions: z.array(z.string()).min(1),
    ...provenance,
  })
  .strict();
export type EnemyTraitData = z.infer<typeof EnemyTraitSchema>;
