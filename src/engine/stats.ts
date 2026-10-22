/**
 * Stat aggregation (SPEC §4.3, §6 step 3, §7.3): player stats from the profile and final stats
 * per placed item, with a breakdown of where every bonus came from.
 *
 * - Basic stats (HP, ATK, Initial Block) come straight from Stat Details; nothing modifies them.
 * - Stat Details already include gear / blessing / star / pet / aura passives, so those are never
 *   added again (config `stats.passives_included_in_stat_details`).
 * - Percentage bonuses stack additively: item base + global (Stat Details) + bonuses received.
 * - Scaled values are ratio × the current basic stat.
 */
import { computeAccountStats } from './accountStats';
import type { Gear, Item } from './loader';
import type { Loadout, LoadoutIssue, PlacedEntry } from './loadout';
import { copyName, copyNumbers } from './loadout';
import { perDotCount, resolveApplications, isStaticStatEffect } from './effects/resolve';
import type { ItemStatPct, ScaledValue } from './model';
import { type ResolvedRatio, parseAbbrev, resolveRatio } from './numbers';

export interface Contribution {
  amount: number;
  source: 'base' | 'global' | 'item';
  label: string;
  /** Instance id of the item that gave it (source 'item'). */
  from?: string;
}

export interface PctStat {
  total: number;
  parts: Contribution[];
}

export interface ItemFinalStats {
  instanceId: string;
  itemId: string;
  name: string;
  kind: 'item' | 'gear';
  damage: null | {
    ratio: ResolvedRatio;
    /** ratio × ATK. */
    base: number;
    /** Type-specific increases (Attack DMG, [Creature] DMG, item-specific %). */
    typePct: PctStat;
    /** All DMG Increase. */
    allPct: PctStat;
    modifier: number;
    /** base × modifier, before crits, additional damage and final multipliers (combat). */
    perHit: number;
    hits: number;
  };
  cooldown: null | {
    base: number;
    haste: PctStat;
    /** base / (1 + haste), clamped to the minimum cooldown. Freeze / Swift apply in combat. */
    final: number;
    clamped: boolean;
  };
  /** Raw accuracy before evasion; can exceed 100. */
  accuracy: PctStat | null;
  critChance: (PctStat & { capped: number }) | null;
  critDamage: PctStat | null;
  /** Named values from effect_values, scaled with the current basic stats. */
  effectValues: Record<string, { ratio: ResolvedRatio; scalesWith: ScaledValue['scales_with']; value: number | null }>;
}

export interface PlayerStats {
  hp: number;
  atk: number;
  initialBlock: number;
  /** Every non-basic stat in the registry, defaults filled in. */
  detailed: Record<string, number>;
}

/**
 * Tag blessings of the active hero ([Sword] Weapon DMG, [Bow] DMG, …) as type-% bonuses for an
 * item with these tags. Blessings that raise a Stat Details stat are never added (already there).
 * Returns 0 when config says tag bonuses are already in Stat Details.
 */
export function blessingTagBonuses(loadout: Loadout): { label: string; tags: string[]; amount: number }[] {
  const { data, profile } = loadout;
  if (data.config?.blessings.tag_bonuses_in_stat_details) return [];
  const hero = profile.heroes.find((h) => h.id === loadout.heroId);
  const out: { label: string; tags: string[]; amount: number }[] = [];
  for (const b of hero?.blessings?.equipped ?? []) {
    const def = data.blessings.get(b.id);
    if (!def || def.stat || def.target_tags.length === 0 || !/DMG/i.test(def.name)) continue;
    out.push({ label: `Blessing: ${def.name}`, tags: def.target_tags, amount: b.value });
  }
  return out;
}

export function blessingTagBonus(loadout: Loadout, tags: readonly string[]): number {
  return blessingTagBonuses(loadout)
    .filter((b) => b.tags.some((t) => tags.includes(t)))
    .reduce((a, b) => a + b.amount, 0);
}

/** The active hero's blessings the simulator doesn't use (skill buffs, conditional bonuses …). */
export function unsimulatedBlessings(loadout: Loadout): string[] {
  const { data, profile } = loadout;
  const hero = profile.heroes.find((h) => h.id === loadout.heroId);
  const tagged = new Set(blessingTagBonuses(loadout).map((b) => b.label));
  return (hero?.blessings?.equipped ?? [])
    .map((b) => data.blessings.get(b.id))
    .filter((d): d is NonNullable<typeof d> => !!d && !d.stat && !d.combat_bonus && !d.item_inflict_statuses && !d.skill_mods && !d.manual_note && !tagged.has(`Blessing: ${d.name}`))
    .filter((d) => !(data.config?.blessings.tag_bonuses_in_stat_details && d.target_tags.length > 0))
    .map((d) => d.name);
}

export interface StatsResult {
  player: PlayerStats;
  items: Map<string, ItemFinalStats>;
  issues: LoadoutIssue[];
}

const pct = (parts: Contribution[]): PctStat => ({ total: parts.reduce((s, p) => s + p.amount, 0), parts });

function itemStatsOf(entry: PlacedEntry) {
  if (entry.kind === 'item') return (entry.def as Item).stats;
  return (entry.def as Gear).basic_attack ?? {};
}

export function aggregateStats(loadout: Loadout): StatsResult {
  const { data, profile } = loadout;
  const config = data.config!;
  const issues: LoadoutIssue[] = [];
  const rounding = config.observations.display_rounding;

  if (!config.stats.passives_included_in_stat_details) {
    issues.push({
      level: 'error',
      code: 'passives_not_supported',
      message:
        'config stats.passives_included_in_stat_details is false, but adding gear / blessing / pet passives on top of Stat Details is not implemented yet. Nothing was added, so stats may be too low.',
    });
  }

  // ---------------------------------------------------------------- player
  // Calculated from gear, blessings and auras (accountStats.ts).
  const account = computeAccountStats(data, profile, loadout.heroId);
  for (const n of account.notes) issues.push({ level: 'warning', code: 'stat_not_counted', message: n });
  for (const b of account.bonusMissing) issues.push({ level: 'error', code: 'gear_bonus_missing', message: b.message });
  const detailed = account.detailed;
  const player: PlayerStats = { hp: account.hp, atk: account.atk, initialBlock: account.initialBlock, detailed };
  const global = (id: string): Contribution[] => {
    const listed = account.parts.filter((p) => p.stat === id && p.amount !== 0);
    // The stat's default (Crit DMG 100%) is the part not explained by gear, blessings or manual values.
    const base = (detailed[id] ?? 0) - listed.filter((p) => p.label !== 'Manual adjustment').reduce((a, p) => a + p.amount, 0) - (id in profile.detailed_stats ? profile.detailed_stats[id]! : 0);
    const out: Contribution[] = base !== 0 ? [{ amount: base, source: 'global', label: `${data.stats.get(id)?.name ?? id} (base)` }] : [];
    return [...out, ...listed.map((p) => ({ amount: p.amount, source: 'global' as const, label: p.label }))];
  };
  const basicOf = (s: ScaledValue['scales_with']) => (s === 'atk' ? player.atk : s === 'hp' ? player.hp : null);

  // ---------------------------------------------------------------- bonuses from other items
  const received = new Map<string, Record<ItemStatPct, Contribution[]>>();
  const bucket = (id: string) => {
    let b = received.get(id);
    if (!b) {
      b = { haste_pct: [], damage_pct: [], accuracy_pct: [], crit_chance_pct: [], crit_damage_pct: [], skill_damage_pct: [], block_dmg_pct: [], atk_dmg_pct: [] };
      received.set(id, b);
    }
    return b;
  };
  const statApps = resolveApplications(
    loadout,
    // Bonuses per status stack change during battle, so they're worked out in combat instead.
    isStaticStatEffect,
  );
  for (const app of statApps) {
    const src = loadout.entries.get(app.source)!;
    // "Per [dot] X": × the number of distinct matching items under the dots.
    const n = app.effect.per_dot ? perDotCount(loadout, app.source, app.effect.per_dot) : 1;
    if (n === 0) continue;
    // A target reached by several dots of one effect counts once (targets are unique).
    for (const t of app.targets) {
      bucket(t)[app.effect.stat!].push({
        amount: app.effect.amount! * n,
        source: 'item',
        label: n > 1 ? `${src.def.name} (×${n})` : src.def.name,
        from: app.source,
      });
    }
  }

  // "Decrease Cooldown by 1.5s": flat change to the base cooldown, before haste.
  const cooldownShift = new Map<string, number>();
  for (const app of resolveApplications(loadout, (e) => e.action === 'add_cooldown_s')) {
    for (const t of app.targets) cooldownShift.set(t, (cooldownShift.get(t) ?? 0) + app.effect.amount!);
  }

  const tagBonuses = blessingTagBonuses(loadout);
  for (const name of unsimulatedBlessings(loadout)) {
    issues.push({ level: 'warning', code: 'blessing_not_simulated', message: `Blessing "${name}" isn't simulated (skill buff or conditional bonus) [later].` });
  }

  // ---------------------------------------------------------------- per item
  const items = new Map<string, ItemFinalStats>();
  const copies = copyNumbers(loadout.layout);
  for (const id of loadout.layout.items.keys()) {
    const entry = loadout.entries.get(id);
    if (!entry) continue;
    const st = itemStatsOf(entry);
    const got = bucket(id);
    const tags = entry.def.tags;
    const result: ItemFinalStats = {
      instanceId: id,
      itemId: entry.def.id,
      name: copyName(entry.def.name, copies.get(id)),
      kind: entry.kind,
      damage: null,
      cooldown: null,
      accuracy: null,
      critChance: null,
      critDamage: null,
      effectValues: {},
    };

    if (st.damage) {
      const ratio = resolveRatio(st.damage, rounding);
      for (const e of ratio.errors) issues.push({ level: 'error', code: 'observation_conflict', message: `${entry.def.name} damage: ${e}`, instanceIds: [id] });
      for (const w of ratio.warnings) issues.push({ level: 'warning', code: 'ratio_check', message: `${entry.def.name} damage: ${w}`, instanceIds: [id] });
      const typeParts: Contribution[] = [];
      if (tags.includes('weapon')) typeParts.push(...global('attack_dmg_increase'));
      for (const s of data.stats.values()) if (s.item_tags?.some((t) => tags.includes(t))) typeParts.push(...global(s.id));
      typeParts.push(...got.damage_pct);
      for (const b of tagBonuses) if (b.tags.some((t) => tags.includes(t))) typeParts.push({ amount: b.amount, source: 'global', label: b.label });
      const typePct = pct(typeParts);
      const allPct = pct(global('all_dmg_increase'));
      const modifier =
        config.combat.all_dmg_mode === 'separate'
          ? (1 + typePct.total / 100) * (1 + allPct.total / 100)
          : 1 + (typePct.total + allPct.total) / 100;
      const base = (ratio.ratio ?? 0) * player.atk;
      result.damage = { ratio, base, typePct, allPct, modifier, perHit: base * modifier, hits: st.hits ?? 1 };
    }

    if (st.cooldown !== undefined) {
      const haste = pct([...global('item_haste'), ...got.haste_pct]);
      const div = 1 + haste.total / 100;
      const min = config.timing.min_cooldown_seconds;
      const base = Math.max(min, st.cooldown + (cooldownShift.get(id) ?? 0));
      const raw = div > 0 ? base / div : Infinity;
      result.cooldown = { base, haste, final: Math.max(raw, min), clamped: raw < min };
      if (div <= 0) issues.push({ level: 'warning', code: 'haste_below_minus_100', message: `${entry.def.name} has ${haste.total}% haste and never activates.`, instanceIds: [id] });
    }

    if (st.accuracy !== undefined) {
      result.accuracy = pct([{ amount: st.accuracy, source: 'base', label: 'Item accuracy' }, ...global('accuracy_bonus'), ...got.accuracy_pct]);
    }

    if (st.damage) {
      const crit = pct([
        ...(st.crit_chance ? [{ amount: st.crit_chance, source: 'base' as const, label: 'Item crit rate' }] : []),
        ...global('crit_rate'),
        ...got.crit_chance_pct,
      ]);
      result.critChance = { ...crit, capped: Math.min(crit.total, config.combat.crit_rate_cap_pct ?? Infinity) };
      const itemCritDmg = entry.kind === 'item' ? (entry.def as Item).stats.crit_damage : undefined;
      result.critDamage = pct([
        ...global('crit_dmg'),
        ...(itemCritDmg ? [{ amount: itemCritDmg, source: 'base' as const, label: 'Item crit DMG' }] : []),
        ...got.crit_damage_pct,
      ]);
    } else if (got.crit_chance_pct.length || got.crit_damage_pct.length || got.damage_pct.length) {
      issues.push({
        level: 'warning',
        code: 'bonus_on_non_damage_item',
        message: `${entry.def.name} receives damage/crit bonuses but deals no damage itself.`,
        instanceIds: [id],
      });
    }

    if (entry.kind === 'item') {
      for (const [name, sv] of Object.entries((entry.def as Item).effect_values)) {
        const ratio = resolveRatio(sv, rounding);
        for (const e of ratio.errors) issues.push({ level: 'error', code: 'observation_conflict', message: `${entry.def.name} ${name}: ${e}`, instanceIds: [id] });
        for (const w of ratio.warnings) issues.push({ level: 'warning', code: 'ratio_check', message: `${entry.def.name} ${name}: ${w}`, instanceIds: [id] });
        const stat = basicOf(sv.scales_with);
        result.effectValues[name] = { ratio, scalesWith: sv.scales_with, value: ratio.ratio !== null && stat !== null ? ratio.ratio * stat : null };
      }
    }
    items.set(id, result);
  }

  return { player, items, issues };
}
