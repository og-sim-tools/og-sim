/** The class bag sizes (config bag.sizes: "x26", "x32", "x38") as bag masks, and the enhanced-slot skill a build's hero has. */
import type { GameData } from '../../engine/loader';
import type { Profile } from '../../engine/model';

export interface BagSize {
  /** "Full", "x26" … as the user calls them. */
  name: string;
  /** Row-major, 8 wide (null = the full bag, no mask). */
  mask: number[] | null;
}

/** A size's rows (`#` = cell) as an 8-wide mask; narrower rows are centred. */
export function sizeMask(rows: readonly string[], width = 8): number[] {
  const w = Math.max(...rows.map((r) => r.length));
  const left = Math.floor((width - Math.min(width, w)) / 2);
  return rows.flatMap((r) => Array.from({ length: width }, (_, x) => (r[x - left] === '#' ? 1 : 0)));
}

/** The full bag, then the class's sizes. */
export function bagSizesFor(data: GameData, cls: string | null | undefined): BagSize[] {
  const sizes = cls ? (data.config?.bag.sizes[cls as 'warrior'] ?? {}) : {};
  return [{ name: 'Full', mask: null }, ...Object.entries(sizes).map(([name, rows]) => ({ name, mask: sizeMask(rows) }))];
}

/** Which of these sizes a bag mask is (null = none: cells edited by hand). */
export function sizeOf(mask: readonly number[] | undefined, sizes: readonly BagSize[]): string | null {
  const full = !mask || (mask.length === 48 && mask.every((v) => v));
  if (full) return 'Full';
  return sizes.find((s) => s.mask && s.mask.length === mask!.length && s.mask.every((v, i) => !!v === !!mask![i]))?.name ?? null;
}

export interface Enhancer {
  /** The skill's name (Instant Casting, Poison Coating). */
  skill: string;
  count: number;
  color: string;
  label: string;
}

/** The skill of this hero (its own or a linked one) that enhances bag slots, if any. */
export function enhancerOf(data: GameData, profile: Profile, heroId: string | null | undefined): Enhancer | null {
  const hero = heroId ? data.heroes.get(heroId) : undefined;
  if (!hero) return null;
  const links = profile.heroes.find((h) => h.id === hero.id)?.links ?? [];
  const blessings = profile.heroes.find((h) => h.id === hero.id)?.blessings?.equipped ?? [];
  for (const id of [...hero.skills.map((s) => s.id), ...links]) {
    const skill = data.skills.get(id);
    const e = skill && data.heroes.get(skill.hero)?.skill_effects[id]?.enhanced_slots;
    if (!e) continue;
    // Blessings that add slots to this skill (Venom's Poison Coating: +1 / +2).
    const extra = blessings.filter((b) => data.blessings.get(b.id)?.buffs_skill === id && data.blessings.get(b.id)?.adds_enhanced_slots).reduce((a, b) => a + b.value, 0);
    return { skill: skill.name, ...e, count: e.count + extra };
  }
  return null;
}
