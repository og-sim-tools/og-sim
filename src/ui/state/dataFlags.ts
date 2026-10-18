/**
 * Game data that isn't confirmed in game yet (verified: false, SPEC §10) or that the loader had problems with,
 * for the Data tab and for the note in the Battle tab about the data a build uses.
 */
import type { GameData, Issue, LoadResult } from '../../engine/loader';
import type { Loadout } from '../../engine/loadout';

export const FLAG_CATEGORIES = ['items', 'gear', 'heroes', 'blessings', 'pets', 'skins', 'auras', 'statuses', 'enemies', 'enemy_traits'] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export interface DataRef {
  category: FlagCategory;
  id: string;
  name: string;
}

export interface Unverified extends DataRef {
  source: string;
  url?: string;
}

type WithProvenance = { name?: string; source?: string; url?: string; verified?: boolean };
const entity = (data: GameData, category: FlagCategory, id: string) => (data[category] as Map<string, WithProvenance>).get(id);

/** Every entry not confirmed in game yet, by category then name. */
export function unverifiedEntries(data: GameData): Unverified[] {
  const out: Unverified[] = [];
  for (const category of FLAG_CATEGORIES) {
    for (const [id, e] of data[category] as Map<string, WithProvenance>) {
      if (e.verified !== false) continue;
      out.push({ category, id, name: e.name ?? id, source: e.source ?? '?', ...(e.url ? { url: e.url } : {}) });
    }
  }
  return out.sort((a, b) => FLAG_CATEGORIES.indexOf(a.category) - FLAG_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

/** The game data a build uses: the items and gear in the bag or equipped, its hero, blessings, pets and skins. */
export function buildDataRefs(lo: Loadout): DataRef[] {
  const seen = new Map<string, DataRef>();
  const add = (category: FlagCategory, id: string | null | undefined) => {
    if (!id || seen.has(`${category}:${id}`)) return;
    const e = entity(lo.data, category, id);
    if (e) seen.set(`${category}:${id}`, { category, id, name: e.name ?? id });
  };
  for (const e of lo.entries.values()) add(e.kind === 'gear' ? 'gear' : 'items', e.def.id);
  const g = lo.profile.gear;
  for (const ref of [g.weapon, g.shield, ...g.rings, ...g.gloves]) add('gear', ref?.id);
  const heroId = lo.hero?.id ?? lo.profile.active_hero;
  add('heroes', heroId);
  for (const b of lo.profile.heroes.find((h) => h.id === heroId)?.blessings?.equipped ?? []) add('blessings', b.id);
  for (const p of lo.profile.pets) add('pets', p.id);
  for (const s of lo.profile.equipped_skins ?? []) add('skins', s);
  return [...seen.values()];
}

export interface BuildFlag extends DataRef {
  unverified: boolean;
  /** Errors and warnings the loader reported for this entry. */
  problems: Issue[];
}

/** The data this build uses that isn't confirmed in game or has load problems. */
export function buildFlags(lo: Loadout, result: Pick<LoadResult, 'issues'>): BuildFlag[] {
  return buildDataRefs(lo)
    .map((r) => ({
      ...r,
      unverified: entity(lo.data, r.category, r.id)?.verified === false,
      problems: result.issues.filter((i) => i.level !== 'info' && i.entry === r.id),
    }))
    .filter((f) => f.unverified || f.problems.length > 0);
}
