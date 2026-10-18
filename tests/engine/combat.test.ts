import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BattleSetupError, runBattle } from '../../src/engine/combat/battle';
import { berserkBonus, berserkStacksAt } from '../../src/engine/combat/berserk';
import { distribution, resolveEnemy, runMonteCarlo, runSeed } from '../../src/engine/combat/montecarlo';
import type { BattleEvent } from '../../src/engine/combat/types';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { Rng } from '../../src/engine/rng';
import { FractionalStacks } from '../../src/engine/statuses/runtime';
import { DATA_, ENEMY, combatLoadout, fight } from '../combat-fixture';

const times = (log: BattleEvent[], type: BattleEvent['type'], source?: RegExp) =>
  log.filter((e) => e.type === type && (!source || source.test(e.source ?? ''))).map((e) => e.t);
const damages = (log: BattleEvent[], side: 'player' | 'enemy', type = 'weapon') =>
  log.filter((e) => e.type === 'damage' && e.side === side && e.detail?.startsWith(type)).map((e) => e.amount!);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));

describe('seeded RNG', () => {
  it('repeats exactly for the same seed and differs for another', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
    expect(new Rng('abc').next()).toBe(new Rng('abc').next());
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("doesn't draw for 0% and 100% chances, so they don't shift the sequence", () => {
    const r = new Rng(1);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(100)).toBe(true);
    expect(r.draws).toBe(0);
  });

  it('draws integers, picks and samples in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 200; i++) expect(r.int(3)).toBeLessThan(3);
    expect(r.pick([])).toBeUndefined();
    const s = r.sample([1, 2, 3, 4], 3);
    expect(new Set(s).size).toBe(3);
  });
});

describe('fractional stacks (SPEC §5.3)', () => {
  const seq = (x: number) => {
    const f = new FractionalStacks();
    return Array.from({ length: 8 }, () => f.take('k', x));
  };
  // Rounds up first (observed in game): 1.5 → 2, 1, 2, 1.
  it('alternates 1.5 → 2, 1, 2, 1', () => expect(seq(1.5)).toEqual([2, 1, 2, 1, 2, 1, 2, 1]));
  it('spreads 1.25 → 2, 1, 1, 1', () => expect(seq(1.25)).toEqual([2, 1, 1, 1, 2, 1, 1, 1]));
  it('spreads 0.5 → 1, 0, 1, 0', () => expect(seq(0.5)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]));
  it('keeps a separate remainder per key', () => {
    const f = new FractionalStacks();
    expect([f.take('a', 0.5), f.take('b', 0.5), f.take('a', 0.5)]).toEqual([1, 1, 0]);
  });
});

describe('berserk (SPEC §7.6)', () => {
  const cfg = DATA_.config!.berserk;
  it('starts at 10.00 s with one stack and adds one per second', () => {
    expect([9.9, 10, 10.9, 11, 14.5].map((t) => berserkStacksAt(t, cfg))).toEqual([0, 1, 1, 2, 5]);
  });
  it('stack n gives +(20 + 5n)% DMG and haste and +5(n − 1)% accuracy', () => {
    expect(berserkBonus(1, cfg)).toMatchObject({ dmgPct: 25, hastePct: 25, accuracyPct: 0 });
    expect(berserkBonus(2, cfg)).toMatchObject({ dmgPct: 30, hastePct: 30, accuracyPct: 5 });
    expect(berserkBonus(6, cfg)).toMatchObject({ dmgPct: 50, hastePct: 50, accuracyPct: 25 });
  });
});

describe('timing and cooldowns', () => {
  it('attacks once per cooldown, starting after a full cooldown', () => {
    expect(times(fight(['blade'], {}, { durationS: 7 }).log, 'attack')).toEqual([2, 4, 6]);
  });

  it('applies haste: base / (1 + haste)', () => {
    expect(times(fight(['blade'], {}, { durationS: 5, stats: 'item_haste: 25' }).log, 'attack')).toEqual([1.6, 3.2, 4.8]);
    // Swift stacks add the same way.
    expect(times(fight(['blade', 'swifter'], {}, { durationS: 5 }).log, 'attack')).toEqual([1.6, 3.2, 4.8]);
  });

  it('applies item haste bonuses from start-of-battle effects (no double counting)', () => {
    // Hasty's dot (left of it) touches the blade at x=0.
    expect(times(fight(['blade@0,0', 'hasty@1,0'], {}, { durationS: 5 }).log, 'attack')).toEqual([1.6, 3.2, 4.8]);
  });

  it('Freeze is a final multiplier: 100 stacks doubles cooldowns', () => {
    const atk = [{ damage: '1', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }];
    expect(times(fight([], { attacks: atk }, { durationS: 4 }).log, 'attack')).toEqual([1, 2, 3, 4]);
    expect(times(fight(['froster'], { attacks: atk }, { durationS: 4 }).log, 'attack')).toEqual([2, 4]);
  });

  it('clamps cooldowns to 0.1 s: at most one attack per tick', () => {
    const r = fight(['blade'], {}, { durationS: 1, stats: 'item_haste: 100000' });
    expect(r.items.blade0!.attacks).toBe(10);
  });

  it('stops items that attack once per battle', () => {
    expect(fight(['rock'], {}, { durationS: 5 }).items.rock0!.attacks).toBe(1);
  });
});

describe('accuracy and crits', () => {
  it('floors hit chance at 25%', () => {
    const r = fight(['blind'], {}, { durationS: 200 });
    const it = r.items.blind0!;
    expect(it.attacks).toBe(2000);
    expect(it.hits / it.attacks).toBeGreaterThan(0.22);
    expect(it.hits / it.attacks).toBeLessThan(0.28);
  });

  it('subtracts Dodge stacks; Focus cancels them; accuracy above 100% cancels Dodge', () => {
    const dodge = { starting_statuses: [{ status: 'dodge', stacks: 50 }] };
    const r1 = fight(['true_shot'], dodge, { durationS: 100 }).items.true_shot0!;
    expect(r1.hits / r1.attacks).toBeGreaterThan(0.45);
    expect(r1.hits / r1.attacks).toBeLessThan(0.55);
    expect(fight(['true_shot', 'focuser'], dodge, { durationS: 20 }).items.true_shot0!.misses).toBe(0);
    expect(fight(['sure'], dodge, { durationS: 20 }).items.sure0!.misses).toBe(0);
  });

  it('applies my Evasion to enemy attacks', () => {
    const atk = [{ damage: '1', cooldown: 0.1, accuracy: 100, hits: 1, crit_chance: 0 }];
    // Short Time Limit: no Berserk, so the enemy's accuracy stays put for the whole run.
    const e = fight([], { attacks: atk, traits: ['short_time_limit'] }, { durationS: 100, stats: 'evasion: 40' }).items['enemy:1']!;
    expect(e.hits / e.attacks).toBeGreaterThan(0.55);
    expect(e.hits / e.attacks).toBeLessThan(0.65);
  });

  it('crits multiply by 1 + Crit DMG', () => {
    const r = fight(['blade'], {}, { durationS: 2, stats: 'crit_rate: 100, crit_dmg: 150' });
    expect(damages(r.log, 'player')).toEqual([250_000]);
    expect(r.items.blade0!.crits).toBe(1);
  });
});

describe('damage pipeline (SPEC §7.3)', () => {
  it('(base × (1 + type%) × (1 + all%))', () => {
    const [d] = damages(fight(['blade'], {}, { durationS: 2, stats: 'attack_dmg_increase: 20, all_dmg_increase: 10' }).log, 'player');
    close(d!, 100_000 * 1.2 * 1.1);
  });

  it('can add All DMG into the type bonus instead (config)', () => {
    const lo = combatLoadout(['blade'], 'attack_dmg_increase: 20, all_dmg_increase: 10');
    const cfg = structuredClone(DATA_.config!);
    cfg.combat.all_dmg_mode = 'additive';
    const r = runBattle({ ...lo, data: { ...lo.data, config: cfg } }, ENEMY(), { durationS: 2, log: true });
    close(damages(r.log, 'player')[0]!, 130_000);
  });

  it('applies damage reduction with the 25% floor', () => {
    close(damages(fight(['blade'], { damage_reduction: 20 }, { durationS: 2 }).log, 'player')[0]!, 80_000);
    close(damages(fight(['blade'], { damage_reduction: 90 }, { durationS: 2 }).log, 'player')[0]!, 25_000);
  });

  it('applies Final DMG to Bosses only against bosses', () => {
    close(damages(fight(['blade'], { boss: true }, { durationS: 2, stats: 'final_dmg_boss_increase: 20' }).log, 'player')[0]!, 120_000);
    close(damages(fight(['blade'], {}, { durationS: 2, stats: 'final_dmg_boss_increase: 20' }).log, 'player')[0]!, 100_000);
  });

  it('takes damage from block first, then HP', () => {
    const r = fight(['blade'], { block: '150K', hp: '1M' }, { durationS: 4 });
    expect(r.enemy.block).toBe(0);
    close(r.enemy.hp, 950_000);
  });

  it('lands the hits of a multi-hit attack one tick apart', () => {
    const r = fight(['triple'], {}, { durationS: 2.3 });
    expect(r.items.triple0!).toMatchObject({ attacks: 1, hits: 3 });
    expect(times(r.log, 'hit')).toEqual([2, 2.1, 2.2]);
  });

  it('ends the battle when someone dies', () => {
    const r = fight(['sure'], { hp: '450K' }, { durationS: 30 });
    expect(r).toMatchObject({ winner: 'player', reason: 'death' });
    expect(r.duration).toBeCloseTo(0.5);
    expect(r.enemy.hp).toBe(0);
  });

  it('loses on the Stage time limit', () => {
    const r = fight(['blade'], {}, { durationS: 5 });
    expect(r).toMatchObject({ winner: 'enemy', reason: 'timeout', duration: 5 });
    expect(fight([], {}).duration).toBe(30);
  });
});

describe('spell activation', () => {
  it('activates spells under the dots on attack; spells without a cooldown never fire alone', () => {
    const r = fight(['staff@0,0', 'bolt@1,0'], {}, { durationS: 6.5 });
    expect(r.items.staff0!.attacks).toBe(3);
    expect(r.items.bolt1!.attacks).toBe(3);
    expect(r.items.bolt1!.damage).toBe(3 * 200_000);
  });

  it('cuts off a truly endless activation loop (a simulator guard) and reports it as a bug', () => {
    const r = fight(['staff@0,0', 'echo@1,0'], {}, { durationS: 2 });
    expect(r.items.echo1!.attacks).toBe(DATA_.config!.combat.max_chain_depth);
    expect(r.warnings.some((w) => /Simulator bug: an endless loop/.test(w))).toBe(true);
  });
});

describe('statuses', () => {
  it('applies fractional stacks alternately (1.5 → 2, 1, 2, 1)', () => {
    expect(fight(['burner'], {}, { durationS: 4 }).enemy.statuses.burn).toBe(6);
    expect(fight(['burner'], {}, { durationS: 3 }).enemy.statuses.burn).toBe(5);
  });

  it('multiplies stacks by Inflict Increase', () => {
    expect(fight(['burner'], {}, { durationS: 4, stats: 'burn_inflict_increase: 50' }).enemy.statuses.burn).toBe(9);
  });

  it('Poison deals 0.1x the inflicter ATK per stack on the global 2 s timer', () => {
    const r = fight(['poisoner'], {}, { durationS: 4, stats: 'poison_dmg_increase: 50' });
    expect(times(r.log, 'damage')).toEqual([2, 4]);
    expect(r.statusDamage.poison).toBeCloseTo(2 * 10 * 0.1 * 100_000 * 1.5);
  });

  it('Burn hurts the holder when hit by a weapon, about half the time', () => {
    const r = fight(['burnstart', 'sure'], {}, { durationS: 100 });
    const burns = r.log.filter((e) => e.type === 'damage' && e.detail?.startsWith('status (burn)'));
    const ratio = burns.length / r.items.sure1!.hits;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
    burns.forEach((b) => close(b.amount!, 10 * 0.1 * 100_000));
  });

  it('Spike hits back whoever hits the holder (0.1x holder ATK per stack)', () => {
    const atk = [{ damage: '1', cooldown: 0.1, accuracy: 1000, hits: 1, crit_chance: 0 }];
    const r = fight(['spiker'], { attacks: atk }, { durationS: 50 });
    const spikes = r.log.filter((e) => e.detail?.startsWith('status (spike)'));
    expect(spikes.length / r.items['enemy:1']!.hits).toBeGreaterThan(0.43);
    expect(spikes.length / r.items['enemy:1']!.hits).toBeLessThan(0.57);
    spikes.forEach((s) => close(s.amount!, 100_000));
  });

  it('Vamp heals 0.005x max HP per stack on my weapon hits', () => {
    const r = fight(['halfstone', 'vamper', 'sure'], {}, { durationS: 10 });
    const heals = r.log.filter((e) => e.type === 'heal' && e.amount! > 0);
    expect(heals.length).toBeGreaterThan(0);
    heals.slice(0, 5).forEach((h) => close(h.amount!, 50_000));
  });

  it('Regen heals the holder on the global timer', () => {
    const r = fight(['blade'], { hp: '10M', starting_statuses: [{ status: 'regen', stacks: 10 }] }, { durationS: 4 });
    // t=2: regen (nothing to heal), blade 100K; t=4: regen heals the 100K back, blade hits again.
    close(r.enemy.hp, 10_000_000 - 100_000);
  });

});

describe('item effects in battle', () => {
  it('resolves battle start in order: statuses and stats, then damaging effects', () => {
    const r = fight(['opener', 'burnstart'], {}, { durationS: 1 });
    const firstStatus = r.log.findIndex((e) => e.type === 'status');
    const firstAttack = r.log.findIndex((e) => e.type === 'attack');
    expect(firstStatus).toBeGreaterThanOrEqual(0);
    expect(firstStatus).toBeLessThan(firstAttack);
    expect(times(r.log, 'attack')[0]).toBe(0);
  });

  it('gains, removes and absorbs block', () => {
    expect(fight(['shield'], {}, { durationS: 1 }).player.block).toBe(500_000);
    const r = fight(['breaker'], { block: '1M' }, { durationS: 1 });
    close(r.enemy.block, 1_000_000 - 100_000 - 100_000);
  });

  it('heals up to max HP and never lets my own HP loss kill me', () => {
    expect(fight(['potion'], {}, { durationS: 3 }).items.potion0!.healing).toBe(0);
    expect(fight(['bloodstone'], {}, { durationS: 1 }).player.hp).toBe(DATA_.config!.combat.self_hp_loss_floor);
    expect(fight(['halfstone', 'potion'], {}, { durationS: 3 }).items.potion1!.healing).toBeCloseTo(300_000);
  });

  it('fires hp_below once when HP crosses the threshold', () => {
    const atk = [{ damage: '300K', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }];
    const r = fight(['lowhp'], { attacks: atk }, { durationS: 3 });
    // 1M → 700K → 400K (≤ 50%: heal 300K → 700K) → 400K
    expect(r.items.lowhp0!.healing).toBeCloseTo(300_000);
    expect(r.player.hp).toBeCloseTo(400_000);
  });

  it('extra attacks when a dotted weapon hits (On [dot] Weapon Hit: Attack)', () => {
    const r = fight(['dog@0,0', 'blade@1,0'], {}, { durationS: 6 });
    expect(r.items.dog0!.attacks).toBe(r.items.blade1!.hits);
  });

  it('refunds cooldown when a dotted weapon hits', () => {
    const without = fight(['blade@0,0', 'dagger@3,3'], {}, { durationS: 10 }).items.dagger1!.attacks;
    const withRefund = fight(['blade@0,0', 'dagger@1,0'], {}, { durationS: 10 }).items.dagger1!.attacks;
    expect(without).toBe(1);
    expect(withRefund).toBeGreaterThanOrEqual(2);
  });

  it('stacks on-hit bonuses up to max_stacks', () => {
    const d = damages(fight(['whipper'], {}, { durationS: 5 }).log, 'player');
    expect(d.map((x) => Math.round(x))).toEqual([100_000, 110_000, 120_000, 130_000, 130_000]);
  });

  it('limits on_dodge to once per tick', () => {
    const atk = [{ damage: '1', cooldown: 1, accuracy: 0, hits: 3, crit_chance: 0 }];
    const r = fight(['dodger'], { attacks: atk }, { durationS: 20, stats: 'evasion: 100' });
    const blocks = r.log.filter((e) => e.type === 'block');
    expect(new Set(blocks.map((b) => b.t)).size).toBe(blocks.length);
    expect(blocks.length).toBeGreaterThan(5);
  });

  it('reports actions it cannot simulate yet and skips effects whose condition fails', () => {
    const r = fight(['weird'], {}, { durationS: 1 });
    expect(r.warnings.some((w) => /"spawn_item" isn't simulated yet/.test(w))).toBe(true);
    expect(r.player.block).toBe(0);
  });
});

describe('enemy berserk and modes', () => {
  const atk = [{ damage: '10K', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }];

  it('makes the enemy hit harder and faster from 10 s', () => {
    const r = fight([], { attacks: atk, hp: '1B' }, { durationS: 12 });
    const enemyHits = r.log.filter((e) => e.type === 'damage' && e.side === 'enemy');
    expect(enemyHits.find((e) => e.t === 9)!.amount).toBeCloseTo(10_000);
    expect(enemyHits.find((e) => e.t === 10)!.amount).toBeCloseTo(12_500);
    expect(enemyHits.filter((e) => e.t > 10).length).toBeGreaterThanOrEqual(2);
  });

  it('never berserks with Short Time Limit, and I never berserk in chapter modes', () => {
    const r = fight(['blade'], { attacks: atk, traits: ['short_time_limit'] }, { durationS: 12 });
    expect(damages(r.log, 'enemy').every((d) => Math.abs(d - 10_000) < 1)).toBe(true);
    expect(r.log.some((e) => e.type === 'berserk')).toBe(false);
  });

  it('rejects modes that come later', () => {
    expect(() => fight([], {}, { mode: 'gauntlet' })).toThrow(/gauntlet has 4 fights but 1 enemy was given/);
    expect(() => fight([], {}, { mode: 'raid' })).toThrow(BattleSetupError);
    expect(() => fight([], {}, { mode: 'nope' })).toThrow(/Unknown battle mode/);
  });
});

describe('determinism and Monte Carlo', () => {
  it('gives the same result for the same seed, and a different one for another seed', () => {
    const a = fight(['burnstart', 'true_shot'], {}, { seed: 5, durationS: 10 });
    const b = fight(['burnstart', 'true_shot'], {}, { seed: 5, durationS: 10 });
    const c = fight(['burnstart', 'true_shot'], {}, { seed: 6, durationS: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(c.log));
  });

  it('runs N battles with seeds counting up', () => {
    // A close race: I need 20 hits at 70% before the enemy's third 400K hit at 3 s.
    const lo = combatLoadout(['true_shot']);
    const enemy = ENEMY({
      hp: '2M',
      starting_statuses: [{ status: 'dodge', stacks: 30 }],
      attacks: [{ damage: '400K', cooldown: 1, accuracy: 1000, hits: 1, crit_chance: 0 }],
    });
    const mc = runMonteCarlo(lo, enemy, 40, { seed: 1 });
    expect(mc.runs).toBe(40);
    expect(mc.wins + (40 - mc.wins)).toBe(40);
    expect(mc.winRate).toBeGreaterThan(0);
    expect(mc.winRate).toBeLessThan(1);
    expect(runMonteCarlo(lo, enemy, 40, { seed: 1 }).wins).toBe(mc.wins);
    expect(mc.sample.seed).toBe(1);
    expect(runSeed(10, 3)).toBe(13);
    expect(runSeed('a', 2)).toBe('a#2');
  });

  it('summarises a distribution', () => {
    expect(distribution([5, 1, 3, 2, 4])).toEqual({ mean: 3, min: 1, p10: 1.4, p50: 3, p90: 4.6, max: 5 });
  });

  it('resolves enemies by id or inline and explains what is missing', () => {
    expect(() => resolveEnemy(DATA_, undefined)).toThrow(/No enemy chosen/);
    expect(() => resolveEnemy(DATA_, 'nope')).toThrow(/Unknown enemy "nope"/);
    expect(resolveEnemy(DATA_, ENEMY()).name).toBe('Dummy');
  });
});

describe('real data', () => {
  const ROOT = join(__dirname, '..', '..');
  const d = loadGameDataFromDir(join(ROOT, 'data')).data;
  const profile = loadProfile({ path: 'p', text: readFileSync(join(ROOT, 'tests', 'fixtures', 'saves', 'v1', 'profile.yaml'), 'utf8') }, d).profile!;
  const layout = LayoutSchema.parse(parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'saves', 'v1', 'builds', 'example.yaml'), 'utf8')));
  const loadout = buildLoadout(d, profile, layout);

  it('battles the example layout against the example enemy, deterministically', () => {
    const enemy = resolveEnemy(d, layout.battle!.enemy);
    // The user's own layout: only check it runs and is deterministic, not who wins.
    const a = runBattle(loadout, enemy, { seed: 1 });
    expect(['player', 'enemy']).toContain(a.winner);
    expect(JSON.stringify(runBattle(loadout, enemy, { seed: 1 }))).toBe(JSON.stringify(a));
  });
});
