/**
 * Dragging items with the pointer (mouse, pen or touch), instead of the browser's drag and drop: the whole item
 * follows the pointer, space turns it while it's held (user, 2026-10-20) and Escape puts it back. Where it can be
 * dropped (a bag, the storage box, the bin) registers itself with useDropTarget.
 */
import { type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Cell, Rotation } from '../engine/bag';
import { SIZE, Sprite, type SpriteInfo, rarityPaint } from './components/BagGrid';
import { type Anchor, getSettings, useSettings } from './settings';

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
  /** Degrees turned since it was picked up (so a turn animates the short way round). */
  spin: number;
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
  /** Gear (its rarity colour follows the gear settings). */
  gear?: boolean;
  sprite: SpriteInfo | null;
}

const THRESHOLD = 5;
const targets = new Map<HTMLElement, { current: DropTarget }>();
/** What happens to a bag's item dropped where nothing takes it (the Build tab: it's removed). */
const elsewhere = new Map<string, { current: (d: DragItem, x: number, y: number, under: Element | null) => void }>();
/** How held items of each bag look (each bag knows its own items). */
const looks = new Map<string, { current: (d: DragItem) => DragLook | null }>();
let state: DragState | null = null;
let current: HTMLElement | null = null;
/** The last item let go over a target: where its cells' top-left corner was on screen, to slide it from there. */
interface Drop {
  scope: string;
  kind: DragItem['kind'];
  id: string;
  left: number;
  top: number;
  at: number;
}
let lastDrop: Drop | null = null;
/** The element under the pointer while something is held. */
let under: Element | null = null;
let justEnded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** True right after a drag ended, so the click that follows it isn't taken as a click. */
export const dragJustEnded = () => justEnded;
// A new press starts afresh.
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => (justEnded = false), true);
export const dragState = () => state;
/** The element under the pointer while something is held (null when nothing is). */
export const dragUnder = () => under;

/** The element at a point (falling back to the event's target where the browser can't say, as in tests). */
const elementAt = (x: number, y: number, fallback: EventTarget | null) =>
  ((typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null) as Element | null) ?? (fallback as Element | null);

/**
 * Of `boxes`, the one a point belongs to: the one it's in (by `under`, the element there, or by position), else
 * the nearest one, so the gaps between boxes belong to a box too (user, 2026-10-20: no threading the needle).
 */
export function nearestBox(boxes: readonly Element[], x: number, y: number, under: Element | null): Element | null {
  const holder = under ? boxes.find((b) => b.contains(under)) : undefined;
  if (holder) return holder;
  let best: Element | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const r = b.getBoundingClientRect();
    // Hidden boxes (another step on a phone) don't count.
    if (r.width === 0 && r.height === 0 && boxes.some((o) => o.getBoundingClientRect().width > 0)) continue;
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < bestD) [best, bestD] = [b, d];
  }
  return best;
}

/** The registered target at a point (the held item's picture doesn't count: it lets the pointer through). */
function targetAt(x: number, y: number, fallback: EventTarget | null): HTMLElement | null {
  let el = elementAt(x, y, fallback) as HTMLElement | null;
  for (; el; el = el.parentElement) if (targets.has(el)) return el;
  return null;
}

function moveTo(x: number, y: number, fallback: EventTarget | null) {
  if (!state) return;
  state = { ...state, x, y };
  // A turn (no pointer event) keeps what was under it.
  if (fallback || typeof document.elementFromPoint === 'function') under = elementAt(x, y, fallback);
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
    if (target && target.accepts(s)) {
      const box = heldBox(s);
      lastDrop = box ? { scope: s.scope, kind: s.kind, id: s.id, left: box.left, top: box.top, at: Date.now() } : null;
      target.drop(s, x, y);
    }
    else if (s.kind !== 'item') elsewhere.get(s.scope)?.current(s, x, y, elementAt(x, y, fallback));
  }
  if (current) targets.get(current)?.current.leave?.();
  current = null;
  under = null;
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
      state = { ...item, x: ev.clientX, y: ev.clientY, spin: 0 };
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
      state = turned(state);
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

/**
 * How far an item's top-left corner moves (in cells) when its w × h cells turn into w2 × h2 and one corner (or
 * the centre) stays put.
 */
export function anchorShift(anchor: Anchor, w: number, h: number, w2: number, h2: number): { dx: number; dy: number } {
  if (anchor === 'center') return { dx: (w - w2) / 2, dy: (h - h2) / 2 };
  return { dx: anchor.endsWith('right') ? w - w2 : 0, dy: anchor.startsWith('bottom') ? h - h2 : 0 };
}

const box = (cells: Cell[]) => {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, w: Math.max(...xs) - minX + 1, h: Math.max(...ys) - minY + 1 };
};

/**
 * The held item turned a quarter clockwise. It turns around the pointer (the held cell stays under it) or
 * around the centre of its cells (settings: one choice for square items, one for the rest).
 */
export function turned(s: DragState): DragState {
  const next: DragState = { ...s, rotation: (((s.rotation + 90) % 360) as Rotation), spin: s.spin + 90 };
  const look = looks.get(s.scope)?.current;
  const before = look?.(s);
  const after = look?.(next);
  if (!before?.cells.length || !after?.cells.length) return next;
  const ob = box(before.cells);
  const settings = getSettings();
  const pivot = ob.w === ob.h ? settings.squarePivot : settings.otherPivot;
  if (pivot === 'cursor') return next;
  // Keep that corner (or the centre) of its cells where it is: then find which cell (and where in it) is under the pointer.
  const g = before.cells[s.grab] ?? before.cells[0]!;
  const left = s.x - (g.x - ob.minX + s.inCell.x) * SIZE;
  const top = s.y - (g.y - ob.minY + s.inCell.y) * SIZE;
  const nb = box(after.cells);
  const shift = anchorShift(pivot, ob.w, ob.h, nb.w, nb.h);
  const px = (s.x - (left + shift.dx * SIZE)) / SIZE;
  const py = (s.y - (top + shift.dy * SIZE)) / SIZE;
  let grab = 0;
  let best = Infinity;
  after.cells.forEach((c, i) => {
    const d = Math.hypot(c.x - nb.minX + 0.5 - px, c.y - nb.minY + 0.5 - py);
    if (d < best) [best, grab] = [d, i];
  });
  const c = after.cells[grab]!;
  return { ...next, grab, inCell: { x: px - (c.x - nb.minX), y: py - (c.y - nb.minY) } };
}

/** Where a held item's cells are on screen: the top-left corner of their box, and its size. */
function heldBox(d: DragState): { left: number; top: number; w: number; h: number } | null {
  const l = looks.get(d.scope)?.current(d);
  if (!l?.cells.length) return null;
  const b = box(l.cells);
  const g = l.cells[d.grab] ?? l.cells[0]!;
  return { left: d.x - (g.x - b.minX + d.inCell.x) * SIZE, top: d.y - (g.y - b.minY + d.inCell.y) * SIZE, w: b.w * SIZE, h: b.h * SIZE };
}

/**
 * Right after a drop (call from a layout effect): if the item just dropped is drawn in `root` (its elements
 * carry data-item = its id; `idOf` says which id the drop gave it), slide them from where it was let go into
 * place (settings). Its cells (`.item-cell`, or the `.stored-item` box) say where it is now.
 */
export function playDrop(root: HTMLElement | null, scope: string, idOf: (d: { kind: DragItem['kind']; id: string }) => string | null) {
  const d = lastDrop;
  if (!d || !root || d.scope !== scope) return;
  if (Date.now() - d.at > 1000) {
    lastDrop = null;
    return;
  }
  const id = idOf(d);
  if (!id) return;
  const els = [...root.querySelectorAll<HTMLElement>('[data-item]')].filter((e) => e.dataset.item === id);
  const anchors = els.filter((e) => e.classList.contains('item-cell') || e.classList.contains('stored-item'));
  if (!anchors.length) return;
  lastDrop = null;
  const s = getSettings();
  if (!s.animatePlacing || s.placeMs <= 0 || typeof anchors[0]!.animate !== 'function') return;
  // No other transition at the same time (turning shown moves cells with one).
  els.forEach((e) => (e.style.transition = 'none'));
  const rects = anchors.map((e) => e.getBoundingClientRect());
  const dx = d.left - Math.min(...rects.map((r) => r.left));
  const dy = d.top - Math.min(...rects.map((r) => r.top));
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) els.forEach((e) => e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: s.placeMs, easing: 'ease-out' }));
  requestAnimationFrame(() => els.forEach((e) => (e.style.transition = '')));
}

/** The bag cell the held cell is over (the pointer may be off that cell after turning around the centre). */
export const heldCellPoint = (d: DragItem, x: number, y: number) => ({ clientX: x - Math.floor(d.inCell.x) * SIZE, clientY: y - Math.floor(d.inCell.y) * SIZE });

/** Let held items be dropped on this element. */
export function useDropTarget(ref: RefObject<HTMLElement | null>, target: DropTarget) {
  const latest = useRef(target);
  latest.current = target;
  // Every render: the element may only appear later (after loading, a tab switch).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    targets.set(el, latest);
    return () => {
      if (targets.get(el) === latest) targets.delete(el);
    };
  });
}

/** A bag's item dropped where nothing takes it, at (x, y) over `under`: call `fn` (the Build tab removes it, or puts it back). */
export function useDropElsewhere(scope: string, fn: (d: DragItem, x: number, y: number, under: Element | null) => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    elsewhere.set(scope, latest);
    return () => {
      if (elsewhere.get(scope) === latest) elsewhere.delete(scope);
    };
  }, [scope]);
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

/**
 * The held item, drawn under the pointer at bag scale (it lets the pointer through to what's under it). With
 * turning shown (settings), a turn while held swings the whole item from where it was to where it is now.
 */
export function DragLayer(): ReactNode {
  const d = useDragState();
  const settings = useSettings();
  const turnBox = useRef<HTMLDivElement>(null);
  /** The held item's centre (relative to the pointer) and how far it had turned, last time it was drawn. */
  const last = useRef<{ spin: number; cx: number; cy: number } | null>(null);
  const l = d ? (looks.get(d.scope)?.current(d) ?? null) : null;
  const shown = d && l && l.cells.length ? l : null;
  const minX = shown ? Math.min(...shown.cells.map((c) => c.x)) : 0;
  const minY = shown ? Math.min(...shown.cells.map((c) => c.y)) : 0;
  const w = shown ? (Math.max(...shown.cells.map((c) => c.x)) - minX + 1) * SIZE : 0;
  const h = shown ? (Math.max(...shown.cells.map((c) => c.y)) - minY + 1) * SIZE : 0;
  const g = shown ? (shown.cells[d!.grab] ?? shown.cells[0]!) : null;
  const left = d && g ? d.x - (g.x - minX + d.inCell.x) * SIZE : 0;
  const top = d && g ? d.y - (g.y - minY + d.inCell.y) * SIZE : 0;
  const cx = d ? left + w / 2 - d.x : 0;
  const cy = d ? top + h / 2 - d.y : 0;
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = d && shown ? { spin: d.spin, cx, cy } : null;
    if (!d || !shown || !prev || prev.spin === d.spin || !settings.animateRotation || settings.rotationMs <= 0) return;
    const el = turnBox.current;
    if (!el || typeof el.animate !== 'function') return;
    // From the old spot and direction (a quarter turn back) to the new one, around its centre.
    el.animate([{ transform: `translate(${prev.cx - cx}px, ${prev.cy - cy}px) rotate(${prev.spin - d.spin}deg)` }, { transform: 'none' }], { duration: settings.rotationMs, easing: 'ease-out' });
  });
  if (!d || !shown) return null;
  const px = (n: number) => (n - minX) * SIZE;
  const py = (n: number) => (n - minY) * SIZE;
  const paint = rarityPaint(shown.color, { gear: !!shown.gear, selected: false, picture: !!shown.sprite }, settings);
  const own = new Set(shown.cells.map((c) => `${c.x},${c.y}`));
  const edge = (c: Cell, dx: number, dy: number) => (own.has(`${c.x + dx},${c.y + dy}`) ? '0' : paint.edge ? '3px' : '1px');
  return (
    <div className="drag-layer" style={{ left, top }} aria-hidden="true">
      <div ref={turnBox} className="drag-turn" style={{ width: w, height: h }}>
        {shown.cells.map((c) => (
          <div
            key={`${c.x},${c.y}`}
            className="drag-cell"
            style={{
              left: px(c.x),
              top: py(c.y),
              background: paint.background,
              borderStyle: 'solid',
              borderColor: paint.edge ?? 'rgba(0,0,0,0.35)',
              borderWidth: `${edge(c, 0, -1)} ${edge(c, 1, 0)} ${edge(c, 0, 1)} ${edge(c, -1, 0)}`,
            }}
          />
        ))}
        {shown.sprite && <Sprite s={{ ...shown.sprite, rotation: d.rotation }} cells={shown.cells.map((c) => ({ x: c.x - minX, y: c.y - minY }))} px={(n) => n * SIZE} size={SIZE} z={2} />}
      </div>
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
