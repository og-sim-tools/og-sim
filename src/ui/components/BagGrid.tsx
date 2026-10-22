/**
 * The bag grid (SPEC §8): mask cells, placed items, red overlaps / invalid cells, item dots for
 * the selected or hovered item (out-of-bag dots shown faded), drag and drop, keyboard controls.
 * Click an item to select it, click it again to rotate it. Dragging shows the whole item and where it lands.
 */
import { type KeyboardEvent, type ReactElement, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Cell, cellKey, footprintOf, isUsable, occupantsAt, resolveDots } from '../../engine/bag';
import { activeEffects, dotAffects } from '../../engine/effects/resolve';
import type { ItemEffect } from '../../engine/model';
import type { Loadout, LoadoutIssue } from '../../engine/loadout';
import { copyName, copyNumbers } from '../../engine/loadout';
import { type KeyAction, keyAction } from '../state/layoutOps';
import { imageUrl } from '../staticData';
import { type DragItem, beginDrag, cellUnder, dragJustEnded, heldCellPoint, playDrop, useDraggedId, useDropTarget } from '../drag';
import { type Settings, getSettings, useSettings } from '../settings';

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
export function Sprite({ s, cells, px, size, label, z, item }: { s: SpriteInfo; cells: Cell[]; px: (n: number) => number; size: number; label?: string; z: number; item?: string }) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const scale = spriteScale(s, size);
  return (
    <div
      className="sprite"
      data-item={item}
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

/** Where a held item would land in the bag: the origin (kept within reach of the bag), its cells, and whether they're free. */
export interface Landing {
  x: number;
  y: number;
  cells: Cell[];
  /** Its dots there. */
  dots?: Cell[];
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
  /** Where a held item would land with its held cell over bag cell (x, y) (null = it can't be dropped). */
  dropTarget?: (drag: DragItem, x: number, y: number) => Landing | null;
  /** Something dropped with its held cell over bag cell (x, y). */
  onDrop: (drag: DragItem, x: number, y: number) => void;
  onKey: (action: KeyAction) => void;
  /** Only to look at: nothing can be picked up or dropped. */
  readOnly?: boolean;
  /** Which bag this is: placed items only move within their own bag (default "build"). */
  scope?: string;
  /** Every selected item when there are several (Shift+click, a Shift+drag box); `selected` is one of them. */
  multi?: ReadonlySet<string>;
  /** Shift+click on an item: add it to the selection or take it out. */
  onShiftSelect?: (id: string) => void;
  /** Shift+drag a box over the bag: the items it touches. */
  onBoxSelect?: (ids: string[]) => void;
  /** Items that will be put in the bag at the start of battle (pets' spawns), drawn faintly where they'll go. */
  ghosts?: { id: string; name: string; cells: Cell[]; sprite: SpriteInfo | null; color: string }[];
  /** Items from the lists and the storage box can be dropped here (the Build tab's bag). */
  acceptsNew?: boolean;
}

export function rarityColor(rarity: string | null | undefined, gear = false): string {
  return gear ? 'var(--r-gear)' : `var(--r-${rarity ?? 'common'})`;
}

/**
 * How an item's cells are painted with its rarity colour (settings: items and gear each have their own look and
 * strength, normally and when selected or hovered). Items without a picture always get the full colour: it's all
 * there is to see of them. `edge` is the colour of the ring round its cells (null = the usual thin dark edge).
 */
export function rarityPaint(color: string, o: { gear: boolean; selected: boolean; picture: boolean }, s: Settings = getSettings()): { background: string; edge: string | null } {
  if (!o.picture) return { background: color, edge: null };
  const look = o.gear ? s.gearLook : s.itemLook;
  const pct = o.gear ? (o.selected ? s.gearSelectedOpacity : s.gearOpacity) : o.selected ? s.itemSelectedOpacity : s.itemOpacity;
  const shade = pct >= 100 ? color : pct <= 0 ? 'transparent' : `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  // Without a full background, a selected item gets a faint light one so it still stands out.
  const plain = o.selected ? 'rgba(255, 255, 255, 0.14)' : 'transparent';
  if (look === 'full') return { background: shade, edge: null };
  if (look === 'ring') return { background: plain, edge: shade };
  return { background: plain, edge: null };
}

/** Cells of margin needed so every item cell outside the bag can still be drawn (dots further out aren't drawn). */
export function marginFor(width: number, height: number, cells: readonly Cell[]): number {
  let m = 1;
  for (const c of cells) m = Math.max(m, -c.x, -c.y, c.x - (width - 1), c.y - (height - 1));
  return Math.min(m, MAX_MARGIN);
}

export function BagGrid(p: Props) {
  const { loadout, issues, selected, hovered } = p;
  const { bag, layout } = loadout;
  const ref = useRef<HTMLDivElement>(null);
  const scope = p.scope ?? 'build';
  const settings = useSettings();
  // The item being held isn't drawn where it was (user, 2026-10-22): only under the pointer and where it lands.
  const held = useDraggedId(scope);
  const isSel = (id: string) => id === selected || !!p.multi?.has(id);
  /** The item a press just selected: its click isn't a second click (that would turn it). */
  const pressed = useRef<string | null>(null);
  /** A Shift+drag selection box (px in the grid), and whether one just ended (its click isn't a click). */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxEnded = useRef(false);
  /** Degrees each item's picture is shown at: always turning clockwise by the short way (so a turn animates). */
  const shownTurn = useRef(new Map<string, number>());
  const turnOf = (id: string, r: number) => {
    const prev = shownTurn.current.get(id);
    const v = prev === undefined ? r : prev + ((((r - prev) % 360) + 360) % 360);
    shownTurn.current.set(id, v);
    return v;
  };
  /** Where the held item would land. */
  const [preview, setPreview] = useState<Landing | null>(null);
  const previewKey = useRef('');
  // Only item cells outside the bag widen the border around it, not dots (turning an item mustn't shift the bag).
  const MARGIN = useMemo(() => marginFor(bag.width, bag.height, [...layout.items.values()].flatMap((i) => i.cells)), [bag, layout]);
  const drawn = (c: Cell) => c.x >= -MARGIN && c.y >= -MARGIN && c.x < bag.width + MARGIN && c.y < bag.height + MARGIN;
  const px = (n: number) => (n + MARGIN) * SIZE;

  const redCells = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const i of issues) if (i.level === 'error' && i.cells) for (const c of i.cells) out.set(cellKey(c), c);
    return [...out.values()];
  }, [issues]);
  const invalidIds = useMemo(() => new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.instanceIds ?? [])), [issues]);

  // Dots of the focused item: hovered, else selected (not while it's held: its dots show where it would land).
  const focus = (hovered ?? selected) === held ? null : (hovered ?? selected);
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
  useDropTarget(ref, {
    accepts: (d) => !p.readOnly && !p.maskEdit && (d.kind === 'placed' ? d.scope === scope : !!p.acceptsNew && (d.kind === 'item' || d.scope === scope)),
    over: (d, x, y) => {
      if (!p.dropTarget) return;
      const c = cellAt(heldCellPoint(d, x, y));
      const key = `${d.kind}:${d.id}:${d.rotation}:${c.x},${c.y}`;
      if (key === previewKey.current) return;
      previewKey.current = key;
      setPreview(p.dropTarget(d, c.x, c.y));
    },
    leave: clearPreview,
    drop: (d, x, y) => {
      clearPreview();
      const c = cellAt(heldCellPoint(d, x, y));
      p.onDrop(d, c.x, c.y);
      ref.current?.focus();
    },
  });

  // A dropped item slides into place: a moved one keeps its id, a new one is selected.
  useLayoutEffect(() => playDrop(ref.current, scope, (d) => (d.kind === 'item' ? selected : d.id)));
  // With turning shown, the focused item's dots swing round with it instead of jumping (user, 2026-10-22).
  const lastTurn = useRef<{ id: string; rotation: number; cx: number; cy: number } | null>(null);
  useLayoutEffect(() => {
    const it = focus ? layout.items.get(focus) : undefined;
    const prev = lastTurn.current;
    if (!it) {
      lastTurn.current = null;
      return;
    }
    const xs = it.cells.map((c) => c.x);
    const ys = it.cells.map((c) => c.y);
    const cx = px((Math.min(...xs) + Math.max(...xs) + 1) / 2);
    const cy = px((Math.min(...ys) + Math.max(...ys) + 1) / 2);
    lastTurn.current = { id: focus!, rotation: it.placement.rotation, cx, cy };
    if (!prev || prev.id !== focus || prev.rotation === it.placement.rotation || !settings.animateRotation || settings.rotationMs <= 0) return;
    const turn = ((((it.placement.rotation - prev.rotation) % 360) + 360) % 360) * (Math.PI / 180);
    const STEPS = 8;
    for (const el of ref.current?.querySelectorAll<HTMLElement>('[data-dot]') ?? []) {
      if (typeof el.animate !== 'function') return;
      const x = parseFloat(el.style.left);
      const y = parseFloat(el.style.top);
      const rx = x - cx;
      const ry = y - cy;
      const frames = Array.from({ length: STEPS + 1 }, (_, k) => {
        const f = k / STEPS;
        const a = -turn * (1 - f);
        // Round the centre as it moves from where it was to where it is, a quarter turn back to none.
        const mx = prev.cx + (cx - prev.cx) * f + rx * Math.cos(a) - ry * Math.sin(a);
        const my = prev.cy + (cy - prev.cy) * f + rx * Math.sin(a) + ry * Math.cos(a);
        return { transform: `translate(${mx - x}px, ${my - y}px) translate(-50%, -50%)` };
      });
      el.animate(frames, { duration: settings.rotationMs, easing: 'ease-in-out' });
    }
  });

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
          onClick={(e) => {
            if (boxEnded.current || e.shiftKey) return;
            if (p.enhanceEdit) p.onToggleEnhanced?.(x, y);
            else if (p.maskEdit) p.onToggleMask(x, y);
            else p.onSelect(null);
          }}
        />,
      );
    }
  }

  const itemCells: ReactElement[] = [];
  const sprites: ReactElement[] = [];
  const copies = copyNumbers(layout);
  for (const [id, item] of layout.items) {
    if (id === held) continue;
    const entry = loadout.entries.get(id);
    const copy = copies.get(id);
    const base = spriteOf(item.def as Parameters<typeof spriteOf>[0], item.placement.rotation);
    const sprite = base ? { ...base, rotation: turnOf(id, item.placement.rotation) } : null;
    if (sprite) sprites.push(<Sprite key={`s${id}`} s={sprite} cells={item.cells} px={px} size={SIZE} z={id === selected ? 4 : 3} item={id} />);
    // Gear shows the rarity it's equipped at (no rarity known → the plain gear colour).
    const color =
      entry?.kind === 'gear'
        ? entry.gearRarity
          ? rarityColor(entry.gearRarity)
          : rarityColor(null, true)
        : rarityColor('rarity' in item.def ? (item.def.rarity as string) : null);
    const paint = rarityPaint(color, { gear: entry?.kind === 'gear', selected: id === selected || id === hovered, picture: !!sprite }, settings);
    const own = new Set(item.cells.map(cellKey));
    const first = [...item.cells].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    if (copy && first) {
      sprites.push(
        <span key={`c${id}`} className="copy-badge" data-item={id} style={{ left: px(first.x) + 2, top: px(first.y) + 2, zIndex: 5 }} title={copyName(String(item.def.name ?? ''), copy)}>
          {copy}
        </span>,
      );
    }
    item.cells.forEach((c, index) => {
      const edge = (dx: number, dy: number) => (own.has(cellKey({ x: c.x + dx, y: c.y + dy })) ? '0' : paint.edge ? '3px' : '2px');
      itemCells.push(
        <div
          key={`i${id}${c.x},${c.y}`}
          data-item={id}
          className={`item-cell${isSel(id) ? ' selected' : ''}${id === hovered ? ' hovered' : ''}${touched.has(id) ? ' touched' : ''}${invalidIds.has(id) ? ' invalid' : ''}${sprite ? ' has-sprite' : ''}`}
          style={{
            left: px(c.x),
            top: px(c.y),
            background: paint.background,
            borderStyle: 'solid',
            borderColor: paint.edge ?? (isSel(id) ? 'white' : 'rgba(0,0,0,0.35)'),
            borderWidth: `${edge(0, -1)} ${edge(1, 0)} ${edge(0, 1)} ${edge(-1, 0)}`,
            zIndex: id === selected ? 2 : 1,
            // While marking enhanced cells, clicks go through to the cell underneath.
            pointerEvents: p.enhanceEdit ? 'none' : undefined,
            outline: enhancedSet.has(`${c.x},${c.y}`) ? `2px dashed ${look?.color ?? '#a78bfa'}` : undefined,
            outlineOffset: -4,
          }}
          title={`${copyName(String(item.def.name ?? ''), copy)}${entry?.supply ? ' (starting equipment)' : ''}${id === selected ? ' · click again to rotate' : ''}`}
          onPointerDown={(e) => {
            if (p.readOnly || p.maskEdit || p.enhanceEdit) return;
            // Selected on the press (user, 2026-10-22): space right away turns this one, not the one before.
            // Pressing one of several selected keeps them all (to drag them together).
            pressed.current = null;
            if (!e.shiftKey && !isSel(id)) {
              pressed.current = id;
              p.onSelect(id);
            }
            const at = cellUnder(e, e.currentTarget);
            beginDrag(e, { kind: 'placed', id, item: item.placement.itemId, rotation: item.placement.rotation, grab: index, inCell: at.inCell, scope });
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dragJustEnded()) return;
            if (e.shiftKey && p.onShiftSelect) {
              p.onShiftSelect(id);
              return;
            }
            if (pressed.current === id) pressed.current = null;
            else if (id === selected && !p.multi) p.onRotate?.(id);
            else p.onSelect(id);
            ref.current?.focus();
          }}
          onMouseEnter={() => p.onHover(id)}
          onMouseLeave={() => p.onHover(null)}
        >
          {c === first && !sprite && <span className="label">{item.def.name}</span>}
        </div>,
      );
    });
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
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          // Shift+drag on the bag (not on an item): a box, and the items it touches are selected.
          if (!e.shiftKey || !p.onBoxSelect || p.readOnly || p.maskEdit || p.enhanceEdit || (e.target as HTMLElement).closest('.item-cell')) return;
          e.preventDefault();
          const r = ref.current!.getBoundingClientRect();
          const x0 = e.clientX - r.left;
          const y0 = e.clientY - r.top;
          setBox({ x0, y0, x1: x0, y1: y0 });
          const move = (ev: PointerEvent) => setBox({ x0, y0, x1: ev.clientX - r.left, y1: ev.clientY - r.top });
          const up = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setBox(null);
            const x1 = ev.clientX - r.left;
            const y1 = ev.clientY - r.top;
            const cx0 = Math.floor(Math.min(x0, x1) / SIZE) - MARGIN;
            const cx1 = Math.floor(Math.max(x0, x1) / SIZE) - MARGIN;
            const cy0 = Math.floor(Math.min(y0, y1) / SIZE) - MARGIN;
            const cy1 = Math.floor(Math.max(y0, y1) / SIZE) - MARGIN;
            const ids = [...layout.items.entries()].filter(([, it]) => it.cells.some((c) => c.x >= cx0 && c.x <= cx1 && c.y >= cy0 && c.y <= cy1)).map(([id]) => id);
            boxEnded.current = true;
            setTimeout(() => (boxEnded.current = false), 0);
            p.onBoxSelect!(ids);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        {box && (
          <div
            className="box-select"
            style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
          />
        )}
        {bgCells}
        {itemCells}
        {sprites}
        {preview?.cells.filter(drawn).map((c) => (
          <div key={`p${c.x},${c.y}`} className={`drop-preview${preview.valid ? '' : ' bad'}`} style={{ left: px(c.x), top: px(c.y) }} />
        ))}
        {/* Where the held item's dots would be: on an item (filled), on an empty cell, or off the bag (user, 2026-10-22). */}
        {preview?.dots?.filter(drawn).map((c, i) => {
          const on = occupantsAt(layout, c.x, c.y).filter((o) => o !== held);
          const status = !isUsable(bag, c.x, c.y) ? 'outside' : on.length ? 'touches' : 'empty';
          return <div key={`pd${i}`} className={`dot ${status} drop-dot`} style={{ left: px(c.x) + SIZE / 2, top: px(c.y) + SIZE / 2 }} />;
        })}
        {p.ghosts?.flatMap((g) => [
          ...g.cells.filter(drawn).map((c) => (
            <div key={`g${g.id}${c.x},${c.y}`} className="spawn-ghost" style={{ left: px(c.x), top: px(c.y), borderColor: g.color }} title={`${g.name}: put here at the start of battle`} />
          )),
          ...(g.sprite ? [<Sprite key={`gs${g.id}`} s={g.sprite} cells={g.cells} px={px} size={SIZE} z={1} item={`ghost:${g.id}`} />] : []),
        ])}
        {redCells.map((c) => (
          <div key={`r${c.x},${c.y}`} className="red-cell" style={{ left: px(c.x), top: px(c.y) }} />
        ))}
        {dots.filter((d) => drawn(d.cell)).map((d, i) => (
          <div
            key={`d${i}`}
            data-dot={i}
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
