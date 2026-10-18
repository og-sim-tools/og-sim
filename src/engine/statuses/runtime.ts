/**
 * Status effects on combatants (SPEC §5.3): stacks (permanent or timed), fractional stacks, and the
 * per-stack modifiers statuses give. Status *damage and healing* happen in the battle loop.
 */
import type { Combatant, Side, StatusStack } from '../combat/types';
import type { StatusData } from '../model';

export type StatusDefs = ReadonlyMap<string, StatusData>;

export function stacksOf(c: Combatant, status: string): number {
  return c.statuses.get(status)?.stacks ?? 0;
}

/** Sum of pct_per_stack × stacks over the holder's statuses with a behaviour. */
export function statusPct(c: Combatant, defs: StatusDefs, behaviour: StatusData['behaviour']): number {
  let total = 0;
  for (const [id, s] of c.statuses) {
    const def = defs.get(id);
    if (def && def.behaviour === behaviour) total += s.stacks * (def.pct_per_stack ?? 1);
  }
  return total;
}

/** True while the holder has any status with this behaviour (Stun, Invincible). */
export function hasBehaviour(c: Combatant, defs: StatusDefs, behaviour: StatusData['behaviour']): boolean {
  for (const id of c.statuses.keys()) if (defs.get(id)?.behaviour === behaviour) return true;
  return false;
}

/**
 * Add stacks. With `until` (a tick), these stacks expire then; otherwise they last the whole battle
 * (SPEC §5.3). Returns the stacks added.
 */
export function addStacks(c: Combatant, status: string, n: number, inflicter: Side, until?: number): number {
  if (n <= 0) return 0;
  const cur: StatusStack = c.statuses.get(status) ?? { stacks: 0, inflicter, timed: [] };
  cur.stacks += n;
  cur.inflicter = inflicter;
  if (until !== undefined) cur.timed.push({ stacks: n, until });
  c.statuses.set(status, cur);
  return n;
}

/**
 * Non-stacking statuses (Stun, Invincible): one stack; a new application keeps the longer
 * duration ('longest') or adds the durations ('add'). Without a duration it lasts all battle.
 */
export function setNonStacking(c: Combatant, status: string, inflicter: Side, now: number, until: number | undefined, reapply: 'longest' | 'add'): void {
  const cur = c.statuses.get(status);
  if (!cur) {
    c.statuses.set(status, { stacks: 1, inflicter, timed: until === undefined ? [] : [{ stacks: 1, until }] });
    return;
  }
  cur.inflicter = inflicter;
  if (until === undefined || cur.timed.length === 0) {
    cur.timed = []; // permanent wins
    return;
  }
  const old = cur.timed[0]!.until;
  cur.timed = [{ stacks: 1, until: reapply === 'add' ? old + (until - now) : Math.max(old, until) }];
}

/**
 * Remove up to n stacks: permanent ones first, then the timed ones that would expire soonest.
 * Returns the stacks removed; the timed pieces taken go into `taken` (so a steal keeps their timers).
 */
export function removeStacks(c: Combatant, status: string, n: number, taken?: { stacks: number; until: number }[]): number {
  const cur = c.statuses.get(status);
  if (!cur || n <= 0) return 0;
  const removed = Math.min(n, cur.stacks);
  cur.stacks -= removed;
  let fromTimed = Math.max(0, removed - (cur.stacks + removed - cur.timed.reduce((a, t) => a + t.stacks, 0)));
  cur.timed.sort((a, b) => a.until - b.until);
  for (const t of cur.timed) {
    if (fromTimed <= 0) break;
    const k = Math.min(t.stacks, fromTimed);
    t.stacks -= k;
    fromTimed -= k;
    taken?.push({ stacks: k, until: t.until });
  }
  cur.timed = cur.timed.filter((t) => t.stacks > 0);
  if (cur.stacks <= 0) c.statuses.delete(status);
  return removed;
}

/** Drop timed stacks whose time is up. Returns the statuses that changed. */
export function expireStacks(c: Combatant, tick: number): string[] {
  const changed: string[] = [];
  for (const [id, s] of [...c.statuses]) {
    const due = s.timed.filter((t) => t.until <= tick);
    if (due.length === 0) continue;
    s.timed = s.timed.filter((t) => t.until > tick);
    s.stacks -= Math.min(s.stacks, due.reduce((a, t) => a + t.stacks, 0));
    if (s.stacks <= 0) c.statuses.delete(id);
    changed.push(id);
  }
  return changed;
}

/**
 * Fractional stacks alternate so they average out (SPEC §5.3): a carried remainder per source
 * and status. Each application adds the exact amount to a running total and applies
 * ceil(total) − already applied, so it rounds up first (4.5 → 5, 4, 5, 4 …; observed in game).
 */
export class FractionalStacks {
  private totals = new Map<string, { total: number; applied: number }>();

  take(key: string, exact: number): number {
    const e = this.totals.get(key) ?? { total: 0, applied: 0 };
    e.total += exact;
    const whole = Math.ceil(e.total - 1e-9);
    const n = whole - e.applied;
    e.applied = whole;
    this.totals.set(key, e);
    return n;
  }
}
