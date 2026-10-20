// @vitest-environment jsdom
/**
 * Feedback of 2026-10-20: on-hit statuses on typed-in attacks, the Profile tab (only account warnings, every hero
 * row alike), and phones going one section at a time.
 */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir, readDataDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { validateLoadout } from '../../src/engine/validate';

const ROOT = join(__dirname, '..', '..');
vi.mock('../../src/ui/api', () => ({
  fetchSnapshot: vi.fn(async () => ({ data: readDataDir(join(ROOT, 'data')), profile: null, layouts: [] })),
  downloadText: vi.fn(),
  saveManualEntry: vi.fn(),
  deleteManualEntry: vi.fn(),
}));
import { App } from '../../src/ui/App';
import { BattlePanel } from '../../src/ui/components/BattlePanel';
import { ProfileEditor } from '../../src/ui/components/ProfileEditor';
import { browserStore, lastBuild } from '../../src/ui/saves';

afterEach(cleanup);
beforeEach(() => localStorage.clear());
const data = loadGameDataFromDir(join(ROOT, 'data')).data;
const profile = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: erwen, stars: 3 }]\nactive_hero: erwen\ngear: { weapon: { id: primal_flame, rarity: mythic, tier: 0 } }\n' }, data).profile!;
const lo = buildLoadout(data, profile, LayoutSchema.parse({ placements: [] }));

describe('typed-in attacks', () => {
  it('each attack can inflict statuses on hit (simple stats only)', () => {
    const onChange = vi.fn();
    const enemy = { id: 'x', name: 'Burner', hp: '10M', atk: 0, block: 0, damage_reduction: 0, attacks: [{ damage: '100K', cooldown: 2, accuracy: 85, hits: 1, crit_chance: 0, on_hit: [] }], boss: false, starting_statuses: [], resistances: {}, vulnerabilities: {}, immunities: [], traits: [] };
    const { rerender } = render(<BattlePanel loadout={lo} battle={{ mode: 'stage', seed: 1, runs: 1, enemy }} onChange={onChange} choices={['monsters', 'typed']} />);
    fireEvent.click(screen.getByRole('button', { name: '+ status' }));
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.enemy.attacks[0].on_hit).toEqual([{ status: 'burn', stacks: 1 }]);
    rerender(<BattlePanel loadout={lo} battle={next} onChange={onChange} choices={['monsters', 'typed']} />);
    fireEvent.change(screen.getByLabelText('On-hit stacks'), { target: { value: '4' } });
    expect(onChange.mock.calls.at(-1)![0].enemy.attacks[0].on_hit).toEqual([{ status: 'burn', stacks: 4 }]);
    // Where builds aren't offered (chapters), a typed-in enemy has simple stats only.
    expect(screen.queryByText(/Full build/)).toBeNull();
  });
});

describe('Profile tab', () => {
  it("shows only the account's warnings, and every hero row the same way", () => {
    const lo2 = buildLoadout(data, profile, LayoutSchema.parse({ placements: [] }));
    const issues = validateLoadout(lo2);
    expect(issues.some((i) => i.code.startsWith('gear_'))).toBe(true); // Primal Flame isn't placed
    const { container } = render(<ProfileEditor data={data} profile={profile} issues={[]} loadoutIssues={issues.filter((i) => /^(blessing_|link_)/.test(i.code))} onChange={vi.fn()} />);
    expect(container.textContent).not.toMatch(/equipped but not placed/);
    const rows = container.querySelectorAll('[data-tour="profile.heroes"] .hero-row, [data-tour="profile.heroes"] details.hero-card');
    expect(rows.length).toBe(data.heroes.size);
  });
});

describe('phones', () => {
  it('go one section at a time, with Back and Next', async () => {
    const mm = vi.fn((q: string) => ({ matches: /max-width/.test(q), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', mm);
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      const store = browserStore(localStorage);
      await store.writeAccount('version: 4\nheroes: [{ id: erwen, stars: 9 }]\n');
      await store.writeBuild('bows', 'version: 4\nhero: erwen\nplacements: []\n');
      lastBuild.set('bows');
      render(<App store={store} />);
      const steps = await screen.findByRole('navigation', { name: 'Steps' }, { timeout: 10000 });
      expect(within(steps).getAllByRole('button').map((b) => b.textContent)).toEqual(['1. Profile', '2. Hero & blessings', '3. Gear', '4. Pets', '5. Skins', '6. Opponent', '7. Items & bag', '8. Fight']);
      fireEvent.click(within(steps).getByRole('button', { name: '2. Hero & blessings' }));
      const shown = (id: string) => (document.querySelector(`[data-tour="${id}"]`)?.closest('[style*="display: none"]') ? false : !!document.querySelector(`[data-tour="${id}"]`));
      expect(shown('battle.hero')).toBe(true);
      expect(shown('battle.pets')).toBe(false);
      expect(shown('battle.items')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: /Next: Gear/ }));
      expect(shown('battle.gear')).toBe(true);
      expect(shown('battle.hero')).toBe(false);
      fireEvent.click(within(steps).getByRole('button', { name: '6. Opponent' }));
      expect(screen.getByRole('tab', { name: 'Battle' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByRole('region', { name: 'You' })).toBeNull();
      expect(screen.getByRole('region', { name: 'Opponent' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '← Back' }));
      expect(shown('battle.skins')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      // @ts-expect-error jsdom has no matchMedia of its own
      delete window.matchMedia;
    }
  }, 30000);
});

describe('Optimize with 0 builds to try', () => {
  it('tests my build as it is against the opponents, changing nothing', async () => {
    const { OptimizePanel } = await import('../../src/ui/components/OptimizePanel');
    const mine = LayoutSchema.parse({ placements: [{ id: 'b1', item: 'hunters_bow', x: 0, y: 0 }, { id: 'r1', item: 'rock', x: 3, y: 0 }], battle: { mode: 'arena', seed: 1, runs: 1 } });
    const myLo = buildLoadout(data, profile, mine);
    const foe = { profile, placements: [{ id: 'f1', item: 'hunters_bow', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    const onApply = vi.fn();
    render(<OptimizePanel data={data} profile={profile} layout={mine} layoutName="mine" loadout={myLo} layouts={['foe one', 'foe two']} layoutAsBuild={vi.fn(async () => foe)} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Builds to try'), { target: { value: '0' } });
    expect((screen.getByLabelText('Builds to try') as HTMLInputElement).value).toBe('0');
    fireEvent.change(screen.getByLabelText('Seeds per opponent'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /foe one/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /foe two/ }));
    expect(screen.getByText(/About 4 battles per run/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test my build' }));
    expect(await screen.findByText('Builds tried (1)', {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getAllByText('starting build').length).toBeGreaterThan(0);
    // It's my build, unchanged: the clean-up pass doesn't run (the Rock does nothing and would be dropped otherwise).
    expect(screen.queryByText(/drop Rock/)).toBeNull();
  }, 30000);
});

describe('later feedback of 2026-10-20', () => {
  it('search goes word by word: "h b" finds Hunter\'s Bow', async () => {
    const { nameMatches } = await import('../../src/ui/state/browser');
    expect(nameMatches("Hunter's Bow", 'h b')).toBe(true);
    expect(nameMatches("Hunter's Bow", 'hunt bo')).toBe(true);
    expect(nameMatches("Hunter's Bow", 'b h')).toBe(false); // in order
    expect(nameMatches("Hunter's Bow", "hunter's")).toBe(true);
    expect(nameMatches('Advanced Magic: Crystal Fall', 'a m c f')).toBe(true);
    expect(nameMatches('Advanced Magic: Crystal Fall', 'stal')).toBe(true); // text inside a word, as typed
    expect(nameMatches('Rock', 'x')).toBe(false);
    const { ItemBrowser } = await import('../../src/ui/components/ItemBrowser');
    const { container } = render(<ItemBrowser data={data} supplyIds={new Set()} onPick={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'h b' } });
    expect([...container.querySelectorAll('.list-row .name')].map((n) => n.textContent)).toContain("Hunter's Bow");
  });

  it("a skin's skill can be forced on whatever the bag holds now, and the optimizer leaves its quest alone", async () => {
    const { activeSkins } = await import('../../src/engine/combat/setup');
    const { skinQuestGuard } = await import('../../src/engine/optimize');
    const p = loadProfile({ path: 'p.yaml', text: 'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: trixie, stars: 3 }]\nactive_hero: trixie\nskins: [{ id: trixie_dream_eater, stars: 1 }]\nequipped_skins: [trixie_dream_eater]\n' }, data).profile!;
    const empty = buildLoadout(data, p, LayoutSchema.parse({ placements: [] }));
    expect(activeSkins(empty).map((x) => x.skin.id)).toEqual([]); // the quest isn't met by an empty bag
    const forced = buildLoadout(data, { ...p, skin_quests_forced: ['trixie_dream_eater'] }, LayoutSchema.parse({ placements: [] }));
    expect(activeSkins(forced).map((x) => x.skin.id)).toEqual(['trixie_dream_eater']);
    expect(validateLoadout(forced).some((i) => i.code.startsWith('skin_quest'))).toBe(false);
    const g = skinQuestGuard(data, forced.profile, forced, true);
    expect(g.warnings).toEqual([]);
    expect(g.guarded).toEqual([]);
  });

  it('the Optimize tab: opponents can be weighted, and runs combined (3 parallel then 3 in series = 12)', async () => {
    const { OptimizePanel } = await import('../../src/ui/components/OptimizePanel');
    const mine = LayoutSchema.parse({ placements: [{ id: 'b1', item: 'hunters_bow', x: 0, y: 0 }] });
    const foe = { profile, placements: [{ id: 'f1', item: 'hunters_bow', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    render(<OptimizePanel data={data} profile={profile} layout={mine} layoutName="mine" loadout={buildLoadout(data, profile, mine)} layouts={['foe one', 'foe two']} layoutAsBuild={vi.fn(async () => foe)} onApply={vi.fn()} />);
    expect(screen.queryByLabelText('Weight of foe one')).toBeNull();
    fireEvent.click(screen.getByLabelText(/prioritize beating some builds/));
    fireEvent.change(screen.getByLabelText('Weight of foe one'), { target: { value: '3' } });
    expect((screen.getByLabelText('Weight of foe one') as HTMLInputElement).value).toBe('3');
    fireEvent.change(screen.getByLabelText('Several runs'), { target: { value: 'parallel-series' } });
    fireEvent.change(screen.getByLabelText('Runs in the first stage'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Runs from each first run'), { target: { value: '3' } });
    expect(screen.getByText(/= 12 runs/)).toBeTruthy();
  });
});

describe('the item class filter', () => {
  it("follows the build's hero's class (items for any class stay), until it's changed by hand", async () => {
    const { ItemBrowser } = await import('../../src/ui/components/ItemBrowser');
    const props = { data, supplyIds: new Set<string>(), onPick: vi.fn(), onEdit: vi.fn() };
    const { rerender, container } = render(<ItemBrowser {...props} heroClass="ranger" />);
    const cls = () => (screen.getByLabelText('Class') as HTMLSelectElement).value;
    const classes = () => [...container.querySelectorAll('.list-row .badge.class')].map((b) => b.textContent).filter((t) => !t!.startsWith('🔒'));
    expect(cls()).toBe('ranger');
    expect(classes().every((c) => c!.split('/').includes('ranger'))).toBe(true);
    expect(container.querySelector('.list-row .name')).toBeTruthy();
    // Universal items (no class badge) are still listed.
    expect([...container.querySelectorAll('.list-row')].some((r) => !r.querySelector('.badge.class'))).toBe(true);
    rerender(<ItemBrowser {...props} heroClass="wizard" />);
    expect(cls()).toBe('wizard');
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: '' } });
    rerender(<ItemBrowser {...props} heroClass="warrior" />);
    expect(cls()).toBe(''); // picked by hand: stays
  });
});

describe('feedback of 2026-10-20, later still', () => {
  it('turning a held item: around the cursor keeps the held cell; around the centre keeps the centre of its cells', async () => {
    const { turned } = await import('../../src/ui/drag');
    const { setSettings } = await import('../../src/ui/settings');
    const { useDragLook } = await import('../../src/ui/drag');
    // A 3 × 1 item held by its left cell; its look turns with it.
    const cellsFor = (r: number) => (r % 180 === 0 ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
    function Look() {
      useDragLook('t', (d) => ({ cells: cellsFor(d.rotation), color: 'red', sprite: null }));
      return null;
    }
    render(<Look />);
    const held = { kind: 'placed' as const, id: 'x', item: 'x', rotation: 0 as const, grab: 0, inCell: { x: 0.5, y: 0.5 }, scope: 't', x: 100, y: 100, spin: 0 };
    setSettings({ otherPivot: 'cursor' });
    expect(turned(held)).toMatchObject({ rotation: 90, grab: 0, inCell: { x: 0.5, y: 0.5 }, spin: 90 });
    setSettings({ otherPivot: 'center' });
    // Centre of the row was 1 cell to the right of the pointer; after turning, the column's centre is there:
    // the pointer is now 1 cell left of the column, beside its middle cell.
    const t = turned(held);
    expect(t.grab).toBe(1);
    expect(t.inCell.x).toBeCloseTo(-0.5, 6);
    expect(t.inCell.y).toBeCloseTo(0.5, 6);
    setSettings({ otherPivot: 'cursor' });
  });

  it('the item searches are remembered over a reload', async () => {
    const { ItemBrowser } = await import('../../src/ui/components/ItemBrowser');
    const props = { data, supplyIds: new Set<string>(), onPick: vi.fn(), onEdit: vi.fn() };
    const first = render(<ItemBrowser {...props} heroClass="ranger" />);
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'bow' } });
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'weapon' } });
    first.unmount();
    render(<ItemBrowser {...props} heroClass="ranger" />);
    expect((screen.getByLabelText('Search items') as HTMLInputElement).value).toBe('bow');
    expect((screen.getByLabelText('Tag') as HTMLSelectElement).value).toBe('weapon');
  });

  it('settings are kept in this browser', async () => {
    const { setSettings, getSettings } = await import('../../src/ui/settings');
    setSettings({ animateRotation: true, rotationMs: 300 });
    expect(JSON.parse(localStorage.getItem('og-sim/settings')!)).toMatchObject({ animateRotation: true, rotationMs: 300 });
    expect(getSettings().rotationMs).toBe(300);
    setSettings({ animateRotation: false, rotationMs: 150 });
  });
});

describe('turning an item in the bag', () => {
  it('keeps the corner (or the centre) the settings say; held items can keep a corner too', async () => {
    const { turnInBag } = await import('../../src/ui/state/bagEdit');
    const { setSettings } = await import('../../src/ui/settings');
    const { anchorShift } = await import('../../src/ui/drag');
    // Hunter's Bow is 1 wide, 2 tall: turned it's 2 wide, 1 tall.
    const lo = buildLoadout(data, profile, LayoutSchema.parse({ placements: [{ id: 'b', item: 'hunters_bow', x: 3, y: 1 }] }));
    const p = { id: 'b', item: 'hunters_bow', x: 3, y: 1, rotation: 0 as const };
    const at = (a: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
      setSettings({ placedOtherPivot: a });
      const r = turnInBag(lo, p);
      return [r.x, r.y, r.rotation];
    };
    expect(at('top-left')).toEqual([3, 1, 90]);
    expect(at('top-right')).toEqual([2, 1, 90]);
    expect(at('bottom-left')).toEqual([3, 2, 90]);
    expect(at('bottom-right')).toEqual([2, 2, 90]);
    expect(at('center')).toEqual([2, 1, 90]); // half cells round down
    setSettings({ placedOtherPivot: 'top-left' });
    expect(anchorShift('bottom-right', 3, 1, 1, 3)).toEqual({ dx: 2, dy: -2 });
  });
});
