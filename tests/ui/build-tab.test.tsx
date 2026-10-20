// @vitest-environment jsdom
/**
 * The Build tab (2026-10-19): items go straight into the bag, a second click rotates, Item details opens the
 * stats, a storage box and a bin beside the bag, items can't leave the bag by more than 4 cells, class bag
 * sizes, enhanced slots by hero skill, the Sort menu, filters on starting equipment, and the Battle tab.
 */
import { join } from 'node:path';
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { availableSupplies } from '../../src/engine/validate';
import { readBuild, writeBuild } from '../../src/engine/saves';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { ItemBrowser } from '../../src/ui/components/ItemBrowser';
import { browserStore, lastBuild } from '../../src/ui/saves';
import { bagSizesFor, enhancerOf, sizeMask, sizeOf } from '../../src/ui/state/bagSizes';
import { sortEntries } from '../../src/ui/state/browser';
import { REACH, addStored, fromStorage, layoutToYaml, reachShift, removeStored, toStorage, updateStored, withIds } from '../../src/ui/state/layoutOps';

afterEach(cleanup);
/** A pointer event at (x, y) (jsdom has no PointerEvent; React only looks at the type). */
const ptr = (el: Element, type: string, x: number, y: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
beforeEach(() => localStorage.clear());
const data = loadGameDataFromDir(join(ROOT, 'data')).data;
const profile = (text: string) => loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\n${text}` }, data).profile!;

describe('storage beside the bag, and the 4-cell reach', () => {
  const l = withIds(LayoutSchema.parse({ placements: [{ item: 'hunters_bow', x: 0, y: 0, rotation: 90, supply: true }], storage: [{ item: 'black_bow', x: 0.2, y: 0.5 }] }));
  const bow = l.placements[0]!.id;

  it('items move between the bag and the storage keeping their id, rotation and starting-equipment mark', () => {
    expect(l.storage![0]!.id).toBe('black_bow#1');
    const stored = toStorage(l, bow, 0.5, 2);
    expect(stored.placements).toEqual([]);
    expect(stored.storage!.find((s) => s.id === bow)).toEqual({ id: bow, item: 'hunters_bow', x: 0.5, y: 1, rotation: 90, supply: true });
    const back = fromStorage(stored, bow, 3, 4);
    expect(back.placements).toEqual([{ id: bow, item: 'hunters_bow', x: 3, y: 4, rotation: 90, supply: true }]);
    expect(back.storage!.map((s) => s.id)).toEqual(['black_bow#1']);
    const added = addStored(back, 'hunters_bow', -1, 0.3);
    expect(added.id).toBe('hunters_bow#2'); // unique across the bag and the storage
    expect(added.layout.storage!.at(-1)).toMatchObject({ x: 0, y: 0.3 });
    expect(updateStored(added.layout, added.id, { rotation: 180 }).storage!.at(-1)!.rotation).toBe(180);
    expect(removeStored(removeStored(added.layout, added.id), 'black_bow#1').storage).toBeUndefined();
  });

  it('is saved with the build', () => {
    const r = readBuild(writeBuild(l));
    expect(r.notes).toEqual([]);
    expect(r.layout.storage).toEqual([{ id: 'black_bow#1', item: 'black_bow', x: 0.2, y: 0.5, rotation: 0, supply: false }]);
    expect(LayoutSchema.parse(parse(layoutToYaml(l))).storage).toEqual(r.layout.storage);
  });

  it('nothing goes further than 4 cells outside the bag', () => {
    expect(REACH).toBe(4);
    const bag = { width: 8, height: 6 };
    expect(reachShift([{ x: 2, y: 3 }], bag)).toEqual({ dx: 0, dy: 0 });
    expect(reachShift([{ x: -4, y: 9 }], bag)).toEqual({ dx: 0, dy: 0 });
    expect(reachShift([{ x: -6, y: 0 }, { x: -5, y: 0 }], bag)).toEqual({ dx: 2, dy: 0 });
    expect(reachShift([{ x: 0, y: 10 }, { x: 0, y: 12 }], bag)).toEqual({ dx: 0, dy: -3 });
    expect(reachShift([{ x: 13, y: -7 }], bag)).toEqual({ dx: -2, dy: 3 });
  });
});

describe('bag sizes by class', () => {
  it("every class has its x26, x32 and x38 besides the full bag, with that many cells", () => {
    for (const cls of ['ranger', 'warrior', 'wizard']) {
      const sizes = bagSizesFor(data, cls);
      expect(sizes.map((s) => s.name), cls).toEqual(['Full', 'x26', 'x32', 'x38']);
      for (const s of sizes.slice(1)) {
        expect(s.mask!.filter(Boolean).length, `${cls} ${s.name}`).toBe(Number(s.name.slice(1)));
        expect(s.mask!.length % 8).toBe(0);
        expect(sizeOf(s.mask!, sizes)).toBe(s.name);
      }
    }
    expect(bagSizesFor(data, null).map((s) => s.name)).toEqual(['Full']);
    expect(sizeOf(undefined, bagSizesFor(data, 'ranger'))).toBe('Full');
    expect(sizeOf([1, 0, 1], bagSizesFor(data, 'ranger'))).toBeNull();
  });

  it('narrower rows are centred in the 8 columns', () => {
    expect(sizeMask(['..##..'])).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
    expect(sizeMask(['########'])).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('enhanced slots belong to the hero skill that made them', () => {
  it("Cecilia's Instant Casting is green and 1 slot; Venom's Poison Coating is purple and 2; other heroes have none", () => {
    const p = profile('heroes: [{ id: cecilia, stars: 4 }, { id: venom, stars: 8 }, { id: lua, stars: 9, links: [poison_coating] }, { id: raven, stars: 1 }]');
    expect(enhancerOf(data, p, 'cecilia')).toEqual({ skill: 'Instant Casting', count: 1, color: '#22c55e', label: expect.stringMatching(/spells/) });
    expect(enhancerOf(data, p, 'venom')).toEqual({ skill: 'Poison Coating', count: 2, color: '#a78bfa', label: expect.stringMatching(/Poison/) });
    // A linked skill counts too.
    expect(enhancerOf(data, p, 'lua')?.skill).toBe('Poison Coating');
    expect(enhancerOf(data, p, 'raven')).toBeNull();
  });
});

describe('the item list', () => {
  it('sorts by name, by value (cheapest first, unknown last) and by rarity (common first)', () => {
    const e = [
      { name: 'b', value: 5, rarity: 'epic' },
      { name: 'a', value: null, rarity: 'common' },
      { name: 'c', value: 1, rarity: 'legendary' },
      { name: 'd', value: 5, rarity: 'common' },
    ];
    expect(sortEntries(e, 'name').map((x) => x.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortEntries(e, 'value').map((x) => x.name)).toEqual(['c', 'b', 'd', 'a']);
    expect(sortEntries(e, 'rarity').map((x) => x.name)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('the Sort menu: rarity sorts common → legendary; its side menu shows one rarity only', () => {
    const { container } = render(<ItemBrowser data={data} supplyIds={new Set()} onPick={vi.fn()} onEdit={vi.fn()} />);
    const byName = new Map([...data.items.values()].map((i) => [i.name, i]));
    const rarities = () => [...container.querySelectorAll('.list-row')].map((r) => byName.get(r.querySelector('.name')!.textContent!)?.rarity);
    expect(container.textContent).not.toMatch(/Primal Flame/); // gear isn't listed
    fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Rarity (common → legendary)' }));
    const order = rarities();
    expect(order[0]).toBe('common');
    expect(order.at(-1)).toBe('legendary');
    fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    fireEvent.mouseEnter(screen.getByRole('menuitemradio', { name: 'Rarity (common → legendary)' }).parentElement!);
    fireEvent.click(within(screen.getByRole('menu', { name: 'Rarity' })).getByRole('menuitemradio', { name: /Epic only/ }));
    expect(new Set(rarities())).toEqual(new Set(['epic']));
    expect(screen.getByRole('button', { name: 'Sort: Epic only' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Value (low → high)' }));
    const values = [...container.querySelectorAll('.list-row')].map((r) => r.querySelector('.small.muted')?.textContent);
    const known = values.filter((v) => v !== '?').map(Number);
    expect(known).toEqual([...known].sort((a, b) => a - b));
  });

  it('starting equipment has the same search and filters', () => {
    const p = profile('heroes: [{ id: erwen, stars: 9 }, { id: lua, stars: 9 }]\nactive_hero: erwen');
    const lo = buildLoadout(data, p, LayoutSchema.parse({ placements: [] }));
    const available = availableSupplies(lo);
    render(<ItemBrowser data={data} supplyIds={new Set()} onPick={vi.fn()} onEdit={vi.fn()} starting={{ heroName: 'Erwen', used: 0, capacity: 20, available, inBag: new Set(), onAdd: vi.fn() }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Starting equipment/ }));
    const rows = () => screen.queryAllByRole('button').filter((b) => b.classList.contains('list-row'));
    expect(rows().length).toBe(available.length);
    const tag = available[0]!.item.tags[0]!;
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: tag } });
    expect(rows().length).toBe(available.filter((a) => a.item.tags.includes(tag)).length);
    fireEvent.change(screen.getByLabelText('Search starting equipment'), { target: { value: 'zzzz' } });
    expect(rows().length).toBe(0);
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
    return store;
  };
  const pick = (name: string) => {
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: name } });
    const row = [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('.name')?.textContent === name)!;
    // As in a browser: a press, then the click.
    ptr(row, 'pointerdown', 0, 0);
    ptr(row, 'pointerup', 0, 0);
    fireEvent.click(row);
  };
  // The Build tab's bag (the Battle tab, kept mounted but hidden, shows the same build).
  const cellsOf = (name: string) => [...screen.getByRole('grid', { name: 'Backpack' }).querySelectorAll<HTMLElement>('.item-cell')].filter((c) => c.title.startsWith(name));

  it("clicking an item puts it straight in the first free spot and selects it; Item details opens its stats; a click elsewhere in the box lets go", async () => {
    await start();
    pick("Hunter's Bow");
    expect(cellsOf("Hunter's Bow").length).toBeGreaterThan(0);
    expect(cellsOf("Hunter's Bow")[0]!.className).toMatch(/selected/);
    expect(screen.queryByRole('complementary', { name: 'Item details' })).toBeNull(); // no stats until asked
    fireEvent.click(screen.getByRole('button', { name: 'Item details' }));
    expect(screen.getByRole('complementary', { name: 'Item details' })).toBeTruthy();
    // Clicking the selected item again rotates it.
    const before = cellsOf("Hunter's Bow").map((c) => `${c.style.left},${c.style.top}`).join(' ');
    fireEvent.click(cellsOf("Hunter's Bow")[0]!);
    const after = cellsOf("Hunter's Bow").map((c) => `${c.style.left},${c.style.top}`).join(' ');
    expect(after).not.toBe(before);
    // A click on the box (not an item or a control) lets go of it.
    fireEvent.click(screen.getByText(/Arrows move it/));
    expect(cellsOf("Hunter's Bow")[0]!.className).not.toMatch(/selected/);
    expect(screen.queryByRole('complementary', { name: 'Item details' })).toBeNull();
  }, 30000);

  it("says so when an item doesn't fit anywhere unrotated", async () => {
    await start();
    fireEvent.change(screen.getByLabelText('Bag size'), { target: { value: 'x26' } });
    for (let i = 0; i < 30; i++) pick('Rock');
    expect(screen.getByText(/No room for Rock in the bag/)).toBeTruthy();
  }, 30000);

  it('drag an item to the storage box, back into the bag, and into the bin', async () => {
    const store = await start();
    pick("Hunter's Bow");
    const bow = () => cellsOf("Hunter's Bow")[0]!;
    const storage = () => screen.getByRole('region', { name: 'Storage' });
    const bag = () => screen.getByRole('grid', { name: 'Backpack' });
    // Pick up, move, let go (jsdom: the element under the pointer is the event's target).
    const drag = (from: Element | undefined, to: Element, x = 10, y = 10, what = '') => {
      expect(from, `nothing to drag: ${what}`).toBeTruthy();
      ptr(from!, 'pointerdown', 5, 5);
      ptr(to, 'pointermove', x, y);
      ptr(to, 'pointerup', x, y);
    };
    drag(bow(), storage(), 10, 10, 'bow to storage');
    expect(cellsOf("Hunter's Bow")).toHaveLength(0);
    const stored = () => document.querySelector<HTMLElement>('.stored-item')!;
    expect(stored().title).toMatch(/Hunter's Bow \(in storage\)/);
    // Its details work in the storage too (its numbers on its own).
    fireEvent.click(stored());
    fireEvent.click(screen.getByRole('button', { name: 'Item details' }));
    expect(within(screen.getByRole('complementary', { name: 'Item details' })).getByText(/In the storage/)).toBeTruthy();
    drag(stored(), bag(), 40 * 3 + 5, 40 * 2 + 5, 'stored to bag');
    expect(cellsOf("Hunter's Bow").length).toBeGreaterThan(0);
    expect(document.querySelector('.stored-item')).toBeNull();
    // Dropped outside the Bag box: removed (no bin any more).
    drag(bow(), screen.getByRole('region', { name: 'Items' }), 10, 10, 'bow out of the box');
    expect(cellsOf("Hunter's Bow")).toHaveLength(0);
    // Saving keeps what's stored.
    pick('Rock');
    drag(cellsOf('Rock')[0], storage(), 10, 10, 'rock to storage');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save "bows"?' })).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(parse((await store.readBuild('bows'))!).storage?.[0]?.item).toBe('rock'));
  }, 30000);

  it('no bin; the storage box is beside the bag, as tall as it; dropping inside the Bag box off the bag keeps the item', async () => {
    await start();
    expect(screen.queryByRole('region', { name: 'Bin' })).toBeNull();
    const grid = screen.getByRole('grid', { name: 'Backpack' });
    const storage = screen.getByRole('region', { name: 'Storage' });
    expect(storage.style.height).toBe(grid.style.height);
    pick("Hunter's Bow");
    const cell = cellsOf("Hunter's Bow")[0]!;
    ptr(cell, 'pointerdown', 5, 5);
    const status = document.querySelector('.bag-status')!;
    ptr(status, 'pointermove', 10, 10);
    ptr(status, 'pointerup', 10, 10);
    expect(cellsOf("Hunter's Bow").length).toBeGreaterThan(0);
  }, 30000);

  it('starting equipment in use is listed first, marked, and can be taken out', async () => {
    await start();
    fireEvent.click(screen.getByRole('tab', { name: /Starting equipment/ }));
    const first = () => document.querySelector<HTMLElement>('[aria-label="Search starting equipment"]')!.closest('div')!.parentElement!.querySelector('.list .list-row')!;
    const name = first().querySelector('.name')!.textContent!;
    const last = [...document.querySelectorAll<HTMLElement>('.list .list-row:not(.blocked)')].at(-1)!;
    const lastName = last.querySelector('.name')!.textContent!;
    fireEvent.click(last);
    expect(screen.getByLabelText('In use').textContent).toMatch(lastName);
    expect(first().querySelector('.name')!.textContent).toBe(lastName);
    expect(first().textContent).toMatch(/in use/);
    fireEvent.click(screen.getByRole('button', { name: `Take ${lastName} out of the bag` }));
    expect(screen.getByLabelText('In use').textContent).toMatch(/nothing yet/);
    expect(name).toBeTruthy();
  }, 30000);

  it("the Build tab has no Stats box; whose bag the Bag box edits is chosen in the Bag box", async () => {
    await start();
    expect(screen.queryByRole('region', { name: 'Stats' })).toBeNull();
    expect(document.querySelector('.topbar [aria-label="Whose build"]')).toBeNull();
  }, 30000);

  it('the bag size list is the hero class\'s', async () => {
    await start();
    const sizes = [...(screen.getByLabelText('Bag size') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(sizes).toEqual(['Full (48)', 'x26', 'x32', 'x38']);
    fireEvent.change(screen.getByLabelText('Bag size'), { target: { value: 'x32' } });
    expect(screen.getByRole('grid', { name: 'Backpack' }).querySelectorAll('.cell.on')).toHaveLength(32);
  }, 30000);

  it('the Battle tab: Arena, Raid or Chapter; my bag and the opponent side by side, each with its setup', async () => {
    await start();
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    const me = screen.getByRole('region', { name: 'You' });
    expect(within(me).getByLabelText('Your build')).toBeTruthy();
    expect(within(me).getByRole('grid', { name: 'Backpack' })).toBeTruthy();
    expect(within(me).getByText('Blessings')).toBeTruthy();
    expect(within(me).getByText('Auras')).toBeTruthy();
    expect(within(me).getByText('Detailed stats')).toBeTruthy();
    const kinds = within(screen.getByRole('tablist', { name: 'Kind of battle' }));
    // Chapter: the chapter's enemies aren't known yet (red), a stand-in is fought.
    expect(kinds.getByRole('tab', { name: 'Chapter' }).getAttribute('aria-selected')).toBe('true');
    const opp = () => screen.getByRole('region', { name: 'Opponent' });
    expect(within(opp()).getByText(/Chapter 1's enemies aren't known yet/)).toBeTruthy();
    fireEvent.change(within(opp()).getByLabelText('Chapter'), { target: { value: '35' } });
    expect(within(opp()).getByText(/same enemies as chapter 10/)).toBeTruthy();
    expect(within(opp()).getAllByText(/Unknown/).length).toBe(5); // a 5th chapter: 5 enemies
    // Arena: builds only, side by side.
    fireEvent.click(kinds.getByRole('tab', { name: 'Arena' }));
    fireEvent.change(within(opp()).getByLabelText('Opponent build'), { target: { value: 'b:bows' } });
    await waitFor(() => expect(within(opp()).getByRole('grid', { name: 'Backpack' })).toBeTruthy());
    expect(within(opp()).queryByLabelText('Enemy')).toBeNull();
    // Raid: the placeholder boss.
    fireEvent.click(kinds.getByRole('tab', { name: 'Raid' }));
    expect(screen.getByRole('region', { name: 'Raid boss' }).textContent).toMatch(/placeholder/i);
    expect(screen.getByRole('region', { name: 'Fight' })).toBeTruthy();
    // The Build tab has no battle box any more.
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    expect(screen.queryByRole('button', { name: /Run battle/ })).toBeNull();
  }, 30000);

  it('items moved in the Battle tab are a try-out: Keep puts them in the build, Undo forgets them', async () => {
    const store = browserStore(localStorage);
    await store.writeAccount('version: 4\nheroes: [{ id: erwen, stars: 9 }]\n');
    await store.writeBuild('bows', "version: 4\nhero: erwen\nplacements: [{ id: b1, item: hunters_bow, x: 0, y: 0 }]\n");
    lastBuild.set('bows');
    render(<App store={store} />);
    await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    const me = () => screen.getByRole('region', { name: 'You' });
    const bag = () => within(me()).getByRole('grid', { name: 'Backpack' });
    const cell = () => bag().querySelector<HTMLElement>('.item-cell')!;
    const before = cell().style.left;
    ptr(cell(), 'pointerdown', 5, 5);
    ptr(bag(), 'pointermove', 40 * 5 + 5, 40 * 3 + 5);
    ptr(bag(), 'pointerup', 40 * 5 + 5, 40 * 3 + 5);
    expect(cell().style.left).not.toBe(before);
    expect(within(me()).getByText(/not in your build yet/)).toBeTruthy();
    fireEvent.click(within(me()).getByRole('button', { name: 'Undo' }));
    expect(cell().style.left).toBe(before);
    ptr(cell(), 'pointerdown', 5, 5);
    ptr(bag(), 'pointermove', 40 * 5 + 5, 40 * 3 + 5);
    ptr(bag(), 'pointerup', 40 * 5 + 5, 40 * 3 + 5);
    fireEvent.click(within(me()).getByRole('button', { name: 'Keep it' }));
    // Kept: the open build changed (not saved yet).
    expect(screen.getByText(/Kept the new arrangement in "bows"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    expect(screen.getByText(/● unsaved/)).toBeTruthy();
  }, 30000);
});
