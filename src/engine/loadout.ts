/**
 * A loadout = game data + my profile + a layout: everything needed before combat (SPEC §6).
 * Resolves layout placements to item / gear definitions and builds the bag layout.
 */
import { type Bag, BagError, FootprintError, type Layout, type Placement, buildLayout, createBag, fullBag, parseFootprint } from './bag';
import type { GameData, Gear, Hero, Item } from './loader';
import { type LayoutData, type Profile, RARITIES, type Rarity } from './model';

export interface PlacedEntry {
  instanceId: string;
  kind: 'item' | 'gear';
  def: Item | Gear;
  /** Brought as starting equipment. */
  supply: boolean;
  /** Gear only: rarity from the profile's equipped piece. */
  gearRarity?: Rarity;
}

export interface LoadoutIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  instanceIds?: string[];
  cells?: { x: number; y: number }[];
}

export interface Loadout {
  data: GameData;
  profile: Profile;
  heroId: string | null;
  hero: Hero | null;
  bag: Bag;
  layout: Layout;
  /** The layout as given (pet spawns add to it). */
  layoutData: LayoutData;
  /** Placed items and gear by instance id (only those with a known id). */
  entries: Map<string, PlacedEntry>;
  /** Problems found while building (unknown ids, bad mask). Rule checks live in validate.ts. */
  issues: LoadoutIssue[];
}

export const isGear = (e: PlacedEntry): e is PlacedEntry & { def: Gear } => e.kind === 'gear';
export const tagsOf = (e: PlacedEntry): string[] => e.def.tags;

/**
 * Copy numbers for items placed more than once: #1, #2 … in bag order (top to bottom, then left to right),
 * so each copy can be told apart in the stats, the battle breakdown and the log.
 */
export function copyNumbers(layout: { items: Map<string, { def: { id: string }; cells: { x: number; y: number }[] }> }): Map<string, number> {
  const groups = new Map<string, { id: string; y: number; x: number }[]>();
  for (const [id, it] of layout.items) {
    const first = [...it.cells].sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? { x: 0, y: 0 };
    const g = groups.get(it.def.id) ?? [];
    g.push({ id, y: first.y, x: first.x });
    groups.set(it.def.id, g);
  }
  const out = new Map<string, number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.y - b.y || a.x - b.x).forEach((e, i) => out.set(e.id, i + 1));
  }
  return out;
}

/**
 * The build's value: the shop value of the items in the bag. Starting equipment, gear and items put in
 * by pets or skins don't count. Items whose value isn't known are listed so the total can say "+?".
 */
export function buildValue(loadout: Pick<Loadout, 'entries'>): { total: number; items: number; unknown: string[] } {
  let total = 0;
  let items = 0;
  const unknown: string[] = [];
  for (const e of loadout.entries.values()) {
    if (e.kind !== 'item' || e.supply) continue;
    const def = e.def as Item;
    if (def.kind !== 'item') continue;
    items++;
    if (def.value_unknown) unknown.push(def.name);
    else total += def.value;
  }
  return { total, items, unknown };
}

/** "Wyrdwood Staff #2" for a copy, the plain name otherwise. */
export const copyName = (name: string, n: number | undefined) => (n ? `${name} #${n}` : name);

export function buildLoadout(data: GameData, profile: Profile, layoutData: LayoutData): Loadout {
  const issues: LoadoutIssue[] = [];
  let bag: Bag;
  try {
    bag = layoutData.bag ? createBag(layoutData.bag.mask) : fullBag();
  } catch (e) {
    if (!(e instanceof BagError)) throw e;
    issues.push({ level: 'error', code: 'bag_mask', message: e.message });
    bag = fullBag();
  }

  const heroId = layoutData.hero ?? profile.active_hero;
  const hero = heroId ? (data.heroes.get(heroId) ?? null) : null;

  // Equipped gear rarities, consumed in order so two identical rings can differ.
  const equipped = [profile.gear.weapon, profile.gear.shield, ...profile.gear.rings, ...profile.gear.gloves].filter(
    (g): g is NonNullable<typeof g> => g !== null,
  );
  const unusedGear = [...equipped];

  const entries = new Map<string, PlacedEntry>();
  const instanceDefs = new Map<string, Gear>();
  const placements: Placement[] = [];
  const counters = new Map<string, number>();
  for (const p of layoutData.placements) {
    let instanceId = p.id;
    if (!instanceId) {
      const n = (counters.get(p.item) ?? 0) + 1;
      counters.set(p.item, n);
      instanceId = `${p.item}#${n}`;
    }
    placements.push({ instanceId, itemId: p.item, x: p.x, y: p.y, rotation: p.rotation });
    const item = data.items.get(p.item);
    const gear = data.gear.get(p.item);
    if (item) {
      entries.set(instanceId, { instanceId, kind: 'item', def: item, supply: p.supply });
    } else if (gear) {
      const idx = unusedGear.findIndex((g) => g.id === p.item);
      const ref = idx >= 0 ? unusedGear.splice(idx, 1)[0] : undefined;
      const def = ref ? gearAtRarity(gear, ref.rarity, issues) : gear;
      if (def !== gear) instanceDefs.set(`@instance:${instanceId}`, def);
      entries.set(instanceId, { instanceId, kind: 'gear', def, supply: p.supply, gearRarity: ref?.rarity });
    }
  }

  const defs = new Map<string, Item | Gear>([...data.items, ...data.gear, ...instanceDefs]);
  const layout = buildLayout(bag, placements, defs);
  return { data, profile, heroId, hero, bag, layout, layoutData, entries, issues };
}

/** The gear as the next copy placed would be: at the rarity of the first equipped copy not yet in the bag. */
export function nextGearDef(loadout: Loadout, gearId: string): Gear | undefined {
  const gear = loadout.data.gear.get(gearId);
  if (!gear) return undefined;
  const g = loadout.profile.gear;
  const refs = [g.weapon, g.shield, ...g.rings, ...g.gloves].filter((r): r is NonNullable<typeof r> => r?.id === gearId);
  const placed = [...loadout.entries.values()].filter((e) => e.kind === 'gear' && e.def.id === gearId).length;
  const ref = refs[placed] ?? refs[0];
  return ref ? gearAtRarity(gear, ref.rarity) : gear;
}

/** Gear with the footprint for its rarity (rarity_footprints), or the gear itself. */
export function gearAtRarity(gear: Gear, rarity: Rarity, issues: LoadoutIssue[] = []): Gear {
  const rank = (r: Rarity) => RARITIES.indexOf(r);
  const pick = gear.rarity_footprints.filter((f) => rank(f.min_rarity) <= rank(rarity)).sort((a, b) => rank(b.min_rarity) - rank(a.min_rarity))[0];
  if (!pick) return gear;
  try {
    const fp = parseFootprint(pick.footprint);
    return { ...gear, footprint: pick.footprint, shape: fp.cells, dots: fp.dots };
  } catch (e) {
    if (!(e instanceof FootprintError)) throw e;
    issues.push({ level: 'error', code: 'bad_footprint', message: `${gear.name}: footprint for ${pick.min_rarity}+ is invalid: ${e.message}` } as LoadoutIssue);
    return gear;
  }
}
