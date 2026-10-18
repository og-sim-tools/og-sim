/** Gear: equipped in the main menu, brought into every battle (SPEC §4.5). */
import { z } from 'zod';
import { Id, Rarity, ScaledValue, geometry, geometryCheck, provenance } from './common';
import { ItemEffects } from './effects';

export const GearSlot = z.enum(['weapon', 'shield', 'ring', 'glove']);
export type GearSlot = z.infer<typeof GearSlot>;

/** A weapon skill (gear; also custom enemy items). Haste and Freeze never change its timing. */
export const GearSkillSchema = z
  .object({
    text: z.string(),
    /** e.g. "Activates every 8 seconds". */
    trigger_text: z.string().optional(),
    /** Structured skill (entered by hand). Haste and Freeze never change skill timing. */
    damage: ScaledValue.optional(),
    hits: z.number().int().positive().optional(),
    /** Fixed timer: activates every N seconds. */
    interval_s: z.number().positive().optional(),
    /** Skill Gauge: activates whenever the gauge reaches 100% (charge_skill fills it). */
    gauge: z.boolean().optional(),
    /** Defaults to the basic attack's accuracy / crit rate. */
    accuracy: z.number().optional(),
    crit_chance: z.number().optional(),
    always_hit: z.boolean().optional(),
    /** Extra hits per stack of a status on me (Meteor Hammer: one more meteor per Wish). */
    extra_hits_per_status: Id.optional(),
  })
  .strict();
export type GearSkill = z.infer<typeof GearSkillSchema>;

export const GearSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    slot: GearSlot,
    s_rank: z.boolean().default(false),
    tags: z.array(Id).default([]),
    /** Already included in Stat Details; display only. */
    bonus_stat: z.string().optional(),
    /** Weapons only. */
    skill: GearSkillSchema.optional(),
    gear_effect_text: z.string().default(''),
    /** Each rarity adds its effect and keeps all lower ones. */
    rarity_effects: z
      .array(
        z
          .object({
            rarity: Rarity,
            text: z.string(),
            /** Plain stat line, already in Stat Details — never applied again. */
            stat_only: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    /** Weapons only, entered by hand (not on the wiki). */
    basic_attack: z
      .object({
        damage: ScaledValue.optional(),
        cooldown: z.number().positive().optional(),
        accuracy: z.number().optional(),
        crit_chance: z.number().optional(),
        hits: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    ...geometry,
    /** A different footprint from a rarity up (gloves' "+2 [dot] Slots" at epic). The highest that applies wins. */
    rarity_footprints: z.array(z.object({ min_rarity: Rarity, footprint: z.string() }).strict()).default([]),
    /** Plain stat lines from rarity_effects, structured: added to my stats when equipped at that rarity or higher. */
    stat_lines: z.array(z.object({ rarity: Rarity, stat: Id, amount: z.number(), text: z.string().optional() }).strict()).default([]),
    /** The weapon's bonus stat ("Crit Rate +12.5%" = the wiki value). The amount used comes from the profile's
     * bonus_value or config gear.bonus_stat_known for the equipped rarity + tier (accountStats.ts). */
    bonus: z.object({ stat: Id, amount: z.number(), text: z.string().optional() }).strict().optional(),
    /** Reference sprite under data/images/. */
    image: z.string().optional(),
    image_size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict().optional(),
    /** Small square menu icon under data/images/ (wiki Gear-Icon), shown next to the gear's name in lists. */
    icon: z.string().optional(),
    effects: ItemEffects,
    /** How much of the effect text `effects` covers. Missing = text only. */
    effects_status: z.enum(['partial', 'complete']).optional(),
    ...provenance,
  })
  .strict()
  .superRefine(geometryCheck);
export type GearData = z.infer<typeof GearSchema>;
