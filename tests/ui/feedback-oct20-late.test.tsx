// @vitest-environment jsdom
/**
 * Feedback of 2026-10-20 (late): a held item visibly turns, the rarity colour behind items and gear is a setting,
 * the Build tab's columns swapped, the optimizer asks before replacing an unsaved build, and the Remove overlay
 * covers only the box the held item is over (gaps belong to the nearest box).
 */
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { rarityPaint } from '../../src/ui/components/BagGrid';
import { DragLayer, beginDrag, nearestBox, useDragLook } from '../../src/ui/drag';
import { browserStore, lastBuild } from '../../src/ui/saves';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../../src/ui/settings';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  setSettings({ ...DEFAULT_SETTINGS });
});
const ptr = (el: Element, type: string, x: number, y: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
const data = loadGameDataFromDir(join(ROOT, 'data')).data;
const profile = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: erwen, stars: 3 }]\nactive_hero: erwen\n' }, data).profile!;

describe('the rarity colour behind items and gear', () => {
  it('is a full background, a ring, or nothing, with its own strength normally and when selected', () => {
    const c = 'var(--r-rare)';
    // As before: pictures on a 55% background, full when selected.
    expect(rarityPaint(c, { gear: false, selected: false, picture: true })).toEqual({ background: 'color-mix(in srgb, var(--r-rare) 55%, transparent)', edge: null });
    expect(rarityPaint(c, { gear: false, selected: true, picture: true })).toEqual({ background: c, edge: null });
    setSettings({ itemLook: 'ring', itemOpacity: 40, itemSelectedOpacity: 80 });
    expect(rarityPaint(c, { gear: false, selected: false, picture: true })).toEqual({ background: 'transparent', edge: 'color-mix(in srgb, var(--r-rare) 40%, transparent)' });
    expect(rarityPaint(c, { gear: false, selected: true, picture: true }).edge).toBe('color-mix(in srgb, var(--r-rare) 80%, transparent)');
    // Gear has its own setting.
    expect(rarityPaint(c, { gear: true, selected: false, picture: true }).edge).toBeNull();
    setSettings({ gearLook: 'none' });
    expect(rarityPaint(c, { gear: true, selected: false, picture: true })).toEqual({ background: 'transparent', edge: null });
    // Without a picture the colour is all there is: always full.
    expect(rarityPaint(c, { gear: true, selected: false, picture: false })).toEqual({ background: c, edge: null });
  });

  it('settings are checked when read back', async () => {
    localStorage.setItem('og-sim/settings', JSON.stringify({ itemLook: 'glow', itemOpacity: 250, gearSelectedOpacity: -3 }));
    vi.resetModules();
    const fresh = await import('../../src/ui/settings');
    expect(fresh.getSettings()).toMatchObject({ itemLook: 'full', itemOpacity: 100, gearSelectedOpacity: 0, gearOpacity: 55 });
  });

  it('can be set in the Settings dialog', async () => {
    const store = browserStore(localStorage);
    render(<App store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }, { timeout: 10000 }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.change(within(dialog).getByLabelText('Gear: rarity colour'), { target: { value: 'ring' } });
    fireEvent.change(within(dialog).getByLabelText('Gear: opacity when selected'), { target: { value: '70' } });
    expect(getSettings()).toMatchObject({ gearLook: 'ring', gearSelectedOpacity: 70, itemLook: 'full' });
    fireEvent.change(within(dialog).getByLabelText('Items: rarity colour'), { target: { value: 'none' } });
    expect((within(dialog).getByLabelText('Items: opacity') as HTMLInputElement).disabled).toBe(true);
  }, 30000);
});

describe('turning a held item', () => {
  it('swings it round from where it was, when turning is shown', () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const cellsFor = (r: number) => (r % 180 === 0 ? [{ x: 0, y: 0 }, { x: 1, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: 1 }]);
      function Bag() {
        useDragLook('t', (d) => ({ cells: cellsFor(d.rotation), color: 'red', sprite: null }));
        return <div data-testid="item" onPointerDown={(e) => beginDrag(e, { kind: 'placed', id: 'x', item: 'x', rotation: 0, grab: 0, inCell: { x: 0.5, y: 0.5 }, scope: 't' })} />;
      }
      render(
        <>
          <Bag />
          <DragLayer />
        </>,
      );
      const item = screen.getByTestId('item');
      ptr(item, 'pointerdown', 100, 100);
      ptr(item, 'pointermove', 120, 120);
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
      expect(animate).not.toHaveBeenCalled(); // turning isn't shown by default
      setSettings({ animateRotation: true, rotationMs: 200 });
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
      expect(animate).toHaveBeenCalledTimes(1);
      const [frames, opts] = animate.mock.calls[0]!;
      expect(frames[0].transform).toMatch(/rotate\(-90deg\)/);
      expect(frames[1].transform).toBe('none');
      expect(opts.duration).toBe(200);
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});

describe('the box a held item is over', () => {
  const at = (el: Element, left: number, top: number, w: number, h: number) =>
    (el.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }));
  it('is the one it is in, else the nearest one (gaps belong to a box)', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const inner = document.createElement('span');
    b.append(inner);
    at(a, 0, 0, 100, 100);
    at(b, 300, 0, 100, 100);
    expect(nearestBox([a, b], 50, 50, null)).toBe(a);
    expect(nearestBox([a, b], 180, 50, null)).toBe(a); // nearer a's edge
    expect(nearestBox([a, b], 220, 50, null)).toBe(b);
    expect(nearestBox([a, b], 0, 0, inner)).toBe(b); // what's under the pointer decides first
    // A hidden box (another step on a phone) doesn't count.
    at(a, 0, 0, 0, 0);
    expect(nearestBox([a, b], 0, 0, null)).toBe(b);
  });
});

describe('the Build tab', () => {
  const start = async () => {
    const store = browserStore(localStorage);
    await store.writeAccount('version: 4\nheroes: [{ id: erwen, stars: 9 }]\n');
    await store.writeBuild('bows', 'version: 4\nhero: erwen\nplacements: []\n');
    lastBuild.set('bows');
    render(<App store={store} />);
    await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
  };
  const pick = (name: string) => {
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: name } });
    const row = [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('.name')?.textContent === name)!;
    ptr(row, 'pointerdown', 0, 0);
    ptr(row, 'pointerup', 0, 0);
    fireEvent.click(row);
  };
  const cellsOf = (name: string) => [...screen.getByRole('grid', { name: 'Backpack' }).querySelectorAll<HTMLElement>('.item-cell')].filter((c) => c.title.startsWith(name));

  it('has hero, gear, pets and skins on the left and the items on the right', async () => {
    await start();
    const page = document.querySelector('.main.build')!;
    expect(page.querySelector('.build-setup [data-tour="battle.hero"]')).toBeTruthy();
    expect(page.querySelector('.build-items [data-tour="battle.items"]')).toBeTruthy();
    expect(page.querySelector('.build-bag .bag-box')).toBeTruthy();
    expect(screen.getByText(/Click an item on the right to put it in the bag/)).toBeTruthy();
  }, 30000);

  it('shows Remove item only over a box other than the Bag box, and dropping in any of them removes the item', async () => {
    await start();
    pick("Hunter's Bow");
    const hero = document.querySelector('[data-tour="battle.hero"]')!;
    ptr(cellsOf("Hunter's Bow")[0]!, 'pointerdown', 5, 5);
    // Over the bag's own box: nothing to remove.
    ptr(document.querySelector('.bag-status')!, 'pointermove', 10, 10);
    expect(screen.queryByText('Remove item')).toBeNull();
    // Over the Hero box: it says so, and dropping there removes the bow.
    ptr(hero, 'pointermove', 20, 20);
    expect(screen.getByText('Remove item')).toBeTruthy();
    ptr(hero, 'pointerup', 20, 20);
    expect(cellsOf("Hunter's Bow")).toHaveLength(0);
    expect(screen.queryByText('Remove item')).toBeNull();
  }, 30000);
});

describe('the optimizer', () => {
  it('asks before a new run replaces a build that was not taken into the Build tab', async () => {
    const { OptimizePanel } = await import('../../src/ui/components/OptimizePanel');
    const mine = LayoutSchema.parse({ placements: [{ id: 'b1', item: 'hunters_bow', x: 0, y: 0 }], battle: { mode: 'arena', seed: 1, runs: 1 } });
    const myLo = buildLoadout(data, profile, mine);
    const foe = { profile, placements: [{ id: 'f1', item: 'hunters_bow', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    const onApply = vi.fn();
    render(<OptimizePanel data={data} profile={profile} layout={mine} layoutName="mine" loadout={myLo} layouts={['foe']} layoutAsBuild={vi.fn(async () => foe)} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Builds to try'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Seeds per opponent'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /foe/ }));
    const runButton = () => screen.getByRole('button', { name: 'Test my build' });
    fireEvent.click(runButton());
    await screen.findByText('Builds tried (1)', {}, { timeout: 10000 });
    // Only my own build so far: nothing to lose, no question.
    fireEvent.click(runButton());
    expect(screen.queryByRole('dialog', { name: 'Replace the last results?' })).toBeNull();
    await screen.findByText('Builds tried (1)', {}, { timeout: 10000 });
    // An edit that isn't taken into the Build tab: asked first; Cancel keeps it.
    const bow = [...document.querySelectorAll<HTMLElement>('.item-cell')].find((c) => c.title.startsWith("Hunter's Bow"))!;
    fireEvent.click(bow);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(screen.getByText(/edited, not tested yet/)).toBeTruthy();
    fireEvent.click(runButton());
    const dialog = screen.getByRole('dialog', { name: 'Replace the last results?' });
    expect(dialog.textContent).toMatch(/Your edited build isn't saved/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/edited, not tested yet/)).toBeTruthy();
    // Taken into the Build tab: no question.
    fireEvent.click(screen.getByRole('button', { name: 'Use this build' }));
    expect(onApply).toHaveBeenCalled();
    fireEvent.click(runButton());
    expect(screen.queryByRole('dialog', { name: 'Replace the last results?' })).toBeNull();
  }, 30000);
});
