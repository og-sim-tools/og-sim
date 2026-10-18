/**
 * Which items each structured item effect reaches (SPEC §6 step 2). Only item dots decide
 * what a dot-based effect reaches; filters narrow it by tag / rarity / class.
 */
import { resolveDots } from '../bag';
import type { Loadout, PlacedEntry } from '../loadout';
import { type ItemEffect, RARITIES, type Rarity, COMBAT_ONLY_ITEM_STATS } from '../model';

export interface EffectApplication {
  /** Instance id of the item the effect belongs to. */
  source: string;
  /** Index into the source's `effects`. */
  index: number;
  effect: ItemEffect;
  /** Instance ids of items the effect reaches (empty for player / enemy targets). */
  targets: string[];
}

const rank = (r: Rarity) => RARITIES.indexOf(r);

/** The effects of a placed item that are active (gear effects need the gear's rarity). */
export function activeEffects(entry: PlacedEntry): { effect: ItemEffect; index: number }[] {
  return entry.def.effects
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => {
      if (!effect.gear_min_rarity && !effect.gear_max_rarity) return true;
      if (entry.kind !== 'gear' || !entry.gearRarity) return false;
      if (effect.gear_min_rarity && rank(entry.gearRarity) < rank(effect.gear_min_rarity)) return false;
      return !effect.gear_max_rarity || rank(entry.gearRarity) <= rank(effect.gear_max_rarity);
    });
}

export function matchesFilter(filter: ItemEffect['filter'], entry: PlacedEntry): boolean {
  if (!filter) return true;
  const tags = entry.def.tags;
  if (filter.tags_any && !filter.tags_any.some((t) => tags.includes(t))) return false;
  if (filter.tags_all && !filter.tags_all.every((t) => tags.includes(t))) return false;
  if (filter.rarity) {
    if (entry.kind !== 'item' || !('rarity' in entry.def) || !filter.rarity.includes(entry.def.rarity as never)) return false;
  }
  if (filter.class) {
    const cls = entry.kind === 'item' && 'class_restriction' in entry.def ? entry.def.class_restriction : [];
    if (!filter.class.some((c) => cls.includes(c))) return false;
  }
  if (filter.tags_none && filter.tags_none.some((t) => tags.includes(t))) return false;
  if (filter.applies && !canApply(entry, filter.applies, true)) return false;
  return true;
}

/**
 * Whether an item's dot effects care about the item under a dot: true / false, or null when the item
 * has no structured dot effects (then nothing is known). Used to highlight only the dots that matter.
 */
/** add_stat_pct effects stats.ts folds into the item's fixed stats; everything else is worked out in battle. */
export function isStaticStatEffect(e: ItemEffect): boolean {
  return (
    e.action === 'add_stat_pct' &&
    (e.trigger === 'passive' || e.trigger === 'battle_start') &&
    e.duration_s === undefined &&
    !e.per_status &&
    !e.condition &&
    !e.amount_from &&
    !e.until_hit &&
    !COMBAT_ONLY_ITEM_STATS.includes(e.stat ?? '')
  );
}

export function dotAffects(effects: readonly ItemEffect[], target: PlacedEntry): boolean | null {
  const checks: ItemEffect['filter'][][] = [];
  let causes = false;
  for (const e of effects) {
    if (e.uses_dots && e.trigger !== 'on_weapon_hit') checks.push([e.filter]);
    const watchesDots = e.watch === 'dots' || e.watch === 'self_and_dots' || (e.trigger === 'on_weapon_hit' && e.uses_dots && !e.watch);
    // "[dot] Item On Burn": only items under the dot that can apply that status set it off.
    const onStatus = e.trigger === 'on_status_applied' && typeof e.params?.status === 'string' ? (e.params.status as string) : null;
    if (watchesDots && onStatus) {
      if (canApply(target, onStatus)) causes = true;
    } else if (watchesDots) checks.push(e.trigger === 'on_weapon_hit' ? [{ tags_any: ['weapon'] }, e.watch_filter] : [e.watch_filter]);
    if (e.per_dot) checks.push([e.per_dot]);
  }
  if (checks.length === 0 && !causes) return effects.some((e) => e.watch === 'dots' || e.uses_dots || e.per_dot) ? false : null;
  return causes || checks.some((all) => all.every((f) => matchesFilter(f, target)));
}

/** Can this placed item apply the status itself (an apply_status of it, or a "most common debuff" pick)? */
function canApply(target: PlacedEntry, status: string, strict = false): boolean {
  return activeEffects(target).some(({ effect: x }) => x.action === 'apply_status' && (x.status === status || (!strict && x.pick !== undefined)));
}

/** Instance ids an effect of `sourceId` reaches. */
export function resolveTargets(loadout: Loadout, sourceId: string, effect: ItemEffect): string[] {
  const pick = (ids: string[]) =>
    ids.filter((id) => {
      const e = loadout.entries.get(id);
      return e !== undefined && matchesFilter(effect.filter, e);
    });
  switch (effect.target) {
    case 'items_under_dots':
      return pick(resolveDots(loadout.layout, sourceId).targets);
    case 'self_item':
      return pick([sourceId]);
    case 'all_items':
      return pick([...loadout.layout.items.keys()]);
    default:
      return [];
  }
}

/** Every active structured effect of every placed item, with its targets. */
export function resolveApplications(loadout: Loadout, keep: (e: ItemEffect) => boolean = () => true): EffectApplication[] {
  const out: EffectApplication[] = [];
  for (const id of loadout.layout.items.keys()) {
    const entry = loadout.entries.get(id);
    if (!entry) continue;
    for (const { effect, index } of activeEffects(entry)) {
      if (!keep(effect)) continue;
      out.push({ source: id, index, effect, targets: resolveTargets(loadout, id, effect) });
    }
  }
  return out;
}

/**
 * "Per [dot] X": the number of distinct items under the source's dots that match the filter. An
 * item covered by several dots counts once (SPEC §4.2).
 */
export function perDotCount(loadout: Loadout, sourceId: string, filter: ItemEffect['filter']): number {
  return resolveDots(loadout.layout, sourceId).targets.filter((id) => {
    const e = loadout.entries.get(id);
    return e !== undefined && matchesFilter(filter, e);
  }).length;
}
