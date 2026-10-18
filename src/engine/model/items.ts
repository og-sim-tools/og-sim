/** Shop items and pet-spawned items (SPEC §4.5). */
import { z } from 'zod';
import {
  ClassId,
  Id,
  ItemRarity,
  ScaledValue,
  geometry,
  geometryCheck,
  provenance,
} from './common';
import { EffectCondition, ItemEffects } from './effects';
import { GearSkillSchema } from './gear';

export const ItemStats = z
  .object({
    /** Ratio of ATK. */
    damage: ScaledValue.optional(),
    /** Seconds. Only items with a cooldown attack or activate on their own timer. */
    cooldown: z.number().positive().optional(),
    /** %. */
    accuracy: z.number().optional(),
    /** %, default 0. */
    crit_chance: z.number().optional(),
    /** %, default +100. */
    crit_damage: z.number().optional(),
    /** Hits per attack, default 1. */
    hits: z.number().int().positive().optional(),
    /** "Attacks once per battle" → 1. */
    max_attacks: z.number().int().positive().optional(),
    /** "This skill always hits": skip the accuracy roll. */
    always_hit: z.boolean().optional(),
    /** "Attack 0 ~ 2 more time(s)": after each activation, 0..N more activations at random (each attacks and counts as an activation). */
    random_extra_hits: z.number().int().positive().optional(),
    /** Hits are always critical while this holds ("Hits Stunned enemies as Critical Hit", "over 40 Burn"). */
    auto_crit_when: EffectCondition.optional(),
  })
  .strict();

export const ItemSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    /** pet_spawn / skin_spawn: put in the bag by a pet or a skin skill, never bought. */
    kind: z.enum(['item', 'pet_spawn', 'skin_spawn']).default('item'),
    rarity: ItemRarity,
    tags: z.array(Id).default([]),
    /** Empty = any class. */
    class_restriction: z.array(ClassId).default([]),
    hero_exclusive: Id.optional(),
    ...geometry,
    stats: ItemStats.default({}),
    /** Effect text as written on the wiki (or as corrected by me). */
    effect_text: z.string().default(''),
    /** Flavour text (italic on the wiki). */
    flavor: z.string().optional(),
    /** Named scaled values used by the effect text, e.g. block: 0.04x HP. */
    effect_values: z.record(Id, ScaledValue).default({}),
    effects: ItemEffects,
    /** How much of the effect text `effects` covers. Missing = text only. */
    effects_status: z.enum(['partial', 'complete']).optional(),
    /** Shop price in gold. Sell value is computed: ceil(value / 2). */
    value: z.number().int().nonnegative(),
    /** Sprite under data/images/ (from the wiki) and its native pixel size, drawn over the item's cells. */
    image: z.string().optional(),
    image_size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict().optional(),
    /** True when the wiki showed `?` (value is then 0). */
    value_unknown: z.boolean().default(false),
    merges_into: z.array(Id).default([]),
    /** "Made from" — the source of truth for recipes. */
    components: z.array(Id).default([]),
    special_shop: z.boolean().default(false),
    /** "Disappears after battle." */
    temporary: z.boolean().default(false),
    /** A gear-style skill (custom enemy items): timer or gauge, its own hits; "On Skill Hit" effects fire on it. */
    skill: GearSkillSchema.optional(),
    /** A monster item made in the enemy item editor: only offered when building an enemy. */
    enemy_item: z.boolean().default(false),
    ...provenance,
  })
  .strict()
  .superRefine(geometryCheck);
export type ItemData = z.infer<typeof ItemSchema>;

export const sellValue = (item: { value: number }): number => Math.ceil(item.value / 2);
