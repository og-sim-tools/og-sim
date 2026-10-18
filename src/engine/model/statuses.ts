/**
 * Status effects: buffs and debuffs that live on a combatant (SPEC §5.3).
 * Not to be confused with item effects.
 */
import { z } from 'zod';
import { Id, provenance } from './common';

export const STATUS_BEHAVIOURS = [
  /** +pct_per_stack accuracy on the holder's attacks (Focus). */
  'accuracy_bonus',
  /** +pct_per_stack evasion against the opponent's attacks (Dodge). */
  'evasion_bonus',
  /** +pct_per_stack haste on the holder's items (Swift). */
  'haste',
  /** Final cooldown multiplier (1 + pct_per_stack × stacks / 100) on the holder's items (Freeze). */
  'slow',
  /** Heals the holder (Vamp, Regen). */
  'heal_holder',
  /** Damages the holder; scales with the inflicter (Burn, Poison). */
  'damage_holder',
  /** Damages whoever hit the holder; scales with the holder (Spike). */
  'damage_attacker',
  /** The holder's item cooldowns don't progress (non-stacking, timed). */
  'stun',
  /** Item-level: the sealed item can't progress or activate (see seal_item). */
  'seal',
  /** Take no damage; enemy attacks are ignored (timed). */
  'invincible',
  /** Healing × (1 + heal bonus % − pct_per_stack × stacks %), floor 0. */
  'heal_reduction',
  /** Damage taken +pct_per_stack % per stack (Frostbite). */
  'vulnerability',
  /** The next damage instance becomes 1 and uses up one stack (Divine Grace). */
  'damage_to_one',
  /** Just a count that other effects read (Charge, Scream, Wish). */
  'counter',
  /** Stacks are an amount of damage absorbed before block. */
  'absorb',
  /** While the holder is below full HP, each stack heals 1% of max HP (Waterdrop Cushion: refills to full). */
  'refill_hp',
  /** Every weapon attack against the holder misses (timed): "Evade all attacks for 3s". */
  'evade_all',
] as const;

export const STATUS_TRIGGERS = [
  /** When one of the holder's weapons hits. */
  'holder_weapon_hit',
  /** When the holder is hit by a weapon. */
  'holder_hit_by_weapon',
  /** On the status timer (global, from battle start, or interval_s). */
  'timer',
] as const;

export const StatusSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    polarity: z.enum(['buff', 'debuff']),
    description: z.string().default(''),
    /** False: can't be cleansed, removed or stolen (behaves like a stat: Heal Amount Reduction, Scream, Wish). */
    removable: z.boolean().optional(),
    /** False: can be removed but never stolen (Waterdrop Cushion). */
    stealable: z.boolean().optional(),
    /** Stacks multiply the effect. False for Stun / Seal / Invincible. */
    stacking: z.boolean().optional(),
    /** Usually applied with a duration. */
    has_duration: z.boolean().optional(),
    /** Damage or healing per stack, as a ratio of a basic stat. */
    amount_per_stack: z
      .object({
        ratio: z.number(),
        scales_with: z.enum(['atk', 'hp']),
        /** Whose stat: the holder's or the inflicter's. */
        of: z.enum(['holder', 'inflicter']).optional(),
      })
      .strict()
      .optional(),
    /** Percentage effect per stack (Focus, Dodge, Swift, Freeze: 1). */
    pct_per_stack: z.number().optional(),
    /** One roll for all stacks. */
    chance_pct: z.number().min(0).max(100).optional(),
    interval_s: z.number().positive().optional(),
    /** Ticks on the global timer from battle start, not from when it was applied. */
    global_timer: z.boolean().optional(),
    /** What the status does. Statuses without one aren't simulated yet. */
    behaviour: z.enum(STATUS_BEHAVIOURS).optional(),
    /** When it acts (for heal / damage behaviours). */
    trigger: z.enum(STATUS_TRIGGERS).optional(),
    /** Status-specific crit bonuses, added to the global ones (SPEC §7.3). */
    crit_chance_pct: z.number().optional(),
    crit_damage_pct: z.number().optional(),
    ...provenance,
  })
  .strict();
export type StatusData = z.infer<typeof StatusSchema>;
