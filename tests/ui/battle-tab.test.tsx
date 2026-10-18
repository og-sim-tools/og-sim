// @vitest-environment jsdom
/** Battle tab pieces: the build picker, folding boxes, item value, skins per hero, starting equipment, the enemy box. */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema, type Profile } from '../../src/engine/model';
import { BattlePanel } from '../../src/ui/components/BattlePanel';
import { BuildPicker } from '../../src/ui/components/BuildPicker';
import { ItemBrowser } from '../../src/ui/components/ItemBrowser';
import { Panel } from '../../src/ui/components/Panel';
import { SkinsEditor } from '../../src/ui/components/SetupEditors';
import { availableSupplies } from '../../src/engine/validate';
import { itemWorth } from '../../src/ui/state/worth';

afterEach(cleanup);
beforeEach(() => localStorage.clear());
const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const profile = (extra = '') =>
  loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: raven, stars: 3 }, { id: bjorn, stars: 0 }]\nactive_hero: raven\n${extra}` }, data).profile!;

function picker(over: Partial<Parameters<typeof BuildPicker>[0]> = {}) {
  const p = { builds: ['raven', 'trixie spike'], active: 'raven', dirty: true, onLoad: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onNew: vi.fn(), onImport: vi.fn(), onExport: vi.fn(), ...over };
  render(<BuildPicker {...p} />);
  return p;
}
const dialog = (name: string | RegExp) => within(screen.getByRole('dialog', { name }));

describe('build picker', () => {
  it('lists saved builds; the green arrow saves over one and the red bin deletes one, both after asking', () => {
    const p = picker();
    fireEvent.click(screen.getByRole('button', { name: /raven/ }));
    const rows = screen.getAllByRole('option');
    expect(rows.map((r) => r.textContent)).toEqual(['raven', 'trixie spike']);
    fireEvent.click(screen.getByRole('button', { name: 'Save over trixie spike' }));
    dialog('Save over "trixie spike"?').getByText(/replaced by your build \("raven"\)/);
    fireEvent.click(dialog('Save over "trixie spike"?').getByRole('button', { name: 'Save over it' }));
    expect(p.onSave).toHaveBeenCalledWith('trixie spike');

    fireEvent.click(screen.getByRole('button', { name: /raven/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete raven' }));
    fireEvent.click(dialog('Delete "raven"?').getByRole('button', { name: 'Cancel' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /raven/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete raven' }));
    fireEvent.click(dialog('Delete "raven"?').getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalledWith('raven');
  });

  it('asks before Save replaces the open build, and before unsaved changes are dropped', () => {
    const p = picker();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(dialog('Save "raven"?').getByRole('button', { name: 'Save' }));
    expect(p.onSave).toHaveBeenCalledWith('raven');
    fireEvent.click(screen.getByRole('button', { name: /raven/ }));
    fireEvent.click(screen.getByRole('button', { name: 'trixie spike' }));
    expect(p.onLoad).not.toHaveBeenCalled();
    dialog('Open "trixie spike"?').getByText(/unsaved changes to "raven" will be lost/);
    fireEvent.click(dialog('Open "trixie spike"?').getByRole('button', { name: 'Open it' }));
    expect(p.onLoad).toHaveBeenCalledWith('trixie spike');
    fireEvent.click(screen.getByRole('button', { name: 'New build' }));
    fireEvent.click(dialog('Start a new build?').getByRole('button', { name: 'New build' }));
    expect(p.onNew).toHaveBeenCalled();
  });

  it('opens a build straight away without unsaved changes; Save is off until something changes', () => {
    const p = picker({ dirty: false });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /raven/ }));
    fireEvent.click(screen.getByRole('button', { name: 'trixie spike' }));
    expect(p.onLoad).toHaveBeenCalledWith('trixie spike');
  });

  it('a new build asks for a name, refusing unsafe ones and warning before replacing another', () => {
    const p = picker({ active: '', dirty: false });
    expect(screen.getByRole('button', { name: /New build \(not saved\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const d = dialog('Save as a new build');
    fireEvent.change(d.getByLabelText('Build name'), { target: { value: '../x' } });
    expect((d.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(d.getByLabelText('Build name'), { target: { value: 'Raven' } });
    d.getByText(/exists: saving replaces it/);
    fireEvent.change(d.getByLabelText('Build name'), { target: { value: 'trixie burn' } });
    fireEvent.keyDown(d.getByLabelText('Build name'), { key: 'Enter' });
    expect(p.onSave).toHaveBeenCalledWith('trixie burn');
  });
});

describe('boxes fold away', () => {
  it('with the chevron in the corner, remembered in this browser', () => {
    const { unmount } = render(
      <Panel id="t.box" title="Pets">
        <p>inside</p>
      </Panel>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pets' }));
    expect(screen.queryByText('inside')).toBeNull();
    unmount();
    render(
      <Panel id="t.box" title="Pets">
        <p>inside</p>
      </Panel>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Pets' }));
    expect(screen.getByText('inside')).toBeTruthy();
  });
});

describe('item value in the item panel', () => {
  it('coins and sell value; starting equipment in Supply points; gear and pet spawns have none; unknown is said', () => {
    const lo = buildLoadout(
      data,
      profile(),
      LayoutSchema.parse({
        placements: [
          { id: 'bow', item: 'hunters_bow', x: 0, y: 0 },
          { id: 'black', item: 'black_bow', x: 2, y: 0, supply: true },
          { id: 'sword', item: 'heros_longsword', x: 4, y: 0 },
          { id: 'egg', item: 'poison_bug_egg', x: 0, y: 4 },
          { id: 'flame', item: 'primal_flame', x: 6, y: 3 },
        ],
      }),
    );
    expect(itemWorth(lo, 'bow')).toEqual({ kind: 'coins', coins: 8, sells: 4 });
    expect(itemWorth(lo, 'black')).toEqual({ kind: 'starting', points: data.config!.supply_cost[data.items.get('black_bow')!.rarity], coins: 16 });
    expect(itemWorth(lo, 'sword')).toEqual({ kind: 'unknown' });
    expect(itemWorth(lo, 'egg')?.kind).toBe('none');
    expect(itemWorth(lo, 'flame')).toMatchObject({ kind: 'none', why: expect.stringMatching(/Gear/) });
    expect(itemWorth(lo, 'nope')).toBeUndefined();
  });
});

describe('skins per hero', () => {
  it("lists only the skins the build's hero can use, up to 2, each with its stars", () => {
    const p = structuredClone(profile());
    render(<SkinsEditor data={data} profile={profile()} update={(fn) => fn(p)} />);
    const names = screen.getAllByRole('checkbox', { name: /^Bring / }).map((c) => c.getAttribute('aria-label'));
    for (const n of names) expect(n).not.toMatch(/Dream Eater|Little Valcan|Red Sun/); // Trixie's, Bjorn's, warriors'
    expect(names.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Bring / })[0]!);
    expect(p.equipped_skins).toHaveLength(1);
    expect(p.skins).toEqual([{ id: p.equipped_skins[0], stars: 0 }]);
  });

  it('a third skin is off once 2 are brought; one the hero can\'t use shows a warning', () => {
    const two: Profile = profile('equipped_skins: [raven_apostle_of_death, trixie_dream_eater]\nskins: [{ id: raven_apostle_of_death, stars: 2 }, { id: trixie_dream_eater, stars: 1 }]\n');
    render(<SkinsEditor data={data} profile={two} update={vi.fn()} />);
    const off = screen.getAllByRole('checkbox', { name: /^Bring / }).filter((c) => !(c as HTMLInputElement).checked);
    expect(off.every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByText(/Not available to Raven/)).toBeTruthy();
    expect((screen.getAllByLabelText(/stars$/)[0] as HTMLSelectElement).value).toBe('2');
  });
});

describe('starting equipment tab', () => {
  it('shows the Supply points and lets me add what fits, once each', () => {
    const onAdd = vi.fn();
    const lo = buildLoadout(data, profile(), LayoutSchema.parse({ placements: [] }));
    const available = availableSupplies(lo);
    expect(available.length).toBeGreaterThan(1);
    render(
      <ItemBrowser
        data={data}
        supplyIds={new Set()}
        onPick={vi.fn()}
        onEdit={vi.fn()}
        starting={{ heroName: 'Raven', used: 6, capacity: 8, available, inBag: new Set([available[0]!.item.id]), onAdd }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Starting equipment 6\/8/ }));
    expect(screen.getByText('Raven: 6 / 8 Supply points')).toBeTruthy();
    const rows = screen.getAllByRole('button').filter((b) => b.classList.contains('list-row'));
    fireEvent.click(rows[0]!); // already in the bag
    expect(onAdd).not.toHaveBeenCalled();
    const fits = rows.findIndex((r, i) => i > 0 && r.getAttribute('aria-disabled') === 'false');
    if (fits > 0) {
      fireEvent.click(rows[fits]!);
      expect(onAdd).toHaveBeenCalledWith(available[fits]);
    }
    fireEvent.change(screen.getByLabelText('Search starting equipment'), { target: { value: available[1]!.item.name } });
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('list-row'))).toHaveLength(1);
  });
});

describe('enemy box', () => {
  const lo = buildLoadout(data, profile(), LayoutSchema.parse({ placements: [] }));
  const battle = (kind: 'monster' | 'player') => ({
    mode: 'stage',
    seed: 1,
    runs: 1,
    enemy: { id: 'x', name: 'Ogre', kind, hp: '5M', atk: 0, block: 0, damage_reduction: 0, attacks: [], boss: false, starting_statuses: [], resistances: {}, vulnerabilities: {}, immunities: [], traits: [] },
  });

  it('a monster has boss, DMG reduction, starting statuses, resistances and immunities', () => {
    render(<BattlePanel loadout={lo} battle={battle('monster')} onChange={vi.fn()} />);
    expect(screen.getByText('Boss')).toBeTruthy();
    expect(screen.getByLabelText('Enemy damage reduction')).toBeTruthy();
    expect(screen.getByText('Starting statuses')).toBeTruthy();
    expect(screen.getByText('Immunities')).toBeTruthy();
  });

  it("a player has none of them (they never apply to players)", () => {
    render(<BattlePanel loadout={lo} battle={battle('player')} onChange={vi.fn()} />);
    expect(screen.queryByText('Boss')).toBeNull();
    expect(screen.queryByLabelText('Enemy damage reduction')).toBeNull();
    expect(screen.queryByText('Starting statuses')).toBeNull();
    expect(screen.queryByText(/Resistances/)).toBeNull();
    expect(screen.queryByText('Immunities')).toBeNull();
  });

  it('"Copy my build" and going back to simple stats ask first', () => {
    const onChange = vi.fn();
    const mine = { profile: lo.profile, placements: [] };
    const b = battle('player');
    render(<BattlePanel loadout={lo} battle={{ ...b, enemy: { ...b.enemy, build: mine } }} onChange={onChange} myBuild={() => mine} layoutAsBuild={vi.fn()} onEditEnemy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy my build' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(dialog(/Copy your build to Ogre/).getByRole('button', { name: 'Copy my build' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: /Simple stats/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog('Switch to simple stats?').getByRole('button', { name: 'Remove the build' }));
    expect(onChange.mock.calls[1]![0].enemy.build).toBeUndefined();
  });
});
