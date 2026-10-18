/**
 * My stats, calculated (user, 2026-10-16): nothing is typed in as a percentage. They come from
 *   - equipped gear: each piece's stat lines up to its rarity, and its bonus stat × the rarity scale,
 *   - the active hero's stat blessings,
 *   - auras (none of the known auras gives a battle stat yet).
 * HP / ATK / Block are typed in as the game shows them, gear bonuses already included (user, 2026-10-16),
 * so HP % / ATK % lines are listed (Gigantization reads HP %) but never applied to them again.
 * profile.detailed_stats is only an optional manual adjustment on top (tests use it).
 */
import type { GameData } from './loader';
import { type Profile, RARITIES, type Rarity } from './model';
import { parseAbbrev } from './numbers';

export interface StatPart {
  stat: string;
  amount: number;
  /** "Primal Flame (mythic): Burn DMG +35%", "Blessing: All DMG". */
  label: string;
}

export interface AccountStats {
  /** Every non-basic stat: defaults + gear + blessings + auras + manual adjustments. */
  detailed: Record<string, number>;
  hp: number;
  atk: number;
  initialBlock: number;
  /** Where each calculated amount came from. */
  parts: StatPart[];
  /** Things that couldn't be counted (unknown stats, non-% blessings …). */
  notes: string[];
  /** Weapon bonus stats that need the in-game value (shown as red warnings). */
  bonusMissing: BonusMissing[];
}

export interface BonusMissing {
  slot: string;
  gearId: string;
  name: string;
  /** "Crit Rate +12.5%" (the wiki's base value). */
  text: string;
  rarity: Rarity;
  tier: number;
  message: string;
}

/** The weapon bonus stat to use: the typed-in value, else a confirmed one for this rarity + tier, else null. */
export function weaponBonusValue(cfg: NonNullable<GameData['config']>, ref: { rarity: Rarity; tier?: number; bonus_value?: number }, sRank: boolean): { amount: number; from: 'typed' | 'known' } | null {
  if (ref.bonus_value !== undefined) return { amount: ref.bonus_value, from: 'typed' };
  // The known values are S-rank weapons' (config gear.bonus_stat_known); other weapons are typed in.
  if (!sRank) return null;
  const known = cfg.gear.bonus_stat_known[`${ref.rarity}+${ref.tier ?? 0}`];
  return known !== undefined ? { amount: known, from: 'known' } : null;
}

const rank = (r: Rarity) => RARITIES.indexOf(r);
const BASIC_PCT: Record<string, string> = { hp: 'hp_pct', atk: 'atk_pct' };

export function computeAccountStats(data: GameData, profile: Profile, heroId: string | null | undefined): AccountStats {
  const cfg = data.config!;
  const parts: StatPart[] = [];
  const notes: string[] = [];
  const bonusMissing: BonusMissing[] = [];
  const add = (stat: string, amount: number, label: string) => {
    if (!data.stats.has(stat)) {
      notes.push(`${label}: unknown stat "${stat}".`);
      return;
    }
    parts.push({ stat, amount, label });
  };

  // Gear.
  const g = profile.gear;
  const slotted: [string, (typeof g)['weapon']][] = [['weapon', g.weapon], ['shield', g.shield], ...g.rings.map((r, i) => [`ring ${i + 1}`, r] as [string, typeof r]), ...g.gloves.map((r, i) => [`glove ${i + 1}`, r] as [string, typeof r])];
  for (const [slot, ref] of slotted) {
    if (!ref) continue;
    const gear = data.gear.get(ref.id);
    if (!gear) continue;
    const name = `${gear.name} (${ref.rarity})`;
    for (const l of gear.stat_lines) if (rank(l.rarity) <= rank(ref.rarity)) add(l.stat, l.amount, `${name}: ${l.text ?? `${l.stat} +${l.amount}`}`);
    if (gear.bonus) {
      const text = gear.bonus.text ?? gear.bonus.stat;
      const v = weaponBonusValue(cfg, ref, !!gear.s_rank);
      if (!v) {
        const statName = text.replace(/\s*\+.*$/, '');
        bonusMissing.push({
          slot,
          gearId: gear.id,
          name: gear.name,
          text,
          rarity: ref.rarity,
          tier: ref.tier ?? 0,
          message: `${gear.name} (${ref.rarity} +${ref.tier ?? 0}): enter its ${statName} bonus as shown in game. It isn't applied until you do (known: epic +0 and mythic +0).`,
        });
        continue;
      }
      add(gear.bonus.stat, v.amount, `${name} +${ref.tier ?? 0}: ${text.replace(/[\d.]+%/, `${v.amount}%`)}${v.from === 'typed' ? ' (typed in)' : ''}`);
    }
  }

  // Owned auras: ownership effect at their star level.
  for (const owned of profile.auras) {
    const aura = data.auras.get(owned.id);
    if (!aura?.ownership) continue;
    const o = aura.ownership;
    const amount = owned.stars > 0 ? (o.by_stars[owned.stars - 1] ?? o.base) : o.base;
    add(o.stat, amount, `Aura: ${aura.name} (${owned.stars}★)`);
  }

  // Blessings of the active hero that raise a stat (tag stats included: they add per tagged item).
  const hero = profile.heroes.find((h) => h.id === heroId);
  for (const b of hero?.blessings?.equipped ?? []) {
    const def = data.blessings.get(b.id);
    if (!def?.stat) continue;
    if (def.unit !== 'pct' && data.stats.get(def.stat)?.unit !== 'flat') {
      notes.push(`Blessing ${def.name}: ${def.unit} values aren't added to stats yet.`);
      continue;
    }
    add(BASIC_PCT[def.stat] ?? def.stat, b.value, `Blessing: ${def.name}`);
  }

  // Start from each stat's default (Crit DMG 100%), or a manual value in its place; then add the parts.
  const detailed: Record<string, number> = {};
  for (const s of data.stats.values()) if (s.group !== 'basic') detailed[s.id] = s.default;
  for (const [k, v] of Object.entries(profile.detailed_stats)) {
    detailed[k] = v;
    if (v) parts.unshift({ stat: k, amount: v, label: 'Manual adjustment' });
  }
  for (const p of parts) if (p.label !== 'Manual adjustment') detailed[p.stat] = (detailed[p.stat] ?? 0) + p.amount;
  return {
    bonusMissing,
    detailed,
    hp: parseAbbrev(profile.basic_stats.hp),
    atk: parseAbbrev(profile.basic_stats.atk),
    initialBlock: parseAbbrev(profile.basic_stats.initial_block),
    parts,
    notes,
  };
}
