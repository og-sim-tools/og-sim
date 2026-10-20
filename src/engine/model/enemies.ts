/** MVP enemies (SPEC §4.9). */
import { z } from 'zod';
import { Abbrev, Id, provenance } from './common';
import { BagMaskSchema, EnhancedCellsSchema, LayoutPlacementSchema, StoredItemSchema } from './placement';
import { ProfileSchema } from './profile';

/**
 * An enemy built like a player: its own account (stats, hero with stars and blessings, gear, pets,
 * auras) and bag. With a build, the enemy's hp / atk / block / attacks are ignored: everything comes
 * from the build, as for me. Resistances, immunities and starting statuses still add on top.
 */
export const EnemyBuildSchema = z
  .object({
    profile: ProfileSchema,
    placements: z.array(LayoutPlacementSchema).default([]),
    bag: BagMaskSchema.optional(),
    enhanced_cells: EnhancedCellsSchema.optional(),
    /** Items set aside beside the bag while editing it (not in battle). */
    storage: z.array(StoredItemSchema).optional(),
    /** The saved layout this build came from (its name is offered when saving the enemy build). */
    source_layout: z.string().optional(),
  })
  .strict();
export type EnemyBuild = z.infer<typeof EnemyBuildSchema>;

/** execute: Execute effects do nothing; hp_based: damage worked out from its max HP does nothing (raid bosses, SPEC §7.5). */
export const IMMUNITIES = ['burn', 'poison', 'freeze', 'stun', 'weapon_attack', 'spike', 'execute', 'hp_based'] as const;

export const EnemyAttack = z
  .object({
    name: z.string().optional(),
    /** Flat damage per hit. */
    damage: Abbrev.default(0),
    /** Damage per hit as a % of the target's max HP, on top of `damage` (a raid boss's weak hits). */
    pct_max_hp: z.number().nonnegative().optional(),
    cooldown: z.number().positive(),
    accuracy: z.number(),
    hits: z.number().int().positive().default(1),
    crit_chance: z.number().default(0),
    /** Statuses each hit inflicts ("On Hit: inflict 3 Burn"). */
    // self (version 6): the attacker gains it (Spike, Dodge …) instead of inflicting it on me.
    on_hit: z.array(z.object({ status: Id, stacks: z.number().positive(), duration_s: z.number().positive().optional(), self: z.boolean().optional() }).strict()).optional(),
  })
  .strict();

const enemyFields = {
  id: Id,
  name: z.string().min(1),
  hp: Abbrev,
  /** Used for statuses the enemy inflicts (Burn / Poison scale with the inflicter's ATK). */
  atk: Abbrev.default(0),
  block: Abbrev.default(0),
  /** %, adds with other reductions. */
  damage_reduction: z.number().default(0),
  attacks: z.array(EnemyAttack).default([]),
  /** Set automatically for Gauntlet's 4th enemy and Boss Rush. */
  boss: z.boolean().default(false),
  starting_statuses: z
    .array(z.object({ status: Id, stacks: z.number().positive(), duration: z.number().positive().optional() }).strict())
    .default([]),
  /** Stat-registry ids → value, e.g. burn_resistance: 50. */
  resistances: z.record(Id, z.number()).default({}),
  /** Stat-registry ids → value, e.g. attack_dmg_vulnerability: 20. */
  vulnerabilities: z.record(Id, z.number()).default({}),
  immunities: z.array(z.enum(IMMUNITIES)).default([]),
  traits: z.array(Id).default([]),
  /** Goes berserk unless false (missing = on). The Short Time Limit trait also turns it off. */
  berserk: z.boolean().optional(),
  /** monster (chapters) or player (PvP: both sides' HP and Block × config pvp.hp_block_multiplier, PvP Berserk and
   * Final DMG in PvP). Missing: player when it has a build, monster otherwise. */
  kind: z.enum(['monster', 'player']).optional(),
  build: EnemyBuildSchema.optional(),
  /** Fought in raids only (left out of the chapter monster list). */
  raid: z.boolean().optional(),
  /** An item whose picture stands for this enemy in the Battle tab. */
  image_item: Id.optional(),
};

export const EnemySchema = z.object({ ...enemyFields, ...provenance }).strict();
export type EnemyData = z.infer<typeof EnemySchema>;

/** An enemy typed straight into a layout's battle settings (no provenance needed). */
export const InlineEnemySchema = z.object({ ...enemyFields, id: Id.default('custom_enemy'), notes: z.string().optional() }).strict();
