/**
 * Beside the bag: a storage box to set items aside while rearranging (anywhere, not on a grid; they don't
 * fight or count), and a bin to drop items in to remove them.
 */
import { type DragEvent, useRef, useState } from 'react';
import type { Cell } from '../../engine/bag';
import { type DragLook, type DragPayload, SIZE, type SpriteInfo, endDrag, readDrag, spriteScale, startDrag } from './BagGrid';
import { TrashIcon } from './BuildPicker';

/** Stored items are drawn smaller than in the bag, so they fit the narrow box. */
export const STORAGE_SCALE = 0.6;
const S = SIZE * STORAGE_SCALE;

export interface StoredView {
  id: string;
  name: string;
  /** Its cells as turned, relative to its placement origin. */
  cells: Cell[];
  color: string;
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
  onSelect: (id: string) => void;
  onRotate: (id: string) => void;
  /** Dropped with the item's top-left corner at (fx, fy), as shares of the box. */
  onDrop: (drag: DragPayload, fx: number, fy: number) => void;
}

export function Storage({ items, width, height, selected, onSelect, onRotate, onDrop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const drag = readDrag(e);
    endDrag();
    if (!drag) return;
    const r = ref.current!.getBoundingClientRect();
    const fx = (e.clientX - r.left - drag.gx * STORAGE_SCALE) / Math.max(1, r.width || width);
    const fy = (e.clientY - r.top - drag.gy * STORAGE_SCALE) / Math.max(1, r.height || height);
    onDrop(drag, Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy)));
  };
  return (
    <div
      ref={ref}
      className={`storage${over ? ' over' : ''}`}
      role="region"
      aria-label="Storage"
      style={{ width, height }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => !ref.current?.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={drop}
    >
      {items.length === 0 && <div className="storage-hint small muted">Storage: drop items here while you rearrange. They don't fight or count.</div>}
      {items.map((it) => {
        const minX = Math.min(...it.cells.map((c) => c.x));
        const minY = Math.min(...it.cells.map((c) => c.y));
        const w = (Math.max(...it.cells.map((c) => c.x)) - minX + 1) * S;
        const h = (Math.max(...it.cells.map((c) => c.y)) - minY + 1) * S;
        // Kept inside the box however it was dropped.
        const left = Math.max(0, Math.min(width - w, it.x * width));
        const top = Math.max(0, Math.min(height - h, it.y * height));
        const look: DragLook = { cells: it.cells, color: it.color, sprite: it.sprite };
        return (
          <div
            key={it.id}
            className={`stored-item${it.id === selected ? ' selected' : ''}`}
            style={{ left, top, width: w, height: h }}
            title={`${it.name} (in storage)${it.id === selected ? ' · click again to rotate' : ''}`}
            draggable
            onDragStart={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const lx = e.clientX ? e.clientX - r.left : S / 2;
              const ly = e.clientY ? e.clientY - r.top : S / 2;
              const cx = Math.max(0, Math.min(Math.floor(lx / S), Math.round(w / S) - 1));
              const cy = Math.max(0, Math.min(Math.floor(ly / S), Math.round(h / S) - 1));
              startDrag(e, { kind: 'stored', id: it.id, dx: minX + cx, dy: minY + cy, gx: lx / STORAGE_SCALE, gy: ly / STORAGE_SCALE }, look);
              onSelect(it.id);
            }}
            onDragEnd={endDrag}
            onClick={(e) => {
              e.stopPropagation();
              if (it.id === selected) onRotate(it.id);
              else onSelect(it.id);
            }}
          >
            {it.cells.map((c) => (
              <div key={`${c.x},${c.y}`} className="stored-cell" style={{ left: (c.x - minX) * S, top: (c.y - minY) * S, width: S, height: S, background: it.color }} />
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
export function Bin({ onDrop }: { onDrop: (drag: DragPayload) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`bin${over ? ' over' : ''}`}
      role="region"
      aria-label="Bin"
      title="Drop an item here to remove it"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const drag = readDrag(e);
        endDrag();
        if (drag) onDrop(drag);
      }}
    >
      <TrashIcon />
      <span className="small">Drop here to remove</span>
    </div>
  );
}
