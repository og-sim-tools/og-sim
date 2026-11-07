/** Pet / skin spawns as real, movable bag items (user, 2026-11-06), one of each pet, fixed unique blessing values. */
import { describe, expect, it } from 'vitest';
import { syncSpawnPlacements, withPetSpawns } from '../../src/engine/combat/setup';
import { buildLoadout } from '../../src/engine/loadout';
import { validateLoadout } from '../../src/engine/validate';
import { DATA_, combatLoadout } from '../combat-fixture';

const pet = (stars: number, active = true) => `pets: [{ id: spawner, stars: ${stars}, active: ${active} }]\n`;
const eggs = (l: { placements: { item: string; x: number; y: number }[] }) => l.placements.filter((p) => p.item === 'egg').map((p) => [p.x, p.y]);

describe('pet spawns in the bag', () => {
  it('are put in the first free spots while the pet is active, like at the start of battle', () => {
    const lo = combatLoadout(['blade@0,0'], '', DATA_, pet(0));
    const next = syncSpawnPlacements(lo)!;
    expect(eggs(next)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    // Settled: nothing more to do, and the battle adds none on top.
    const again = buildLoadout(DATA_, lo.profile, next);
    expect(syncSpawnPlacements(again)).toBeNull();
    expect([...withPetSpawns(again).loadout.entries.values()].filter((e) => e.def.id === 'egg')).toHaveLength(3);
  });

  it('stay where I moved them', () => {
    expect(syncSpawnPlacements(combatLoadout(['egg@5,5', 'egg@6,5', 'egg@7,5'], '', DATA_, pet(0)))).toBeNull();
    const one = syncSpawnPlacements(combatLoadout(['egg@5,5'], '', DATA_, pet(0)))!;
    expect(eggs(one)).toEqual([
      [5, 5],
      [0, 0],
      [1, 0],
    ]);
  });

  it('are taken out when the pet is turned off or removed (storage first)', () => {
    const off = syncSpawnPlacements(combatLoadout(['blade@0,0', 'egg@5,5', 'egg@6,5'], '', DATA_, pet(0, false)))!;
    expect(off.placements.map((p) => p.item)).toEqual(['blade']);
    const lo = combatLoadout(['egg@5,5', 'egg@6,5', 'egg@7,5'], '', DATA_, pet(0));
    const stored = buildLoadout(DATA_, lo.profile, { ...lo.layoutData, storage: [{ item: 'egg', x: 0.1, y: 0.1, rotation: 0, supply: false }] });
    const fewer = syncSpawnPlacements(stored)!;
    expect(fewer.storage).toBeUndefined();
    expect(eggs(fewer)).toHaveLength(3);
  });

  it('leave items that are not spawns alone', () => {
    expect(syncSpawnPlacements(combatLoadout(['blade@0,0'], '', DATA_, ''))).toBeNull();
  });
});

describe('one of each pet', () => {
  it('is an error to equip the same pet twice', () => {
    const lo = combatLoadout([], '', DATA_, 'pets: [{ id: spawner, stars: 0, active: true }, { id: spawner, stars: 0, active: false }]\n');
    expect(validateLoadout(lo).map((i) => i.code)).toContain('pet_duplicate');
    expect(validateLoadout(combatLoadout([], '', DATA_, pet(0))).map((i) => i.code)).not.toContain('pet_duplicate');
  });
});
