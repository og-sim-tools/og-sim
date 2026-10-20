// @vitest-environment jsdom
/**
 * The app with my real version-1 files in storage: they load (with a note about the upgrade), account edits
 * save themselves in today's format, builds save in today's format, and unsaved changes survive closing the tab.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { readDataDir } from '../../src/engine/loader-node';
import { SAVE_VERSION } from '../../src/engine/saves';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { browserStore, lastBuild } from '../../src/ui/saves';

const V1 = join(ROOT, 'tests', 'fixtures', 'saves', 'v1');
const store = browserStore(localStorage);

beforeEach(async () => {
  localStorage.clear();
  await store.writeAccount(readFileSync(join(V1, 'profile.yaml'), 'utf8'));
  for (const n of ['raven', 'trixie anti-raven']) await store.writeBuild(n, readFileSync(join(V1, 'builds', `${n}.yaml`), 'utf8'));
  lastBuild.set('trixie anti-raven');
});
afterEach(cleanup);

const heroPicker = () => screen.findByLabelText('Hero for this build', {}, { timeout: 10000 }) as Promise<HTMLSelectElement>;

describe('the app and my saved files', () => {
  it('opens the last build from version-1 files and says they were updated', async () => {
    render(<App store={store} />);
    expect((await heroPicker()).value).toBe('trixie');
    const notice = screen.getByRole('status');
    expect(within(notice).getByText('Your saved files were updated to the new format')).toBeTruthy();
    expect(notice.textContent).toMatch(/version 3: Dragon's Blessings, pet and skin stars, and HP \/ ATK \/ Block are account-wide now \(Profile tab\), taken from your old profile/);
    // Nothing is written until I change something.
    expect(parse((await store.readAccount())!)).not.toHaveProperty('version');
  }, 30000);

  it("version-2 files (from the site before 2026-10-19): opening a build moves its stars and stats into the account, and says so", async () => {
    localStorage.clear();
    const V2 = join(ROOT, 'tests', 'fixtures', 'saves', 'v2');
    // A version-2 account that didn't come from version 1 (the hosted site's): nothing account-wide in it yet.
    const acc = parse(readFileSync(join(V2, 'profile.yaml'), 'utf8'));
    delete acc.migrated_from_v1;
    await store.writeAccount(stringify(acc));
    await store.writeBuild('raven', readFileSync(join(V2, 'builds', 'raven.yaml'), 'utf8'));
    lastBuild.set('raven');
    render(<App store={store} />);
    expect((await heroPicker()).value).toBe('raven');
    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/Moved into your Profile from "raven".*HP 5\.29M \/ ATK 1\.61M \/ Block 1\.85M/);
    await waitFor(() => expect(parse(localStorage.getItem('og-sim/account')!).stats).toEqual({ hp: '5.29M', atk: '1.61M', initial_block: '1.85M' }), { timeout: 3000 });
    const saved = parse(localStorage.getItem('og-sim/account')!);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.pets.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['white_wolf_captain', 'ice_reaper']));
    // The build itself isn't changed until I save it.
    expect(parse((await store.readBuild('raven'))!).version).toBe(2);
  }, 30000);

  it("saves account changes by itself, in today's format, keeping the old profile inside", async () => {
    render(<App store={store} />);
    await heroPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    fireEvent.change(screen.getByLabelText('Erwen stars'), { target: { value: '6' } });
    await waitFor(() => expect(parse(localStorage.getItem('og-sim/account')!).version).toBe(SAVE_VERSION), { timeout: 3000 });
    const saved = parse(localStorage.getItem('og-sim/account')!);
    expect(saved.heroes.find((h: { id: string }) => h.id === 'erwen')).toMatchObject({ id: 'erwen', stars: 6, links: [] });
    expect(saved.stats).toEqual({ hp: '5.29M', atk: '1.61M', initial_block: '1.85M' });
    expect(saved).not.toHaveProperty('gear');
    expect(saved.migrated_from_v1.active_hero).toBe('trixie');
    // The tab shows no unsaved-changes dot.
    expect(screen.getByRole('tab', { name: 'Profile' }).textContent).toBe('Profile');
  }, 30000);

  it('asks before the tab closes, only while the build has unsaved changes', async () => {
    render(<App store={store} />);
    const picker = await heroPicker();
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    fireEvent.change(picker, { target: { value: 'raven' } });
    await waitFor(() => expect(leave()).toBe(true));
  }, 30000);

  it("saves a build in today's format (pet stars go to the account), and brings back unsaved changes after closing the tab", async () => {
    const first = render(<App store={store} />);
    const picker = await heroPicker();
    // Save is off until something changes; then it asks before replacing the saved build.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    // A pet's stars are the account's: the build itself doesn't change.
    fireEvent.change(screen.getAllByLabelText('Pet stars')[0]!, { target: { value: '1' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    // Which pets are active is the build's.
    fireEvent.click(screen.getAllByRole('checkbox', { name: /active/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save "trixie anti-raven"?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(parse(localStorage.getItem('og-sim/build/trixie anti-raven')!).version).toBe(SAVE_VERSION));
    const saved = parse(localStorage.getItem('og-sim/build/trixie anti-raven')!);
    expect(saved).toMatchObject({ hero: 'trixie', skins: [{ id: 'trixie_dream_eater', quest_done: true }] });
    expect(saved).not.toHaveProperty('blessings');
    expect(saved).not.toHaveProperty('basic_stats');
    expect(saved.pets[0]).not.toHaveProperty('stars');
    // The pet's stars are the account's now.
    await waitFor(() => expect(parse(localStorage.getItem('og-sim/account')!).pets.find((p: { id: string }) => p.id === saved.pets[0].id)?.stars).toBe(1), { timeout: 3000 });
    expect(parse(localStorage.getItem('og-sim/account')!).heroes.find((h: { id: string }) => h.id === 'trixie').blessings.equipped.map((b: { id: string }) => b.id)).toEqual([
      'trixie_ill_be_having_that',
      'trixie_consider_this_yours',
    ]);

    fireEvent.change(picker, { target: { value: 'raven' } });
    await waitFor(() => expect(localStorage.getItem('og-sim/draft')).toMatch(/"name":"trixie anti-raven"/), { timeout: 3000 });
    first.unmount();

    render(<App store={store} />);
    expect((await heroPicker()).value).toBe('raven');
    expect(screen.getByText(/Brought back your unsaved changes to "trixie anti-raven"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }));
    await waitFor(async () => expect((await heroPicker()).value).toBe('trixie'));
    expect(localStorage.getItem('og-sim/draft')).toBeNull();
  }, 30000);
});
