/** A small picture of a build's bag (for the build list): its cells and items, nothing to click. */
import { useLayoutEffect, useRef, useState } from 'react';
import { isUsable } from '../../engine/bag';
import type { Loadout } from '../../engine/loadout';
import { Sprite, rarityColor, spriteOf } from './BagGrid';

/** As wide as the space it's in (the build list's cards, user 2026-10-20: no dead space round it), cells of `cell` px until measured. */
export function FitBagPreview({ loadout, cell = 14 }: { loadout: Loadout; cell?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = width > 0 ? Math.max(6, Math.floor(width / loadout.bag.width)) : cell;
  return (
    <div ref={ref} className="bag-preview-fit">
      <BagPreview loadout={loadout} cell={fit} />
    </div>
  );
}

export function BagPreview({ loadout, cell = 14 }: { loadout: Loadout; cell?: number }) {
  const { bag, layout } = loadout;
  const px = (n: number) => n * cell;
  const inBag = (c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x < bag.width && c.y < bag.height;
  const cells = [];
  for (let y = 0; y < bag.height; y++)
    for (let x = 0; x < bag.width; x++) cells.push(<div key={`b${x},${y}`} className={`pv-cell${isUsable(bag, x, y) ? '' : ' off'}`} style={{ left: px(x), top: px(y), width: cell, height: cell }} />);
  const items = [];
  for (const [id, item] of layout.items) {
    const entry = loadout.entries.get(id);
    const color = entry?.kind === 'gear' ? rarityColor(entry.gearRarity ?? null, !entry.gearRarity) : rarityColor('rarity' in item.def ? (item.def.rarity as string) : null);
    const shown = item.cells.filter(inBag);
    for (const c of shown) items.push(<div key={`i${id}${c.x},${c.y}`} className="pv-item" style={{ left: px(c.x), top: px(c.y), width: cell, height: cell, background: color }} />);
    const sprite = spriteOf(item.def as Parameters<typeof spriteOf>[0], item.placement.rotation);
    if (sprite && shown.length === item.cells.length) items.push(<Sprite key={`s${id}`} s={sprite} cells={item.cells} px={px} size={cell} z={2} />);
  }
  return (
    <div className="bag-preview" style={{ width: px(bag.width), height: px(bag.height) }} aria-hidden="true">
      {cells}
      {items}
    </div>
  );
}
