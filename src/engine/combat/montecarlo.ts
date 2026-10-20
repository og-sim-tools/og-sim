/** Monte Carlo mode (SPEC §7.4): N battles with different seeds → win rate and DPS distribution. */
import type { GameData } from '../loader';
import type { Loadout } from '../loadout';
import type { LayoutData } from '../model';
import { type BattleOptions, BattleSetupError, runBattle } from './battle';
import type { EnemyInput } from './setup';
import type { BattleResult } from './types';

export interface Distribution {
  mean: number;
  min: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
}

export interface MonteCarloResult {
  runs: number;
  wins: number;
  winRate: number;
  timeouts: number;
  duration: Distribution;
  dps: Distribution;
  /** The damage I dealt (raids: what the result is about). */
  damage: Distribution;
  /** My HP left, % of max, averaged. */
  playerHpLeftPct: number;
  enemyHpLeftPct: number;
  warnings: string[];
  /** The first battle, for a sample. */
  sample: BattleResult;
  /** Each run: its seed and outcome. */
  perRun: { seed: number | string; winner: 'player' | 'enemy'; reason: string; duration: number }[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

export function distribution(values: number[]): Distribution {
  const s = [...values].sort((a, b) => a - b);
  return {
    mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length),
    min: s[0] ?? 0,
    p10: quantile(s, 0.1),
    p50: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    max: s[s.length - 1] ?? 0,
  };
}

/** Seed of run i: numeric seeds count up; text seeds get "#i". */
export const runSeed = (seed: number | string, i: number): number | string => (typeof seed === 'number' ? seed + i : `${seed}#${i}`);

export function runMonteCarlo(loadout: Loadout, enemy: EnemyInput | EnemyInput[], runs: number, opts: Omit<BattleOptions, 'log'> = {}): MonteCarloResult {
  if (runs < 1) throw new BattleSetupError('Monte Carlo needs at least 1 run.');
  const seed = opts.seed ?? 1;
  const results: BattleResult[] = [];
  const warnings = new Set<string>();
  for (let i = 0; i < runs; i++) {
    const r = runBattle(loadout, enemy, { ...opts, seed: runSeed(seed, i) });
    r.warnings.forEach((w) => warnings.add(w));
    results.push(i === 0 ? r : { ...r, log: [] });
  }
  const wins = results.filter((r) => r.winner === 'player').length;
  return {
    runs,
    wins,
    winRate: wins / runs,
    timeouts: results.filter((r) => r.reason === 'timeout').length,
    duration: distribution(results.map((r) => r.duration)),
    dps: distribution(results.map((r) => r.dps)),
    damage: distribution(results.map((r) => r.player.damageDealt)),
    playerHpLeftPct: (results.reduce((a, r) => a + r.player.hp / r.player.maxHp, 0) / runs) * 100,
    enemyHpLeftPct: (results.reduce((a, r) => a + r.enemy.hp / r.enemy.maxHp, 0) / runs) * 100,
    warnings: [...warnings],
    sample: results[0]!,
    perRun: results.map((r, i) => ({ seed: runSeed(seed, i), winner: r.winner, reason: r.reason, duration: r.duration })),
  };
}

type BattleSettings = NonNullable<LayoutData['battle']>;

/**
 * The enemies a layout's battle settings name, for the mode: Stage takes `enemy`; Gauntlet and
 * Boss Rush take `enemies` (one per fight). Each is an id in data/enemies or typed in.
 */
export function resolveEnemies(data: GameData, battle: Pick<BattleSettings, 'mode' | 'enemy' | 'enemies'> | undefined, enemyOverride?: string): EnemyInput[] {
  const mode = battle?.mode ?? 'stage';
  const fights = data.config?.modes[mode]?.fights ?? 1;
  if (enemyOverride !== undefined) return new Array(fights).fill(0).map(() => resolveEnemy(data, enemyOverride));
  if (fights === 1) return [resolveEnemy(data, battle?.enemy ?? battle?.enemies?.[0])];
  const list = battle?.enemies ?? [];
  if (list.length !== fights) throw new BattleSetupError(`${mode} needs ${fights} enemies (battle.enemies), ${list.length} given.`);
  return list.map((e) => resolveEnemy(data, e));
}

/** The enemy a layout's battle settings name: an id in data/enemies, or an enemy typed in. */
export function resolveEnemy(data: GameData, enemy: NonNullable<LayoutData['battle']>['enemy'] | string | undefined): EnemyInput {
  if (enemy === undefined) throw new BattleSetupError('No enemy chosen: set battle.enemy in the layout (an id from data/enemies, or the enemy itself).');
  if (typeof enemy === 'string') {
    const e = data.enemies.get(enemy);
    if (!e) throw new BattleSetupError(`Unknown enemy "${enemy}" (known: ${[...data.enemies.keys()].join(', ') || 'none — add one to data/enemies/manual/'}).`);
    return e;
  }
  return enemy;
}
