/**
 * Builds saved before version 3 carry their own Dragon's Blessings, pet and skin stars and HP / ATK / Block,
 * which are account-wide now. Opening such a build moves them into the account where the account has none
 * yet, and says so; where the account already has other values, the account's are used from now on and a
 * note says what the build had. Either way the build itself is left with only what's chosen per build.
 */
import type { LayoutData, Profile } from '../model';
import { sameStats, statsUnset } from './files';
import type { SaveNote } from './salvage';

export interface Adopted {
  account: Profile;
  layout: LayoutData;
  notes: SaveNote[];
  /** The account changed (save it). */
  changed: boolean;
}

/** The build's own values, if it has any (older files). */
export function hasLegacy(layout: LayoutData): boolean {
  const s = layout.setup;
  return !!s && (!!s.hero?.blessings || !!s.basic_stats || !!s.skins?.length || !!s.pets?.some((p) => p.stars !== undefined));
}

type Named = (kind: 'hero' | 'pet' | 'skin', id: string) => string;
const blessingText = (b: NonNullable<Profile['heroes'][number]['blessings']>, name: (id: string) => string) =>
  b.equipped.length ? `level ${b.level}: ${b.equipped.map((x) => `${name(x.id)} ${x.value}`).join(', ')}` : 'none';
const sameBlessings = (a: Profile['heroes'][number]['blessings'], b: Profile['heroes'][number]['blessings']) =>
  JSON.stringify(a?.equipped ?? []) === JSON.stringify(b?.equipped ?? []) && (!a?.equipped.length || a?.level === b?.level);

export function adoptLegacy(account: Profile, layout: LayoutData, what: string, names: Named = (_k, id) => id, blessingName: (id: string) => string = (id) => id): Adopted {
  if (!hasLegacy(layout)) return { account, layout, notes: [], changed: false };
  const acc = structuredClone(account);
  const setup = structuredClone(layout.setup!);
  const added: string[] = [];
  const notes: SaveNote[] = [];
  const differs = (text: string) => notes.push({ level: 'warning', message: `${what} had ${text}; your Profile's ${text.startsWith('HP') ? 'stats are' : 'are'} used now (they're account-wide).` });

  // Blessings: one set per hero.
  const heroId = layout.hero ?? setup.hero?.id;
  const bl = setup.hero?.blessings;
  if (setup.hero && bl) {
    const own = acc.heroes.find((h) => h.id === heroId);
    const name = names('hero', heroId ?? '');
    if (!own) {
      if (bl.equipped.length) notes.push({ level: 'warning', message: `${what} had blessings for ${name} (${blessingText(bl, blessingName)}), but ${name} isn't ticked in your Profile, so they're not kept. Tick ${name} in the Profile tab and enter them there.` });
    } else if (!own.blessings?.equipped.length) {
      if (bl.equipped.length) {
        own.blessings = structuredClone(bl);
        added.push(`${name}'s blessings`);
      }
    } else if (!sameBlessings(own.blessings, bl)) differs(`other blessings for ${name} (${blessingText(bl, blessingName)})`);
    delete setup.hero.blessings;
  }

  // Pet stars.
  if (setup.pets) {
    setup.pets = setup.pets.map((p) => {
      if (p.stars === undefined) return p;
      const own = acc.owned_pets.find((o) => o.id === p.id);
      if (!own) {
        acc.owned_pets.push({ id: p.id, stars: p.stars });
        added.push(`${names('pet', p.id)} ${p.stars}★`);
      } else if (own.stars !== p.stars) differs(`${names('pet', p.id)} at ${p.stars}★ (your Profile: ${own.stars}★)`);
      return { id: p.id, active: p.active };
    });
  }

  // Skin stars (only for skins the build brings).
  for (const s of setup.skins ?? []) {
    const own = acc.skins.find((o) => o.id === s.id);
    if (!own) {
      acc.skins.push({ id: s.id, stars: s.stars });
      added.push(`${names('skin', s.id)} ${s.stars}★`);
    } else if (own.stars !== s.stars) differs(`${names('skin', s.id)} at ${s.stars}★ (your Profile: ${own.stars}★)`);
  }
  delete setup.skins;

  // HP / ATK / Block.
  if (setup.basic_stats) {
    const b = setup.basic_stats;
    if (statsUnset(acc.basic_stats)) {
      if (!statsUnset(b)) {
        acc.basic_stats = structuredClone(b);
        added.push(`HP ${b.hp} / ATK ${b.atk} / Block ${b.initial_block}`);
      }
    } else if (!sameStats(acc.basic_stats, b)) differs(`HP ${b.hp} / ATK ${b.atk} / Block ${b.initial_block} (your Profile: ${acc.basic_stats.hp} / ${acc.basic_stats.atk} / ${acc.basic_stats.initial_block})`);
    delete setup.basic_stats;
  }

  if (added.length) notes.unshift({ level: 'info', message: `Moved into your Profile from ${what} (they're account-wide now): ${added.join(', ')}.` });
  return { account: acc, layout: { ...layout, setup }, notes, changed: added.length > 0 };
}
