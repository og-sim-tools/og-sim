// @vitest-environment jsdom
/**
 * Unconfirmed game data: listed in the Data tab (not as badges in the item lists), with a gentle note in the
 * Battle tab naming what the build uses; the first-run guide; Optimize's advanced settings folded away.
 */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { DataPanel } from '../../src/ui/components/DataPanel';
import { ItemBrowser } from '../../src/ui/components/ItemBrowser';
import { OptimizePanel } from '../../src/ui/components/OptimizePanel';
import { browserStore } from '../../src/ui/saves';
import { buildDataRefs, buildFlags, unverifiedEntries } from '../../src/ui/state/dataFlags';

afterEach(cleanup);
beforeEach(() => localStorage.clear());
const res = loadGameDataFromDir(join(ROOT, 'data'));
const data = res.data;
const profile = loadProfile(
  {
    path: 'p.yaml',
    text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }
heroes: [{ id: raven, stars: 3, blessings: { level: 9, equipped: [{ id: all_dmg, rarity: epic, value: 7 }] } }]
active_hero: raven
gear: { weapon: { id: primal_flame, rarity: mythic, tier: 0 } }
pets: [{ id: flora, stars: 2 }]
skins: [{ id: raven_apostle_of_death, stars: 1 }]
equipped_skins: [raven_apostle_of_death]
`,
  },
  data,
).profile!;
const lo = buildLoadout(data, profile, LayoutSchema.parse({ placements: [{ id: 'b', item: 'hunters_bow', x: 0, y: 0 }] }));

describe('data not confirmed in game', () => {
  it('lists every entry with verified: false, and nothing else', () => {
    const list = unverifiedEntries(data);
    expect(list.length).toBeGreaterThan(0);
    for (const u of list) expect((data[u.category] as Map<string, { verified: boolean }>).get(u.id)!.verified, u.id).toBe(false);
    const verifiedItem = [...data.items.values()].find((i) => i.verified)!;
    expect(list.some((u) => u.id === verifiedItem.id)).toBe(false);
  });

  it("knows what a build uses: bag items, gear, hero, blessings, pets and skins", () => {
    const refs = buildDataRefs(lo).map((r) => `${r.category}:${r.id}`);
    expect(refs).toEqual(expect.arrayContaining(['items:hunters_bow', 'gear:primal_flame', 'heroes:raven', 'blessings:all_dmg', 'pets:flora', 'skins:raven_apostle_of_death']));
    // Flags: what's unverified, and what the loader reported problems for.
    const issues = [{ level: 'warning' as const, message: 'odd value', entry: 'flora' }];
    const flags = buildFlags(lo, { issues });
    expect(flags.find((f) => f.id === 'flora')?.problems).toEqual(issues);
    for (const f of flags) expect(f.unverified || f.problems.length > 0).toBe(true);
  });

  it("isn't a badge in the item list any more", () => {
    const { container } = render(<ItemBrowser data={data} supplyIds={new Set()} onPick={vi.fn()} onEdit={vi.fn()} />);
    expect(container.textContent).not.toMatch(/unverified/);
  });

  it('the Data tab lists it, and can show only what the build uses', () => {
    render(<DataPanel result={res} buildRefs={buildDataRefs(lo)} focusBuild />);
    const table = screen.getByRole('table', { name: 'Not verified yet' });
    const rows = within(table).getAllByRole('row').slice(1);
    const used = new Set(buildDataRefs(lo).map((r) => r.id));
    expect(rows.length).toBeLessThanOrEqual(used.size);
    fireEvent.click(screen.getByLabelText(/Only what this build uses/));
    expect(within(screen.getByRole('table', { name: 'Not verified yet' })).getAllByRole('row').length - 1).toBe(unverifiedEntries(data).length);
    fireEvent.change(screen.getByLabelText('Search the data report'), { target: { value: 'hunters_bow' } });
    expect(within(screen.getByRole('table', { name: 'Not verified yet' })).getAllByRole('row').length - 1).toBeLessThanOrEqual(1);
  });
});

describe('the app', () => {
  it('a new account gets the guide; "Got it" hides it for good and "?" brings it back', async () => {
    const store = browserStore(localStorage);
    const first = render(<App store={store} />);
    expect(await screen.findByRole('region', { name: 'How to use the simulator' }, { timeout: 10000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start in the Profile tab' }));
    expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Battle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'How to use the simulator' })).toBeNull();
    first.unmount();
    render(<App store={store} />);
    await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
    expect(screen.queryByRole('region', { name: 'How to use the simulator' })).toBeNull();
    // Closed for good: the top bar has a Tutorial button instead, which asks before starting the tour.
    fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Take the tour?' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Tutorial' })).toBeNull();
  }, 30000);

  it('the tour walks through every tab, and can be skipped at any step', async () => {
    const store = browserStore(localStorage);
    render(<App store={store} />);
    await screen.findByRole('region', { name: 'How to use the simulator' }, { timeout: 10000 });
    expect(screen.queryByRole('button', { name: 'Tutorial' })).toBeNull(); // the card is still open
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Take the tour?' })).getByRole('button', { name: 'Start the tour' }));
    const tour = () => within(screen.getByRole('dialog', { name: 'Tutorial' }));
    expect(tour().getByText('Welcome!')).toBeTruthy();
    const { APP_TOUR } = await import('../../src/ui/components/Tour');
    const tabsSeen = new Set<string>();
    // Every step's area exists on its tab.
    for (let i = 0; i < APP_TOUR.length; i++) {
      const step = APP_TOUR[i]!;
      expect(tour().getByText(step.title)).toBeTruthy();
      if (step.target) expect(document.querySelector(`[data-tour="${step.target}"]`), step.target).not.toBeNull();
      tabsSeen.add(document.querySelector('.topbar [role=tab][aria-selected=true]')!.textContent!);
      if (i < APP_TOUR.length - 1) fireEvent.click(tour().getByRole('button', { name: 'Next' }));
    }
    expect([...tabsSeen]).toEqual(expect.arrayContaining(['Battle', 'Optimize', 'Profile', 'Item editor']));
    fireEvent.click(tour().getByRole('button', { name: 'Back' }));
    fireEvent.click(tour().getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog', { name: 'Tutorial' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Battle' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tutorial' })).toBeTruthy();
  }, 30000);

  it("the Checks box names the build's unconfirmed data and opens the Data tab on it", async () => {
    const store = browserStore(localStorage);
    await store.writeBuild('bows', 'version: 2\nplacements: [{ item: hunters_bow, x: 0, y: 0 }]\n');
    localStorage.setItem('og-sim/last-build', 'bows');
    render(<App store={store} />);
    await screen.findByLabelText('Hero for this build', {}, { timeout: 10000 });
    const unconfirmed = data.items.get('hunters_bow')!.verified === false;
    const note = screen.queryByText(/isn't confirmed in game yet/);
    expect(!!note).toBe(unconfirmed);
    if (!note) return;
    expect(note.textContent).toMatch(/Hunter's Bow/);
    fireEvent.click(within(note as HTMLElement).getByRole('button', { name: 'Look in the Data tab' }));
    expect(screen.getByRole('tab', { name: /^Data/ }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText(/Only what this build uses/) as HTMLInputElement).checked).toBe(true);
  }, 30000);
});

describe('Optimize', () => {
  it('says how it works and keeps the advanced search settings folded away', () => {
    const { container } = render(
      <OptimizePanel data={data} profile={profile} layout={LayoutSchema.parse({ placements: [] })} layoutName="raven" loadout={lo} layouts={[]} layoutAsBuild={vi.fn()} onApply={vi.fn()} />,
    );
    expect(screen.getByText(/Tick the saved builds to test it against/)).toBeTruthy();
    const advanced = [...container.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Advanced search settings')!;
    expect(advanced.open).toBe(false);
    expect(advanced.textContent).toMatch(/Temperature/);
    expect(screen.getByText('Builds to try').closest('details')).toBeNull();
  });
});
