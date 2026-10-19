/**
 * data/config.yaml — tunable rules. Everything marked [UNVERIFIED] in SPEC lives here.
 */
import { z } from 'zod';

const rarityList = z.array(z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'])).min(1);
const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const int = z.number().int().nonnegative();

export const ConfigSchema = z
  .object({
    rarities: z
      .object({ item: rarityList, gear: rarityList, blessing: rarityList, pet: rarityList, hero: rarityList })
      .strict(),
    bag: z
      .object({
        width: z.literal(8),
        full_height: int,
        /** The smaller bags by class ("x26" …): rows top to bottom, `#` = a cell, `.` = none; narrower rows are centred. */
        sizes: z.record(z.enum(['warrior', 'ranger', 'wizard']), z.record(z.string().min(1), z.array(z.string().regex(/^[#.]+$/)).min(1))).default({}),
      })
      .strict(),
    gear: z
      .object({
        slots: z.object({ weapon: int, shield: int, ring: int, glove: int }).strict(),
        /** Highest tier per rarity (Epic +0..+2 → 2). Rarities not listed have no tiers. */
        max_tier: z.record(z.string(), int),
        /** [UNVERIFIED] Gear bonus stat multiplier per rarity. */
        /** Confirmed weapon bonus stat values by "<rarity>+<tier>" (e.g. "mythic+0": 50). Anything else needs the in-game value. */
        bonus_stat_known: z.record(z.string().regex(/^[a-z]+\+\d+$/), z.number().nonnegative()).default({}),
      })
      .strict(),
    heroes: z
      .object({
        max_stars: int,
        supply_ability_base: z.object({ rare: int, epic: int, legendary: int }).strict(),
        supply_ability_per_star: int,
        /** Expected star levels of a hero's supply unlocks, per hero rarity. */
        supply_unlock_stars: z.object({ rare: z.array(int), epic: z.array(int), legendary: z.array(int) }).strict(),
        skill_link_stars: z.array(int),
      })
      .strict(),
    /** Supply Ability cost per item rarity. */
    supply_cost: z.object({ common: int, uncommon: int, rare: int, epic: int, legendary: int }).strict(),
    blessings: z
      .object({
        max_per_hero: int,
        /** My account's Dragon's Blessing level: used for heroes added in the editor and heroes without one. */
        default_level: int.default(1),
        /** [UNVERIFIED] Tag blessings ([Sword] Weapon DMG …) are already in Stat Details. If false they're added per item. */
        tag_bonuses_in_stat_details: z.boolean(),
        /** Dragon's Blessing level → slots. */
        slots_by_level: z.record(z.string().regex(/^\d+$/), int),
      })
      .strict(),
    pets: z.object({ max_equipped: int, activation_points: int, max_stars: int }).strict(),
    stats: z
      .object({
        /** Stat Details already include gear / blessing / star / pet / aura passives (confirmed). */
        passives_included_in_stat_details: z.boolean(),
      })
      .strict(),
    observations: z
      .object({
        /** How the game turns numbers into displayed text. */
        display_rounding: z.enum(['round', 'truncate']),
      })
      .strict(),
    timing: z
      .object({
        /** [UNVERIFIED] */
        tick_seconds: pos,
        min_cooldown_seconds: pos,
        /** [UNVERIFIED] ticks between hits of a multi-hit attack (0 = same tick). */
        multi_hit_spacing_ticks: int,
        status_timer_seconds: pos,
        /** Max times a trigger fires per tick; triggers not listed are unlimited. */
        trigger_rate_limits: z.record(z.string(), int),
        /** [UNVERIFIED] Within a tick, whose items act first. */
        side_order: z.enum(['player_first', 'enemy_first', 'random']),
      })
      .strict(),
    combat: z
      .object({
        hit_chance_floor_pct: nonneg,
        hit_chance_cap_pct: nonneg,
        crit_rate_cap_pct: nonneg,
        default_crit_damage_pct: nonneg,
        status_crit_rate_cap_pct: nonneg.default(100),
        status_crit_dmg_per_rate_from: z.enum(['total', 'bonus']).default('bonus'),
        damage_taken_floor_pct: nonneg,
        /** [UNVERIFIED] separate: (1 + type%) × (1 + all%); additive: (1 + type% + all%). */
        all_dmg_mode: z.enum(['separate', 'additive']),
        /** [UNVERIFIED] */
        additional_damage_gets_final_multiplier: z.boolean(),
        /** [UNVERIFIED] "Lose HP" from my own items never takes me below this much HP. */
        self_hp_loss_floor: nonneg,
        /** [UNVERIFIED] Both sides die in the same tick (not the Spike case): who wins. */
        mutual_kill_winner: z.enum(['player', 'enemy', 'random']),
        /** immediate: a fighter at 0 HP stops acting at once (first killing blow wins); end_of_tick: both finish the tick. */
        death_timing: z.enum(['immediate', 'end_of_tick']).default('immediate'),
        /** Safety cap on activations chained inside one tick (spell → spell → …). */
        max_chain_depth: int,
        /** [UNVERIFIED] Stun Resistance: chance × (1 − resist %) (multiply) or chance − resist % (subtract). */
        stun_resistance_mode: z.enum(['multiply', 'subtract']),
        /** [UNVERIFIED] Stunned again while stunned: keep the longer duration (longest) or add them (add). */
        stun_reapply: z.enum(['longest', 'add']),
        /** [UNVERIFIED] Stun also pauses gear weapon skill timers. */
        stun_pauses_gear_skills: z.boolean(),
        /** [UNVERIFIED] "Remove 5 random debuffs": 5 stacks or 5 whole statuses. */
        removal_unit: z.enum(['stacks', 'statuses']),
        /** Waterdrop Cushion: missing 2.3% uses 3 stacks (ceil) or 2.3 (exact). */
        refill_rounding: z.enum(['ceil', 'exact']).default('ceil'),
        /** [UNVERIFIED] Gear skill hits count as weapon hits (accuracy, Burn, Spike, on-hit effects). */
        skill_hits_are_weapon_hits: z.boolean(),
        /** [UNVERIFIED] Attack DMG Increase applies to gear skill damage. */
        skill_damage_gets_attack_dmg: z.boolean(),
      })
      .strict(),
    berserk: z
      .object({
        start_seconds: nonneg,
        interval_seconds: pos,
        first_stack: z.object({ dmg_pct: z.number(), haste_pct: z.number(), accuracy_pct: z.number() }).strict(),
        per_stack: z.object({ dmg_pct: z.number(), haste_pct: z.number(), accuracy_pct: z.number() }).strict(),
        sides: z.object({ chapter: z.enum(['enemy', 'both', 'none']), pvp: z.enum(['enemy', 'both', 'none']) }).strict(),
      })
      .strict(),
    /** Fights against a player enemy (PvP): both sides' base HP and Block × this (user, 2026-10-17). */
    pvp: z.object({ hp_block_multiplier: z.number().positive() }).strict().default({ hp_block_multiplier: 20 }),
    /** Start-of-battle order by action (lower first; ties go in bag order). `gear_basic_attack` = gear weapons hitting at the start. */
    battle_start_priority: z.record(z.string(), z.number()),
    multi_fight: z
      .object({
        /** [UNVERIFIED] Gauntlet / Boss Rush: item cooldown progress carries over to the next fight. */
        carry_cooldowns: z.boolean(),
        /** [UNVERIFIED] Gauntlet: Berserk counts from each fight's start (Boss Rush always does). */
        berserk_per_fight: z.boolean(),
      })
      .strict(),
    modes: z.record(
      z.string(),
      z
        .object({
          /** Seconds per fight. */
          fight_seconds: pos.optional(),
          /** Seconds across all fights. */
          total_seconds: pos.optional(),
          fights: int,
          /** 1-based fight numbers that are bosses. */
          boss_fights: z.array(int).default([]),
          later: z.boolean().default(false),
          /** The time limit can't be changed (Boss Rush: always 30 s). */
          fixed_time: z.boolean().default(false),
          /** Always against a player (Arena): HP and Block × pvp.hp_block_multiplier for both, PvP Berserk and Final DMG. */
          pvp: z.boolean().default(false),
          /** Who wins when time runs out: the enemy (stages), or whoever has the higher remaining HP % (Arena). */
          timeout_winner: z.enum(['enemy', 'hp_pct']).default('enemy'),
        })
        .strict(),
    ),
  })
  .strict();
export type Config = z.infer<typeof ConfigSchema>;
