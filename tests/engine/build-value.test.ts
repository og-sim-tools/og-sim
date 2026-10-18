/** Build value (shop items only), and data the user confirmed on 2026-10-17. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout, buildValue } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { combatData, combatProfile } from '../combat-fixture';

const data = combatData([
  {
    path: 'items/manual/value-test.yaml',
    text: `
- { id: cheap, name: Cheap, rarity: common, tags: [tool], footprint: "#", value: 3, source: manual, verified: true }
- { id: pricey, name: Pricey, rarity: epic, tags: [tool], footprint: "#", value: 12, source: manual, verified: true }
- { id: mystery, name: Mystery, rarity: epic, tags: [tool], footprint: "#", value: 0, value_unknown: true, source: manual, verified: true }
- { id: summoned, name: Summoned, kind: skin_spawn, rarity: rare, tags: [creature], footprint: "#", value: 1, source: manual, verified: true }
`,
  },
]);

const lo = (placements: { item: string; supply?: boolean }[]) =>
  buildLoadout(data, combatProfile('', data), LayoutSchema.parse({ placements: placements.map((p, i) => ({ id: `${p.item}${i}`, item: p.item, x: i, y: 0, supply: p.supply ?? false })) }));

describe('build value', () => {
  it('adds up bought items; starting equipment and spawned items do not count', () => {
    expect(buildValue(lo([{ item: 'cheap' }, { item: 'pricey' }, { item: 'cheap' }]))).toEqual({ total: 18, items: 3, unknown: [] });
    expect(buildValue(lo([{ item: 'pricey' }, { item: 'cheap', supply: true }, { item: 'summoned' }])).total).toBe(12);
  });

  it('lists items whose value is not known', () => {
    expect(buildValue(lo([{ item: 'cheap' }, { item: 'mystery' }]))).toEqual({ total: 3, items: 2, unknown: ['Mystery'] });
  });
});

describe('confirmed in game (2026-10-17)', () => {
  const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;

  it('has the values the wiki showed as ?', () => {
    const v = (id: string) => [d.items.get(id)!.value, d.items.get(id)!.value_unknown];
    expect(v('shadow_hunter')).toEqual([32, false]);
    expect(v('fairy_dragon')).toEqual([17, false]);
    expect(v('poison_bug')).toEqual([0, false]);
  });

  it('Sunspot Sphere: 30x ATK, then ×1.5 / 2 / 2.5 / 3.5 / 5 by star', () => {
    const ratios = d.skins.get('cecilia_arua_raven')!.effects.map((e) => (e.value as { ratio: number }).ratio);
    expect(ratios).toEqual([30, 45, 60, 75, 105, 150]);
  });

  it('True Sight: the Crit DMG starts once 40 Focus is reached and stays', () => {
    const e = d.items.get('true_sight')!.effects.find((x) => x.stat === 'crit_damage_pct')!;
    expect(e).toMatchObject({ trigger: 'on_status_applied', limit: { per_battle: 1 }, condition: { status: 'focus', min_stacks: 40 } });
  });
});
