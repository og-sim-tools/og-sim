/** Pure edits on a layout (UI state). Every placement in the UI has an id. */
import { stringify } from 'yaml';
import type { Rotation } from '../../engine/bag';
import type { LayoutData } from '../../engine/model';

export type Placement = LayoutData['placements'][number] & { id: string };
export type Stored = NonNullable<LayoutData['storage']>[number] & { id: string };
export interface UiLayout extends Omit<LayoutData, 'placements' | 'storage'> {
  placements: Placement[];
  storage?: Stored[];
}

/** Give every placement and stored item an id (`<item>#n`, unique across both). */
export function withIds(layout: LayoutData): UiLayout {
  const used = new Set([...layout.placements, ...(layout.storage ?? [])].map((p) => p.id).filter((x): x is string => !!x));
  const placements = layout.placements.map((p) => (p.id ? (p as Placement) : { ...p, id: newInstanceId(used, p.item) }));
  const storage = layout.storage?.map((p) => (p.id ? (p as Stored) : { ...p, id: newInstanceId(used, p.item) }));
  const { storage: _s, ...rest } = layout;
  return { ...rest, placements, ...(storage?.length ? { storage } : {}) };
}

const allIds = (l: UiLayout) => new Set([...l.placements, ...(l.storage ?? [])].map((x) => x.id));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function newInstanceId(used: Set<string>, itemId: string): string {
  let n = 1;
  while (used.has(`${itemId}#${n}`)) n++;
  const id = `${itemId}#${n}`;
  used.add(id);
  return id;
}

export function addPlacement(layout: UiLayout, p: Omit<Placement, 'id'> & { id?: string }): { layout: UiLayout; id: string } {
  const id = p.id ?? newInstanceId(allIds(layout), p.item);
  return { layout: { ...layout, placements: [...layout.placements, { ...p, id }] }, id };
}

export function updatePlacement(layout: UiLayout, id: string, patch: Partial<Omit<Placement, 'id' | 'item'>>): UiLayout {
  return { ...layout, placements: layout.placements.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removePlacement(layout: UiLayout, id: string): UiLayout {
  return { ...layout, placements: layout.placements.filter((p) => p.id !== id) };
}

/** Put a placed item into the storage box at (x, y) (shares of the box, 0–1). */
export function toStorage(layout: UiLayout, id: string, x: number, y: number): UiLayout {
  const p = layout.placements.find((q) => q.id === id);
  if (!p) return layout;
  const stored: Stored = { id, item: p.item, x: clamp01(x), y: clamp01(y), rotation: p.rotation, supply: p.supply };
  return { ...layout, placements: layout.placements.filter((q) => q.id !== id), storage: [...(layout.storage ?? []), stored] };
}

/** Take a stored item out of the storage box and place it in the bag with its origin at (x, y). */
export function fromStorage(layout: UiLayout, id: string, x: number, y: number): UiLayout {
  const s = layout.storage?.find((q) => q.id === id);
  if (!s) return layout;
  const rest = layout.storage!.filter((q) => q.id !== id);
  const { storage: _old, ...l } = layout;
  return { ...l, ...(rest.length ? { storage: rest } : {}), placements: [...layout.placements, { id, item: s.item, x, y, rotation: s.rotation, supply: s.supply }] };
}

export function addStored(layout: UiLayout, item: string, x: number, y: number): { layout: UiLayout; id: string } {
  const id = newInstanceId(allIds(layout), item);
  return { layout: { ...layout, storage: [...(layout.storage ?? []), { id, item, x: clamp01(x), y: clamp01(y), rotation: 0, supply: false }] }, id };
}

export function updateStored(layout: UiLayout, id: string, patch: Partial<Omit<Stored, 'id' | 'item'>>): UiLayout {
  return { ...layout, storage: (layout.storage ?? []).map((s) => (s.id === id ? { ...s, ...patch, x: clamp01(patch.x ?? s.x), y: clamp01(patch.y ?? s.y) } : s)) };
}

export function removeStored(layout: UiLayout, id: string): UiLayout {
  const rest = (layout.storage ?? []).filter((s) => s.id !== id);
  const { storage: _old, ...l } = layout;
  return rest.length ? { ...l, storage: rest } : l;
}

/** How far outside the bag an item may go (cells): further and it would be drawn off the grid and lost. */
export const REACH = 4;

/**
 * The shift that keeps every one of these cells within REACH cells of the bag (0 when they already are), so
 * dropping or moving an item never takes it further out.
 */
export function reachShift(cells: readonly { x: number; y: number }[], bag: { width: number; height: number }, reach = REACH): { dx: number; dy: number } {
  if (!cells.length) return { dx: 0, dy: 0 };
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const shift = (min: number, max: number, size: number) => (min < -reach ? -reach - min : max > size - 1 + reach ? size - 1 + reach - max : 0);
  return { dx: shift(Math.min(...xs), Math.max(...xs), bag.width), dy: shift(Math.min(...ys), Math.max(...ys), bag.height) };
}

export const rotateCw = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'rotate' | 'place' | 'remove' | 'cancel';

/** SPEC §8: arrows move, space rotates, enter places, delete/backspace removes. */
export function keyAction(key: string): KeyAction | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case ' ':
    case 'Spacebar':
      return 'rotate';
    case 'Enter':
      return 'place';
    case 'Delete':
    case 'Backspace':
      return 'remove';
    case 'Escape':
      return 'cancel';
    default:
      return null;
  }
}

export function moveBy(action: KeyAction): { dx: number; dy: number } | null {
  return { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } }[action as 'up'] ?? null;
}

/** YAML for layouts/<name>.yaml (defaults left out to keep it short). */
export function layoutToYaml(layout: UiLayout): string {
  const out: Record<string, unknown> = {};
  if (layout.name) out.name = layout.name;
  if (layout.hero) out.hero = layout.hero;
  if (layout.bag) out.bag = { mask: layout.bag.mask };
  if (layout.enhanced_cells?.length) out.enhanced_cells = layout.enhanced_cells;
  const entry = (p: Placement | Stored) => {
    const e: Record<string, unknown> = { id: p.id, item: p.item, x: p.x, y: p.y };
    if (p.rotation) e.rotation = p.rotation;
    if (p.supply) e.supply = true;
    return e;
  };
  out.placements = layout.placements.map(entry);
  if (layout.storage?.length) out.storage = layout.storage.map(entry);
  if (layout.setup) out.setup = layout.setup;
  if (layout.battle) out.battle = layout.battle;
  return stringify(out, { lineWidth: 0 });
}
