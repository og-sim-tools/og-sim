/**
 * One handler per generic item-effect action (SPEC §5.2). Handlers only use the EffectApi the
 * battle gives them, so no item-specific logic lives here. Actions without a handler are
 * reported as not simulated yet.
 */
import type { Combatant, CombatItem } from '../combat/types';
import type { ItemEffect, ItemStatPct } from '../model';
import { isStaticStatEffect } from './resolve';

export interface EffectApi {
  own(item: CombatItem): Combatant;
  opponent(item: CombatItem): Combatant;
  /** Items the effect reaches (self / under dots / all / event item), after its filter. */
  itemTargets(owner: CombatItem, effect: ItemEffect, ev?: CombatItem): CombatItem[];
  /** The effect's `value`, scaled with the owner's basic stats; null if it can't be worked out. */
  value(owner: CombatItem, effect: ItemEffect): number | null;
  /** The amount of the event that fired the trigger (on_heal: the overheal). */
  eventAmount(): number;
  triggerStatus(owner: CombatItem, holder: Combatant, status: string, times: number, mult: number): void;
  multiplyStatus(owner: CombatItem, target: Combatant, status: string, pct: number): void;
  addPlayerStat(owner: CombatItem, target: Combatant, stat: string, amount: number, durationS?: number): void;
  preventLethal(owner: CombatItem, key: string, status: string | undefined, stacks: number, growth: number, avoid?: boolean): void;
  /** Kill the opponent outright. */
  execute(owner: CombatItem): void;
  /** deal_damage bonus_per_removed_block for the Block removed so far in this trigger. */
  removedBlockBonus(owner: CombatItem, effect: ItemEffect): number;
  /** A log line from an effect. */
  note(owner: CombatItem, text: string): void;
  /** A seeded random pick of n of the items (all when n is undefined). */
  pickRandom(list: CombatItem[], n: number | undefined): CombatItem[];
  /** Roll an in-battle chance stat of a side. */
  rollStat(side: CombatItem['side'], stat: string): boolean;
  addSkillHits(item: CombatItem, amount: number): void;
  scaleSkillDamage(item: CombatItem, factor: number): void;
  addAtkPct(target: Combatant, amount: number): void;
  addMaxHpPct(target: Combatant, amount: number, owner: CombatItem): void;
  /** Of these statuses, the one the target has most stacks of (none → null). */
  mostStacksOf(target: Combatant, ids: string[]): string | null;
  /** Totals for the breakdown: stacks a side cleansed from itself, removed from / stole from the enemy. */
  countMoves(owner: CombatItem, kind: 'cleansed' | 'removed' | 'stolen', list: { status?: string; stacks: number }[]): void;
  isBuff(status: string): boolean;
  isStealable(status: string): boolean;
  matches(item: CombatItem, filter: NonNullable<ItemEffect['filter']>): boolean;
  countSpent(owner: CombatItem, status: string, n: number): void;
  /** Steps one tick apart (see Battle.sequence). */
  sequence(times: number, step: (i: number) => number): void;
  /** A status id picked at fire time (apply_status `pick`), or null. */
  pickStatus(target: Combatant, pick: NonNullable<ItemEffect['pick']>): string | null;
  effectDamage(owner: CombatItem, target: Combatant, amount: number, type?: 'effect' | 'weapon', crit?: { bonusPct: number }): void;
  chargeCounter(owner: CombatItem, status: string, pct: number): void;
  releaseCounter(owner: CombatItem, status: string): void;
  heal(target: Combatant, amount: number, owner: CombatItem): void;
  gainBlock(target: Combatant, amount: number, owner: CombatItem): void;
  removeBlock(target: Combatant, amount: number, owner: CombatItem): void;
  loseHp(target: Combatant, amount: number, owner: CombatItem): void;
  applyStatus(owner: CombatItem, target: Combatant, status: string, stacks: number, depth: number, durationS?: number): void;
  removeStatuses(target: Combatant, match: { polarity?: 'buff' | 'debuff'; status?: string; steal?: boolean }, count: number, unit: 'stacks' | 'statuses' | undefined): { status: string; stacks: number }[];
  giveStatuses(to: Combatant, list: { status: string; stacks: number }[]): void;
  refund(item: CombatItem, pct: number, ofRemaining?: boolean): void;
  activate(item: CombatItem, depth: number): void;
  triggerActivation(item: CombatItem, depth: number): void;
  attack(item: CombatItem, depth: number): void;
  chargeSkill(item: CombatItem, pct: number, depth: number): void;
  addBonus(item: CombatItem, stat: ItemStatPct, amount: number, durationS?: number, untilHit?: boolean): void;
  /** value_growth × the value's stat × earlier fires of this effect. */
  growth(owner: CombatItem, effect: ItemEffect, index: number): number;
  addCombatStat(target: Combatant, stat: string, amount: number, durationS?: number): void;
  reduceHit(pct: number, owner: CombatItem): void;
  seal(item: CombatItem, durationS: number, by: CombatItem): void;
  randomOpponentItems(owner: CombatItem, n: number): CombatItem[];
  transform(item: CombatItem, newItemId: string): void;
  /** Bonus counter for add_stat_pct max_stacks. */
  bump(key: string): number;
  warnOnce(message: string): void;
}

/** `ev` = the item whose event fired the trigger, if any. */
export type Handler = (api: EffectApi, owner: CombatItem, effect: ItemEffect, index: number, depth: number, ev?: CombatItem) => void;

/** Combatant an effect targets: 'player' = the owner's side, 'enemy' = the other side. */
const who = (api: EffectApi, owner: CombatItem, effect: ItemEffect, fallback: 'player' | 'enemy'): Combatant => {
  const t = effect.target === 'player' || effect.target === 'enemy' ? effect.target : fallback;
  return t === 'player' ? api.own(owner) : api.opponent(owner);
};

/** Item targets, defaulting to the item itself when the effect names a combatant. */
const items = (api: EffectApi, owner: CombatItem, e: ItemEffect, ev?: CombatItem) =>
  e.target === 'player' || e.target === 'enemy' ? [owner] : api.itemTargets(owner, e, ev);

const amount = (api: EffectApi, owner: CombatItem, effect: ItemEffect, fn: (n: number) => void) => {
  const v = effect.event_pct !== undefined ? (api.eventAmount() * effect.event_pct) / 100 : api.value(owner, effect);
  if (v !== null) fn(v);
};

/** How many stacks / statuses to take: count (or stacks), × the number of `count_per_item` in my bag. */
const countOf = (api: EffectApi, owner: CombatItem, e: ItemEffect) =>
  (e.count ?? e.stacks ?? 1) * (e.count_per_item ? api.own(owner).items.filter((i) => i.itemId === e.count_per_item).length : 1);

export const HANDLERS: Partial<Record<ItemEffect['action'], Handler>> = {
  add_stat_pct(api, owner, e, index, _depth, ev) {
    // Start-of-battle / passive bonuses are already in the item's fixed stats (stats.ts), and
    // per-status bonuses are worked out at each hit.
    if (e.per_status) return;
    if (isStaticStatEffect(e) && owner.kind !== 'skill') return;
    if (e.trigger === 'passive') return; // applied once in Battle.start()
    for (const t of api.pickRandom(api.itemTargets(owner, e, ev), e.pick_random)) {
      if (e.max_stacks !== undefined && api.bump(`${owner.id}#${index}>${t.id}`) > e.max_stacks) continue;
      api.addBonus(t, e.stat!, e.amount!, e.duration_s, e.until_hit);
    }
  },
  deal_damage(api, owner, e) {
    amount(api, owner, e, (n) => {
      const bonus = api.removedBlockBonus(owner, e);
      api.sequence(e.hits ?? 1, () => {
        api.effectDamage(owner, who(api, owner, e, 'enemy'), n + bonus, e.damage_type, e.can_crit ? { bonusPct: e.crit_bonus_pct ?? 0 } : undefined);
        return 1;
      });
    });
  },
  gain_block(api, owner, e) {
    amount(api, owner, e, (n) => api.gainBlock(who(api, owner, e, 'player'), n, owner));
  },
  remove_block(api, owner, e) {
    const target = who(api, owner, e, 'enemy');
    if (e.pct_of_current !== undefined) api.removeBlock(target, (target.block * e.pct_of_current) / 100, owner);
    else amount(api, owner, e, (n) => api.removeBlock(target, n, owner));
  },
  heal(api, owner, e) {
    amount(api, owner, e, (n) => api.heal(who(api, owner, e, 'player'), n, owner));
  },
  lose_hp(api, owner, e, index) {
    const extra = e.value_growth !== undefined ? api.growth(owner, e, index) : 0;
    amount(api, owner, e, (n) => api.loseHp(who(api, owner, e, 'player'), n + extra, owner));
  },
  apply_status(api, owner, e, _index, depth) {
    const target = who(api, owner, e, 'enemy');
    const status = e.pick ? api.pickStatus(target, e.pick) : e.status!;
    if (!status) return;
    // Amount statuses (Waterdrop Cushion = damage absorbed) take their stacks from a value: "equal to 100% of your max HP".
    if (e.stacks === undefined) amount(api, owner, e, (n) => api.applyStatus(owner, target, status, e.value_as_hp_pct ? (100 * n) / Math.max(1, target.maxHp) : n, depth, e.duration_s));
    else {
      const per = e.duration_per_item ? api.own(owner).items.filter((i) => i.itemId === e.duration_per_item).length : 1;
      api.applyStatus(owner, target, status, e.stacks, depth, e.duration_s !== undefined ? e.duration_s * per : undefined);
    }
  },
  /** Remove random debuffs from me ("Cleanse 5 random debuffs"), or a named status ("Cleanse 5 Freeze"). */
  cleanse(api, owner, e) {
    const taken = api.removeStatuses(who(api, owner, e, 'player'), e.status ? { status: e.status } : { polarity: 'debuff' }, e.count ?? e.stacks ?? 1, e.count_unit);
    api.countMoves(owner, 'cleansed', taken);
  },
  /** Remove random buffs from the enemy, or a named status ("Remove 10 Dodge from the enemy"). */
  remove_status(api, owner, e) {
    const target = who(api, owner, e, 'enemy');
    // Snowball Fight: a chance not to use up the stacks when an item consumes them.
    if (e.consume && e.status && api.rollStat(owner.side, `${e.status}_keep_on_consume_pct`)) {
      api.note(owner, `keeps the ${e.status} it would consume`);
      return;
    }
    const status = e.pick_from ? api.mostStacksOf(target, e.pick_from) : e.status;
    if (e.pick_from && !status) return;
    const taken = api.removeStatuses(target, status ? { status } : { polarity: 'buff' }, countOf(api, owner, e), e.count_unit);
    // Spending stacks ("spend 25 Freeze to Stun", "consume 5 Spike") is a cost, not a cleanse or removal: nothing to steal.
    if (e.consume) {
      for (const r of taken) api.countSpent(owner, r.status, r.stacks);
      return;
    }
    if (target !== api.opponent(owner)) return api.countMoves(owner, 'cleansed', taken);
    // "When removing an enemy buff: x% chance to steal that buff instead." Only buffs can be stolen.
    if (taken.length && taken.every((r) => api.isBuff(r.status)) && api.rollStat(owner.side, 'steal_on_remove_pct')) {
      // Unstealable buffs (Waterdrop Cushion) are still removed, just not gained.
      const got = taken.filter((r) => api.isStealable(r.status));
      api.giveStatuses(api.own(owner), got);
      api.countMoves(owner, 'stolen', got);
      api.countMoves(owner, 'removed', taken.filter((r) => !api.isStealable(r.status)));
    } else api.countMoves(owner, 'removed', taken);
  },
  /** Take buffs from the enemy: they lose the stacks and I gain them. */
  steal_status(api, owner, e) {
    const status = e.pick_from ? api.mostStacksOf(api.opponent(owner), e.pick_from) : e.status;
    if (e.pick_from && !status) return;
    const taken = api.removeStatuses(api.opponent(owner), status ? { status, steal: true } : { polarity: 'buff', steal: true }, countOf(api, owner, e), e.count_unit);
    api.giveStatuses(api.own(owner), taken);
    api.countMoves(owner, 'stolen', taken);
  },
  refund_cooldown(api, owner, e, _index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) api.refund(t, e.pct!, e.pct_of === 'remaining');
  },
  activate_item(api, owner, e, _index, depth, ev) {
    for (const t of api.pickRandom(api.itemTargets(owner, e, ev), e.pick_random)) api.triggerActivation(t, depth + 1);
  },
  attack(api, owner, e, _index, depth, ev) {
    const times = (e.times ?? 1) + (e.times_per_bag ? api.own(owner).items.filter((i) => api.matches(i, e.times_per_bag!)).length : 0);
    for (const t of api.pickRandom(items(api, owner, e, ev), e.pick_random)) for (let k = 0; k < times; k++) api.attack(t, depth + 1);
  },
  charge_skill(api, owner, e, _index, depth, ev) {
    for (const t of items(api, owner, e, ev)) api.chargeSkill(t, e.pct!, depth);
  },
  /** Seal the item that hit me (event_item), or `count` random enemy items. */
  seal_item(api, owner, e, _index, _depth, ev) {
    const targets = e.target === 'event_item' ? (ev ? [ev] : []) : e.target === 'enemy' ? api.randomOpponentItems(owner, e.count ?? 1) : api.itemTargets(owner, e, ev);
    for (const t of targets) api.seal(t, e.duration_s!, owner);
  },
  reduce_hit_damage(api, owner, e) {
    api.reduceHit(e.pct!, owner);
  },
  add_combatant_stat(api, owner, e, index) {
    if (e.max_stacks !== undefined && api.bump(`${owner.id}#${index}`) > e.max_stacks) return;
    api.addCombatStat(who(api, owner, e, 'player'), e.combat_stat!, e.amount!, e.duration_s);
  },
  trigger_status(api, owner, e) {
    api.triggerStatus(owner, who(api, owner, e, 'enemy'), e.status!, e.count ?? 1, e.amount ?? 1);
  },
  multiply_status(api, owner, e) {
    api.multiplyStatus(owner, who(api, owner, e, 'enemy'), e.status!, e.pct!);
  },
  add_player_stat(api, owner, e) {
    api.addPlayerStat(owner, who(api, owner, e, 'player'), e.player_stat!, e.amount!, e.duration_s);
  },
  prevent_lethal(api, owner, e, index) {
    api.preventLethal(owner, `${owner.id}#${index}`, e.status, e.stacks ?? 0, e.stacks_growth ?? 0, e.avoid ?? false);
  },
  execute(api, owner) {
    api.execute(owner);
  },
  /** Statuses the target items inflict are +amount % from now on. */
  add_inflict_pct(api, owner, e, _index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) {
      t.inflictPct ??= {};
      t.inflictPct[e.status!] = (t.inflictPct[e.status!] ?? 0) + e.amount!;
    }
  },
  add_skill_hits(api, owner, e, index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) {
      if (e.max_stacks !== undefined && api.bump(`${owner.id}#${index}>${t.id}`) > e.max_stacks) continue;
      api.addSkillHits(t, e.amount!);
    }
  },
  scale_skill_damage(api, owner, e, _index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) api.scaleSkillDamage(t, e.amount!);
  },
  add_atk_pct(api, owner, e) {
    api.addAtkPct(who(api, owner, e, 'player'), e.amount!);
  },
  add_max_hp_pct(api, owner, e) {
    api.addMaxHpPct(who(api, owner, e, 'player'), e.amount!, owner);
  },
  add_next_attack_hits(api, owner, e, _index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) t.nextExtraHits = Math.max(t.nextExtraHits ?? 0, e.amount!);
  },
  /** Applied to the base cooldown before battle (stats.ts). */
  add_cooldown_s() {},
  charge_counter(api, owner, e) {
    api.chargeCounter(owner, e.status!, e.pct!);
  },
  release_counter(api, owner, e) {
    api.releaseCounter(owner, e.status!);
  },
  transform_item(api, owner, e, _index, _depth, ev) {
    for (const t of items(api, owner, e, ev)) api.transform(t, e.item!);
  },
};
