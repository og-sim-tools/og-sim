// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSynergyReport } from '../../src/engine/effects/synergy';
import { aggregateStats } from '../../src/engine/stats';
import { validateLoadout } from '../../src/engine/validate';
import { BagGrid, marginFor } from '../../src/ui/components/BagGrid';
import type { DragItem } from '../../src/ui/drag';
import { BattlePanel } from '../../src/ui/components/BattlePanel';
import { combatData, combatLoadout } from '../combat-fixture';
import { ItemBrowser } from '../../src/ui/components/ItemBrowser';
import { BuildStats, PetsEditor, petPoints } from '../../src/ui/components/SetupEditors';
import { StatsPanel } from '../../src/ui/components/StatsPanel';
import { ItemDrawer } from '../../src/ui/components/ItemDrawer';
import { makeData, makeLoadout, makeProfile, PROFILE } from '../helpers';

afterEach(cleanup);

/** A pointer event at (x, y) (jsdom has no PointerEvent; React only looks at the type). */
const ptr = (el: Element, type: string, x: number, y: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));


const data = makeData();
const profile = makeProfile(data);
// Glove at (0,0) touches the sword at (1,0); a pup overlaps the sword at (1,1).
const LAYOUT = `
placements:
  - { id: g1, item: glove, x: 0, y: 0 }
  - { id: sword, item: sword, x: 1, y: 0 }
  - { id: pup, item: pup, x: 1, y: 1 }
`;

function renderGrid(overrides: Partial<Parameters<typeof BagGrid>[0]> = {}) {
  const loadout = makeLoadout(data, profile, LAYOUT);
  const props = {
    loadout,
    issues: validateLoadout(loadout),
    selected: null,
    hovered: null,
    maskEdit: false,
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onToggleMask: vi.fn(),
    onDrop: vi.fn(),
    onKey: vi.fn(),
    ...overrides,
  };
  const utils = render(<BagGrid {...props} />);
  return { ...utils, props };
}

describe('BagGrid', () => {
  it('draws the bag mask, the items, and overlapping cells in red', () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll('.cell.on')).toHaveLength(48);
    expect(container.querySelectorAll('.item-cell')).toHaveLength(1 + 2 + 1);
    expect(container.querySelectorAll('.red-cell')).toHaveLength(1);
    expect(container.querySelectorAll('.item-cell.invalid')).toHaveLength(3); // both sword cells + pup
  });

  it('shows the dots of the hovered item and the items they touch', () => {
    const { container } = renderGrid({ hovered: 'g1' });
    const dots = [...container.querySelectorAll('.dot')].map((d) => d.className);
    expect(dots.sort()).toEqual(['dot outside', 'dot touches']);
    expect([...container.querySelectorAll('.item-cell.touched')].map((c) => (c as HTMLElement).title)).toEqual(['Sword', 'Sword']);
  });

  it('passes keyboard controls on', () => {
    const { container, props } = renderGrid({ selected: 'sword' });
    fireEvent.keyDown(container.querySelector('.bag')!, { key: 'ArrowLeft' });
    fireEvent.keyDown(container.querySelector('.bag')!, { key: ' ' });
    fireEvent.keyDown(container.querySelector('.bag')!, { key: 'x' });
    expect(vi.mocked(props.onKey).mock.calls).toEqual([['left'], ['rotate']]);
  });

  it('toggles bag cells in mask-edit mode and selects items on click', () => {
    const { container, props } = renderGrid({ maskEdit: true });
    fireEvent.click(container.querySelectorAll('.cell')[9]!);
    expect(props.onToggleMask).toHaveBeenCalledWith(1, 1);
    fireEvent.click(container.querySelector('.item-cell')!);
    expect(props.onSelect).toHaveBeenCalledWith('g1');
  });

  it('while an item is held, shows where it would land; Escape puts it back', () => {
    const dropTarget = vi.fn((_d: DragItem, x: number, y: number) => ({ x, y, cells: [{ x, y }, { x, y: y + 1 }], valid: x > 0 }));
    const { container, props } = renderGrid({ dropTarget });
    const sword = [...container.querySelectorAll<HTMLElement>('.item-cell')].find((c) => c.title.startsWith('Sword'))!;
    const bag = container.querySelector('.bag')!;
    ptr(sword, 'pointerdown', 45, 5);
    // Bag at 0,0 in jsdom with a 1-cell margin: clientX 2.5 cells = bag x 1.
    ptr(bag, 'pointermove', 40 * 2 + 5, 40 + 5);
    expect(dropTarget).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'placed', id: 'sword', item: 'sword' }), 1, 0);
    expect(container.querySelectorAll('.drop-preview')).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelectorAll('.drop-preview')).toHaveLength(0);
    ptr(bag, 'pointerup', 40 * 2 + 5, 40 + 5);
    expect(props.onDrop).not.toHaveBeenCalled();
  });

  it('clicking the selected item again rotates it', () => {
    const onRotate = vi.fn();
    const { container, props } = renderGrid({ selected: 'sword', onRotate });
    const sword = [...container.querySelectorAll<HTMLElement>('.item-cell')].find((c) => c.title.startsWith('Sword'))!;
    fireEvent.click(sword);
    expect(onRotate).toHaveBeenCalledWith('sword');
    fireEvent.click(container.querySelector('.item-cell')!); // the glove: selects it
    expect(props.onSelect).toHaveBeenCalledWith('g1');
  });

  it('sizes the margin to fit out-of-bag cells and dots', () => {
    expect(marginFor(8, 6, [{ x: 0, y: 0 }])).toBe(1);
    expect(marginFor(8, 6, [{ x: -3, y: 0 }])).toBe(3);
    expect(marginFor(8, 6, [{ x: 7, y: 15 }])).toBe(4);
  });
});

describe('StatsPanel', () => {
  it('opens the selected item breakdown and synergies in the side panel', () => {
    const loadout = makeLoadout(data, profile, LAYOUT);
    const stats = aggregateStats(loadout);
    const onClose = vi.fn();
    render(<ItemDrawer s={stats.items.get('sword')!} syn={buildSynergyReport(loadout).get('sword')} start={undefined} names={(id) => id} onClose={onClose} />);
    expect(screen.getByRole('complementary', { name: 'Item details' })).toBeTruthy();
    expect(screen.getAllByText(/Cooldown/).some((e) => /Cooldown 1\.600s/.test(e.textContent ?? ''))).toBe(true); // 2 s / (1 + 10% + 15%)
    expect(screen.getByText('+15 Glove')).toBeTruthy();
    expect(screen.getByText(/← Glove/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close item details'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ItemBrowser', () => {
  it('filters as I type, leaves gear out (the Gear box places it) and marks items that need a shape', () => {
    const onPick = vi.fn();
    const onEdit = vi.fn();
    const noShape = { ...data, items: new Map([...data.items, ['stone', { ...data.items.get('stone')!, shape: null }]]) } as typeof data;
    const { container } = render(<ItemBrowser data={noShape} supplyIds={new Set(['rock'])} onPick={onPick} onEdit={onEdit} />);
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'ban' } });
    expect(container.querySelectorAll('.list-row')).toHaveLength(0); // Band is a ring
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'stone' } });
    const rows = container.querySelectorAll('.list-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toMatch(/Stone.*needs shape/);
    fireEvent.click(rows[0]!);
    expect(onEdit).toHaveBeenCalled(); // no shape → open the editor
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'rock' } });
    fireEvent.click(container.querySelector('.list-row')!);
    expect(onPick.mock.calls[0]![0].id).toBe('rock');
    expect(container.querySelector(".list-row")!.textContent).toMatch(/starting eq./);
  });
});

describe('build setup editors', () => {
  it('commits valid K/M/B stats and rejects invalid ones', () => {
    const onChange = vi.fn();
    const p = makeProfile(data, PROFILE);
    render(<BuildStats data={data} profile={p} update={(fn) => { const next = structuredClone(p); fn(next); onChange(next); }} />);
    fireEvent.change(screen.getByLabelText('ATK'), { target: { value: '1.5m' } });
    expect(onChange.mock.calls[0]![0].basic_stats.atk).toBe('1.5M');
    fireEvent.change(screen.getByLabelText('ATK'), { target: { value: '1.5x' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/like 4M, 1\.34M, 812\.5K/)).toBeTruthy();
  });

  it('shows the pet activation budget', () => {
    const p = makeProfile(data, `${PROFILE}pets: [{ id: wolf, stars: 1 }, { id: cat, stars: 0 }, { id: rockpet, stars: 0, active: false }]\n`);
    render(<PetsEditor data={data} profile={p} update={vi.fn()} />);
    expect(screen.getByTitle('Active pets cost 5 / 5 points')).toBeTruthy();
    expect(petPoints(data, p)).toEqual({ used: 5, max: 5 });
  });
});

describe('BattlePanel', () => {
  it('runs a battle against an enemy typed in, and shows the result and log', async () => {
    const onChange = vi.fn();
    const data = combatData();
    const loadout = combatLoadout(['sure'], '', data);
    const battle = {
      mode: 'stage',
      seed: 1,
      runs: 1,
      enemy: {
        id: 'x', name: 'Target', hp: '450K', atk: 0, block: 0, damage_reduction: 0, attacks: [], boss: false,
        starting_statuses: [], resistances: {}, vulnerabilities: {}, immunities: [], traits: [],
      },
    };
    render(<BattlePanel loadout={loadout} battle={battle} onChange={onChange} />);
    fireEvent.click(screen.getByText('Run battle'));
    expect(await screen.findByText(/Win after 0\.5s/)).toBeTruthy();
    expect(screen.getByText(/Event log/)).toBeTruthy();
    // My breakdown and the enemy's side by side.
    expect(within(screen.getByRole('table', { name: 'My breakdown' })).getByText('Sure Shot')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: "⚔ Target's breakdown" })).queryByText('Sure Shot')).toBeNull();
    fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '20' } });
    expect(onChange.mock.calls.at(-1)![0].runs).toBe(20);
  });

  it('turns a typed-in enemy into a full build (a copy of mine) and offers to edit it', () => {
    const onChange = vi.fn();
    const onEditEnemy = vi.fn();
    const data = combatData();
    const loadout = combatLoadout(['sure'], '', data);
    const mine = { profile: loadout.profile, placements: [{ id: 's', item: 'sure', x: 0, y: 0, rotation: 0 as const, supply: false }] };
    const enemy = { id: 'x', name: 'Mirror', hp: '1M', atk: 0, block: 0, damage_reduction: 0, attacks: [], boss: false, starting_statuses: [], resistances: {}, vulnerabilities: {}, immunities: [], traits: [] };
    const { rerender } = render(<BattlePanel loadout={loadout} battle={{ mode: 'stage', seed: 1, runs: 1, enemy }} onChange={onChange} myBuild={() => mine} layoutAsBuild={vi.fn()} onEditEnemy={onEditEnemy} />);
    fireEvent.click(screen.getByLabelText(/Full build/));
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.enemy.build.placements).toHaveLength(1);
    rerender(<BattlePanel loadout={loadout} battle={next} onChange={onChange} myBuild={() => mine} layoutAsBuild={vi.fn()} onEditEnemy={onEditEnemy} />);
    expect(screen.queryByLabelText('Enemy HP')).toBeNull(); // HP comes from the build
    fireEvent.click(screen.getByText('Edit enemy build'));
    expect(onEditEnemy).toHaveBeenCalled();
  });
});
