/** Item browser entries and filters (SPEC §8): search by name; filter by class, hero, rarity, tag, kind. */
import type { GameData, Gear, Item } from '../../engine/loader';
import { RARITIES } from '../../engine/model';

export type EntryKind = 'item' | 'gear' | 'pet_spawn';

export interface BrowserEntry {
  id: string;
  name: string;
  kind: EntryKind;
  rarity: string | null;
  tags: string[];
  /** Empty = any class. */
  classes: string[];
  hero: string | null;
  /** Wiki data I haven't confirmed (the entry or any field). */
  unverified: boolean;
  needsShape: boolean;
  /** Effects only written as text so far. */
  textOnly: boolean;
  /** Shop price in coins (null: not known, or gear). */
  value: number | null;
  def: Item | Gear;
}

export interface BrowserFilter {
  text: string;
  /** '' = all. 'supply' = starting equipment available to the active hero. */
  kind: '' | EntryKind | 'supply';
  cls: string;
  hero: string;
  rarity: string;
  tag: string;
}

export const EMPTY_FILTER: BrowserFilter = { text: '', kind: '', cls: '', hero: '', rarity: '', tag: '' };

export function browserEntries(data: GameData): BrowserEntry[] {
  const items: BrowserEntry[] = [...data.items.values()].map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind === 'pet_spawn' ? 'pet_spawn' : 'item',
    rarity: i.rarity,
    tags: i.tags,
    classes: i.class_restriction,
    hero: i.hero_exclusive ?? null,
    unverified: !i.verified,
    needsShape: i.shape === null,
    textOnly: i.effects.length === 0 && i.effect_text !== '',
    value: i.value_unknown ? null : i.value,
    def: i,
  }));
  const gear: BrowserEntry[] = [...data.gear.values()].map((g) => ({
    id: g.id,
    name: g.name,
    kind: 'gear',
    rarity: null,
    tags: g.tags,
    classes: [],
    hero: null,
    unverified: !g.verified,
    needsShape: g.shape === null,
    textOnly: g.effects.length === 0,
    value: null,
    def: g,
  }));
  return [...items, ...gear].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterEntries(entries: BrowserEntry[], f: BrowserFilter, supplyIds: ReadonlySet<string> = new Set()): BrowserEntry[] {
  const text = f.text.trim().toLowerCase();
  return entries.filter((e) => {
    if (text && !e.name.toLowerCase().includes(text) && !e.id.includes(text)) return false;
    if (f.kind === 'supply') {
      if (!supplyIds.has(e.id)) return false;
    } else if (f.kind && e.kind !== f.kind) return false;
    // A class filter keeps items usable by that class (including universal ones).
    if (f.cls && e.classes.length > 0 && !e.classes.includes(f.cls)) return false;
    if (f.hero && e.hero !== f.hero) return false;
    if (f.rarity && e.rarity !== f.rarity) return false;
    if (f.tag && !e.tags.includes(f.tag)) return false;
    return true;
  });
}

export function allTags(entries: BrowserEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.tags))].sort();
}

/** How the item list is ordered: by name, by value (cheapest first, unknown last), or by rarity (common first). */
export type BrowserSort = 'name' | 'value' | 'rarity';

export function sortEntries<T extends Pick<BrowserEntry, 'name' | 'value' | 'rarity'>>(entries: readonly T[], sort: BrowserSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const rank = (r: string | null) => (r ? RARITIES.indexOf(r as (typeof RARITIES)[number]) : -1);
  const list = [...entries];
  if (sort === 'value') return list.sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || byName(a, b));
  if (sort === 'rarity') return list.sort((a, b) => rank(a.rarity) - rank(b.rarity) || byName(a, b));
  return list.sort(byName);
}
