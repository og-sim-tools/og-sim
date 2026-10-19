/** Dragon's Blessings, per hero (SPEC §4.6). */
import { z } from 'zod';
import { ClassId, Id, provenance } from './common';
import { EffectCondition } from './effects';

export const BlessingValue = z.union([
  z.object({ min: z.number(), max: z.number() }).strict(),
  z.object({ value: z.number() }).strict(),
]);
export type BlessingValue = z.infer<typeof BlessingValue>;

const perRarity = z
  .object({
    common: BlessingValue.optional(),
    uncommon: BlessingValue.optional(),
    rare: BlessingValue.optional(),
    epic: BlessingValue.optional(),
    legendary: BlessingValue.optional(),
    mythic: BlessingValue.optional(),
  })
  .strict();

export const BlessingSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    kind: z.enum(['common', 'class', 'unique']),
    /** Class blessings only. */
    class: ClassId.optional(),
    /** Unique blessings only. */
    hero: Id.optional(),
    /** Unique blessings that buff a hero skill. */
    buffs_skill: Id.optional(),
    /**
     * How the blessing changes that skill: on effect `effect` (index in the skill's effects), the number at `path`
     * (dot path, e.g. "chance_pct", "amount_from.max") gets the blessing's value added (add), value / 100 added
     * (add_pct_of_one: factors like 0.25), or is scaled by (1 + value / 100) (scale_pct: "Final DMG +50%").
     */
    skill_mods: z
      .array(z.object({ effect: z.number().int().nonnegative(), path: z.string(), op: z.enum(['add', 'add_pct_of_one', 'scale_pct']) }).strict())
      .optional(),
    /** Something the simulator can't do on its own (shown instead of "not simulated"), e.g. "mark one more enhanced cell". */
    manual_note: z.string().optional(),
    /** The blessing's value is that many more enhanced bag slots for the skill it buffs (Venom's Poison Coating: +1 / +2). */
    adds_enhanced_slots: z.boolean().optional(),
    effect_text: z.string().default(''),
    /** The stat-registry stat this blessing raises (shown on Stat Details), e.g. all_dmg_increase. */
    stat: Id.optional(),
    /** A bonus that only applies in battle while a condition holds ("When HP is below 50%, DMG +x%"). The blessing's value is the amount. */
    combat_bonus: z.object({ stat: Id, when: EffectCondition }).strict().optional(),
    /** "[Spirit] Burn Inflict & Swift Gain": items with target_tags inflict/gain these statuses +value% more. */
    item_inflict_statuses: z.array(Id).optional(),
    /** Tags named in brackets, e.g. [Sword] → sword. */
    target_tags: z.array(Id).default([]),
    unit: z.enum(['pct', 'seconds', 'flat']),
    /** Ranges (common / class) or fixed values (unique) per rarity. */
    values: perRarity,
    ...provenance,
  })
  .strict()
  .superRefine((b, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (b.kind === 'class' && !b.class) issue('class', 'class blessings need a `class`');
    if (b.kind === 'unique' && !b.hero) issue('hero', 'unique blessings need a `hero`');
    if (b.kind !== 'class' && b.class) issue('class', 'only class blessings have a `class`');
    if (b.kind !== 'unique' && b.hero) issue('hero', 'only unique blessings have a `hero`');
    if (Object.keys(b.values).length === 0) issue('values', 'needs at least one rarity');
  });
export type BlessingData = z.infer<typeof BlessingSchema>;
