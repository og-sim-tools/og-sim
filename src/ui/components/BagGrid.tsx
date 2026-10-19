/**
 * The bag grid (SPEC §8): mask cells, placed items, red overlaps / invalid cells, item dots for
 * the selected or hovered item (out-of-bag dots shown faded), drag and drop, keyboard controls.
 * Click an item to select it, click it again to rotate it. Dragging shows the whole item and where it lands.
 */
import { type DragEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { type Cell, cellKey, footprintOf, isUsable, occupantsAt, resolveDots } from '../../engine/bag';
import { activeEffects, dotAffects } from '../../engine/effects/resolve';
import type { ItemEffect } from '../../engine/model';
import type { Loadout, LoadoutIssue } from '../../engine/loadout';
import { copyName, copyNumbers } from '../../engine/loadout';
import { type KeyAction, keyAction } from '../state/layoutOps';
import { imageUrl } from '../staticData';

/** Most cells drawn around the bag for out-of-bag item cells and dots (items can't go further out: layoutOps REACH). */
export const MAX_MARGIN = 4;
export const SIZE = 40;
/** Share of the footprint box a sprite fills. */
export const SPRITE_FILL = 0.9;

/** A sprite and the item's unrotated footprint size in cells, for scaling it into the bag. */
export interface SpriteInfo {
  src: string;
  /** Native pixel size. */
  w: number;
  h: number;
  /** Unrotated footprint bounding box, in cells. */
  cellsW: number;
  cellsH: number;
  rotation: number;
}

/** The sprite of an item or gear definition, if it has one. */
export function spriteOf(def: { image?: string; image_size?: { w: number; h: number } } & Parameters<typeof footprintOf>[0], rotation = 0): SpriteInfo | null {
  if (!def.image || !def.image_size) return null;
  const fp = footprintOf(def);
  if (!fp || fp.cells.length === 0) return null;
  const xs = fp.cells.map((c) => c.x);
  const ys = fp.cells.map((c) => c.y);
  return {
    src: imageUrl(def.image),
    w: def.image_size.w,
    h: def.image_size.h,
    cellsW: Math.max(...xs) - Math.min(...xs) + 1,
    cellsH: Math.max(...ys) - Math.min(...ys) + 1,
    rotation,
  };
}

/** How big a sprite is drawn in a box of cells of `size` px (90% of the fit, so neighbours don't touch). */
export const spriteScale = (s: SpriteInfo, size: number) => SPRITE_FILL * Math.min((s.cellsW * size) / s.w, (s.cellsH * size) / s.h);

/**
 * The sprite scaled to fit the item's footprint box (keeping its pixel shape, crisp), centred in
 * the cells the item covers and turned with it.
 */
export function Sprite({ s, cells, px, size, label, z }: { s: SpriteInfo; cells: Cell[]; px: (n: number) => number; size: number; label?: string; z: number }) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const scale = spriteScale(s, size);
  return (
    <div
      className="sprite"
      style={{ left: px(minX), top: px(minY), width: (Math.max(...xs) - minX + 1) * size, height: (Math.max(...ys) - minY + 1) * size, zIndex: z }}
    >
      <img src={s.src} alt="" draggable={false} style={{ width: s.w * scale, height: s.h * scale, transform: `translate(-50%, -50%) rotate(${s.rotation}deg)` }} />
      {label && <span className="label">{label}</span>}
    </div>
  );
}

/** A gear piece's small menu icon (or an empty box of the same size, so names line up). */
export function GearIcon({ icon }: { icon?: string }) {
  return <span className="gear-icon">{icon ? <img src={imageUrl(icon)} alt="" draggable={false} /> : null}</span>;
}

// ------------------------------------------------------------------ dragging

/** What's being dragged: an item from the list, an item in the bag, or one in the storage box. */
export interface DragPayload {
  kind: 'item' | 'placed' | 'stored';
  /** The item id ('item') or the instance id. */
  id: string;
  /** The grabbed cell, relative to the item's placement origin. */
  dx: number;
  dy: number;
  /** The grabbed point, in px from the item's top-left corner at bag scale. */
  gx: number;
  gy: number;
}

export const DRAG = 'application/x-og-drag';
/** The drag in progress (a drag's data can't be read until it's dropped, but the bag shows where it would land). */
export const dragging: { current: DragPayload | null } = { current: null };

/** What a drag image shows: the item's cells (relative to its origin), its colour and sprite. */
export interface DragLook {
  cells: readonly Cell[];
  color: string;
  sprite?: SpriteInfo | null;
}

/** The point to hold an item by when it's dragged from a list: the middle of its origin cell. */
export function originGrab(cells: readonly Cell[]): Pick<DragPayload, 'dx' | 'dy' | 'gx' | 'gy'> {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return { dx: 0, dy: 0, gx: (0 - minX) * SIZE + SIZE / 2, gy: (0 - minY) * SIZE + SIZE / 2 };
}

/** Start dragging: remember what, and show the whole item under the pointer (not just the grabbed cell). */
export function startDrag(e: DragEvent, payload: DragPayload, look?: DragLook | null) {
  dragging.current = payload;
  e.dataTransfer.setData(DRAG, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'move';
  if (look && look.cells.length && typeof e.dataTransfer.setDragImage === 'function') {
    const el = dragImage(look);
    document.body.appendChild(el);
    e.dataTransfer.setDragImage(el, payload.gx, payload.gy);
    setTimeout(() => el.remove(), 0);
  }
}

export function endDrag() {
  dragging.current = null;
}

/** The drag being dropped (its data, or the one remembered when the data can't be read). */
export function readDrag(e: DragEvent): DragPayload | null {
  const text = e.dataTransfer?.getData(DRAG);
  if (text) {
    try {
      return JSON.parse(text) as DragPayload;
    } catch {
      /* fall through */
    }
  }
  return dragging.current;
}

/** An off-screen copy of the item at bag scale, for the browser to draw under the pointer. */
function dragImage({ cells, color, sprite }: DragLook): HTMLElement {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const w = (Math.max(...cells.map((c) => c.x)) - minX + 1) * SIZE;
  const h = (Math.max(...cells.map((c) => c.y)) - minY + 1) * SIZE;
  const el = document.createElement('div');
  el.className = 'drag-image';
  el.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${w}px;height:${h}px;pointer-events:none;`;
  for (const c of cells) {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${(c.x - minX) * SIZE}px;top:${(c.y - minY) * SIZE}px;width:${SIZE}px;height:${SIZE}px;background:${color};opacity:0.6;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.35);`;
    el.appendChild(d);
  }
  if (sprite) {
    const scale = spriteScale(sprite, SIZE);
    const img = document.createElement('img');
    img.src = sprite.src;
    img.style.cssText = `position:absolute;left:50%;top:50%;width:${sprite.w * scale}px;height:${sprite.h * scale}px;transform:translate(-50%,-50%) rotate(${sprite.rotation}deg);image-rendering:pixelated;`;
    el.appendChild(img);
  }
  return el;
}

/** Where a drag would land in the bag: the origin (kept within reach of the bag), its cells, and whether they're free. */
export interface DropTarget {
  x: number;
  y: number;
  cells: Cell[];
  valid: boolean;
}

/** How enhanced slots are drawn: the colour of the hero skill that enhanced them, and what it does there. */
export interface EnhancedLook {
  skill: string;
  color: string;
  label: string;
}

interface Props {
  loadout: Loadout;
  issues: LoadoutIssue[];
  selected: string | null;
  hovered: string | null;
  maskEdit: boolean;
  onSelect: (id: string | null) => void;
  /** Clicked the selected item again: turn it. */
  onRotate?: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleMask: (x: number, y: number) => void;
  /** Cells enhanced by a hero skill, and whether clicks toggle them. */
  enhanced?: readonly Cell[];
  enhancedLook?: EnhancedLook | null;
  enhanceEdit?: boolean;
  onToggleEnhanced?: (x: number, y: number) => void;
  /** Where a drag would land with its grabbed cell over (x, y) (null = it can't be dropped). */
  dropTarget?: (drag: DragPayload, x: number, y: number) => DropTarget | null;
  /** Something dropped with its grabbed cell over (x, y). */
  onDrop: (drag: DragPayload, x: number, y: number) => void;
  onKey: (action: KeyAction) => void;
  /** Only to look at (the Battle tab): no dragging or dropping. */
  readOnly?: boolean;
}

export function rarityColor(rarity: string | null | undefined, gear = false): string {
  return gear ? 'var(--r-gear)' : `var(--r-${rarity ?? 'common'})`;
}

/** Cells of margin needed so every item cell and dot outside the bag can still be drawn. */
export function marginFor(width: number, height: number, cells: readonly Cell[]): number {
  let m = 1;
  for (const c of cells) m = Math.max(m, -c.x, -c.y, c.x - (width - 1), c.y - (height - 1));
  return Math.min(m, MAX_MARGIN);
}

export function BagGrid(p: Props) {
  const { loadout, issues, selected, hovered } = p;
  const { bag, layout } = loadout;
  const ref = useRef<HTMLDivElement>(null);
  /** Where the item being dragged would land. */
  const [preview, setPreview] = useState<DropTarget | null>(null);
  const previewKey = useRef('');
  const MARGIN = useMemo(() => marginFor(bag.width, bag.height, [...layout.items.values()].flatMap((i) => [...i.cells, ...i.dots])), [bag, layout]);
  const px = (n: number) => (n + MARGIN) * SIZE;

  const redCells = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const i of issues) if (i.level === 'error' && i.cells) for (const c of i.cells) out.set(cellKey(c), c);
    return [...out.values()];
  }, [issues]);
  const invalidIds = useMemo(() => new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.instanceIds ?? [])), [issues]);

  // Dots of the focused item: hovered, else selected.
  const focus = hovered ?? selected;
  const dots = useMemo(() => markRepeats(dotsRaw()), [focus, layout, bag, loadout]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function dotsRaw(): { cell: Cell; status: string; target?: string }[] {
    if (!focus || !layout.items.has(focus)) return [];
    // A dot on an item its effects don't care about (Wind Spirit's dot on a glove) is drawn as "touches-other".
    try {
      const src = loadout.entries.get(focus);
      const effects: readonly ItemEffect[] | undefined = src ? activeEffects(src).map((e) => e.effect) : undefined;
      return resolveDots(layout, focus).dots.map((d) => {
        if (d.status !== 'touches' || !effects || !d.target) return d;
        const t = loadout.entries.get(d.target);
        // Unknown (no structured dot effects, e.g. a text-only item) is not shown as affecting anything.
        return t && dotAffects(effects, t) !== true ? { ...d, status: 'touches-other' } : d;
      });
    } catch {
      return [];
    }
  }
  const touched = new Set(dots.filter((d) => d.status === 'touches').map((d) => d.target));

  const width = px(bag.width + MARGIN);
  const height = px(bag.height + MARGIN);

  const cellAt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / SIZE) - MARGIN, y: Math.floor((e.clientY - r.top) / SIZE) - MARGIN };
  };

  const clearPreview = () => {
    previewKey.current = '';
    setPreview(null);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const drag = dragging.current;
    if (!drag || !p.dropTarget) return;
    const { x, y } = cellAt(e);
    const key = `${drag.kind}:${drag.id}:${x},${y}`;
    if (key === previewKey.current) return;
    previewKey.current = key;
    setPreview(p.dropTarget(drag, x, y));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    clearPreview();
    const drag = readDrag(e);
    endDrag();
    if (!drag) return;
    const { x, y } = cellAt(e);
    p.onDrop(drag, x, y);
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = keyAction(e.key);
    if (!action) return;
    e.preventDefault();
    p.onKey(action);
  };

  const look = p.enhancedLook;
  const enhancedSet = new Set((p.enhanced ?? []).map((c) => `${c.x},${c.y}`));
  const bgCells = [];
  for (let y = 0; y < bag.height; y++) {
    for (let x = 0; x < bag.width; x++) {
      const on = isUsable(bag, x, y);
      const isEnhanced = enhancedSet.has(`${x},${y}`);
      bgCells.push(
        <div
          key={`b${x},${y}`}
          className={`cell ${on ? 'on' : 'off'}${p.maskEdit || p.enhanceEdit ? ' edit-mask' : ''}${isEnhanced ? ' enhanced' : ''}`}
          style={{ left: px(x), top: px(y) }}
          title={
            p.enhanceEdit
              ? `Click to mark / unmark a slot ${look?.skill ?? 'a hero skill'} enhanced`
              : p.maskEdit
                ? 'Click to toggle this bag cell'
                : `(${x},${y})${on ? '' : ' not available'}${isEnhanced ? ` · enhanced by ${look?.skill ?? 'a hero skill'}${look ? `: ${look.label}` : ''}` : ''}`
          }
          onClick={() => (p.enhanceEdit ? p.onToggleEnhanced?.(x, y) : p.maskEdit ? p.onToggleMask(x, y) : p.onSelect(null))}
        />,
      );
    }
  }

  const itemCells = [];
  const sprites = [];
  const copies = copyNumbers(layout);
  for (const [id, item] of layout.items) {
    const entry = loadout.entries.get(id);
    const copy = copies.get(id);
    const sprite = spriteOf(item.def as Parameters<typeof spriteOf>[0], item.placement.rotation);
    if (sprite) sprites.push(<Sprite key={`s${id}`} s={sprite} cells={item.cells} px={px} size={SIZE} z={id === selected ? 4 : 3} />);
    // Gear shows the rarity it's equipped at (no rarity known → the plain gear colour).
    const color =
      entry?.kind === 'gear'
        ? entry.gearRarity
          ? rarityColor(entry.gearRarity)
          : rarityColor(null, true)
        : rarityColor('rarity' in item.def ? (item.def.rarity as string) : null);
    const own = new Set(item.cells.map(cellKey));
    const first = [...item.cells].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const minX = Math.min(...item.cells.map((c) => c.x));
    const minY = Math.min(...item.cells.map((c) => c.y));
    if (copy && first) {
      sprites.push(
        <span key={`c${id}`} className="copy-badge" style={{ left: px(first.x) + 2, top: px(first.y) + 2, zIndex: 5 }} title={copyName(String(item.def.name ?? ''), copy)}>
          {copy}
        </span>,
      );
    }
    for (const c of item.cells) {
      const edge = (dx: number, dy: number) => (own.has(cellKey({ x: c.x + dx, y: c.y + dy })) ? '0' : '2px');
      itemCells.push(
        <div
          key={`i${id}${c.x},${c.y}`}
          className={`item-cell${id === selected ? ' selected' : ''}${id === hovered ? ' hovered' : ''}${touched.has(id) ? ' touched' : ''}${invalidIds.has(id) ? ' invalid' : ''}${sprite ? ' has-sprite' : ''}`}
          style={{
            left: px(c.x),
            top: px(c.y),
            background: color,
            borderStyle: 'solid',
            borderColor: id === selected ? 'white' : 'rgba(0,0,0,0.35)',
            borderWidth: `${edge(0, -1)} ${edge(1, 0)} ${edge(0, 1)} ${edge(-1, 0)}`,
            zIndex: id === selected ? 2 : 1,
            // While marking enhanced cells, clicks go through to the cell underneath.
            pointerEvents: p.enhanceEdit ? 'none' : undefined,
            outline: enhancedSet.has(`${c.x},${c.y}`) ? `2px dashed ${look?.color ?? '#a78bfa'}` : undefined,
            outlineOffset: -4,
          }}
          title={`${copyName(String(item.def.name ?? ''), copy)}${entry?.supply ? ' (starting equipment)' : ''}${id === selected ? ' · click again to rotate' : ''}`}
          draggable={!p.maskEdit && !p.readOnly}
          onDragStart={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const inX = e.clientX ? Math.max(0, Math.min(SIZE - 1, e.clientX - r.left)) : SIZE / 2;
            const inY = e.clientY ? Math.max(0, Math.min(SIZE - 1, e.clientY - r.top)) : SIZE / 2;
            startDrag(
              e,
              { kind: 'placed', id, dx: c.x - item.placement.x, dy: c.y - item.placement.y, gx: (c.x - minX) * SIZE + inX, gy: (c.y - minY) * SIZE + inY },
              { cells: item.cells, color, sprite },
            );
            p.onSelect(id);
          }}
          onDragEnd={() => {
            endDrag();
            clearPreview();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (id === selected) p.onRotate?.(id);
            else p.onSelect(id);
            ref.current?.focus();
          }}
          onMouseEnter={() => p.onHover(id)}
          onMouseLeave={() => p.onHover(null)}
        >
          {c === first && !sprite && <span className="label">{item.def.name}</span>}
        </div>,
      );
    }
  }

  return (
    <div className="bag-wrap">
      <div
        ref={ref}
        className="bag"
        tabIndex={0}
        role="grid"
        aria-label="Backpack"
        style={{ width, height, ['--cell-size' as string]: `${SIZE}px`, ...(look ? { ['--enh' as string]: look.color } : {}) }}
        onDragOver={p.readOnly ? undefined : onDragOver}
        onDragLeave={(e) => {
          if (!ref.current?.contains(e.relatedTarget as Node)) clearPreview();
        }}
        onDrop={p.readOnly ? undefined : onDrop}
        onKeyDown={onKeyDown}
      >
        {bgCells}
        {itemCells}
        {sprites}
        {preview?.cells.map((c) => (
          <div key={`p${c.x},${c.y}`} className={`drop-preview${preview.valid ? '' : ' bad'}`} style={{ left: px(c.x), top: px(c.y) }} />
        ))}
        {redCells.map((c) => (
          <div key={`r${c.x},${c.y}`} className="red-cell" style={{ left: px(c.x), top: px(c.y) }} />
        ))}
        {dots.map((d, i) => (
          <div
            key={`d${i}`}
            className={`dot ${d.status}`}
            style={{ left: px(d.cell.x) + SIZE / 2, top: px(d.cell.y) + SIZE / 2 }}
            title={d.status === 'outside' ? 'Outside the bag: does nothing' : d.status === 'masked' ? 'Unavailable cell: does nothing' : d.status === 'repeat' ? 'Already touched by another dot: counts once' : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/** An item counts once however many dots land on it: only its first dot is filled, the others are hollow ("repeat"). */
export function markRepeats<T extends { status: string; target?: string }>(dots: T[]): T[] {
  const seen = new Set<string>();
  return dots.map((d) => {
    if ((d.status !== 'touches' && d.status !== 'touches-other') || !d.target) return d;
    if (seen.has(d.target)) return { ...d, status: 'repeat' };
    seen.add(d.target);
    return d;
  });
}
