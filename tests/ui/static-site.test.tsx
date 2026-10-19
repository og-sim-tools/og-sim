// @vitest-environment jsdom
/**
 * The hosted static site: game data bundled at build time, saves and item edits in the browser, a starter build
 * for a first visit, item edits in the account export.
 */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { readDataDir } from '../../src/engine/loader-node';
import { readBuild } from '../../src/engine/saves';
import { BROWSER_EDITS_FILE, deepMerge, readEdits, removeEdit, upsertEdit, writeEdits } from '../../src/engine/userEdits';
import { App } from '../../src/ui/App';
import { browserStore } from '../../src/ui/saves';
import { seedStarter } from '../../src/ui/starter';
import { accountArchive, readAccountArchive } from '../../src/ui/state/accountArchive';
import { unzipFiles } from '../../src/ui/state/zip';
import { bundledData, imageUrl } from '../../src/ui/staticData';

const DATA = join(__dirname, '..', '..', 'data');
const onDisk = readDataDir(DATA);
const fromDisk = async () => onDisk;
afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('bundled game data', () => {
  it('is exactly the data/ folder, with the same paths and contents', async () => {
    const bundled = await bundledData();
    expect(bundled.map((f) => f.path)).toEqual(onDisk.map((f) => f.path).sort((a, b) => a.localeCompare(b)));
    const byPath = new Map(onDisk.map((f) => [f.path, f.text]));
    for (const f of bundled) expect(f.text, f.path).toBe(byPath.get(f.path));
  });

  it('images come from the dev server while developing', () => {
    expect(imageUrl('items/whip.png')).toBe('/api/images/items/whip.png');
    expect(imageUrl('data/images/items/whip.png')).toBe('/api/images/items/whip.png');
  });
});

describe('item edits', () => {
  it('merge field by field, keep earlier edits, and can be dropped', () => {
    let list = upsertEdit([], { id: 'whip', stats: { cooldown: 2 }, value: 4 });
    list = upsertEdit(list, { id: 'whip', stats: { accuracy: 90 }, value: null });
    expect(list).toEqual([{ id: 'whip', stats: { cooldown: 2, accuracy: 90 }, value: null }]);
    expect(() => upsertEdit(list, { id: 'Bad Id' })).toThrow(/Bad id/);
    expect(readEdits(writeEdits(list))).toEqual(list);
    expect(removeEdit(list, 'whip')).toEqual([]);
    expect(deepMerge({ a: { b: 1 }, c: [1] }, { a: { d: 2 }, c: [2] })).toEqual({ a: { b: 1, d: 2 }, c: [2] });
    expect(() => readEdits('a: 1')).toThrow(/must contain a list/);
  });

  it('on the hosted site they live in the browser and load after the data files', async () => {
    const store = browserStore(localStorage, fromDisk);
    await store.writeEdit('items', { id: 'whip', value: 99 });
    await store.writeEdit('items', { id: 'whip', stats: { cooldown: 1 } });
    const data = await store.readData();
    const mine = data.find((f) => f.path === `items/manual/${BROWSER_EDITS_FILE}`)!;
    expect(parse(mine.text)).toEqual([{ id: 'whip', value: 99, stats: { cooldown: 1 } }]);
    expect(data.length).toBe(onDisk.length + 1);
    expect(store.editsWhere('items')).toMatch(/this browser/);
    expect((await store.listEdits()).map((e) => e.category)).toEqual(['items']);
    await store.deleteEdit('items', 'whip');
    expect(await store.listEdits()).toEqual([]);
  });

  it('travel in the account export and come back with an import', async () => {
    const { bytes } = accountArchive('version: 2\n', [], new Date(2026, 9, 18), [{ category: 'gear', text: writeEdits([{ id: 'primal_flame', tier: 2 }]) }]);
    const files = await unzipFiles(bytes);
    expect(files.map((f) => f.path)).toContain('og-sim-account-2026-10-18/edits/gear.yaml');
    const back = readAccountArchive(files);
    expect(back.edits).toEqual([{ category: 'gear', text: writeEdits([{ id: 'primal_flame', tier: 2 }]) }]);
    // Only known kinds of data.
    expect(readAccountArchive([{ path: 'x/edits/nonsense.yaml', text: '[]' }]).edits).toEqual([]);
    const store = browserStore(localStorage, fromDisk);
    await store.writeEdits!('gear', back.edits[0]!.text);
    expect((await store.listEdits())[0]!.category).toBe('gear');
    await expect(store.writeEdits!('gear', 'not: a list')).rejects.toThrow(/must contain a list/);
  });
});

describe('first visit', () => {
  it('an empty browser gets the example build, once', async () => {
    const store = browserStore(localStorage, fromDisk);
    expect(await seedStarter(store)).toBe(true);
    expect(await store.listBuilds()).toEqual(['example']);
    const b = readBuild(await store.readBuild('example'));
    expect(b.notes).toEqual([]);
    expect(b.layout).toMatchObject({ name: 'example', hero: 'erwen' });
    expect(b.layout.setup?.equipped_skins).toEqual([]);
    await store.deleteBuild('example');
    expect(await seedStarter(store)).toBe(false); // deleted on purpose: not brought back
    expect(await store.listBuilds()).toEqual([]);
  });

  it("never touches a browser that already has an account or builds", async () => {
    const store = browserStore(localStorage, fromDisk);
    await store.writeAccount('version: 2\nheroes: []\n');
    expect(await seedStarter(store)).toBe(false);
    expect(await store.listBuilds()).toEqual([]);
  });

  it("blessings entered in the Profile tab are the build's hero's, without changing the build", async () => {
    const store = browserStore(localStorage, fromDisk);
    await seedStarter(store);
    render(<App store={store} />);
    await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    const erwen = screen.getAllByRole('checkbox').find((c) => c.parentElement?.textContent?.trim() === 'Erwen')!;
    fireEvent.click(erwen);
    const card = screen.getByLabelText('Own Erwen').closest('details')!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Add blessing' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    expect(screen.getAllByText('Blessings')[0]!.closest('summary')!.textContent).toMatch(/1 \/ \d/);
    expect(screen.queryByText(/unsaved/)).toBeNull(); // an account change isn't a build change
  }, 30000);
});

vi.mock('../../src/ui/api', () => ({ fetchSnapshot: vi.fn(), downloadText: vi.fn(), saveManualEntry: vi.fn(), deleteManualEntry: vi.fn() }));
