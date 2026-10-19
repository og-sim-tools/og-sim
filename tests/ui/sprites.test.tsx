// @vitest-environment jsdom
/** Item and gear sprites from the wiki: files on disk, and scaling into the bag. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { BagGrid, spriteOf } from '../../src/ui/components/BagGrid';
import { combatData, combatLoadout } from '../combat-fixture';

afterEach(cleanup);
const ROOT = join(__dirname, '..', '..');
const real = loadGameDataFromDir(join(ROOT, 'data')).data;

describe('sprites', () => {
  it('every image the data names exists, at the size it says', () => {
    const defs = [...real.items.values(), ...real.gear.values()].filter((d) => d.image);
    expect(defs.length).toBe(231 + 38); // every item and gear piece
    for (const d of defs) {
      const file = join(ROOT, 'data', 'images', d.image!);
      expect(existsSync(file), d.id).toBe(true);
      const buf = readFileSync(file);
      expect({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }, d.id).toEqual(d.image_size);
    }
  });

  it('scales a sprite to fit its footprint box and turns it with the item', () => {
    const spear = real.items.get('spear')!;
    const s = spriteOf(spear, 90)!;
    expect(s).toMatchObject({ src: '/api/images/items/spear.png', w: 11, h: 47, rotation: 90 });
    expect(s.cellsW * s.cellsH).toBeGreaterThan(0);
  });

  it('draws a placed item with a sprite over its cells', () => {
    const data = combatData([
      { path: 'items/manual/sprite.yaml', text: '- { id: blade, image: items/spear.png, image_size: { w: 11, h: 47 }, source: manual, verified: true }' },
    ]);
    const { container } = render(
      <BagGrid
        loadout={combatLoadout(['blade'], '', data)}
        issues={[]}
        selected={null}
        hovered={null}
        maskEdit={false}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        onToggleMask={vi.fn()}
        onDrop={vi.fn()}
        onKey={vi.fn()}
      />,
    );
    const img = container.querySelector<HTMLImageElement>('.sprite img')!;
    expect(img.getAttribute('src')).toBe('/api/images/items/spear.png');
    // 1×1 footprint, 40 px cells: fit = min(40/11, 40/47), × 0.9 → 47 px tall becomes 36.
    expect(parseFloat(img.style.height)).toBeCloseTo(36);
    expect(container.querySelector('.item-cell.has-sprite')).toBeTruthy();
  });
});

describe('gear icons and auras', () => {
  it('every gear piece has its small icon on disk', () => {
    for (const g of real.gear.values()) expect(existsSync(join(ROOT, 'data', 'images', g.icon ?? 'missing')), g.id).toBe(true);
  });

  it('owned auras add their ownership effect at their star level', async () => {
    const { loadProfile } = await import('../../src/engine/loader');
    const { computeAccountStats } = await import('../../src/engine/accountStats');
    const p = loadProfile(
      { path: 'p.yaml', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nauras: [{ id: aura_of_vitality, stars: 0 }, { id: grace_of_the_goddess, stars: 3 }, { id: judicators_blade, stars: 7 }]\n' },
      real,
    ).profile!;
    const s = computeAccountStats(real, p, null);
    expect(s.detailed).toMatchObject({ hp_pct: 5, final_dmg_boss_increase: 16, final_dmg_pvp_increase: 30 });
    expect(s.hp).toBe(1e6);
  });
});
