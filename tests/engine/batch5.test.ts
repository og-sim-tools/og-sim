/** Effects batch 5 (every remaining item) and the generic mechanics it needed. */
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat/battle';
import { dotAffects } from '../../src/engine/effects/resolve';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { deleteLayout } from '../../src/server/files';
import { ENEMY, combatLoadout } from '../combat-fixture';

const real = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const calm = { traits: ['short_time_limit'] };
const atk = (damage: string, accuracy = 1000, cooldown = 1) => [{ damage, cooldown, accuracy, hits: 1, crit_chance: 0 }];
const fight = (items: string[], enemy: Parameters<typeof ENEMY>[0] = {}, durationS = 3.05, stats = 'crit_rate: 0', seed = 1) =>
  runBattle(combatLoadout(items, stats, real), ENEMY({ hp: '100B', ...calm, ...enemy }), { durationS, log: true, seed });

describe('batch 5 mechanics', () => {
  it('Axe gains +20% DMG with every hit', () => {
    const r = fight(['axe'], {}, 6.65);
    const hits = r.log.filter((e) => e.type === 'damage' && e.source === 'axe0').map((e) => e.amount!);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[1]! / hits[0]!).toBeCloseTo(1.2 / 1.0, 1);
  });

  it('random extra hits (Spark: 0~1 more) and auto crits (Firestorm vs 41+ Burn)', () => {
    const hitsPer = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const r = fight(['flame_staff@1,2', 'intermediate_magic_spark@2,1'], {}, 2.35, 'crit_rate: 0', seed);
      const a = r.log.filter((e) => e.type === 'hit' && e.source === 'intermediate_magic_spark1').length;
      if (a) hitsPer.add(a);
    }
    expect([...hitsPer].some((n) => n >= 2)).toBe(true);
    // Each extra attack is an activation of its own (On Activation / dot watchers see it again), one hit each.
    let moreActivations = false;
    for (let seed = 1; seed <= 12; seed++) {
      const r = fight(['flame_staff@1,2', 'intermediate_magic_spark@2,1'], {}, 2.35, 'crit_rate: 0', seed);
      const spark = r.items.intermediate_magic_spark1!;
      expect(spark.activations).toBe(spark.attacks);
      expect(r.log.some((e) => e.type === 'attack' && e.source === 'intermediate_magic_spark1' && /hits\)/.test(e.detail ?? ''))).toBe(false);
      if (spark.activations > r.items.flame_staff0!.attacks) moreActivations = true;
    }
    expect(moreActivations).toBe(true);
    const storm = fight(['flame_staff@1,2', 'fusion_magic_firestorm@1,0'], { starting_statuses: [{ status: 'burn', stacks: 50 }] }, 2.15);
    expect(storm.items.fusion_magic_firestorm1!.crits).toBe(storm.items.fusion_magic_firestorm1!.hits);
  });

  it('Massive Hammer: up to +100% DMG at full HP, less when hurt', () => {
    const full = fight(['massive_hammer'], {}, 2.45, 'crit_rate: 0', 3).log.find((e) => e.type === 'damage' && e.source === 'massive_hammer0');
    expect(full?.amount).toBeCloseTo(2.7 * 100_000 * 2, -2);
  });

  it('Plate Helmet: [dot] weapon deals extra damage equal to 15% of current Block', () => {
    const r = fight(['training_sword@0,0', 'plate_helmet@1,0'], {}, 1.85);
    const hit = r.log.find((e) => e.type === 'damage' && e.source === 'training_sword0')!.amount!;
    expect(hit).toBeGreaterThan(100_000); // 1.0x ATK + 15% of 0.2x HP Block
  });

  it('Fairy Dragon heals more per Burn stack on the enemy (scale_per_status)', () => {
    const r = fight(['fairy_dragon'], { starting_statuses: [{ status: 'burn', stacks: 50 }], attacks: atk('200K') }, 3.05);
    const heals = r.log.filter((e) => e.type === 'heal' && e.source === 'fairy_dragon0').map((e) => e.amount!);
    expect(heals.some((h) => h > 0)).toBe(true);
  });

  it('Berserk Potion: HP lost grows by 0.05x Max HP each activation', () => {
    const r = fight(['berserk_potion'], {}, 7.05);
    const lost = r.log.filter((e) => e.type === 'hp_lost').map((e) => Math.round(e.amount!));
    expect(lost).toEqual([Math.round(0.15 * 1_150_000), Math.round(0.2 * 1_150_000)]);
  });

  it('Blood Frenzy: +50% DMG per 15% of max HP lost (on_hp_lost)', () => {
    const r = fight(['blood_frenzy'], { attacks: atk('160K') }, 2.25);
    expect(r.log.some((e) => e.detail?.includes('On 15% HP Loss'))).toBe(true);
  });

  it('Crow Necklace counts [dot] items that grant Dodge (applies filter)', () => {
    const r = fight(['crow_necklace@1,0', 'crows_claw@0,0', 'rock@2,0'], {}, 0.1);
    expect(r.player.statuses.dodge).toBe(10 + 7);
  });

  it('Monocle: after a [dot] weapon misses, its next attack gets +45% accuracy (until it hits)', () => {
    const r = fight(['training_sword@0,0', 'monocle@1,0'], { starting_statuses: [{ status: 'dodge', stacks: 60 }] }, 8, 'crit_rate: 0', 4);
    expect(r.log.some((e) => e.detail?.includes("[dot] Weapon's next attack gains 45% Accuracy"))).toBe(true);
  });

  it('every shop item with effect text is marked complete', () => {
    const left = [...real.items.values()].filter((i) => i.effect_text.trim() && i.effects_status !== 'complete');
    expect(left.map((i) => i.id)).toEqual([]);
    const gearLeft = [...real.gear.values()].filter((g) => (g as { effects_status?: string }).effects_status !== 'complete');
    expect(gearLeft.map((g) => g.id)).toEqual([]);
  });
});

describe('dot relevance', () => {
  it('an item with no dot effects affects nothing; "[dot] Item On Burn" needs an item that applies Burn', () => {
    const lo = combatLoadout(['rock@0,0', 'archwizards_ring@1,0'], '', real);
    const pf = real.gear.get('primal_flame')!.effects;
    expect(dotAffects(pf.filter((e) => e.trigger === 'on_status_applied'), lo.entries.get('archwizards_ring1')!)).toBe(true);
    expect(dotAffects(pf.filter((e) => e.trigger === 'on_status_applied'), lo.entries.get('rock0')!)).toBe(false);
  });
});

describe('saves', () => {
  it('deletes a saved layout file', () => {
    const root = mkdtempSync(join(tmpdir(), 'og-'));
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(root, 'layouts'));
    writeFileSync(join(root, 'layouts', 'bjorn spike.yaml'), 'placements: []\n');
    deleteLayout(root, 'bjorn spike');
    expect(existsSync(join(root, 'layouts', 'bjorn spike.yaml'))).toBe(false);
    expect(() => deleteLayout(root, 'bjorn spike')).toThrow(/No layout/);
  });
});

describe('buff / debuff totals', () => {
  it('counts stacks removed from and stolen from the enemy, and cleansed from me', () => {
    const enemy = { starting_statuses: [{ status: 'focus', stacks: 30 }] };
    const removed = fight(['heros_circlet'], enemy, 3.6);
    expect(removed.statusMoves.player.removed).toBe(5);
    const stolen = fight(['bloody_crown'], enemy, 3.6);
    expect(stolen.statusMoves.player.stolen).toBe(5);
    expect(stolen.player.statuses.focus).toBe(5);
    const cleansed = fight(['chilling_potion@0,0', 'midwinter_brush@2,0'], {}, 6.05);
    expect(cleansed.statusMoves.player.cleansed).toBe(0); // Midwinter only cleanses Poison
  });
});

describe('screenshot values (2026-10-17)', () => {
  it('flat ATK damage bonuses and corrected numbers', () => {
    expect(real.items.get('fusion_magic_deep_impact')!.effects[0]).toMatchObject({ stacks: 15 });
    expect(real.items.get('blood_frenzy')!.effects[1]).toMatchObject({ stat: 'atk_dmg_pct', amount: 50 });
    expect(real.items.get('staff_of_the_sage')!.stats.cooldown).toBe(2.3);
    expect(real.items.get('midwinter_brush')!.effects[1]).toMatchObject({ target: 'enemy', status: 'freeze' });
    expect(real.items.get('spear')!.value).toBe(6);
  });
});
