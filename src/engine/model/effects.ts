/**
 * Structured item effects (SPEC §5.2). Item effects belong to items and gear; they are not
 * status effects (statuses.ts).
 *
 * Effects start as text (`effect_text`); I convert them in small reviewed batches. Lists of
 * triggers and actions will grow. Phase 3 only evaluates `add_stat_pct`; the rest is combat.
 */
import { z } from 'zod';
import { ClassId, Id, ItemRarity, Rarity, ScaledValue } from './common';

export const TRIGGERS = [
  'passive',
  'battle_start',
  'on_hit',
  'on_weapon_hit',
  'on_skill_hit',
  'on_attack',
  'on_use',
  'on_activation',
  'on_damage_dealt',
  'on_attacked',
  'on_dodge',
  'on_crit',
  'on_status_applied',
  'on_block_gained',
  'hp_below',
  'timer',
  /** About to take a weapon hit: reduce_hit_damage changes that hit. */
  'before_attacked',
  /** A gear weapon skill activates. */
  'on_skill_activation',
  /** I stunned the enemy. */
  'on_stun',
  /** I stunned an enemy that was already stunned (Meteor Hammer's Wish). */
  'on_restun',
  /** A hit is about to kill the holder. If the holder is Invincible afterwards, or the enemy died
   * during these effects, the killing blow is avoided (Celestial Shield, Deathrattle's Scream). */
  'on_lethal',
  /** An item of mine healed (or a status healed me, for watch: any). Event amount = the overheal. */
  'on_heal',
  /** Someone in the fight entered Berserk (once per fight). */
  'on_berserk',
  /** My side dealt damage with a status (params.status: only that one): "When dealing DMG with Burn". */
  'on_status_damage',
  /** Stacks were removed from the enemy by an effect (cleanse, remove, steal): params.statuses / params.polarity limit which; amount = stacks. */
  'on_status_removed',
  /** My own item or skill made me lose HP ("Upon losing HP yourself"); amount = HP lost. */
  'on_self_hp_loss',
  /** I resisted a status (params.status: only that one): "Every time you resist Stun". */
  'on_status_resisted',
  /** I lost HP from any source (damage that reached HP, or my own Lose HP); amount = HP lost. `every` works with it ("On 15% HP Loss"). */
  'on_hp_lost',
  /** One of my items missed (or was evaded): an item event ("On [dot] Weapon Miss"). */
  'on_miss',
] as const;

export const ACTIONS = [
  'add_stat_pct',
  'deal_damage',
  'gain_block',
  'remove_block',
  'heal',
  'lose_hp',
  'apply_status',
  'remove_status',
  'cleanse',
  'steal_status',
  'refund_cooldown',
  'charge_skill',
  'activate_item',
  'attack',
  'spawn_item',
  'transform_item',
  /** Disable item(s) for duration_s: the event item, or `count` random items of the target side. */
  'seal_item',
  /** In before_attacked: reduce the incoming hit by `pct` %. */
  'reduce_hit_damage',
  /** Add `amount` to a combat stat (damage reduction, resistance, …) of a combatant, optionally for duration_s. */
  'add_combatant_stat',
  /** Add `pct` % of the damage the event hit dealt to a counter status on me (Scream). */
  'charge_counter',
  /** Deal damage equal to a counter status's stacks to the enemy, then clear it (Scream on death). */
  'release_counter',
  /** Make a status deal its effect `count` times right now (default 1), each × `amount` (default 1): "Activates Spike 6 times". */
  'trigger_status',
  /** Raise a status's stacks on the target by `pct` % ("increase the enemy's Poison stacks by 20%"). */
  'multiply_status',
  /** Add `amount` to a detailed stat (all_dmg_increase, burn_dmg_increase, block_gain …) of a combatant in battle.
   * passive: applies while `condition` holds; other triggers: from then on (or for duration_s). */
  'add_player_stat',
  /** In on_lethal: pay `stacks` of `status` (+ `stacks_growth` per earlier use) to reduce the killing blow to 1. */
  'prevent_lethal',
  /** Add `amount` hits to the target items' gear skill (max_stacks caps how often). */
  'add_skill_hits',
  /** passive: multiply the target items' gear skill damage by `amount` ("Skill DMG is doubled"). */
  'scale_skill_damage',
  /** passive: kill the enemy outright when `condition` holds (checked every tick): "Execute the opponent". */
  'execute',
  /** Statuses the target items inflict are +`amount` % (status: which one): "Items in enhanced slots inflict 50% more Poison". */
  'add_inflict_pct',
  /** Total ATK +`amount` % for the rest of the battle. */
  'add_atk_pct',
  /** passive: change the target items' base cooldown by `amount` seconds ("Decrease Cooldown by 1.5s" = -1.5). */
  'add_cooldown_s',
  /** Max HP +`amount` % of the starting max HP; current HP rises by the same (counts as HP % for Gigantization). */
  'add_max_hp_pct',
  /** The target item's next attack hits `amount` more times (doesn't stack: "the next attack hits two times" = 1). */
  'add_next_attack_hits',
] as const;

/** Per-item percentage stats an effect can add to (stacking additively). */
export const ITEM_STAT_PCTS = ['haste_pct', 'damage_pct', 'accuracy_pct', 'crit_chance_pct', 'crit_damage_pct', 'skill_damage_pct', 'block_dmg_pct', 'atk_dmg_pct'] as const;
/** Item stats only worked out in battle: block_dmg_pct = extra damage per hit equal to x% of my current Block;
 * atk_dmg_pct = extra damage per hit equal to x% of my ATK ("deal 0.6x ATK additional DMG" = 60). */
export const COMBAT_ONLY_ITEM_STATS: readonly string[] = ['block_dmg_pct', 'atk_dmg_pct'];
export type ItemStatPct = (typeof ITEM_STAT_PCTS)[number];

/** event_item = the item whose event set off the trigger (e.g. the spell that was just activated). */
export const EffectTarget = z.enum(['items_under_dots', 'self_item', 'all_items', 'event_item', 'player', 'enemy']);

export const ItemFilter = z
  .object({
    tags_any: z.array(Id).optional(),
    tags_all: z.array(Id).optional(),
    rarity: z.array(ItemRarity).optional(),
    class: z.array(ClassId).optional(),
    /** Only items covering an enhanced bag cell (layout enhanced_cells: Venom, Cecilia). */
    enhanced: z.boolean().optional(),
    /** Items with none of these tags ("non-Spear weapons"). */
    tags_none: z.array(Id).optional(),
    /** Shop items only, not gear ("excluding gear"). */
    exclude_gear: z.boolean().optional(),
    /** Items that can apply this status themselves ("[dot] Item that grants Dodge"). */
    applies: Id.optional(),
    /** Of the matching items, only the strongest (highest damage per attack) or fastest (shortest cooldown right now). */
    pick: z.enum(['strongest', 'fastest']).optional(),
  })
  .strict();

/**
 * Whose event fires an item-event trigger (on_hit, on_weapon_hit, on_attack, on_activation, on_crit):
 * self = this item; dots = an item under this item's dots; any = any of my items.
 * Defaults: on_weapon_hit → dots if uses_dots else any; other item events → self.
 */
export const Watch = z.enum(['self', 'dots', 'self_and_dots', 'any']);

/** Every listed part must hold when the effect would fire. `who` is whose state is checked. */
export const EffectCondition = z
  .object({
    who: z.enum(['self', 'enemy']).default('self'),
    has_block: z.boolean().optional(),
    /** Has at least min_stacks (default 1) of this status. */
    status: Id.optional(),
    min_stacks: z.number().optional(),
    /** Doesn't have this status. */
    no_status: Id.optional(),
    hp_above_pct: z.number().optional(),
    hp_below_pct: z.number().optional(),
    /** `who` has more of `status` than `factor` × the other side's current HP %: "Spike stacks exceed 10 times the opponent's HP %". */
    status_over_foe_hp: z.object({ status: Id, factor: z.number().positive() }).strict().optional(),
    /** `who` has at least `min` stacks of these statuses together ("a total of 30 or more Focus and Dodge"). */
    statuses_total: z.object({ statuses: z.array(Id).min(1), min: z.number() }).strict().optional(),
  })
  .strict();
export type EffectCondition = z.infer<typeof EffectCondition>;

export const ItemEffectSchema = z
  .object({
    /** The part of effect_text this effect encodes. */
    text: z.string().optional(),
    trigger: z.enum(TRIGGERS),
    /** Reaches the items under this item's dots. */
    uses_dots: z.boolean().default(false),
    /** Which items count (for item targets). */
    filter: ItemFilter.optional(),
    /** Whose event fires the trigger (see Watch), and which of those items count. */
    watch: Watch.optional(),
    watch_filter: ItemFilter.optional(),
    chance_pct: z.number().min(0).max(100).optional(),
    /** Free-form until conditions are structured (phase 5+). */
    condition: EffectCondition.optional(),
    /** Multiply the effect by the number of distinct items under this item's dots matching the filter ("per [dot] Armor"). */
    per_dot: ItemFilter.optional(),
    /** Start-of-battle order: lower first (defaults per action in config battle_start_priority). */
    priority: z.number().optional(),
    /** deal_damage: damage type ("effect" skips damage reductions; pets use "weapon"). */
    damage_type: z.enum(['effect', 'weapon']).optional(),
    limit: z.object({ per_battle: z.number().int().positive() }).strict().optional(),
    action: z.enum(ACTIONS),
    target: EffectTarget,
    duration_s: z.number().positive().optional(),
    /** add_stat_pct: which stat and how much (negative = slow / reduction). */
    stat: z.enum(ITEM_STAT_PCTS).optional(),
    amount: z.number().optional(),
    /** Amount for deal_damage / gain_block / heal / lose_hp / remove_block: a scaled value, or the name of one in effect_values. */
    value: z.union([ScaledValue, Id]).optional(),
    /** apply_status: which status and how many stacks (fractions alternate, SPEC §5.3). */
    status: Id.optional(),
    stacks: z.number().positive().optional(),
    /** refund_cooldown: % of the cooldown given back. */
    pct: z.number().optional(),
    /** add_stat_pct: amount × stacks of a status (on me or the enemy), worked out at each hit. */
    per_status: z
      .object({ status: Id, on: z.enum(['self', 'enemy']), max_stacks: z.number().positive().optional() })
      .strict()
      .optional(),
    /** cleanse / remove_status / steal_status / seal_item: how many. */
    count: z.number().int().positive().optional(),
    /** cleanse / remove_status / steal_status: count stacks, or whole statuses. Default from config. */
    count_unit: z.enum(['stacks', 'statuses']).optional(),
    /** transform_item / spawn_item: the item id. */
    item: Id.optional(),
    /** add_combatant_stat: a stat-registry id (combat group), e.g. attack_dmg_reduction. */
    combat_stat: Id.optional(),
    /** add_stat_pct in combat: the most times it can stack. */
    max_stacks: z.number().int().positive().optional(),
    /** timer: every N seconds from battle start (not affected by haste), or once at N seconds. */
    interval_s: z.number().positive().optional(),
    at_s: z.number().nonnegative().optional(),
    /** hp_below: fires when HP drops to this % of max HP or lower. */
    hp_pct: z.number().min(0).max(100).optional(),
    /** Pets: the effect applies from this star level (star effects). */
    min_stars: z.number().int().min(0).optional(),
    /** … and up to this star level (a higher star replaces it with a stronger version). */
    max_stars: z.number().int().min(0).optional(),
    /** Gear: the effect applies when the gear is at this rarity or higher … */
    gear_min_rarity: Rarity.optional(),
    /** … and at most this rarity (a higher rarity replaces it with a stronger version). */
    gear_max_rarity: Rarity.optional(),
    /** on_status_applied: fire once per this many stacks applied ("On Inflicting 100 Freeze");
     * on_block_gained: once per this much Block gained ("Every 1.0x Block gained"). */
    every: z.union([z.number().positive(), ScaledValue]).optional(),
    /** gain_block / heal / deal_damage: `event_pct` % of the event amount (overheal for on_heal) instead of `value`. */
    event_pct: z.number().positive().optional(),
    /** add_player_stat: a stat-registry id (detailed group). */
    player_stat: Id.optional(),
    /** prevent_lethal: extra stacks paid per earlier use. */
    stacks_growth: z.number().nonnegative().optional(),
    /** apply_status: pick the status at fire time instead of naming it. */
    pick: z.enum(['most_stacks_debuff']).optional(),
    /** apply_status: inflict bonuses (Burn Inflict +x%, blessings, pet multipliers) don't apply: Gloves of Plague's
     * "inflict 2 of the most common debuff" is a debuff effect, not Burn. */
    ignore_inflict_bonus: z.boolean().optional(),
    /** prevent_lethal: evade the killing blow entirely instead of reducing it to 1. */
    avoid: z.boolean().optional(),
    /** refund_cooldown: % of the full cooldown (default) or of what's left of it. */
    pct_of: z.enum(['cooldown', 'remaining']).optional(),
    /** Only fire when the event amount is above this (on_heal: overheal > 0 → "On Over Heal"). */
    min_event_amount: z.number().optional(),
    /** passive add_player_stat / add_stat_pct: amount × a stat (or × missing HP %), capped at `max`: "All DMG up to 30% in proportion to Max HP increase". */
    amount_from: z
      .object({
        stat: Id.optional(),
        missing_hp: z.boolean().optional(),
        /** amount = factor × stacks of this status on `status_on` (relative to the owner): "per Burn stack on the enemy". */
        status: Id.optional(),
        status_on: z.enum(['self', 'enemy']).optional(),
        /** amount = factor × my (or the enemy's) remaining HP % ("Increase DMG by up to 50% based on remaining HP": factor 0.5). */
        remaining_hp: z.boolean().optional(),
        enemy_remaining_hp: z.boolean().optional(),
        /** add_stat_pct: amount = factor × how far the target item's accuracy is over this ("Crit Rate by the amount Accuracy exceeds 100%"). */
        accuracy_over: z.number().optional(),
        /** add_stat_pct: amount = factor × the target item's current Crit Rate ("Crit DMG increases by that Weapon's Crit Rate"). */
        target_crit: z.boolean().optional(),
        /** amount = factor × stacks of this status my side has removed (or stolen) from the enemy so far ("for each enemy Spike stack removed during battle"). */
        removed: Id.optional(),
        factor: z.number(),
        max: z.number().optional(),
      })
      .strict()
      .optional(),
    /** passive add_player_stat: × the number of different matching items in the bag (inverse: amount ÷ that number, 0 → amount). */
    per_bag: ItemFilter.extend({ inverse: z.boolean().optional() }).optional(),
    /** Effects of one item with the same roll_group share one chance roll per event ("25% chance to gain 1 Spike, and Haste +5%"). */
    roll_group: z.string().optional(),
    /** activate_item / attack: only this many random items of the targets. */
    pick_random: z.number().int().positive().optional(),
    /** passive: amount − `step` for each matching item in the bag (instances), not below `min`: "for each non-Spear weapon reduce by 10%". */
    per_bag_reduce: ItemFilter.extend({ step: z.number(), min: z.number().default(0) }).optional(),
    /** remove_block: remove this % of the target's current Block instead of a `value`. */
    pct_of_current: z.number().positive().optional(),
    /** deal_damage: + this value for each 100% of max HP worth of Block removed earlier in the same trigger (Flesh Burst). */
    bonus_per_removed_block: ScaledValue.optional(),
    /** remove_status: paying a cost ("consumes Freeze"): <status>_keep_on_consume_pct may keep the stacks. */
    consume: z.boolean().optional(),
    /** Combatant-level triggers (on_heal, on_berserk …): fire on the opponent's event instead of my own ("each time the enemy Heals"). */
    listen: z.enum(['enemy']).optional(),
    /** After firing, the effect can't fire again for this long ("Can activate every 3s"). */
    cooldown_s: z.number().positive().optional(),
    /** timer: no more fires after this many seconds ("for 10s, … every 3s"). */
    until_s: z.number().positive().optional(),
    /** remove_status / steal_status: take from whichever of these statuses the target has most of ("Focus or Dodge, whichever has more"). */
    pick_from: z.array(Id).min(1).optional(),
    /** apply_status with a `value` / `event_pct`: the amount is HP, turned into % of the target's max HP (Waterdrop Cushion: 1 stack = 1%). */
    value_as_hp_pct: z.boolean().optional(),
    /** deal_damage: the hit can crit, with the owner side's Crit Rate + `crit_bonus_pct` and its Crit DMG (pet attacks). */
    can_crit: z.boolean().optional(),
    crit_bonus_pct: z.number().optional(),
    /** add_stat_pct: the bonus lasts until the target item's next hit or miss ("until the next hit"). */
    until_hit: z.boolean().optional(),
    /** heal / gain_block / deal_damage: the value × stacks of a status ("Heal 0.002x Max HP more for every Burn stack on the enemy"). */
    scale_per_status: z.object({ status: Id, on: z.enum(['self', 'enemy']), max: z.number().optional() }).strict().optional(),
    /** lose_hp / heal / gain_block / deal_damage: + this ratio of the same stat for each earlier fire ("increases by 0.05x Max HP each activation"). */
    value_growth: z.number().optional(),
    /** apply_status: duration_s × the number of this item in my bag ("1s per Black Feather in your backpack"). */
    duration_per_item: Id.optional(),
    /** remove_status / steal_status: count × the number of this item in my bag ("remove 2 Spike for each Witch's Mirror you own"). */
    count_per_item: Id.optional(),
    /** attack: each target attacks `times` (default 1) + one more per matching item in my bag ("attack once each, repeated for each Legendary Sword"). */
    times: z.number().int().nonnegative().optional(),
    times_per_bag: ItemFilter.optional(),
    /** deal_damage: this many hits, one tick apart ("deals 0.5x ATK DMG 3 times"). */
    hits: z.number().int().positive().optional(),
    /** A reading of the text not confirmed in game: shown as a warning in every battle where this effect is active. */
    assumption: z.string().optional(),
    /** Parameters for actions not implemented yet. */
    params: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.action === 'add_stat_pct' && (e.stat === undefined || e.amount === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['stat'], message: 'add_stat_pct needs `stat` and `amount`' });
    }
    const need = (field: keyof typeof e, actions: string[]) => {
      if (actions.includes(e.action) && e[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${e.action} needs \`${field}\`` });
      }
    };
    if (e.event_pct === undefined && e.pct_of_current === undefined) need('value', ['deal_damage', 'gain_block', 'heal', 'lose_hp', 'remove_block']);
    if (e.pick === undefined) need('status', ['apply_status']);
    need('status', ['trigger_status', 'multiply_status']);
    need('pct', ['multiply_status']);
    need('player_stat', ['add_player_stat']);
    if (e.amount_from === undefined) need('amount', ['add_player_stat']);
    need('amount', ['add_skill_hits', 'scale_skill_damage', 'add_atk_pct', 'add_cooldown_s', 'add_max_hp_pct', 'add_next_attack_hits']);
    if (['scale_skill_damage', 'add_cooldown_s'].includes(e.action) && e.trigger !== 'passive') {
      ctx.addIssue({ code: 'custom', path: ['trigger'], message: `${e.action} only works with the passive trigger` });
    }
    if (e.every !== undefined && !['on_status_applied', 'on_block_gained', 'on_status_removed', 'on_hp_lost'].includes(e.trigger)) {
      ctx.addIssue({ code: 'custom', path: ['every'], message: '`every` only works with on_status_applied or on_block_gained' });
    }
    if (e.value === undefined && e.event_pct === undefined) need('stacks', ['apply_status']);
    need('pct', ['refund_cooldown', 'reduce_hit_damage', 'charge_skill']);
    need('item', ['transform_item']);
    need('combat_stat', ['add_combatant_stat']);
    need('status', ['add_inflict_pct']);
    need('amount', ['add_inflict_pct']);
    if (e.action === 'execute' && (e.trigger !== 'passive' || !e.condition)) {
      ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'execute needs the passive trigger and a condition' });
    }
    need('amount', ['add_combatant_stat']);
    need('duration_s', ['seal_item']);
    need('status', ['charge_counter', 'release_counter']);
    need('pct', ['charge_counter']);
    if (e.trigger === 'timer' && e.interval_s === undefined && e.at_s === undefined) {
      ctx.addIssue({ code: 'custom', path: ['interval_s'], message: 'timer needs `interval_s` or `at_s`' });
    }
    if (e.trigger === 'hp_below' && e.hp_pct === undefined) {
      ctx.addIssue({ code: 'custom', path: ['hp_pct'], message: 'hp_below needs `hp_pct`' });
    }
    if (e.target === 'items_under_dots' && !e.uses_dots) {
      ctx.addIssue({ code: 'custom', path: ['uses_dots'], message: 'target items_under_dots needs `uses_dots: true`' });
    }
  });
export type ItemEffect = z.infer<typeof ItemEffectSchema>;

export const ItemEffects = z.array(ItemEffectSchema).default([]);
