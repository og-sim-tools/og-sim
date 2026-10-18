/**
 * Migrations between saved-file versions. Each step takes the raw YAML object of one version and returns
 * the raw object of the next; they're chained up to SAVE_VERSION. Never edit a step once released: add a
 * new one (and fixtures in tests/fixtures/saves/<version>/).
 *
 * Version 1 (no `version` field; until 2026-10-18): profile/profile.yaml held the whole setup (hero with
 * stars, links and blessings, gear, pets, owned skins with stars, equipped skins, quests done, HP / ATK /
 * Block). A layout's `setup` was put into whatever the profile had when the layout was loaded, so parts a
 * layout didn't save came from the profile.
 * Version 2: the account keeps only heroes' stars and links, and auras; each build keeps the rest.
 */
import { DEFAULT_BASIC_STATS } from './files';
import type { SaveNote } from './salvage';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** The version a raw file says it is: no `version` = 1 (files from before versioning). */
export function versionOf(raw: unknown): number {
  const v = isObj(raw) ? raw.version : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

// ------------------------------------------------------------------ v1 → v2

/** v1 profile → v2 account. The whole v1 profile is kept (migrated_from_v1) for v1 builds that still need it. */
export function accountV1toV2(raw: Raw, notes: SaveNote[]): Raw {
  const heroes = list(raw.heroes).map((h) => (isObj(h) ? { id: h.id, stars: h.stars, ...(h.links !== undefined ? { links: h.links } : {}) } : h));
  const moved = ['blessings', 'gear', 'pets', 'skins', 'HP / ATK / Block'].filter((k) =>
    k === 'blessings' ? list(raw.heroes).some((h) => isObj(h) && isObj(h.blessings) && list(h.blessings.equipped).length > 0) : k === 'HP / ATK / Block' ? isObj(raw.basic_stats) : k === 'gear' ? isObj(raw.gear) : list(raw[k]).length > 0,
  );
  if (moved.length)
    notes.push({ level: 'info', message: `Account file updated to version 2: ${moved.join(', ')} are now saved with each build. Your old profile is kept inside the account file, so older builds load exactly as before.` });
  return {
    version: 2,
    heroes,
    ...(raw.auras !== undefined ? { auras: raw.auras } : {}),
    ...(raw.aura !== undefined ? { aura: raw.aura } : {}),
    migrated_from_v1: structuredClone(raw),
  };
}

/**
 * v1 build → v2 build, with v1's rule: whatever the build didn't save comes from the v1 profile it was used
 * with (`v1Profile`; null = not known, those parts start empty and a note says so).
 */
export function buildV1toV2(raw: Raw, v1Profile: Raw | null, notes: SaveNote[]): Raw {
  const s: Raw = isObj(raw.setup) ? raw.setup : {};
  const base: Raw = v1Profile ?? {};
  const fromProfile = (key: string, what: string, instead: string): unknown => {
    if (s[key] !== undefined) return s[key];
    if (v1Profile && base[key] !== undefined) return structuredClone(base[key]);
    notes.push({ level: 'warning', message: `This old build didn't save its ${what}, and the profile it was used with isn't known: ${instead}.` });
    return undefined;
  };
  const setupHero = isObj(s.hero) ? s.hero : null;
  const hero = (typeof raw.hero === 'string' ? raw.hero : null) ?? (typeof setupHero?.id === 'string' ? setupHero.id : null) ?? (typeof base.active_hero === 'string' ? base.active_hero : null);
  const profileHero = list(base.heroes).find((h): h is Raw => isObj(h) && h.id === hero) ?? null;
  const ownHero = setupHero && setupHero.id === hero ? setupHero : null;
  const blessings = ownHero?.blessings ?? profileHero?.blessings;
  if (ownHero && list(ownHero.links).length > 0 && !same(ownHero.links, profileHero?.links))
    notes.push({ level: 'warning', message: `Skill links are account-wide now: this build had ${JSON.stringify(ownHero.links)}, the Profile tab has ${JSON.stringify(profileHero?.links ?? [])} (used from now on).` });

  const equipped = list(s.equipped_skins ?? base.equipped_skins).filter((x): x is string => typeof x === 'string');
  const quests = list(s.skin_quests_done ?? base.skin_quests_done);
  const owned = list(base.skins).filter(isObj);
  const skins = equipped.flatMap((id) => {
    const o = owned.find((x) => x.id === id);
    // v1 only used an equipped skin I owned; keep it that way.
    if (!o) {
      notes.push({ level: 'warning', message: `Skin "${id}" was equipped but not owned in the profile, so it did nothing; removed from this build.` });
      return [];
    }
    return [{ id, stars: o.stars, quest_done: quests.includes(id) }];
  });

  const detailed = s.detailed_stats ?? base.detailed_stats;
  const out: Raw = { version: 2 };
  for (const [k, v] of Object.entries(raw)) if (k !== 'setup' && k !== 'hero' && k !== 'version') out[k] = v;
  out.hero = hero;
  if (blessings !== undefined) out.blessings = structuredClone(blessings);
  const gear = fromProfile('gear', 'gear', 'no gear equipped');
  if (gear !== undefined) out.gear = gear;
  const pets = fromProfile('pets', 'pets', 'no pets');
  if (pets !== undefined) out.pets = pets;
  out.skins = skins;
  const basic = fromProfile('basic_stats', 'HP / ATK / Block', `set to ${DEFAULT_BASIC_STATS.hp} / ${DEFAULT_BASIC_STATS.atk} / ${DEFAULT_BASIC_STATS.initial_block}, enter yours`);
  if (basic !== undefined) out.basic_stats = basic;
  if (isObj(detailed) && Object.keys(detailed).length > 0) out.detailed_stats = structuredClone(detailed);
  return out;
}
