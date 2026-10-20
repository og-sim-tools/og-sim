/**
 * Editing a bag with held items and keys, the same in every bag (the Build tab's, and both bags in the Battle
 * tab): where a held item lands (its held cell over the pointer's cell, as turned while held, never more than
 * REACH cells outside the bag), what dropping it does, and the arrow / space / Delete keys.
 */
import { type Cell, footprintOf, isUsable, occupantsAt, placeFootprint } from '../../engine/bag';
import type { Gear, Item } from '../../engine/loader';
import { type Loadout, nextGearDef } from '../../engine/loadout';
import { rarityColor, spriteOf } from '../components/BagGrid';
import type { DragItem, DragLook } from '../drag';
import { type KeyAction, type UiLayout, addPlacement, fromStorage, moveBy, reachShift, removePlacement, removeStored, rotateCw, updatePlacement, updateStored } from './layoutOps';

export interface Landing {
  x: number;
  y: number;
  cells: Cell[];
  valid: boolean;
}

/** The definition a held item is placed with: a placed one's own (gear at its rarity), else the item (gear at the rarity it's equipped at). */
export function defFor(loadout: Loadout, d: Pick<DragItem, 'kind' | 'id' | 'item'>): Item | Gear | undefined {
  if (d.kind === 'placed') {
    const own = loadout.layout.items.get(d.id)?.def as Item | Gear | undefined;
    if (own) return own;
  }
  return loadout.data.gear.has(d.item) ? nextGearDef(loadout, d.item) : loadout.data.items.get(d.item);
}

/** An item's cells as turned, relative to its origin (in footprint order). */
export function turnedCells(def: Item | Gear | undefined, rotation: 0 | 90 | 180 | 270): Cell[] | null {
  const fp = def ? footprintOf(def) : null;
  return fp ? placeFootprint(fp, { x: 0, y: 0, rotation }).cells : null;
}

/** How a held item looks. */
export function lookOf(loadout: Loadout, d: DragItem): DragLook | null {
  const def = defFor(loadout, d);
  const cells = turnedCells(def, d.rotation);
  if (!def || !cells) return null;
  const isGear = loadout.data.gear.has(d.item);
  const entry = d.kind === 'placed' ? loadout.entries.get(d.id) : undefined;
  const color = entry?.kind === 'gear' && entry.gearRarity ? rarityColor(entry.gearRarity) : rarityColor('rarity' in def ? (def.rarity as string) : null, isGear);
  return { cells, color, sprite: spriteOf(def as Parameters<typeof spriteOf>[0], d.rotation) };
}

/** Where a held item lands with its held cell over bag cell (x, y). */
export function landing(loadout: Loadout, d: DragItem, x: number, y: number): Landing | null {
  const cells = turnedCells(defFor(loadout, d), d.rotation);
  if (!cells) return null;
  const g = cells[d.grab] ?? cells[0]!;
  const abs = cells.map((c) => ({ x: c.x + x - g.x, y: c.y + y - g.y }));
  const { dx, dy } = reachShift(abs, loadout.bag);
  const moved = abs.map((c) => ({ x: c.x + dx, y: c.y + dy }));
  const ignore = d.kind === 'placed' ? d.id : undefined;
  const valid = moved.every((c) => isUsable(loadout.bag, c.x, c.y) && occupantsAt(loadout.layout, c.x, c.y).every((o) => o === ignore));
  return { x: x - g.x + dx, y: y - g.y + dy, cells: moved, valid };
}

/** Drop a held item into the bag: moved (and turned), out of the storage, or new. Returns the layout and the item now selected. */
export function dropInBag(layout: UiLayout, d: DragItem, at: Landing): { layout: UiLayout; selected: string } {
  if (d.kind === 'placed') return { layout: updatePlacement(layout, d.id, { x: at.x, y: at.y, rotation: d.rotation }), selected: d.id };
  if (d.kind === 'stored') return { layout: updatePlacement(fromStorage(layout, d.id, at.x, at.y), d.id, { rotation: d.rotation }), selected: d.id };
  const r = addPlacement(layout, { item: d.item, x: at.x, y: at.y, rotation: d.rotation, supply: !!d.supply });
  return { layout: r.layout, selected: r.id };
}

/** Drop a held item in the bin. */
export function dropInBin(layout: UiLayout, d: DragItem): UiLayout {
  if (d.kind === 'placed') return removePlacement(layout, d.id);
  if (d.kind === 'stored') return removeStored(layout, d.id);
  return layout;
}

/**
 * A key on the selected item: arrows move it (no further than REACH cells out), space turns it, Delete removes it,
 * Escape lets go. Items in the storage box only turn or go. Returns null when nothing changes.
 */
export function keyOnSelected(layout: UiLayout, loadout: Loadout, selected: string, action: KeyAction): { layout?: UiLayout; selected: string | null } | null {
  const stored = layout.storage?.find((x) => x.id === selected);
  if (stored) {
    if (action === 'rotate') return { layout: updateStored(layout, selected, { rotation: rotateCw(stored.rotation) }), selected };
    if (action === 'remove') return { layout: removeStored(layout, selected), selected: null };
    if (action === 'cancel') return { selected: null };
    return null;
  }
  const p = layout.placements.find((x) => x.id === selected);
  if (!p) return null;
  const d = moveBy(action);
  if (d) {
    const def = defFor(loadout, { kind: 'placed', id: p.id, item: p.item });
    const cells = turnedCells(def, p.rotation);
    if (!cells) return null;
    const abs = cells.map((c) => ({ x: c.x + p.x + d.dx, y: c.y + p.y + d.dy }));
    const s = reachShift(abs, loadout.bag);
    const x = p.x + d.dx + s.dx;
    const y = p.y + d.dy + s.dy;
    return x === p.x && y === p.y ? null : { layout: updatePlacement(layout, selected, { x, y }), selected };
  }
  if (action === 'rotate') return { layout: updatePlacement(layout, selected, { rotation: rotateCw(p.rotation) }), selected };
  if (action === 'remove') return { layout: removePlacement(layout, selected), selected: null };
  if (action === 'cancel') return { selected: null };
  return null;
}
