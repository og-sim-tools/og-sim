/**
 * Bag and placement engine (SPEC §4.1, §4.2, §6 steps 1–2).
 *
 * - The bag is a binary mask, always 8 wide; height = mask.length / 8.
 * - Items have a shape (cells) and item dots (cells), both relative to the item's origin.
 * - The origin is the top-left corner of the bounding box of the item's *shape* cells.
 *   Dots may sit at negative coordinates (e.g. a dot above the item).
 * - Rotation is clockwise in screen coordinates (y grows downward). Shape and dots go
 *   through the same transform, then the result is re-anchored so the shape's bounding
 *   box starts at (0, 0) again.
 * - Only item dots decide what an effect reaches. Dots outside the bag or on a `0` cell
 *   touch nothing.
 */

export const BAG_WIDTH = 8;

export interface Cell {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Shape cells and item dots, relative to the item origin. */
export interface Footprint {
  cells: Cell[];
  dots: Cell[];
}

/** The minimum an item definition needs for the bag engine. */
export interface ShapeDef {
  id: string;
  name?: string;
  /** Missing / null = the item can't be placed yet ("needs shape"). */
  shape?: Cell[] | null;
  dots?: Cell[];
}

export interface Bag {
  width: number;
  height: number;
  mask: readonly (0 | 1)[];
}

export interface Placement {
  instanceId: string;
  itemId: string;
  x: number;
  y: number;
  rotation: Rotation;
}

// ------------------------------------------------------------------ cells

export const cellKey = (c: Cell): string => `${c.x},${c.y}`;
export const formatCell = (c: Cell): string => `(${c.x},${c.y})`;
const formatCells = (cells: Cell[]): string => cells.map(formatCell).join(', ');

function itemLabel(def: { id: string; name?: string }): string {
  return def.name && def.name !== def.id ? `"${def.id}" (${def.name})` : `"${def.id}"`;
}

// ------------------------------------------------------------------ bag mask

export class BagError extends Error {}

/** Build a bag from a flat mask. Every 8 entries is a row; 1 = usable, 0 = not. */
export function createBag(mask: readonly number[]): Bag {
  if (mask.length === 0 || mask.length % BAG_WIDTH !== 0) {
    throw new BagError(
      `Bag mask must have a length that is a positive multiple of ${BAG_WIDTH}, got ${mask.length}.`,
    );
  }
  const bad = mask.findIndex((v) => v !== 0 && v !== 1);
  if (bad !== -1) {
    throw new BagError(
      `Bag mask entries must be 0 or 1; entry ${bad} (x=${bad % BAG_WIDTH}, y=${Math.floor(bad / BAG_WIDTH)}) is ${String(mask[bad])}.`,
    );
  }
  return { width: BAG_WIDTH, height: mask.length / BAG_WIDTH, mask: mask as (0 | 1)[] };
}

/** The full 8 × 6 bag. */
export function fullBag(): Bag {
  return createBag(new Array(BAG_WIDTH * 6).fill(1));
}

export function inBounds(bag: Bag, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < bag.width && y < bag.height;
}

/** True only for an in-bounds cell whose mask value is 1. Never throws. */
export function isUsable(bag: Bag, x: number, y: number): boolean {
  return inBounds(bag, x, y) && bag.mask[y * bag.width + x] === 1;
}

// ------------------------------------------------------------------ footprint notation

export class FootprintError extends Error {}

/**
 * Parse the docs/wiki-data footprint notation: `#` item cell, `o` item dot, `.` empty,
 * rows top to bottom separated by ` / `. Coordinates are re-anchored so the shape's
 * bounding box starts at (0, 0).
 */
export function parseFootprint(text: string): Footprint {
  const rows = text
    .trim()
    .replace(/^`|`$/g, '')
    .split('/')
    .map((r) => r.trim());
  const cells: Cell[] = [];
  const dots: Cell[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') cells.push({ x, y });
      else if (ch === 'o') dots.push({ x, y });
      else if (ch !== '.') {
        throw new FootprintError(`Footprint "${text}": unknown character "${ch}" at row ${y}, column ${x}.`);
      }
    });
  });
  if (cells.length === 0) {
    throw new FootprintError(`Footprint "${text}" has no item cells ("#").`);
  }
  return normalize({ cells, dots });
}

/**
 * Write shape cells and dots back in footprint notation (inverse of parseFootprint), covering the
 * bounding box of cells and dots. A cell listed as both counts as a cell.
 */
export function formatFootprint(cells: readonly Cell[], dots: readonly Cell[]): string {
  const all = [...cells, ...dots];
  if (cells.length === 0) throw new FootprintError('A footprint needs at least one item cell.');
  const minX = Math.min(...all.map((c) => c.x));
  const minY = Math.min(...all.map((c) => c.y));
  const maxX = Math.max(...all.map((c) => c.x));
  const maxY = Math.max(...all.map((c) => c.y));
  const cellSet = new Set(cells.map(cellKey));
  const dotSet = new Set(dots.map(cellKey));
  const rows: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const k = cellKey({ x, y });
      row += cellSet.has(k) ? '#' : dotSet.has(k) ? 'o' : '.';
    }
    rows.push(row);
  }
  return rows.join(' / ');
}

// ------------------------------------------------------------------ rotation

function rotateCell(c: Cell, rotation: Rotation): Cell {
  // Clockwise in screen coordinates: a dot to the right ends up below.
  switch (rotation) {
    case 0:
      return { x: c.x, y: c.y };
    case 90:
      return { x: -c.y, y: c.x };
    case 180:
      return { x: -c.x, y: -c.y };
    case 270:
      return { x: c.y, y: -c.x };
  }
}

/** Translate shape and dots together so the shape's bounding box starts at (0, 0). */
export function normalize(fp: Footprint): Footprint {
  if (fp.cells.length === 0) return { cells: [], dots: fp.dots.map((d) => ({ ...d })) };
  const minX = Math.min(...fp.cells.map((c) => c.x));
  const minY = Math.min(...fp.cells.map((c) => c.y));
  const shift = (c: Cell): Cell => ({ x: c.x - minX + 0, y: c.y - minY + 0 }); // +0 avoids -0
  return { cells: fp.cells.map(shift), dots: fp.dots.map(shift) };
}

/** Rotate shape and dots through the same transform, then re-anchor. */
export function orient(fp: Footprint, rotation: Rotation): Footprint {
  if (!ROTATIONS.includes(rotation)) {
    throw new BagError(`Invalid rotation ${String(rotation)}; must be one of ${ROTATIONS.join(', ')}.`);
  }
  return normalize({
    cells: fp.cells.map((c) => rotateCell(c, rotation)),
    dots: fp.dots.map((c) => rotateCell(c, rotation)),
  });
}

export function footprintOf(def: ShapeDef): Footprint | null {
  if (!def.shape || def.shape.length === 0) return null;
  return { cells: def.shape, dots: def.dots ?? [] };
}

// ------------------------------------------------------------------ shape definition checks

/**
 * Hard data checks for an item's shape and dots. Returns human-readable errors naming the
 * item and the offending cells; empty = valid. The loader must reject items with errors.
 */
export function validateShapeDefinition(def: ShapeDef): string[] {
  const errors: string[] = [];
  const label = itemLabel(def);
  const shape = def.shape;
  const dots = def.dots ?? [];

  const all = [...(shape ?? []), ...dots];
  const nonInt = all.filter((c) => !Number.isInteger(c.x) || !Number.isInteger(c.y));
  if (nonInt.length > 0) {
    errors.push(`Item ${label}: cell coordinates must be integers: ${formatCells(nonInt)}.`);
    return errors;
  }

  const dupes = (cells: Cell[]): Cell[] => {
    const seen = new Set<string>();
    const out: Cell[] = [];
    for (const c of cells) {
      const k = cellKey(c);
      if (seen.has(k)) out.push(c);
      seen.add(k);
    }
    return out;
  };

  if (shape && shape.length > 0) {
    const d = dupes(shape);
    if (d.length > 0) errors.push(`Item ${label}: shape lists the same cell more than once: ${formatCells(d)}.`);
  } else if (shape && shape.length === 0) {
    errors.push(`Item ${label}: shape is an empty list. Leave it out instead if the shape isn't known yet.`);
  }
  const dd = dupes(dots);
  if (dd.length > 0) errors.push(`Item ${label}: item dots list the same cell more than once: ${formatCells(dd)}.`);

  if (shape && shape.length > 0) {
    // Rotation is a rigid transform, so checking 0° is enough in theory; check all four
    // anyway so a bug in the transform can never let a bad item through.
    for (const rotation of ROTATIONS) {
      const fp = orient({ cells: shape, dots }, rotation);
      const own = new Set(fp.cells.map(cellKey));
      const bad = fp.dots.filter((d) => own.has(cellKey(d)));
      if (bad.length > 0) {
        errors.push(
          `Item ${label}: item dots land on the item's own cells at ${formatCells(bad)}` +
            (rotation === 0 ? '' : ` (rotated ${rotation}°)`) +
            '. Dots can never overlap their own item.',
        );
        break;
      }
    }
  }
  return errors;
}

export class ShapeDefinitionError extends Error {}

export function assertValidShapeDefinition(def: ShapeDef): void {
  const errors = validateShapeDefinition(def);
  if (errors.length > 0) throw new ShapeDefinitionError(errors.join('\n'));
}

// ------------------------------------------------------------------ layout

export type PlacementIssueCode =
  | 'duplicate_instance'
  | 'unknown_item'
  | 'needs_shape'
  | 'invalid_rotation'
  | 'out_of_bounds'
  | 'masked_cell'
  | 'overlap';

export interface PlacementIssue {
  code: PlacementIssueCode;
  message: string;
  /** Instances involved (one, or two for an overlap). */
  instanceIds: string[];
  /** Bag cells involved, for red highlighting in the UI. */
  cells: Cell[];
}

export interface PlacedItem {
  placement: Placement;
  def: ShapeDef;
  /** Absolute bag cells occupied by the item (may include out-of-bag cells if invalid). */
  cells: Cell[];
  /** Absolute cells of the item's dots (may be outside the bag). */
  dots: Cell[];
}

export interface Layout {
  bag: Bag;
  /** Items that have a shape and could be positioned (even if the placement is invalid). */
  items: Map<string, PlacedItem>;
  /**
   * Occupancy grid (width × height): instance ids occupying each usable cell. More than one
   * id means an overlap. Out-of-bag and masked cells are never recorded.
   */
  occupancy: string[][];
  issues: PlacementIssue[];
  valid: boolean;
}

export type ShapeLookup = ReadonlyMap<string, ShapeDef> | Readonly<Record<string, ShapeDef>>;

function lookup(defs: ShapeLookup, id: string): ShapeDef | undefined {
  return defs instanceof Map ? defs.get(id) : (defs as Record<string, ShapeDef>)[id];
}

/** Absolute cells and dots for a placed item. */
export function placeFootprint(fp: Footprint, placement: Pick<Placement, 'x' | 'y' | 'rotation'>): Footprint {
  const o = orient(fp, placement.rotation);
  const move = (c: Cell): Cell => ({ x: c.x + placement.x, y: c.y + placement.y });
  return { cells: o.cells.map(move), dots: o.dots.map(move) };
}

/**
 * Validate placements against the bag (§6 step 1, bag part): every item cell on a usable
 * cell, no overlaps, every item has a shape. Class / capacity / gear-slot / pet checks
 * come with stat aggregation (phase 3).
 */
export function buildLayout(bag: Bag, placements: readonly Placement[], defs: ShapeLookup): Layout {
  const issues: PlacementIssue[] = [];
  const items = new Map<string, PlacedItem>();
  const occupancy: string[][] = Array.from({ length: bag.width * bag.height }, () => []);

  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.instanceId)) {
      issues.push({
        code: 'duplicate_instance',
        message: `Two placements share the instance id "${p.instanceId}".`,
        instanceIds: [p.instanceId],
        cells: [],
      });
      continue;
    }
    seen.add(p.instanceId);
    // A per-instance shape (gear whose footprint depends on its rarity) wins over the item's.
    const def = lookup(defs, `@instance:${p.instanceId}`) ?? lookup(defs, p.itemId);
    if (!def) {
      issues.push({
        code: 'unknown_item',
        message: `Placement "${p.instanceId}" refers to unknown item "${p.itemId}".`,
        instanceIds: [p.instanceId],
        cells: [],
      });
      continue;
    }
    const label = `${def.name ?? def.id} [${p.instanceId}]`;
    if (!ROTATIONS.includes(p.rotation)) {
      issues.push({
        code: 'invalid_rotation',
        message: `${label} has rotation ${String(p.rotation)}; must be 0, 90, 180 or 270.`,
        instanceIds: [p.instanceId],
        cells: [],
      });
      continue;
    }
    const fp = footprintOf(def);
    if (!fp) {
      issues.push({
        code: 'needs_shape',
        message: `${label} has no shape yet and can't be placed. Enter its shape in the item editor.`,
        instanceIds: [p.instanceId],
        cells: [],
      });
      continue;
    }
    const abs = placeFootprint(fp, p);
    items.set(p.instanceId, { placement: p, def, cells: abs.cells, dots: abs.dots });

    const outside = abs.cells.filter((c) => !inBounds(bag, c.x, c.y));
    const masked = abs.cells.filter((c) => inBounds(bag, c.x, c.y) && !isUsable(bag, c.x, c.y));
    if (outside.length > 0) {
      issues.push({
        code: 'out_of_bounds',
        message: `${label} sticks out of the bag at ${formatCells(outside)}.`,
        instanceIds: [p.instanceId],
        cells: outside,
      });
    }
    if (masked.length > 0) {
      issues.push({
        code: 'masked_cell',
        message: `${label} covers unavailable bag cells at ${formatCells(masked)}.`,
        instanceIds: [p.instanceId],
        cells: masked,
      });
    }
    for (const c of abs.cells) {
      if (isUsable(bag, c.x, c.y)) occupancy[c.y * bag.width + c.x]!.push(p.instanceId);
    }
  }

  // Overlaps, reported once per pair of instances with all shared cells.
  const pairs = new Map<string, { ids: [string, string]; cells: Cell[] }>();
  occupancy.forEach((ids, i) => {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const key = `${ids[a]}\u0000${ids[b]}`;
        const entry = pairs.get(key) ?? { ids: [ids[a]!, ids[b]!], cells: [] };
        entry.cells.push({ x: i % bag.width, y: Math.floor(i / bag.width) });
        pairs.set(key, entry);
      }
    }
  });
  for (const { ids, cells } of pairs.values()) {
    const [a, b] = ids.map((id) => `${items.get(id)!.def.name ?? items.get(id)!.def.id} [${id}]`);
    issues.push({
      code: 'overlap',
      message: `${a} and ${b} overlap at ${formatCells(cells)}.`,
      instanceIds: ids,
      cells,
    });
  }

  return {
    bag,
    items,
    occupancy: occupancy,
    issues,
    valid: issues.length === 0,
  };
}

/** Instance ids at a bag cell (empty for out-of-bag, masked or empty cells). */
export function occupantsAt(layout: Layout, x: number, y: number): string[] {
  if (!isUsable(layout.bag, x, y)) return [];
  return layout.occupancy[y * layout.bag.width + x] ?? [];
}

/**
 * First position where a footprint fits on usable, empty cells, scanning left to right, top to
 * bottom (SPEC §4.5 pet-spawn rule). `ignore` = an instance whose cells count as free (moving it).
 */
export function findFirstFit(layout: Layout, fp: Footprint, rotation: Rotation = 0, ignore?: string): { x: number; y: number } | null {
  const o = orient(fp, rotation);
  for (let y = 0; y < layout.bag.height; y++) {
    for (let x = 0; x < layout.bag.width; x++) {
      const fits = o.cells.every((c) => {
        const cx = c.x + x;
        const cy = c.y + y;
        return isUsable(layout.bag, cx, cy) && occupantsAt(layout, cx, cy).every((id) => id === ignore);
      });
      if (fits) return { x, y };
    }
  }
  return null;
}

// ------------------------------------------------------------------ item-dot resolution

export type DotStatus =
  /** Lands on another item. */
  | 'touches'
  /** Lands on a usable but empty cell. */
  | 'empty'
  /** Lands on a `0` cell of the mask. Does nothing. */
  | 'masked'
  /** Lands outside the bag. Does nothing. */
  | 'outside';

export interface DotHit {
  cell: Cell;
  status: DotStatus;
  /** For 'touches': the instance under the dot. */
  target?: string;
}

export interface DotResolution {
  /** One entry per dot, for display (outside / masked dots can be shown faded). */
  dots: DotHit[];
  /** Unique instances touched, in the order first reached. A target covered by several dots counts once. */
  targets: string[];
}

export class DotResolutionError extends Error {}

/**
 * Resolve what an item's dots touch. By default uses the item's own dot set; an effect with
 * its own dot set can pass `dotsOverride` (relative, unrotated cells).
 *
 * On an invalid layout with overlapping items, a dot touches every item on that cell.
 */
export function resolveDots(layout: Layout, instanceId: string, dotsOverride?: readonly Cell[]): DotResolution {
  const item = layout.items.get(instanceId);
  if (!item) return { dots: [], targets: [] };

  const absDots = dotsOverride
    ? placeFootprint({ cells: item.def.shape ?? [], dots: [...dotsOverride] }, item.placement).dots
    : item.dots;

  // Runtime guard: dots may never land on their own item (the loader should have caught it).
  const own = new Set(item.cells.map(cellKey));
  const onSelf = absDots.filter((d) => own.has(cellKey(d)));
  if (onSelf.length > 0) {
    throw new DotResolutionError(
      `Item ${itemLabel(item.def)} (${instanceId}): item dots land on its own cells at ${formatCells(onSelf)}. ` +
        'This is a data error the loader should have rejected.',
    );
  }

  const hits: DotHit[] = [];
  const targets: string[] = [];
  for (const cell of absDots) {
    if (!inBounds(layout.bag, cell.x, cell.y)) {
      hits.push({ cell, status: 'outside' });
      continue;
    }
    if (!isUsable(layout.bag, cell.x, cell.y)) {
      hits.push({ cell, status: 'masked' });
      continue;
    }
    const occupants = occupantsAt(layout, cell.x, cell.y).filter((id) => id !== instanceId);
    if (occupants.length === 0) {
      hits.push({ cell, status: 'empty' });
      continue;
    }
    for (const target of occupants) {
      hits.push({ cell, status: 'touches', target });
      if (!targets.includes(target)) targets.push(target);
    }
  }
  return { dots: hits, targets };
}

/** For each placed item, which items it reaches and which items reach it. */
export function dotGraph(layout: Layout): Map<string, { reaches: string[]; reachedBy: string[] }> {
  const graph = new Map<string, { reaches: string[]; reachedBy: string[] }>();
  for (const id of layout.items.keys()) graph.set(id, { reaches: [], reachedBy: [] });
  for (const id of layout.items.keys()) {
    const { targets } = resolveDots(layout, id);
    graph.get(id)!.reaches.push(...targets);
    for (const t of targets) graph.get(t)!.reachedBy.push(id);
  }
  return graph;
}
