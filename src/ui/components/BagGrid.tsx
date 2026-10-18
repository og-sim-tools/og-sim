/**
 * The bag grid (SPEC §8): mask cells, placed items, red overlaps / invalid cells, item dots for
 * the selected or hovered item (out-of-bag dots shown faded), drag and drop, keyboard controls.
 */
import { type DragEvent, type KeyboardEvent, useMemo, useRef } from 'react';
import { type Cell, cellKey, footprintOf, isUsable, occupantsAt, resolveDots } from '../../engine/bag';
import { activeEffects, dotAffects } from '../../engine/effects/resolve';
import type { ItemEffect } from '../../engine/model';
import type { Loadout, LoadoutIssue } from '../../engine/loadout';
import { copyName, copyNumbers } from '../../engine/loadout';
import { type KeyAction, keyAction } from '../state/layoutOps';
import { imageUrl } from '../staticData';

/** Most cells drawn around the bag for out-of-bag item cells and dots. */
export const MAX_MARGIN = 4;
const SIZE = 40;
/** Share of the footprint box a sprite fills. */
export const SPRITE_FILL = 0.9;

export interface Ghost {
  name: string;
  color: string;
  cells: Cell[];
  dots: Cell[];
  valid: boolean;
  /** The placed item's effects, to tell which touched items its dots affect. */
  effects?: readonly ItemEffect[];
  /** The item's sprite, drawn like a placed one. */
  sprite?: SpriteInfo;
  /** Placement origin, so a drag can keep the grab offset. */
  origin: Cell;
}

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

/**
 * The sprite scaled to fit the item's footprint box (keeping its pixel shape, crisp), centred in
 * the cells the item covers and turned with it.
 */
function Sprite({ s, cells, px, size, label, z }: { s: SpriteInfo; cells: Cell[]; px: (n: number) => number; size: number; label?: string; z: number }) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // 90% of the fit, so sprites in neighbouring cells don't touch.
  const scale = SPRITE_FILL * Math.min((s.cellsW * size) / s.w, (s.cellsH * size) / s.h);
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

export const DRAG_ITEM = 'application/x-og-item';
export const DRAG_INSTANCE = 'application/x-og-instance';
export const DRAG_PENDING = 'application/x-og-pending';

interface Props {
  loadout: Loadout;
  issues: LoadoutIssue[];
  selected: string | null;
  hovered: string | null;
  ghost: Ghost | null;
  maskEdit: boolean;
  onSelect: (id: string | null) => void;
  /** Clicked an item (opens its side panel); placing with Enter or dragging doesn't. */
  onInspect?: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleMask: (x: number, y: number) => void;
  /** Cells enhanced by a hero skill, and whether clicks toggle them. */
  enhanced?: readonly Cell[];
  enhanceEdit?: boolean;
  onToggleEnhanced?: (x: number, y: number) => void;
  /** A browser item (itemId), a placed instance or the not-yet-placed item (pending) dropped with its origin at x, y. */
  onDrop: (drop: { itemId?: string; instanceId?: string; pending?: boolean }, x: number, y: number) => void;
  onKey: (action: KeyAction) => void;
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
  const { loadout, issues, selected, hovered, ghost } = p;
  const { bag, layout } = loadout;
  const ref = useRef<HTMLDivElement>(null);
  const MARGIN = useMemo(
    () => marginFor(bag.width, bag.height, [...[...layout.items.values()].flatMap((i) => [...i.cells, ...i.dots]), ...(ghost ? [...ghost.cells, ...ghost.dots] : [])]),
    [bag, layout, ghost],
  );
  const px = (n: number) => (n + MARGIN) * SIZE;

  const redCells = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const i of issues) if (i.level === 'error' && i.cells) for (const c of i.cells) out.set(cellKey(c), c);
    return [...out.values()];
  }, [issues]);
  const invalidIds = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.instanceIds ?? [])),
    [issues],
  );

  // Dots of the focused item: the ghost while placing, else hovered, else selected.
  const focus = ghost ? null : (hovered ?? selected);
  const dots = useMemo(() => markRepeats(dotsRaw()), [ghost, focus, layout, bag, loadout]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function dotsRaw() {
    // A dot on an item its effects don't care about (Wind Spirit's dot on a glove) is drawn as "touches-other".
    const relevance = (effects: readonly ItemEffect[] | undefined, d: { status: string; target?: string }) => {
      if (d.status !== 'touches' || !effects || !d.target) return d.status;
      const t = loadout.entries.get(d.target);
      // Unknown (no structured dot effects, e.g. a text-only item) is not shown as affecting anything.
      return t && dotAffects(effects, t) !== true ? 'touches-other' : d.status;
    };
    if (ghost) {
      return ghost.dots.map((c) => {
        const inside = c.x >= 0 && c.y >= 0 && c.x < bag.width && c.y < bag.height;
        const status = !inside ? 'outside' : !isUsable(bag, c.x, c.y) ? 'masked' : occupantsAt(layout, c.x, c.y).length ? 'touches' : 'empty';
        const d = { cell: c, status, target: occupantsAt(layout, c.x, c.y)[0] };
        return { ...d, status: relevance(ghost.effects, d) };
      });
    }
    if (!focus || !layout.items.has(focus)) return [];
    try {
      const src = loadout.entries.get(focus);
      const effects = src ? activeEffects(src).map((e) => e.effect) : undefined;
      return resolveDots(layout, focus).dots.map((d) => ({ ...d, status: relevance(effects, d) }));
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const { x, y } = cellAt(e);
    const pend = e.dataTransfer.getData(DRAG_PENDING);
    if (pend) {
      const { dx, dy } = JSON.parse(pend) as { dx: number; dy: number };
      p.onDrop({ pending: true }, x - dx, y - dy);
      return;
    }
    const inst = e.dataTransfer.getData(DRAG_INSTANCE);
    if (inst) {
      const { id, dx, dy } = JSON.parse(inst) as { id: string; dx: number; dy: number };
      p.onDrop({ instanceId: id }, x - dx, y - dy);
      return;
    }
    const itemId = e.dataTransfer.getData(DRAG_ITEM);
    if (itemId) p.onDrop({ itemId }, x, y);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = keyAction(e.key);
    if (!action) return;
    e.preventDefault();
    p.onKey(action);
  };

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
          title={p.enhanceEdit ? 'Click to mark / unmark an enhanced slot' : p.maskEdit ? 'Click to toggle this bag cell' : `(${x},${y})${on ? '' : ' not available'}${isEnhanced ? ' · enhanced' : ''}`}
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
    if (copy && first) {
      sprites.push(
        <span key={`c${id}`} className="copy-badge" style={{ left: px(first.x) + 2, top: px(first.y) + 2, zIndex: 5 }} title={copyName(String(item.def.name ?? ""), copy)}>
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
            outline: enhancedSet.has(`${c.x},${c.y}`) ? '2px dashed #a78bfa' : undefined,
            outlineOffset: -4,
          }}
          title={`${copyName(String(item.def.name ?? ""), copy)}${p.loadout.entries.get(id)?.supply ? ' (starting equipment)' : ''}`}
          draggable={!p.maskEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_INSTANCE, JSON.stringify({ id, dx: c.x - item.placement.x, dy: c.y - item.placement.y }));
            e.dataTransfer.effectAllowed = 'move';
            p.onSelect(id);
          }}
          onClick={(e) => {
            e.stopPropagation();
            p.onSelect(id);
            p.onInspect?.(id);
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
        style={{ width, height, ['--cell-size' as string]: `${SIZE}px` }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {bgCells}
        {itemCells}
        {sprites}
        {ghost?.sprite && <Sprite s={ghost.sprite} cells={ghost.cells} px={px} size={SIZE} z={6} />}
        {ghost &&
          ghost.cells.map((c) => {
            // Yellow outline on the outer edges only, drawn above every placed item.
            const own = new Set(ghost.cells.map(cellKey));
            const edge = (dx: number, dy: number) => (own.has(cellKey({ x: c.x + dx, y: c.y + dy })) ? '0' : '3px');
            return (
              <div
                key={`g${c.x},${c.y}`}
                className={`item-cell ghost${ghost.valid ? '' : ' bad'}`}
                style={{
                  left: px(c.x),
                  top: px(c.y),
                  background: ghost.color,
                  borderStyle: 'solid',
                  borderColor: '#facc15',
                  borderWidth: `${edge(0, -1)} ${edge(1, 0)} ${edge(0, 1)} ${edge(-1, 0)}`,
                }}
                title={`${ghost.name} (not placed yet: drag it, or press Enter to place)`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_PENDING, JSON.stringify({ dx: c.x - ghost.origin.x, dy: c.y - ghost.origin.y }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  ref.current?.focus();
                }}
              />
            );
          })}
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
