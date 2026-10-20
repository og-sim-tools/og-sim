/**
 * Beside the bag: a storage box to set items aside while rearranging (anywhere, not on a grid; they don't
 * fight or count). Under the bag: a bin to drop items in to remove them.
 */
import { useRef, useState } from 'react';
import type { Cell } from '../../engine/bag';
import { type DragItem, type DragLook, beginDrag, dragJustEnded, useDropTarget } from '../drag';
import { useSettings } from '../settings';
import { SIZE, type SpriteInfo, rarityPaint, spriteScale } from './BagGrid';
import { TrashIcon } from './BuildPicker';

/** Stored items are drawn at the bag's size (user, 2026-10-20). */
export const STORAGE_SCALE = 1;
const S = SIZE * STORAGE_SCALE;

export interface StoredView {
  id: string;
  item: string;
  name: string;
  /** Its cells as turned, relative to its placement origin (in footprint order). */
  cells: Cell[];
  rotation: 0 | 90 | 180 | 270;
  color: string;
  /** Gear (its rarity colour follows the gear settings). */
  gear?: boolean;
  sprite: SpriteInfo | null;
  /** Top-left corner as shares (0–1) of the box. */
  x: number;
  y: number;
}

interface Props {
  items: StoredView[];
  width: number;
  height: number;
  selected: string | null;
  /** The bag these items belong to. */
  scope?: string;
  /** How a held item looks (its cells as turned), to place its corner where it's dropped. */
  look: (d: DragItem) => DragLook | null;
  onSelect: (id: string) => void;
  onRotate: (id: string) => void;
  /** Dropped with the item's top-left corner at (fx, fy), as shares of the box. */
  onDrop: (drag: DragItem, fx: number, fy: number) => void;
  /** Space above it, to line it up with the bag's own cells. */
  top?: number;
}

export function Storage({ items, width, height, selected, scope = 'build', look, onSelect, onRotate, onDrop, top: offsetTop = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const settings = useSettings();
  useDropTarget(ref, {
    accepts: (d) => d.kind === 'item' || d.scope === scope,
    over: () => setOver(true),
    leave: () => setOver(false),
    drop: (d, x, y) => {
      setOver(false);
      const r = ref.current!.getBoundingClientRect();
      const l = look(d);
      // The held cell is under the pointer: the item's corner is that far up and left of it.
      const g = l?.cells[d.grab];
      const minX = l ? Math.min(...l.cells.map((c) => c.x)) : 0;
      const minY = l ? Math.min(...l.cells.map((c) => c.y)) : 0;
      const offX = g ? (g.x - minX + d.inCell.x) * S : S / 2;
      const offY = g ? (g.y - minY + d.inCell.y) * S : S / 2;
      const fx = (x - r.left - offX) / Math.max(1, r.width || width);
      const fy = (y - r.top - offY) / Math.max(1, r.height || height);
      onDrop(d, Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy)));
    },
  });
  return (
    <div ref={ref} className={`storage${over ? ' over' : ''}`} role="region" aria-label="Storage" style={{ width, height, marginTop: offsetTop }}>
      {items.length === 0 && <div className="storage-hint small muted">Storage: drop items here while you rearrange. They don't fight or count.</div>}
      {items.map((it) => {
        const minX = Math.min(...it.cells.map((c) => c.x));
        const minY = Math.min(...it.cells.map((c) => c.y));
        const w = (Math.max(...it.cells.map((c) => c.x)) - minX + 1) * S;
        const h = (Math.max(...it.cells.map((c) => c.y)) - minY + 1) * S;
        // Kept inside the box however it was dropped.
        const left = Math.max(0, Math.min(width - w, it.x * width));
        const top = Math.max(0, Math.min(height - h, it.y * height));
        const paint = rarityPaint(it.color, { gear: !!it.gear, selected: it.id === selected, picture: !!it.sprite }, settings);
        const own = new Set(it.cells.map((c) => `${c.x},${c.y}`));
        const edge = (c: Cell, dx: number, dy: number) => (own.has(`${c.x + dx},${c.y + dy}`) ? '0' : paint.edge ? '3px' : '1px');
        return (
          <div
            key={it.id}
            className={`stored-item${it.id === selected ? ' selected' : ''}`}
            style={{ left, top, width: w, height: h }}
            title={`${it.name} (in storage)${it.id === selected ? ' · click again to rotate' : ''}`}
            onPointerDown={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const lx = (e.clientX - r.left) / S + minX;
              const ly = (e.clientY - r.top) / S + minY;
              // The cell under the pointer (or the nearest one).
              let grab = 0;
              let best = Infinity;
              it.cells.forEach((c, i) => {
                const dist = Math.hypot(c.x + 0.5 - lx, c.y + 0.5 - ly);
                if (dist < best) [best, grab] = [dist, i];
              });
              const g = it.cells[grab]!;
              const inCell = { x: Math.max(0, Math.min(0.99, lx - g.x)), y: Math.max(0, Math.min(0.99, ly - g.y)) };
              beginDrag(e, { kind: 'stored', id: it.id, item: it.item, rotation: it.rotation, grab, inCell, scope });
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (dragJustEnded()) return;
              if (it.id === selected) onRotate(it.id);
              else onSelect(it.id);
            }}
          >
            {it.cells.map((c) => (
              <div
                key={`${c.x},${c.y}`}
                className="stored-cell"
                style={{
                  left: (c.x - minX) * S,
                  top: (c.y - minY) * S,
                  width: S,
                  height: S,
                  background: paint.background,
                  borderStyle: 'solid',
                  borderColor: paint.edge ?? 'rgba(0,0,0,0.35)',
                  borderWidth: `${edge(c, 0, -1)} ${edge(c, 1, 0)} ${edge(c, 0, 1)} ${edge(c, -1, 0)}`,
                }}
              />
            ))}
            {it.sprite && (
              <img
                src={it.sprite.src}
                alt=""
                draggable={false}
                style={{
                  width: it.sprite.w * spriteScale(it.sprite, S),
                  height: it.sprite.h * spriteScale(it.sprite, S),
                  transform: `translate(-50%, -50%) rotate(${it.sprite.rotation}deg)`,
                }}
              />
            )}
            {!it.sprite && <span className="label">{it.name}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Drop an item here to take it out of the bag (or the storage box). */
export function Bin({ scope = 'build', onDrop }: { scope?: string; onDrop: (drag: DragItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useDropTarget(ref, {
    accepts: (d) => d.kind !== 'item' && d.scope === scope,
    over: () => setOver(true),
    leave: () => setOver(false),
    drop: (d) => {
      setOver(false);
      onDrop(d);
    },
  });
  return (
    <div ref={ref} className={`bin${over ? ' over' : ''}`} role="region" aria-label="Bin" title="Drop an item here to remove it">
      <TrashIcon />
      <span className="small">Drop here to remove</span>
    </div>
  );
}
