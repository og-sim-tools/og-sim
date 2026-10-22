// @vitest-environment jsdom
/**
 * Feedback of 2026-10-22: gear swaps take the old piece's place, the bag follows the hero's class, no Rotate /
 * Remove buttons, a click anywhere lets go, the search box selects its text, Ctrl+C/D/X/Z, Clear all, the Fight
 * button (waiting for an opponent), the Battle tab's Edit browser, random seeds, forcing skins in the optimizer,
 * pet spawns shown over the bag, and dragging (nearest tiles, the original hidden, dots where it lands).
 */
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { freshSeed } from '../../src/engine/rng';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { heldCellPoint } from '../../src/ui/drag';
import { browserStore, lastBuild } from '../../src/ui/saves';
import { DEFAULT_SETTINGS, setSettings } from '../../src/ui/settings';
import { landing } from '../../src/ui/state/bagEdit';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  setSettings({ ...DEFAULT_SETTINGS });
});
const ptr = (el: Element, type: string, x: number, y: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
const data = loadGameDataFromDir(join(ROOT, 'data')).data;

const start = async (account = 'version: 4\nheroes: [{ id: erwen, stars: 9 }, { id: venom, stars: 9 }]\n', build = 'version: 4\nhero: erwen\nplacements: []\n') => {
  const store = browserStore(localStorage);
  await store.writeAccount(account);
  await store.writeBuild('bows', build);
  lastBuild.set('bows');
  render(<App store={store} />);
  await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
  return store;
};
const pick = (name: string) => {
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: name } });
  const row = [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('.name')?.textContent === name)!;
  ptr(row, 'pointerdown', 0, 0);
  ptr(row, 'pointerup', 0, 0);
  fireEvent.click(row);
};
const cellsOf = (name: string) => [...screen.getByRole('grid', { name: 'Backpack' }).querySelectorAll<HTMLElement>('.item-cell')].filter((c) => c.title.startsWith(name));
const key = (k: string, extra: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, ...extra })));

describe('engine and data', () => {
  it('Crit Rate has no cap: over 100% every hit crits once, and what scales with it keeps growing', () => {
    expect(data.config!.combat.crit_rate_cap_pct).toBeNull();
    expect(data.config!.combat.status_crit_rate_cap_pct).toBeNull();
  });

  it('Widow Spider is ## / ## / oo (user, 2026-10-22)', () => {
    const w = data.items.get('widow_spider')!;
    expect(w.footprint).toBe('## / ## / oo');
  });

  it('fresh seeds are whole numbers that change', () => {
    const a = freshSeed();
    const b = freshSeed();
    expect(Number.isInteger(a) && a > 0).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('dragging', () => {
  it('an item lands in the tiles nearest to where it is drawn, wherever it is held', () => {
    const lo = buildLoadout(data, loadProfile({ path: 'p', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }' }, data).profile!, LayoutSchema.parse({ placements: [] }));
    // Held near the right edge of its cell, with the pointer just into cell 3: the cell is drawn mostly over cell 2.
    const d = { kind: 'item' as const, id: 'rock', item: 'rock', rotation: 0 as const, grab: 0, inCell: { x: 0.9, y: 0.5 }, scope: 'build' };
    const pt = heldCellPoint(d, 3 * 40 + 6, 20);
    expect(Math.floor(pt.clientX / 40)).toBe(2);
    const at = landing(lo, d, 2, 0)!;
    expect(at.dots).toBeDefined();
  });

  it("the held item isn't drawn where it was, and its dots show where it would land", async () => {
    await start();
    pick('Widow Spider');
    const grid = screen.getByRole('grid', { name: 'Backpack' });
    ptr(cellsOf('Widow Spider')[0]!, 'pointerdown', 5, 5);
    ptr(grid, 'pointermove', 40 * 4 + 20, 40 * 2 + 20);
    const hidden = cellsOf('Widow Spider').length;
    const previews = grid.querySelectorAll('.drop-preview').length;
    const dots = grid.querySelectorAll('.drop-dot').length;
    ptr(grid, 'pointerup', 40 * 4 + 20, 40 * 2 + 20);
    expect(hidden).toBe(0);
    expect(previews).toBe(4);
    expect(dots).toBe(2);
    expect(cellsOf('Widow Spider')).toHaveLength(4);
  }, 30000);
});

describe('the Build tab', () => {
  it('has no Rotate or Remove buttons; a click anywhere else lets go of the item', async () => {
    await start();
    pick("Hunter's Bow");
    expect(cellsOf("Hunter's Bow")[0]!.className).toMatch(/selected/);
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    // Outside the bag box (the Hero box).
    fireEvent.click(document.querySelector('[data-tour="battle.hero"]')!);
    expect(cellsOf("Hunter's Bow")[0]!.className).not.toMatch(/selected/);
  }, 30000);

  it('the item search selects its text when entered', async () => {
    await start();
    const box = screen.getByLabelText('Search items') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'bow' } });
    box.setSelectionRange(3, 3);
    fireEvent.focus(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 3]);
  }, 30000);

  it('Ctrl+D / Ctrl+C copy the selected item, Ctrl+X removes it, Ctrl+Z undoes', async () => {
    await start();
    pick('Rock');
    const rocks = () => cellsOf('Rock').length;
    expect(rocks()).toBe(1);
    key('d');
    expect(rocks()).toBe(2);
    key('c');
    expect(rocks()).toBe(3);
    key('x');
    expect(rocks()).toBe(2);
    key('z');
    expect(rocks()).toBe(3);
    key('z');
    key('z');
    expect(rocks()).toBe(1);
    // Not while typing in a field.
    fireEvent.click(cellsOf('Rock')[0]!);
    act(() => void screen.getByLabelText('Search items').dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true })));
    expect(rocks()).toBe(1);
  }, 30000);

  it('Clear all empties the bag after asking (Ctrl+Z brings it back)', async () => {
    await start();
    pick('Rock');
    pick("Hunter's Bow");
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear the bag?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('grid', { name: 'Backpack' }).querySelectorAll('.item-cell')).toHaveLength(0);
    key('z');
    expect(cellsOf('Rock').length).toBe(1);
  }, 30000);

  it('a new gear piece takes the old one\'s place in the bag', async () => {
    await start();
    fireEvent.change(screen.getByLabelText('weapon 1'), { target: { value: 'spiral_spear' } });
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-tour="battle.gear"]')!).getByRole('button', { name: 'Place' }));
    expect(cellsOf('Spiral Spear').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('weapon 1'), { target: { value: 'elderwood_bow' } });
    await waitFor(() => expect(cellsOf('Elderwood Bow').length).toBeGreaterThan(0));
    expect(cellsOf('Spiral Spear')).toHaveLength(0);
  }, 30000);

  it("a hero of another class: a class bag becomes that class's bag of the same size", async () => {
    const other = [...data.heroes.values()].find((h) => h.class !== data.heroes.get('erwen')!.class)!;
    await start(`version: 4
heroes: [{ id: erwen, stars: 9 }, { id: ${other.id}, stars: 9 }]
`);
    fireEvent.change(screen.getByLabelText('Bag size'), { target: { value: 'x32' } });
    const shape = () => [...document.querySelectorAll('.bag .cell')].map((c) => (c.classList.contains('off') ? 0 : 1)).join('');
    const before = shape();
    fireEvent.change(screen.getByLabelText('Hero for this build'), { target: { value: other.id } });
    await waitFor(() => expect((screen.getByLabelText('Bag size') as HTMLSelectElement).value).toBe('x32'));
    expect(shape()).not.toBe(before); // the other class's x32 is shaped differently
  }, 30000);

  it('shows where pets put their items when asked', async () => {
    await start('version: 4\nheroes: [{ id: erwen, stars: 9 }]\npets: [{ id: venomous_spider, stars: 0 }]\n', 'version: 6\nhero: erwen\npets: [{ id: venomous_spider, active: true }]\nplacements: []\n');
    expect(document.querySelectorAll('.spawn-ghost')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/Show pet spawns \(12\)/));
    expect(document.querySelectorAll('.spawn-ghost').length).toBeGreaterThan(0);
  }, 30000);
});

describe('Fight from the Build tab', () => {
  it('goes to the Battle tab; with no opponent it asks for one, then fights as soon as one is picked', async () => {
    await start();
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Arena' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    fireEvent.click(screen.getByRole('button', { name: /Fight/ }));
    expect(await screen.findByText(/No enemy selected/)).toBeTruthy();
    expect(document.querySelector('.need-enemy')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Opponent build'), { target: { value: 'copy' } });
    await waitFor(() => expect(screen.queryByText(/No enemy selected/)).toBeNull(), { timeout: 10000 });
    await waitFor(() => expect(document.querySelector('.battle-fight')!.textContent).toMatch(/won|lost|draw|Winner|HP/i), { timeout: 10000 });
  }, 40000);

  it("the Battle tab's Edit opens the item browser; it adds to the bag here and closes on a run", async () => {
    await start();
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    const me = document.querySelector<HTMLElement>('[data-tour="battle.me"]')!;
    fireEvent.click(within(me).getByRole('button', { name: 'Edit' }));
    const browser = me.querySelector('.battle-browser')!;
    expect(browser).toBeTruthy();
    fireEvent.change(within(browser as HTMLElement).getByLabelText('Search items'), { target: { value: 'Rock' } });
    const row = [...browser.querySelectorAll('.list-row')].find((r) => r.querySelector('.name')?.textContent === 'Rock')!;
    fireEvent.click(row);
    expect(within(me).getByText(/not in your build yet/)).toBeTruthy();
    // Leaving the tab closes it.
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    expect(me.querySelector('.battle-browser')).toBeNull();
  }, 30000);

  it('every battle has a dice button for a new seed, and can pick one each run', async () => {
    await start();
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    const seed = screen.getAllByLabelText('Seed')[0] as HTMLInputElement;
    const was = seed.value;
    fireEvent.click(screen.getAllByRole('button', { name: 'New random seed' })[0]!);
    await waitFor(() => expect((screen.getAllByLabelText('Seed')[0] as HTMLInputElement).value).not.toBe(was));
    expect(screen.getAllByLabelText(/new seed each run/).length).toBeGreaterThan(0);
  }, 30000);
});

describe('feedback of 2026-10-22, later', () => {
  it('copying with no room puts the copy right over the original (no warning)', async () => {
    await start('version: 4\nheroes: [{ id: erwen, stars: 9 }]\n', 'version: 4\nhero: erwen\nbag: { mask: [1,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0] }\nplacements: [{ id: "rock#1", item: rock, x: 0, y: 0 }]\n');
    fireEvent.click(cellsOf('Rock')[0]!);
    key('d');
    expect(cellsOf('Rock')).toHaveLength(2);
    expect(cellsOf('Rock').map((c) => c.style.left)).toEqual([cellsOf('Rock')[0]!.style.left, cellsOf('Rock')[0]!.style.left]);
    expect(document.body.textContent).not.toMatch(/No room for/);
  }, 30000);

  it('pressing another item selects it at once: space then turns that one', async () => {
    await start();
    pick('Rock');
    pick("Hunter's Bow");
    const rock = cellsOf('Rock')[0]!;
    ptr(rock, 'pointerdown', 5, 5);
    expect(cellsOf('Rock')[0]!.className).toMatch(/selected/);
    // Its click after the press doesn't turn it too.
    ptr(rock, 'pointerup', 5, 5);
    fireEvent.click(rock);
    expect(cellsOf('Rock')[0]!.className).toMatch(/selected/);
    const bowTurn = cellsOf("Hunter's Bow").map((c) => c.style.left).join();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Backpack' }), { key: ' ' });
    expect(cellsOf("Hunter's Bow").map((c) => c.style.left).join()).toBe(bowTurn);
  }, 30000);

  it('gear goes in even with no room: a swap keeps the old spot, Place overlaps (no warning)', async () => {
    const one = 'bag: { mask: [1,1,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0] }\n';
    await start('version: 4\nheroes: [{ id: erwen, stars: 9 }]\n', `version: 4\nhero: erwen\n${one}placements: [{ id: "rock#1", item: rock, x: 0, y: 0 }, { id: "rock#2", item: rock, x: 1, y: 0 }]\n`);
    fireEvent.change(screen.getByLabelText('weapon 1'), { target: { value: 'spiral_spear' } });
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-tour="battle.gear"]')!).getByRole('button', { name: 'Place' }));
    expect(cellsOf('Spiral Spear').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/No room for/);
    const spot = cellsOf('Spiral Spear').map((c) => `${c.style.left},${c.style.top}`)[0];
    fireEvent.change(screen.getByLabelText('weapon 1'), { target: { value: 'elderwood_bow' } });
    await waitFor(() => expect(cellsOf('Elderwood Bow').length).toBeGreaterThan(0));
    expect(cellsOf('Spiral Spear')).toHaveLength(0);
    expect(cellsOf('Elderwood Bow').map((c) => `${c.style.left},${c.style.top}`)).toContain(spot);
    expect(document.body.textContent).not.toMatch(/No room for/);
  }, 30000);

  it('Shift+click adds items to the selection; they move, copy and go together', async () => {
    await start();
    pick('Rock');
    pick("Hunter's Bow");
    fireEvent.click(cellsOf('Rock')[0]!, { shiftKey: true });
    expect(screen.getByText(/2 items selected/)).toBeTruthy();
    expect(cellsOf('Rock')[0]!.className).toMatch(/selected/);
    expect(cellsOf("Hunter's Bow")[0]!.className).toMatch(/selected/);
    key('d');
    expect(cellsOf('Rock')).toHaveLength(2);
    expect(cellsOf("Hunter's Bow").length).toBeGreaterThan(2);
    key('x');
    expect(cellsOf('Rock')).toHaveLength(1);
    // Shift+click again takes one out.
    fireEvent.click(cellsOf('Rock')[0]!);
    fireEvent.click(cellsOf("Hunter's Bow")[0]!, { shiftKey: true });
    fireEvent.click(cellsOf("Hunter's Bow")[0]!, { shiftKey: true });
    expect(screen.queryByText(/items selected/)).toBeNull();
  }, 30000);

  it('Shift+drag a box over the bag selects the items it touches', async () => {
    await start();
    pick('Rock');
    pick("Hunter's Bow");
    const grid = screen.getByRole('grid', { name: 'Backpack' });
    fireEvent(grid, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey: true, clientX: 0, clientY: 0, button: 0 }));
    expect(grid.querySelector('.box-select')).toBeTruthy();
    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40 * 9, clientY: 40 * 7 })));
    expect(screen.getByText(/2 items selected/)).toBeTruthy();
  }, 30000);

  it('typing anywhere goes to the item search, replacing what was there', async () => {
    await start();
    const box = screen.getByLabelText('Search items') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'bow' } });
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })));
    expect(box.value).toBe('r');
    expect(document.activeElement).toBe(box);
  }, 30000);
});
