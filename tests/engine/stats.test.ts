import { describe, expect, it } from 'vitest';
import { resolveApplications } from '../../src/engine/effects/resolve';
import { buildSynergyReport } from '../../src/engine/effects/synergy';
import { aggregateStats } from '../../src/engine/stats';
import { makeData, makeLoadout, makeProfile } from '../helpers';

const data = makeData();
const profile = makeProfile(data);

//   x: 0     1      2      3     4     5    6   7
// y0: glove sword  glove  pup
// y1:       sword  stone
// y3:                          pup2  scope scope
// y5:                                              potion
const LAYOUT = `
placements:
  - { id: g1, item: glove, x: 0, y: 0 }
  - { id: sword, item: sword, x: 1, y: 0 }
  - { id: g2, item: glove, x: 2, y: 0 }
  - { id: pup, item: pup, x: 3, y: 0 }
  - { id: stone, item: stone, x: 2, y: 1 }
  - { id: pup2, item: pup, x: 4, y: 3 }
  - { id: scope, item: scope, x: 5, y: 3 }
  - { id: potion, item: potion, x: 7, y: 5 }
`;

describe('stat aggregation', () => {
  const loadout = makeLoadout(data, profile, LAYOUT);
  const { player, items, issues } = aggregateStats(loadout);

  it('reads basic and detailed stats from the profile, with registry defaults', () => {
    expect(issues).toEqual([]);
    expect(player).toMatchObject({ hp: 4_000_000, atk: 1_000_000, initialBlock: 1_000_000 });
    expect(player.detailed.item_haste).toBe(10);
    expect(player.detailed.crit_dmg).toBe(100); // registry default
    expect(player.detailed.evasion).toBe(0);
  });

  it('stacks haste additively: two gloves = +30%, plus global 10% (SPEC §4.3 example)', () => {
    const sword = items.get('sword')!.cooldown!;
    expect(sword.haste.total).toBe(40);
    expect(sword.haste.parts.map((p) => [p.label, p.amount])).toEqual([
      ['Manual adjustment', 10],
      ['Glove', 15],
      ['Glove', 15],
    ]);
    expect(sword.final).toBeCloseTo(2 / 1.4);
    expect(items.get('pup')!.cooldown!.haste.total).toBe(25); // one glove
    expect(items.get('pup2')!.cooldown!.haste.total).toBe(10); // no glove
    expect(items.get('pup2')!.cooldown!.final).toBeCloseTo(3 / 1.1);
  });

  it('counts a target once when several dots of one effect cover it', () => {
    // The stone's ring of dots covers both sword cells.
    expect(items.get('sword')!.damage!.typePct.parts.filter((p) => p.label === 'Stone')).toHaveLength(1);
  });

  it('builds damage: ratio × ATK × (1 + type%) × (1 + all%)', () => {
    const d = items.get('sword')!.damage!;
    expect(d.base).toBe(1_000_000);
    expect(d.typePct.total).toBe(35); // Attack DMG Increase 5 + Stone 30
    expect(d.allPct.total).toBe(10);
    expect(d.modifier).toBeCloseTo(1.35 * 1.1);
    expect(d.perHit).toBeCloseTo(1_485_000);
    expect(items.get('pup')!.damage!.hits).toBe(2);
  });

  it('applies tag filters (creature crit DMG goes to the pup, not the sword)', () => {
    expect(items.get('pup')!.critDamage!.total).toBe(140);
    expect(items.get('sword')!.critDamage!.total).toBe(100);
  });

  it('adds item crit rate to the global one and caps at 100%', () => {
    expect(items.get('pup')!.critChance!).toMatchObject({ total: 30, capped: 30 });
  });

  it('keeps raw accuracy unclamped (it can exceed 100%)', () => {
    expect(items.get('pup2')!.accuracy!.total).toBe(130);
    expect(items.get('pup')!.accuracy!.total).toBe(85);
  });

  it('ignores triggers that only happen in combat (on_hit)', () => {
    expect(items.get('pup')!.cooldown!.haste.parts.some((p) => p.amount === 99)).toBe(false);
  });

  it('scales effect values with the current basic stat', () => {
    expect(items.get('potion')!.effectValues.heal!.value).toBeCloseTo(400_000);
    expect(items.get('potion')!.damage).toBeNull();
    expect(items.get('potion')!.cooldown).toBeNull();
  });

  it('can add All DMG into the type bonus instead (config switch)', () => {
    const cfg = structuredClone(data.config!);
    cfg.combat.all_dmg_mode = 'additive';
    const res = aggregateStats({ ...loadout, data: { ...data, config: cfg } });
    expect(res.items.get('sword')!.damage!.modifier).toBeCloseTo(1.45);
  });

  it('clamps cooldowns to the minimum', () => {
    const fast = makeProfile(data, profileWith('item_haste: 5000'));
    const res = aggregateStats(makeLoadout(data, fast, LAYOUT));
    expect(res.items.get('sword')!.cooldown).toMatchObject({ final: 0.1, clamped: true });
  });

  it('refuses to guess when passives are not included in Stat Details', () => {
    const cfg = structuredClone(data.config!);
    cfg.stats.passives_included_in_stat_details = false;
    const res = aggregateStats({ ...loadout, data: { ...data, config: cfg } });
    expect(res.issues.map((i) => i.code)).toEqual(['passives_not_supported']);
  });
});

describe('gear effects by rarity', () => {
  const layout = `
placements:
  - { id: blade, item: blade, x: 0, y: 4 }
  - { id: pup, item: pup, x: 2, y: 4 }
`;
  it('applies a rarity effect only at that rarity or higher', () => {
    const rare = makeProfile(data, `${profileWith('')}gear: { weapon: { id: blade, rarity: rare } }\n`);
    const epic = makeProfile(data, `${profileWith('')}gear: { weapon: { id: blade, rarity: legendary } }\n`);
    expect(aggregateStats(makeLoadout(data, rare, layout)).items.get('pup')!.cooldown!.haste.total).toBe(0);
    expect(aggregateStats(makeLoadout(data, epic, layout)).items.get('pup')!.cooldown!.haste.total).toBe(10);
  });

  it('uses the gear basic attack for its stats', () => {
    const p = makeProfile(data, `${profileWith('')}gear: { weapon: { id: blade, rarity: epic } }\n`);
    const blade = aggregateStats(makeLoadout(data, p, layout)).items.get('blade')!;
    expect(blade.kind).toBe('gear');
    expect(blade.damage!.base).toBe(1_000_000);
    expect(blade.accuracy!.total).toBe(90);
  });
});

describe('synergy report', () => {
  const loadout = makeLoadout(data, profile, LAYOUT);
  const report = buildSynergyReport(loadout);

  it('lists what each item gives and to whom', () => {
    const stone = report.get('stone')!;
    expect(stone.gives.map((g) => [g.text, g.targets])).toEqual([
      ['+30% damage', ['sword', 'pup']],
      ['+40% crit_damage', ['pup']],
      ['on_hit: +99% haste', ['sword', 'g2', 'pup']],
    ]);
  });

  it('lists what each item receives and from which item', () => {
    expect(report.get('pup')!.receives.map((r) => `${r.fromName}: ${r.text}`)).toEqual([
      'Glove: +15% haste',
      'Stone: +30% damage',
      'Stone: +40% crit_damage',
      'Stone: on_hit: +99% haste',
    ]);
  });

  it('shows items under the dots for effects that are still text only', () => {
    expect(report.get('sword')!.textOnly).toBeNull();
    expect(report.get('g1')!.dotTargets).toEqual(['sword']);
  });

  it('resolveApplications can filter effects', () => {
    expect(resolveApplications(loadout, (e) => e.trigger === 'on_hit')).toHaveLength(1);
  });
});

function profileWith(statsLine: string): string {
  return `basic_stats: { hp: "4M", atk: "1M", initial_block: "1M" }
detailed_stats: { ${statsLine} }
heroes: [{ id: alpha, stars: 6 }]
active_hero: alpha
`;
}

describe('blessings (SPEC §4.6)', () => {
  const withBlessings = (extra = '') =>
    makeProfile(
      data,
      `basic_stats: { hp: "4M", atk: "1M", initial_block: "1M" }
heroes:
  - id: alpha
    stars: 6
    blessings: { level: 5, equipped: [{ id: sword_dmg, rarity: rare, value: 7 }, { id: all_dmg, rarity: epic, value: 8 }, { id: alpha_bonus, rarity: legendary, value: 25 }] }
active_hero: alpha
${extra}`,
    );
  const layout = 'placements: [{ id: sword, item: sword, x: 0, y: 0 }, { id: pup, item: pup, x: 2, y: 0 }]';

  // Stats are calculated from gear and blessings now (user, 2026-10-16): stat blessings are added too.
  it('adds tag blessings to matching items, and stat blessings to everything', () => {
    const res = aggregateStats(makeLoadout(data, withBlessings(), layout));
    expect(res.items.get('sword')!.damage!.typePct.parts.map((p) => [p.label, p.amount])).toEqual([['Blessing: [Sword] DMG', 7]]);
    expect(res.items.get('pup')!.damage!.typePct.parts).toEqual([]);
    expect(res.items.get('sword')!.damage!.allPct.total).toBe(8); // All DMG blessing
    expect(res.issues.map((i) => i.message)).toEqual([`Blessing "Alpha bonus" isn't simulated (skill buff or conditional bonus) [later].`]);
  });

  it('can treat tag blessings as already in Stat Details (config)', () => {
    const lo = makeLoadout(data, withBlessings(), layout);
    const cfg = structuredClone(data.config!);
    cfg.blessings.tag_bonuses_in_stat_details = true;
    const res = aggregateStats({ ...lo, data: { ...data, config: cfg } });
    expect(res.items.get('sword')!.damage!.typePct.parts).toEqual([]);
  });
});
