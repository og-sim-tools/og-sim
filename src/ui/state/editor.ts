/**
 * Item editor helpers (SPEC §8.2): turn a loaded entry into an editable draft, diff a draft against
 * the original (only changed fields are saved to manual/user_edits.yaml), validate a draft, and
 * convert between footprints and the clickable shape grid.
 */
import { type Cell, FootprintError, formatFootprint, parseFootprint, validateShapeDefinition } from '../../engine/bag';
import { GearSchema, ItemSchema, PetSchema } from '../../engine/model';

export type EditCategory = 'items' | 'gear' | 'pets';
export type Draft = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Editable copy of a loaded entry in data-file shape (geometry as a footprint string). */
export function toDraft(entry: Record<string, unknown>): Draft {
  const { meta: _m, shape, dots, footprint: _f, ...rest } = structuredClone(entry);
  const d: Draft = { ...rest };
  if (Array.isArray(shape) && shape.length > 0) d.footprint = formatFootprint(shape as Cell[], (dots as Cell[] | undefined) ?? []);
  return d;
}

/** Normalised footprint text, so equivalent drawings compare equal. */
export function normalFootprint(fp: unknown): string | undefined {
  if (typeof fp !== 'string' || fp.trim() === '') return undefined;
  try {
    const p = parseFootprint(fp);
    return formatFootprint(p.cells, p.dots);
  } catch {
    return fp;
  }
}

/**
 * Fields of `draft` that differ from `orig`. Nested objects diff recursively; a key removed from
 * the draft becomes null (the loader deletes it). Provenance is left to the caller.
 */
export function diffFields(orig: Draft, draft: Draft): Draft {
  const out: Draft = {};
  for (const k of new Set([...Object.keys(orig), ...Object.keys(draft)])) {
    if (k === 'id' || k === 'source' || k === 'url' || k === 'verified' || k === 'notes' || k === 'observed_with') continue;
    const a = k === 'footprint' ? normalFootprint(orig[k]) : orig[k];
    const b = k === 'footprint' ? normalFootprint(draft[k]) : draft[k];
    if (b === undefined) {
      if (a !== undefined) out[k] = null;
    } else if (isObj(a) && isObj(b)) {
      const sub = diffFields(a, b);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (!same(a, b)) {
      out[k] = b;
    }
  }
  return out;
}

const SCHEMAS = { items: ItemSchema, gear: GearSchema, pets: PetSchema };

/** Schema and shape errors for a draft, as "field: message" lines. */
export function validateDraft(category: EditCategory, draft: Draft): string[] {
  const res = SCHEMAS[category].safeParse(draft);
  const errors = res.success ? [] : res.error.issues.map((i) => `${i.path.join('.') || '(entry)'}: ${i.message}`);
  if (category !== 'pets' && typeof draft.footprint === 'string') {
    try {
      const fp = parseFootprint(draft.footprint);
      errors.push(...validateShapeDefinition({ id: String(draft.id), name: String(draft.name), shape: fp.cells, dots: fp.dots }));
    } catch (e) {
      if (!(e instanceof FootprintError)) throw e;
      errors.push(`footprint: ${e.message}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- shape grid

export type ShapeCell = 0 | 1 | 2; // empty, item cell, item dot
export const GRID = 9;

/** Lay a footprint out on a GRID×GRID board, roughly centred. */
export function gridFromFootprint(footprint: string | undefined): ShapeCell[] {
  const g: ShapeCell[] = new Array(GRID * GRID).fill(0);
  if (!footprint) return g;
  let fp;
  try {
    fp = parseFootprint(footprint);
  } catch {
    return g;
  }
  const all = [...fp.cells, ...fp.dots];
  const minX = Math.min(...all.map((c) => c.x));
  const minY = Math.min(...all.map((c) => c.y));
  const w = Math.max(...all.map((c) => c.x)) - minX + 1;
  const h = Math.max(...all.map((c) => c.y)) - minY + 1;
  const ox = Math.max(0, Math.floor((GRID - w) / 2)) - minX;
  const oy = Math.max(0, Math.floor((GRID - h) / 2)) - minY;
  const put = (c: Cell, v: ShapeCell) => {
    const x = c.x + ox;
    const y = c.y + oy;
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) g[y * GRID + x] = v;
  };
  fp.dots.forEach((c) => put(c, 2));
  fp.cells.forEach((c) => put(c, 1));
  return g;
}

/** Footprint text from the board, or undefined if it has no item cells. */
export function footprintFromGrid(g: readonly ShapeCell[]): string | undefined {
  const cells: Cell[] = [];
  const dots: Cell[] = [];
  g.forEach((v, i) => {
    const c = { x: i % GRID, y: Math.floor(i / GRID) };
    if (v === 1) cells.push(c);
    else if (v === 2) dots.push(c);
  });
  return cells.length ? formatFootprint(cells, dots) : undefined;
}

/** Click cycles: empty → item cell → dot → empty. */
export const nextShapeCell = (v: ShapeCell): ShapeCell => ((v + 1) % 3) as ShapeCell;

// ---------------------------------------------------------------- tags

/** Every tag already in use: item and gear tags, blessing target tags, stat item tags. */
export function knownTags(data: { items: Map<string, { tags: string[] }>; gear: Map<string, { tags: string[] }>; blessings: Map<string, { target_tags: string[] }>; stats: Map<string, { item_tags?: string[] }> }): string[] {
  const all = new Set<string>();
  for (const e of [...data.items.values(), ...data.gear.values()]) e.tags.forEach((t) => all.add(t));
  for (const b of data.blessings.values()) b.target_tags.forEach((t) => all.add(t));
  for (const s of data.stats.values()) s.item_tags?.forEach((t) => all.add(t));
  return [...all].sort();
}

/** Known tags matching what's typed: prefix matches first, then other matches; `exclude` = tags already on the entry. */
export function suggestTags(known: readonly string[], typed: string, exclude: readonly string[] = [], limit = 8): string[] {
  const q = typed.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const free = known.filter((t) => !exclude.includes(t));
  if (!q) return free.slice(0, limit);
  const starts = free.filter((t) => t.startsWith(q));
  const inside = free.filter((t) => !t.startsWith(q) && t.includes(q));
  return [...starts, ...inside].slice(0, limit);
}
