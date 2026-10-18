/** Heroes (SPEC §4.6). */
import { z } from 'zod';
import { ClassId, HeroRarity, Id, provenance } from './common';
import { ItemEffects } from './effects';

export const HeroSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    class: ClassId,
    rarity: HeroRarity,
    /** As listed on the wiki; checked against config. */
    base_supply_ability: z.number().int().nonnegative(),
    /** Skill ids are global, so other heroes can link them. Their battle effects are in skill_effects. */
    skills: z.array(z.object({ id: Id, name: z.string().min(1), text: z.string() }).strict()).default([]),
    /** Which of this hero's skills other heroes can link, at which star level. */
    skill_links: z.array(z.object({ stars: z.number().int().min(0), skill: Id }).strict()).default([]),
    exclusive_items: z.array(z.object({ item: Id, note: z.string().optional() }).strict()).default([]),
    /** Starting equipment unlocked by this hero's stars. */
    supplies: z.array(z.object({ stars: z.number().int().min(0), item: Id }).strict()).default([]),
    /** Skin names as the wiki lists them; the skins themselves are in data/skins/. */
    skins: z.array(z.string()).default([]),
    /** Hero skills in battle, by skill id (entered by hand): effects run for the active hero (own skills + links). */
    skill_effects: z
      .record(
        Id,
        z
          .object({
            effects: ItemEffects,
            /** complete / partial (some text isn't simulated) / shop (no battle effect) / needs_values (numbers missing). */
            status: z.enum(['complete', 'partial', 'shop', 'needs_values']),
            notes: z.string().optional(),
          })
          .strict(),
      )
      .default({}),
    ...provenance,
  })
  .strict();
export type HeroData = z.infer<typeof HeroSchema>;
