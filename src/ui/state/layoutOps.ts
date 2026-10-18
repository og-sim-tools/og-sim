/** Pure edits on a layout (UI state). Every placement in the UI has an id. */
import { stringify } from 'yaml';
import type { Rotation } from '../../engine/bag';
import type { LayoutData } from '../../engine/model';

export type Placement = LayoutData['placements'][number] & { id: string };
export interface UiLayout extends Omit<LayoutData, 'placements'> {
  placements: Placement[];
}

/** Give every placement an id (`<item>#n`, unique). */
export function withIds(layout: LayoutData): UiLayout {
  const used = new Set(layout.placements.map((p) => p.id).filter((x): x is string => !!x));
  const placements = layout.placements.map((p) => (p.id ? (p as Placement) : { ...p, id: newInstanceId(used, p.item) }));
  return { ...layout, placements };
}

export function newInstanceId(used: Set<string>, itemId: string): string {
  let n = 1;
  while (used.has(`${itemId}#${n}`)) n++;
  const id = `${itemId}#${n}`;
  used.add(id);
  return id;
}

export function addPlacement(layout: UiLayout, p: Omit<Placement, 'id'> & { id?: string }): { layout: UiLayout; id: string } {
  const id = p.id ?? newInstanceId(new Set(layout.placements.map((x) => x.id)), p.item);
  return { layout: { ...layout, placements: [...layout.placements, { ...p, id }] }, id };
}

export function updatePlacement(layout: UiLayout, id: string, patch: Partial<Omit<Placement, 'id' | 'item'>>): UiLayout {
  return { ...layout, placements: layout.placements.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removePlacement(layout: UiLayout, id: string): UiLayout {
  return { ...layout, placements: layout.placements.filter((p) => p.id !== id) };
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
  out.placements = layout.placements.map((p) => {
    const e: Record<string, unknown> = { id: p.id, item: p.item, x: p.x, y: p.y };
    if (p.rotation) e.rotation = p.rotation;
    if (p.supply) e.supply = true;
    return e;
  });
  if (layout.setup) out.setup = layout.setup;
  if (layout.battle) out.battle = layout.battle;
  return stringify(out, { lineWidth: 0 });
}
