// @vitest-environment jsdom
/** Overkill not counted, activations/triggers in reports, tagged inflict blessings, one of each supply, draggable unplaced item. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { validateLoadout } from '../../src/engine/validate';
import { BagGrid } from '../../src/ui/components/BagGrid';
import { ENEMY, combatData, combatLoadout, combatProfile, fight } from '../combat-fixture';

afterEach(cleanup);

describe('damage totals', () => {
  it('never count more than the enemy had (no overkill, nothing after 0 HP)', () => {
    const r = fight(['burnstart', 'burnstart', 'burnstart', 'blade'], { hp: '1M' }, { durationS: 30, stats: 'burn_dmg_increase: 100000' });
    expect(r.winner).toBe('player');
    expect(r.player.damageDealt).toBeLessThanOrEqual(1e6 + 1);
    expect(r.statusDamage.burn ?? 0).toBeLessThanOrEqual(1e6 + 1);
  });
});

describe('item reports', () => {
  it('count activations (cooldown) and triggers (effects) separately', () => {
    const r = fight(['froster', 'potion'], { hp: '100B' }, { durationS: 3.05 });
    const froster = Object.values(r.items).find((i) => i.name === 'Froster')!;
    const potion = Object.values(r.items).find((i) => i.name === 'Potion')!;
    expect(froster).toMatchObject({ activations: 0, triggers: 1 });
    expect(potion.activations).toBe(3);
    expect(potion.triggers).toBe(3);
  });
});

describe('[Spirit] Burn Inflict & Swift Gain', () => {
  const data = combatData([
    { path: 'items/manual/spirit.yaml', text: '- { id: firesp, name: Fire Sp, rarity: common, tags: [tool, spirit], footprint: "#", effects: [{ trigger: battle_start, target: enemy, action: apply_status, status: burn, stacks: 10 }], value: 1, source: manual, verified: true }' },
    {
      path: 'heroes/manual/h.yaml',
      text: '- { id: erw, name: Erw, class: ranger, rarity: legendary, base_supply_ability: 10, source: manual, verified: true }',
    },
    {
      path: 'blessings/manual/b.yaml',
      text: '- { id: spirit_gain, name: "[Spirit] Burn Inflict & Swift Gain", kind: unique, hero: erw, item_inflict_statuses: [burn, swift], target_tags: [spirit], unit: pct, values: { mythic: { value: 50 } }, source: manual, verified: true }',
    },
  ]);
  const burnWith = (blessed: boolean, item: string) => {
    const extra = `heroes: [{ id: erw, stars: 0, blessings: { level: 5, equipped: [${blessed ? '{ id: spirit_gain, rarity: mythic, value: 50 }' : ''}] } }]\nactive_hero: erw\n`;
    const lo = buildLoadout(data, combatProfile('', data, extra), LayoutSchema.parse({ placements: [{ item, x: 0, y: 0, rotation: 0 }] }));
    return runBattle(lo, ENEMY({ hp: '100B' }), { durationS: 0.1 }).enemy.statuses.burn;
  };

  it('raises statuses inflicted by items with the tag, and only those', () => {
    expect(burnWith(false, 'firesp')).toBe(10);
    expect(burnWith(true, 'firesp')).toBe(15);
    expect(burnWith(true, 'burnstart')).toBe(10);
  });

  it('is simulated, so no "isn\'t simulated" warning', () => {
    const extra = 'heroes: [{ id: erw, stars: 0, blessings: { level: 5, equipped: [{ id: spirit_gain, rarity: mythic, value: 50 }] } }]\nactive_hero: erw\n';
    const lo = buildLoadout(data, combatProfile('', data, extra), LayoutSchema.parse({ placements: [] }));
    expect(runBattle(lo, ENEMY(), { durationS: 0.1 }).warnings.join(' ')).not.toMatch(/isn't simulated/);
  });

  it('the real Fire Spirit inflicts Burn per [dot] Spirit', () => {
    const real = readFileSync(join(__dirname, '..', '..', 'data', 'items', 'manual', 'effects_spirits.yaml'), 'utf8');
    expect(real).toMatch(/fire_spirit[\s\S]*status: burn, stacks: 12, duration_s: 10/);
    expect(real).toMatch(/wind_spirit[\s\S]*status: swift, stacks: 10, duration_s: 10/);
  });
});

describe('starting equipment', () => {
  it('two of the same is an error', () => {
    const lo = buildLoadout(
      combatData(),
      combatProfile(),
      LayoutSchema.parse({ placements: [0, 2].map((x) => ({ item: 'burnstart', x, y: 0, rotation: 0, supply: true })) }),
    );
    expect(validateLoadout(lo).map((i) => i.code)).toContain('supply_duplicate');
  });
});

describe('dragging an item in the bag', () => {
  it('hands over which item, which of its cells was grabbed and where it was dropped', () => {
    const loadout = combatLoadout(['blade']);
    const onDrop = vi.fn();
    const id = [...loadout.layout.items.keys()][0]!;
    const { container } = render(
      <BagGrid loadout={loadout} issues={[]} selected={null} hovered={null} maskEdit={false} onSelect={vi.fn()} onHover={vi.fn()} onToggleMask={vi.fn()} onDrop={onDrop} onKey={vi.fn()} />,
    );
    const cells = container.querySelectorAll<HTMLElement>('.item-cell');
    expect(cells[0]!.draggable).toBe(true);
    const store: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(cells[0]!, { dataTransfer });
    // Bag at 0,0 in jsdom; the margin is 1 cell (40px), so clientX 4.5 cells = bag x 3.
    // jsdom drops clientX/Y from drag events, so set them by hand.
    const bag = container.querySelector('.bag')!;
    const drop = createEvent.drop(bag, { dataTransfer });
    Object.defineProperties(drop, { clientX: { value: 40 * 4 + 5 }, clientY: { value: 40 * 2 + 5 } });
    fireEvent(bag, drop);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ kind: "placed", id, dx: 0, dy: 0 }), 3, 1);
  });
});

describe('skill activations', () => {
  it('a gear skill on a timer is counted separately from cooldown activations', async () => {
    const { loadGameDataFromDir } = await import('../../src/engine/loader-node');
    const { loadProfile } = await import('../../src/engine/loader');
    const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
    const profile = loadProfile(
      { path: 'p.yaml', text: 'basic_stats: { hp: 4M, atk: 1M, initial_block: 0 }\ngear:\n  weapon: { id: primal_flame, rarity: mythic, tier: 0 }\n' },
      real,
    ).profile!;
    const lo = buildLoadout(real, profile, LayoutSchema.parse({ placements: [{ item: 'primal_flame', x: 0, y: 0, rotation: 0 }] }));
    const r = runBattle(lo, ENEMY({ hp: '900B' }), { durationS: 16.05 });
    const pf = Object.values(r.items).find((i) => i.name === 'Primal Flame')!;
    expect(pf.skillActivations).toBe(2);
    expect(pf.activations).toBeGreaterThan(2);
  });
});

describe('expiry log', () => {
  it('says when timed stacks run out, even when other stacks stay', () => {
    const r = fight(['timedburn', 'burnstart'], { hp: '900B' }, { durationS: 4 });
    expect(r.log.some((e) => e.detail?.includes('10 burn wears off (now 10)'))).toBe(true);
  });
  it('says when a timed stat change ends', () => {
    const data = combatData([
      { path: 'items/manual/t.yaml', text: '- { id: furyband, name: Furyband, rarity: common, tags: [tool], footprint: "#", effects: [{ trigger: battle_start, target: player, action: add_player_stat, player_stat: all_dmg_increase, amount: 20, duration_s: 2 }], value: 1, source: manual, verified: true }' },
    ]);
    const r = runBattle(combatLoadout(['furyband'], '', data), ENEMY({ hp: '900B' }), { durationS: 3, log: true });
    expect(r.log.some((e) => e.detail?.includes('all_dmg_increase +20 (Furyband) ends'))).toBe(true);
  });
});

describe('battle-start stats (item side panel)', () => {
  it('shows an item after Start of Battle effects: Swift Haste speeds it up', async () => {
    const { battleStartStats } = await import('../../src/engine/combat/battle');
    const lo = combatLoadout(['blade', 'swifter']);
    const s = battleStartStats(lo, ENEMY())!.get('blade0')!;
    expect(s.hastePct).toBe(25);
    expect(s.cooldown).toBeCloseTo(2 / 1.25);
    expect(s.damagePerHit).toBeCloseTo(100_000);
  });
});

describe('helped-apply statuses and Plague-style debuffs', () => {
  const data = combatData([
    {
      path: 'items/manual/plague.yaml',
      text: '- { id: plaguer, name: Plaguer, rarity: common, tags: [armor], footprint: "#o", effects: [{ trigger: on_weapon_hit, uses_dots: true, target: enemy, action: apply_status, pick: most_stacks_debuff, stacks: 2, ignore_inflict_bonus: true }], value: 1, source: manual, verified: true }',
    },
  ]);
  it('credits the weapon whose hits made the gloves apply Burn, and skips Burn Inflict bonuses', () => {
    const lo = combatLoadout(['burnstart@4,0', 'plaguer@0,0', 'sure@1,0'], 'burn_inflict_increase: 50', data);
    const r = runBattle(lo, ENEMY({ hp: '900B', traits: ['short_time_limit'] }), { durationS: 1.05 });
    const sure = Object.values(r.items).find((i) => i.name === 'Sure Shot')!;
    const plaguer = Object.values(r.items).find((i) => i.name === 'Plaguer')!;
    expect(plaguer.statuses.burn).toBe(2 * sure.hits); // 2 per hit, not 3
    expect(sure.assisted.burn).toBe(plaguer.statuses.burn);
    expect(r.enemy.statuses.burn).toBe(15 + 2 * sure.hits); // burnstart 10 × 1.5, gloves unboosted
  });
});
