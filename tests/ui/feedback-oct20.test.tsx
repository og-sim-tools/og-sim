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
