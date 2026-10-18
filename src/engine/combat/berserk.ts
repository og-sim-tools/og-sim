/** Berserk (SPEC §7.6): from 10 s, +1 stack per second; stack n = +(20 + 5n)% DMG and haste, +5(n − 1)% accuracy. */
import type { Config } from '../model';

export interface BerserkBonus {
  stacks: number;
  dmgPct: number;
  hastePct: number;
  accuracyPct: number;
}

export const NO_BERSERK: BerserkBonus = { stacks: 0, dmgPct: 0, hastePct: 0, accuracyPct: 0 };

/** Berserk stacks at a time (seconds), given the config. */
export function berserkStacksAt(t: number, cfg: Config['berserk']): number {
  const eps = 1e-9;
  if (t + eps < cfg.start_seconds) return 0;
  return Math.floor((t - cfg.start_seconds + eps) / cfg.interval_seconds) + 1;
}

export function berserkBonus(stacks: number, cfg: Config['berserk']): BerserkBonus {
  if (stacks <= 0) return NO_BERSERK;
  const n = stacks - 1;
  return {
    stacks,
    dmgPct: cfg.first_stack.dmg_pct + n * cfg.per_stack.dmg_pct,
    hastePct: cfg.first_stack.haste_pct + n * cfg.per_stack.haste_pct,
    accuracyPct: cfg.first_stack.accuracy_pct + n * cfg.per_stack.accuracy_pct,
  };
}
