/**
 * Dragging items with the pointer (mouse, pen or touch), instead of the browser's drag and drop: the whole item
 * follows the pointer, space turns it while it's held (user, 2026-10-20) and Escape puts it back. Where it can be
 * dropped (a bag, the storage box, the bin) registers itself with useDropTarget.
 */
import { type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Cell, Rotation } from '../engine/bag';
import { SIZE, Sprite, type SpriteInfo } from './components/BagGrid';

export interface DragItem {
  /** From an item list, from a bag, or from the storage box. */
  kind: 'item' | 'placed' | 'stored';
  /** The item id ('item') or the instance id. */
  id: string;
  /** The item id. */
  item: string;
  /** As it's held now (space turns it). */
  rotation: Rotation;
  /** Which of its footprint cells is held (index into the footprint's cells; the order doesn't change with rotation). */
  grab: number;
  /** Where in that cell it's held (0–1). */
  inCell: { x: number; y: number };
  /** The bag it belongs to: a placed or stored item only drops back into its own bag. */
  scope: string;
  /** From the starting equipment list. */
  supply?: boolean;
}

export interface DragState extends DragItem {
  x: number;
  y: number;
}

export interface DropTarget {
  accepts: (d: DragItem) => boolean;
  /** The held item moved over this target (or was turned there). */
  over?: (d: DragItem, x: number, y: number) => void;
  leave?: () => void;
  drop: (d: DragItem, x: number, y: number) => void;
}

/** How a held item looks: its cells as turned (relative to its origin), its colour and sprite. */
export interface DragLook {
  cells: Cell[];
  color: string;
  sprite: SpriteInfo | null;
}

const THRESHOLD = 5;
const targets = new Map<HTMLElement, { current: DropTarget }>();
/** How held items of each bag look (each bag knows its own items). */
const looks = new Map<string, { current: (d: DragItem) => DragLook | null }>();
let state: DragState | null = null;
let current: HTMLElement | null = null;
let justEnded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** True right after a drag ended, so the click that follows it isn't taken as a click. */
export const dragJustEnded = () => justEnded;
// A new press starts afresh.
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => (justEnded = false), true);
export const dragState = () => state;

/** The registered target at a point (the held item's picture doesn't count: it lets the pointer through). */
function targetAt(x: number, y: number, fallback: EventTarget | null): HTMLElement | null {
  let el = (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null) as HTMLElement | null;
  el ??= fallback as HTMLElement | null;
  for (; el; el = el.parentElement) if (targets.has(el)) return el;
  return null;
}

function moveTo(x: number, y: number, fallback: EventTarget | null) {
  if (!state) return;
  state = { ...state, x, y };
  const t = targetAt(x, y, fallback);
  const target = t ? targets.get(t)!.current : null;
  const ok = !!target && target.accepts(state);
  if (current && current !== t) targets.get(current)?.current.leave?.();
  current = ok ? t : null;
  if (ok) target!.over?.(state, x, y);
  notify();
}

function finish(drop: boolean, x: number, y: number, fallback: EventTarget | null) {
  const s = state;
  if (s && drop) {
    const t = targetAt(x, y, fallback);
    const target = t ? targets.get(t)!.current : null;
    if (target && target.accepts(s)) target.drop(s, x, y);
  }
  if (current) targets.get(current)?.current.leave?.();
  current = null;
  state = null;
  document.body.classList.remove('dragging');
  // The click the browser sends after the drop isn't a click (a cancelled drag sends none).
  if (s && drop) {
    justEnded = true;
    setTimeout(() => (justEnded = false), 0);
  }
  notify();
}

/**
 * Call from an item's onPointerDown: once the pointer moves a few pixels the item is picked up and follows it;
 * a press that doesn't move stays a click.
 */
export function beginDrag(e: ReactPointerEvent, item: DragItem) {
  if (e.button !== undefined && e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      started = true;
      state = { ...item, x: ev.clientX, y: ev.clientY };
      document.body.classList.add('dragging');
    }
    ev.preventDefault();
    moveTo(ev.clientX, ev.clientY, ev.target);
  };
  const key = (ev: KeyboardEvent) => {
    if (!started || !state) return;
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      ev.stopPropagation();
      state = { ...state, rotation: (((state.rotation + 90) % 360) as Rotation) };
      moveTo(state.x, state.y, null);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      done(false, 0, 0, null);
    }
  };
  const up = (ev: PointerEvent) => done(started, ev.clientX, ev.clientY, ev.target);
  const cancel = () => done(false, 0, 0, null);
  const done = (drop: boolean, x: number, y: number, t: EventTarget | null) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    if (started) finish(drop, x, y, t);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/** Let held items be dropped on this element. */
export function useDropTarget(ref: RefObject<HTMLElement | null>, target: DropTarget) {
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    targets.set(el, latest);
    return () => {
      if (targets.get(el) === latest) targets.delete(el);
    };
  }, [ref]);
}

/** Tell the drag layer how this bag's held items look. */
export function useDragLook(scope: string, look: (d: DragItem) => DragLook | null) {
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => {
    looks.set(scope, latest);
    return () => {
      if (looks.get(scope) === latest) looks.delete(scope);
    };
  }, [scope]);
}

export function useDragState(): DragState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}

/** The held item, drawn under the pointer at bag scale (it lets the pointer through to what's under it). */
export function DragLayer(): ReactNode {
  const d = useDragState();
  if (!d) return null;
  const l = looks.get(d.scope)?.current(d) ?? null;
  if (!l || !l.cells.length) return null;
  const minX = Math.min(...l.cells.map((c) => c.x));
  const minY = Math.min(...l.cells.map((c) => c.y));
  const g = l.cells[d.grab] ?? l.cells[0]!;
  const left = d.x - (g.x - minX + d.inCell.x) * SIZE;
  const top = d.y - (g.y - minY + d.inCell.y) * SIZE;
  const px = (n: number) => (n - minX) * SIZE;
  const py = (n: number) => (n - minY) * SIZE;
  return (
    <div className="drag-layer" style={{ left, top }} aria-hidden="true">
      {l.cells.map((c) => (
        <div key={`${c.x},${c.y}`} className="drag-cell" style={{ left: px(c.x), top: py(c.y), background: l.color }} />
      ))}
      {l.sprite && <Sprite s={{ ...l.sprite, rotation: d.rotation }} cells={l.cells.map((c) => ({ x: c.x - minX, y: c.y - minY }))} px={(n) => n * SIZE} size={SIZE} z={2} />}
    </div>
  );
}

/** Where a pointer is in an element, as a cell of `size` px and the spot within it (0–1). */
export function cellUnder(e: { clientX: number; clientY: number }, el: Element, size = SIZE): { cx: number; cy: number; inCell: { x: number; y: number } } {
  const r = el.getBoundingClientRect();
  const lx = e.clientX - r.left;
  const ly = e.clientY - r.top;
  const cx = Math.floor(lx / size);
  const cy = Math.floor(ly / size);
  return { cx, cy, inCell: { x: Math.max(0, Math.min(0.99, lx / size - cx)), y: Math.max(0, Math.min(0.99, ly / size - cy)) } };
}
