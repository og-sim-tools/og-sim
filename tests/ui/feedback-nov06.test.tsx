// @vitest-environment jsdom
/**
 * Feedback of 2026-11-06: copies keep their rotation, changing a gear piece changes the Gear box too, New build can
 * copy the open build, Shift works from an item (a click toggles it, a drag draws the box), and the Bag box no
 * longer shows the cell count.
 */
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataDir } from '../../src/engine/loader-node';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { browserStore, lastBuild } from '../../src/ui/saves';
import { DEFAULT_SETTINGS, setSettings } from '../../src/ui/settings';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  setSettings({ ...DEFAULT_SETTINGS });
});
const ptr = (el: Element, type: string, x: number, y: number, extra: MouseEventInit = {}) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
const ACCOUNT = 'version: 8\nheroes: [{ id: erwen, stars: 9 }]\n';
const start = async (build = 'version: 8\nhero: erwen\nplacements: []\n') => {
  const store = browserStore(localStorage);
  await store.writeAccount(ACCOUNT);
  await store.writeBuild('bows', build);
  lastBuild.set('bows');
  render(<App store={store} />);
  await screen.findByLabelText('Hero for this build', {}, { timeout: 25000 });
  return store;
};
const grid = () => screen.getByRole('grid', { name: 'Backpack' });
const cellsOf = (name: string) => [...grid().querySelectorAll<HTMLElement>('.item-cell')].filter((c) => c.title.startsWith(name));
/** Each placed item's footprint (cells relative to its top-left), by instance id. */
const shapes = () => {
  const by = new Map<string, { x: number; y: number }[]>();
  for (const c of grid().querySelectorAll<HTMLElement>('.item-cell')) {
    const list = by.get(c.dataset.item!) ?? [];
    list.push({ x: parseFloat(c.style.left), y: parseFloat(c.style.top) });
    by.set(c.dataset.item!, list);
  }
  return [...by.entries()].map(([id, cs]) => {
    const x0 = Math.min(...cs.map((c) => c.x));
    const y0 = Math.min(...cs.map((c) => c.y));
    return { id, shape: cs.map((c) => `${c.x - x0},${c.y - y0}`).sort().join(' ') };
  });
};
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true })));

describe('feedback 2026-11-06', () => {
  it('Ctrl+D: the copy is turned like the original', async () => {
    await start('version: 8\nhero: erwen\nplacements: [{ id: "hunters_bow#1", item: hunters_bow, x: 0, y: 0, rotation: 90 }]\n');
    fireEvent.click(cellsOf("Hunter's Bow")[0]!);
    key('d');
    const s = shapes();
    expect(s).toHaveLength(2);
    expect(s[1]!.shape).toBe(s[0]!.shape);
  }, 45000);

  it('changing a placed gear piece changes the Gear box too, not only the bag', async () => {
    await start('version: 8\nhero: erwen\ngear: { weapon: { id: spiral_spear, rarity: common, tier: 0, level: 1 } }\nplacements: [{ id: "spiral_spear#1", item: spiral_spear, x: 0, y: 0 }]\n');
    const select = screen.getByLabelText('weapon 1') as HTMLSelectElement;
    expect(select.value).toBe('spiral_spear');
    fireEvent.change(select, { target: { value: 'elderwood_bow' } });
    await waitFor(() => expect(cellsOf('Elderwood Bow').length).toBeGreaterThan(0));
    expect(cellsOf('Spiral Spear')).toHaveLength(0);
    expect((screen.getByLabelText('weapon 1') as HTMLSelectElement).value).toBe('elderwood_bow');
  }, 45000);

  it('New build can copy the open build (unsaved changes included) into the temp build; the saved one stays', async () => {
    const store = await start('version: 8\nhero: erwen\nplacements: [{ id: "rock#1", item: rock, x: 0, y: 0 }]\n');
    // An unsaved change: a second rock.
    fireEvent.click(cellsOf('Rock')[0]!);
    key('d');
    expect(cellsOf('Rock')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'New build' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Start a new build?' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Copy this build' }));
    expect(cellsOf('Rock')).toHaveLength(2);
    expect(document.querySelector('.picker-button')!.textContent).toMatch(/Temp build/);
    expect(await store.readBuild('bows')).not.toMatch(/rock#2/);
    // Empty bag is still there as the other choice.
    fireEvent.click(screen.getByRole('button', { name: 'New build' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Start a new build?' })).getByRole('button', { name: /New build|Start one/ }));
    expect(cellsOf('Rock')).toHaveLength(0);
  }, 45000);

  it('Shift on an item: a click adds it to the selection (or takes it out), a drag draws the selection box', async () => {
    await start('version: 8\nhero: erwen\nplacements: [{ id: "rock#1", item: rock, x: 0, y: 0 }, { id: "rock#2", item: rock, x: 3, y: 0 }]\n');
    const [a] = cellsOf('Rock');
    fireEvent.click(a!);
    const b = cellsOf('Rock').find((c) => c.dataset.item === 'rock#2')!;
    // A real Shift+click: press, release, click. No drag starts.
    ptr(b, 'pointerdown', 5, 5, { shiftKey: true });
    expect(document.querySelector('.drag-layer .held, .held-item')).toBeNull();
    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 6, clientY: 6, shiftKey: true })));
    fireEvent.click(b, { shiftKey: true });
    expect(screen.getByText(/2 items selected/)).toBeTruthy();
    // Shift+click it again: out.
    ptr(b, 'pointerdown', 5, 5, { shiftKey: true });
    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 5, shiftKey: true })));
    fireEvent.click(b, { shiftKey: true });
    expect(screen.queryByText(/items selected/)).toBeNull();
    // Shift+drag starting on an item: the box.
    ptr(cellsOf('Rock')[0]!, 'pointerdown', 0, 0, { shiftKey: true });
    expect(grid().querySelector('.box-select')).toBeTruthy();
    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40 * 9, clientY: 40 * 7 })));
    expect(screen.getByText(/2 items selected/)).toBeTruthy();
  }, 45000);

  it("the Bag box doesn't show the cell count (the size menu does)", async () => {
    await start();
    const box = document.querySelector<HTMLElement>('[data-tour="battle.bag"]')!;
    expect(box.textContent).not.toMatch(/\d+ cells/);
    expect(box.textContent).toMatch(/0 placed/);
  }, 45000);
});
