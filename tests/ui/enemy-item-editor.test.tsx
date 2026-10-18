// @vitest-environment jsdom
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { abilityCatalog, effectErrors, shownFields } from '../../src/ui/components/EffectForm';
import { EnemyItemEditor, enemyItemErrors, enemyItemPayload } from '../../src/ui/components/EnemyItemEditor';
import { DEFAULT_PROFILE } from '../../src/ui/App';
import { ENEMY, combatData, combatLoadout } from '../combat-fixture';

vi.mock('../../src/ui/api', () => ({ saveManualEntry: vi.fn(async () => undefined), deleteManualEntry: vi.fn(async () => undefined) }));
import { saveManualEntry } from '../../src/ui/api';

afterEach(cleanup);
const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;

describe('ability catalog and effect form helpers', () => {
  it('lists every structured effect from items, gear, hero skills and pets', () => {
    const cat = abilityCatalog(real);
    expect(cat.some((c) => c.source === 'Gear: Primal Flame' && c.effect.action === 'trigger_status')).toBe(true);
    expect(cat.some((c) => c.source.startsWith('Hero: '))).toBe(true);
    expect(cat.some((c) => c.source === 'Pet: Red Dragon')).toBe(true);
    expect(cat.every((c) => c.effect.min_stars === undefined && c.effect.gear_min_rarity === undefined)).toBe(true);
  });

  it('shows the parameters the trigger and action use, and checks the effect', () => {
    expect(shownFields({ trigger: 'timer', action: 'apply_status' })).toEqual(expect.arrayContaining(['interval_s', 'status', 'stacks', 'duration_s']));
    expect(effectErrors({ trigger: 'on_hit', target: 'enemy', action: 'apply_status' })).not.toEqual([]); // no status / stacks
    expect(effectErrors({ trigger: 'on_hit', target: 'enemy', action: 'apply_status', status: 'burn', stacks: 2 })).toEqual([]);
  });

  it('saves enemy items as normal items flagged enemy_item, and rejects bad ones', () => {
    const d = { id: '', name: 'Ogre Club', rarity: 'rare' as const, value: 0, tags: ['weapon'], footprint: '# / #', stats: { damage: { ratio: 3, scales_with: 'atk' }, cooldown: 3, accuracy: 90 }, effect_text: '', effects: [] };
    expect(enemyItemPayload(d)).toMatchObject({ id: 'ogre_club', enemy_item: true, source: 'manual' });
    expect(enemyItemErrors(d, real, true)).toEqual([]);
    expect(enemyItemErrors({ ...d, name: 'Spear' }, real, true)).toContain('"spear" is already used by another item.');
    expect(enemyItemErrors({ ...d, effects: [{ trigger: 'nope' }] }, real, true).length).toBeGreaterThan(0);
  });
});

describe('EnemyItemEditor', () => {
  it('copies an ability by search and saves the item', async () => {
    render(<EnemyItemEditor data={real} onSaved={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByText('New enemy item'));
    fireEvent.change(screen.getByLabelText('Enemy item name'), { target: { value: 'Ogre Club' } });
    fireEvent.change(screen.getByLabelText('Search abilities'), { target: { value: 'Stun the enemy for 1s' } });
    fireEvent.click(screen.getAllByText(/Stun the enemy for 1s/)[0]!);
    expect(screen.getByText('Abilities (1)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Chance %'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveManualEntry).toHaveBeenCalled());
    const [cat, payload] = vi.mocked(saveManualEntry).mock.calls[0]!;
    expect(cat).toBe('items');
    expect(payload).toMatchObject({ id: 'ogre_club', enemy_item: true, effects: [{ action: 'apply_status', status: 'stun', chance_pct: 100 }] });
  });
});

describe('enemy items in battle', () => {
  it("an enemy build can carry a monster item, and its abilities run on the enemy's side", () => {
    const data = combatData([
      {
        path: 'items/manual/monster.yaml',
        text: `- { id: ogre_club, name: Ogre Club, rarity: rare, tags: [weapon], footprint: "#", value: 0, enemy_item: true, stats: { damage: { ratio: 0.01, scales_with: atk }, cooldown: 1, accuracy: 1000 }, effects: [{ trigger: on_hit, target: enemy, action: apply_status, status: burn, stacks: 3 }], source: manual, verified: true }`,
      },
    ]);
    const lo = combatLoadout([], '', data);
    const r = runBattle(
      lo,
      ENEMY({ name: 'Ogre', traits: ['short_time_limit'], build: { profile: { ...DEFAULT_PROFILE, basic_stats: { hp: '10M', atk: '10K', initial_block: 0 } }, placements: [{ id: 'c', item: 'ogre_club', x: 0, y: 0, rotation: 0, supply: false }] } }),
      { durationS: 2.05 },
    );
    expect(r.items['enemy:c']!.statuses.burn).toBe(6); // hits at 1 s and 2 s
    expect(r.player.statuses.burn).toBe(6);
  });
});
