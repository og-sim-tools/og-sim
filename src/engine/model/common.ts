/**
 * Shared zod building blocks for data files (SPEC §2, §4.3, §4.4).
 */
import { z } from 'zod';

export const ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const Id = z.string().regex(ID_RE, 'must be a snake_case id (lowercase letters, digits, single underscores)');

/** snake_case id from a display name: "Hero's Longsword" → "heros_longsword". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export const Rarity = z.enum(RARITIES);
export type Rarity = z.infer<typeof Rarity>;
export const ItemRarity = z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export const HeroRarity = z.enum(['rare', 'epic', 'legendary']);
export const PetRarity = z.enum(['rare', 'epic', 'legendary', 'mythic']);

export const CLASSES = ['warrior', 'ranger', 'wizard'] as const;
export const ClassId = z.enum(CLASSES);
export type ClassId = z.infer<typeof ClassId>;

export const Source = z.enum(['manual', 'wiki', 'observed']);

/** A game number as shown in-game: 812.5K, 1.34M, 4M — or a plain number. */
export const ABBREV_RE = /^\d+(?:\.\d+)?[KMB]?$/i;
export const Abbrev = z.union([
  z.number().nonnegative(),
  z.string().regex(ABBREV_RE, 'must be a number like 812.5K, 1.34M or 4M'),
]);

/** An in-game observation of a scaled value: the number shown and the basic stat at the time. */
export const Observation = z
  .object({
    shown: z.string().regex(ABBREV_RE, 'must be the number exactly as shown in-game, like "2.01M"'),
    stat: z.string().regex(ABBREV_RE, 'must be the basic stat exactly as shown in-game, like "1.34M"'),
  })
  .strict();

/** atk / hp = the owner's; enemy_hp = the enemy's max HP ("30% of the enemy's Max HP"). */
export const ScalesWith = z.enum(['atk', 'hp', 'enemy_hp', 'unknown']);

/** A value stored as a ratio of a basic stat (SPEC §4.3), from the wiki and/or observations. */
export const ScaledValue = z
  .object({
    ratio: z.number().optional(),
    scales_with: ScalesWith,
    observations: z.array(Observation).optional(),
  })
  .strict()
  .refine((v) => v.ratio !== undefined || (v.observations?.length ?? 0) > 0, {
    message: 'needs a ratio or at least one observation',
  });
export type ScaledValue = z.infer<typeof ScaledValue>;

export const CellTuple = z.tuple([z.number().int(), z.number().int()]);

/** Provenance fields every entry carries (SPEC §2). Not merged as overrides. */
export const provenance = {
  source: Source,
  url: z.string().url().optional(),
  verified: z.boolean(),
  /** Basic stats at the time of an in-game observation. */
  observed_with: z.object({ hp: Abbrev.optional(), atk: Abbrev.optional() }).strict().optional(),
  notes: z.string().optional(),
};
export const PROVENANCE_KEYS = ['source', 'url', 'verified', 'observed_with', 'notes'] as const;

/**
 * Bag geometry: either `footprint` in the docs notation ("o#o / .#.") or explicit
 * `shape` / `dots` cell lists ([x, y] pairs). Missing = needs shape.
 */
export const geometry = {
  footprint: z.string().optional(),
  shape: z.array(CellTuple).optional(),
  dots: z.array(CellTuple).optional(),
};
export const GEOMETRY_KEYS = ['footprint', 'shape', 'dots'] as const;

export function geometryCheck(v: { footprint?: string; shape?: unknown; dots?: unknown }, ctx: z.RefinementCtx): void {
  if (v.footprint !== undefined && (v.shape !== undefined || v.dots !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['footprint'],
      message: 'use either `footprint` or `shape`/`dots`, not both',
    });
  }
  if (v.dots !== undefined && v.shape === undefined && v.footprint === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dots'], message: '`dots` given without a `shape`' });
  }
}
