/**
 * Build optimizer: a local search over my layout, scored by battles against a list of opponent builds.
 *
 * Every candidate plays the same seeds against every opponent (common random numbers), so two
 * candidates are compared on the same luck. A match scores my HP % left minus the opponent's HP %
 * left, plus `shieldWeight` for each unused once-per-battle save (Celestial Shield) I still have and
 * minus it for each one the opponent still has.
 *
 * The search isn't blind: each scored build gets a diagnosis from its battles (where my damage comes
 * from, what hurts me most in my worst matchup, which items do little). Targeted changes use it:
 * replace a weak item with one that counters that weakness, or with one that pushes my main damage
 * source further, and place the new item where its dots link up with the most items. Moves, swaps,
 * rotations and "re-place one item at its best spot" refine the layout in between. A change is kept
 * when the mean score doesn't drop by more than the current temperature (simulated annealing).
 *
 * `optimize` is a generator that yields after every battle, so the UI can run it in time slices.
 */
import { runBattle } from './combat/battle';
import type { EnemyInput } from './combat/setup';
import type { BattleResult } from './combat/types';
import { buildSynergyReport } from './effects/synergy';
import type { GameData, Item, Skin } from './loader';
import { type Loadout, buildLoadout, buildValue } from './loadout';
import type { ItemEffect, LayoutData, Profile } from './model';
import { footprintOf, orient } from './bag';
import { parseAbbrev } from './numbers';
import { Rng } from './rng';
import { availableSupplies, supplySummary } from './validate';
import { checkSkinQuest } from './skinQuests';
import { aggregateStats } from './stats';
import { heroSkillSources } from './combat/setup';

type Placement = LayoutData['placements'][number];

export interface Opponent {
  name: string;
  /** One entry per fight (as resolveEnemies returns it). */
  enemy: EnemyInput[];
}

export interface OptimizeOptions {
  /** Battles per opponent for each candidate (seeds seedBase … seedBase + n − 1). */
  seeds: number;
  /** Candidates to try after the starting build. */
  iterations: number;
  /** Score points for each unused once-per-battle save (Celestial Shield). */
  shieldWeight: number;
  /** Also replace shop items with other shop items, and add items into empty cells, within `valueBudget`. */
  allowItemChanges: boolean;
  valueBudget?: number;
  /** Starting temperature in score points (0 = only accept changes that don't lower the score). */
  temperature: number;
  seedBase: number;
  /** Seed for the search's own choices. */
  searchSeed: number | string;
  mode?: string;
  durationS?: number;
  /** Skip builds that break the quest of an equipped skin the starting build meets (Dream Eater's Creature value …). */
  keepSkinQuests?: boolean;
  /**
   * Balance matchups (default on): the search maximises the mean over opponents of a score with diminishing
   * returns above 0, so winning a won matchup by more counts less than helping a lost one.
   */
  balance?: boolean;
  /** Move or drop items that do nothing after the search (default on). */
  cleanup?: boolean;
  /** Several search seeds in one list (optimizeMany): scored builds go into this shared list (ids stay unique). */
  sink?: Candidate[];
  /** The starting build's parent (a chained run starts from the previous run's best). */
  startParent?: number;
  /** Which search-seed run a build came from (1, 2 …). */
  runLabel?: number;
  /**
   * Shake up when stuck: after `patience` builds without a better best, make `size` changes in a row from the
   * best build and keep the result even if it scores worse, then search on from there. Each time it's stuck
   * again the shake-up grows by one change (back to `size` when the best improves).
   */
  shakeUp?: { patience: number; size: number };
}

/** Diminishing returns above 0: +50 counts as +34.7, +100 as +54.9, +150 as +69.3; losses count in full. */
export const balanced = (s: number) => (s <= 0 ? s : 50 * Math.log(1 + s / 50));

export interface MatchScore {
  score: number;
  win: boolean;
  myHpPct: number;
  foeHpPct: number;
  myShieldLeft: boolean;
  foeShieldLeft: boolean;
  duration: number;
  dps: number;
  dealt: number;
  taken: number;
}

/** Damage by source ("Spiral Spear", "spike", "burn" …) and what each of my items did, summed over the battles. */
export interface Breakdown {
  myDamage: Record<string, number>;
  foeDamage: Record<string, number>;
  items: Record<string, { name: string; damage: number; healing: number; block: number; statuses: number; moved: number; triggers: number }>;
}

export interface OpponentSummary {
  name: string;
  matches: MatchScore[];
  meanScore: number;
  winRate: number;
  myHpPct: number;
  foeHpPct: number;
  myShieldLeftRate: number;
  foeShieldLeftRate: number;
  duration: number;
  dps: number;
  dealt: number;
  taken: number;
  breakdown: Breakdown;
}

/** What a build is good and bad at, read from its battles. */
export interface Diagnosis {
  /** My damage by source, largest first, as shares of my total. */
  strengths: { source: string; share: number }[];
  /** The opponent I do worst against, and what hurts me most there. */
  worst: { opponent: string; score: number; threats: { source: string; share: number }[] } | null;
  /** My shop items doing the least (no damage, healing, block or statuses, and not boosting other items). */
  weakItems: { id: string; name: string; contribution: number }[];
}

export interface Candidate {
  id: number;
  /** The candidate it was made from (null for the starting build). */
  parent: number | null;
  change: string;
  /** Why this change was tried. */
  reason: string;
  placements: Placement[];
  value: number;
  opponents: OpponentSummary[];
  /** Mean over opponents (each opponent counts the same). */
  meanScore: number;
  /** What the search maximises: with balance on, the mean of balanced(matchup score); otherwise meanScore. */
  objective: number;
  winRate: number;
  diagnosis: Diagnosis;
  /** Dot links in the layout (effects reaching other items); ties go to the better-linked build. */
  links: number;
  /** Kept as the new current build. */
  accepted: boolean;
  /** With several search seeds: which run (1, 2 …) it came from. */
  run?: number;
}

export interface OptimizeProgress {
  candidate: number;
  battles: number;
  totalBattles: number;
  best: Candidate | null;
  current: Candidate | null;
  latest: Candidate | null;
  /** Every build scored so far, in order (lets a stopped run show what it found). */
  candidates: readonly Candidate[];
  warnings: string[];
}

export interface OptimizeResult {
  candidates: Candidate[];
  start: Candidate;
  best: Candidate;
  /** Things to know about skin quests (can't be checked in one battle, not met, guarded). */
  warnings: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const add = (r: Record<string, number>, k: string, v: number) => {
  if (v > 0) r[k] = (r[k] ?? 0) + v;
};

/** One match's score (see the file comment). */
export function matchScore(r: BattleResult, shieldWeight: number): MatchScore {
  const pct = (c: BattleResult['player']) => (100 * Math.max(0, c.hp)) / Math.max(1, c.maxHp);
  const myHpPct = pct(r.player);
  const foeHpPct = pct(r.enemy);
  const myShieldLeft = (r.lethalSavesLeft?.player ?? 0) > 0;
  const foeShieldLeft = (r.lethalSavesLeft?.enemy ?? 0) > 0;
  return {
    score: myHpPct - foeHpPct + shieldWeight * ((myShieldLeft ? 1 : 0) - (foeShieldLeft ? 1 : 0)),
    win: r.winner === 'player',
    myHpPct,
    foeHpPct,
    myShieldLeft,
    foeShieldLeft,
    duration: r.duration,
    dps: r.dps,
    dealt: r.player.damageDealt,
    taken: r.enemy.damageDealt,
  };
}

/** Add one battle's damage sources and item work to a breakdown. */
export function addToBreakdown(b: Breakdown, r: BattleResult): void {
  for (const [id, it] of Object.entries(r.items)) {
    if (it.side === 'enemy') {
      add(b.foeDamage, 'weapon hits', it.damage);
      continue;
    }
    add(b.myDamage, it.name.replace(/ #\d+$/, ''), it.damage);
    const s = (b.items[id] ??= { name: it.name, damage: 0, healing: 0, block: 0, statuses: 0, moved: 0, triggers: 0 });
    s.damage += it.damage;
    s.healing += it.healing;
    s.block += it.block;
    s.statuses += Object.values(it.statuses).reduce((a, n) => a + n, 0);
    s.moved += it.moved ?? 0;
    s.triggers += it.triggers + it.activations;
  }
  for (const [k, v] of Object.entries(r.statusDamage)) add(b.myDamage, k, v);
  for (const [k, v] of Object.entries(r.enemyStatusDamage)) add(b.foeDamage, k, v);
}

const shares = (r: Record<string, number>) => {
  const total = Object.values(r).reduce((a, v) => a + v, 0) || 1;
  return Object.entries(r)
    .map(([source, v]) => ({ source, share: v / total }))
    .sort((a, b) => b.share - a.share);
};

function summarize(name: string, matches: MatchScore[], breakdown: Breakdown): OpponentSummary {
  const m = (f: (x: MatchScore) => number) => mean(matches.map(f));
  return {
    name,
    matches,
    meanScore: m((x) => x.score),
    winRate: m((x) => (x.win ? 1 : 0)),
    myHpPct: m((x) => x.myHpPct),
    foeHpPct: m((x) => x.foeHpPct),
    myShieldLeftRate: m((x) => (x.myShieldLeft ? 1 : 0)),
    foeShieldLeftRate: m((x) => (x.foeShieldLeft ? 1 : 0)),
    duration: m((x) => x.duration),
    dps: m((x) => x.dps),
    dealt: m((x) => x.dealt),
    taken: m((x) => x.taken),
    breakdown,
  };
}

/** Strengths, the worst matchup's threats and the weakest shop items of a scored build. */
export function diagnose(data: GameData, lo: Loadout, opponents: OpponentSummary[]): Diagnosis {
  const my: Record<string, number> = {};
  const items: Breakdown['items'] = {};
  for (const o of opponents) {
    for (const [k, v] of Object.entries(o.breakdown.myDamage)) add(my, k, v);
    for (const [id, s] of Object.entries(o.breakdown.items)) {
      const t = (items[id] ??= { ...s, damage: 0, healing: 0, block: 0, statuses: 0, moved: 0, triggers: 0 });
      t.damage += s.damage;
      t.healing += s.healing;
      t.block += s.block;
      t.statuses += s.statuses;
      t.moved += s.moved;
      t.triggers += s.triggers;
    }
  }
  const worstOpp = [...opponents].sort((a, b) => a.meanScore - b.meanScore)[0];
  const synergy = buildSynergyReport(lo);
  // A status stack or a removed / stolen stack counts like 0.1x ATK of damage (roughly what a stack is worth).
  const stackWorth = 0.1 * aggregateStats(lo).player.atk;
  const weakItems = [...lo.entries.values()]
    .filter((e) => e.kind === 'item' && !e.supply && (e.def as Item).kind === 'item')
    .filter((e) => !(synergy.get(e.instanceId)?.gives.some((g) => g.targets.length > 0) ?? false))
    .map((e) => {
      const s = items[e.instanceId];
      return { id: e.instanceId, name: e.def.name, contribution: s ? s.damage + s.healing + s.block + (s.statuses + s.moved) * stackWorth : 0 };
    })
    .sort((a, b) => a.contribution - b.contribution);
  void data;
  return {
    strengths: shares(my).slice(0, 5),
    worst: worstOpp ? { opponent: worstOpp.name, score: worstOpp.meanScore, threats: shares(worstOpp.breakdown.foeDamage).slice(0, 5) } : null,
    weakItems: weakItems.slice(0, 5),
  };
}

// ---------------------------------------------------------------- item roles

/** What an item does, in a few generic words, read from its effects (used to pick swaps). */
export function rolesOf(item: Item): Set<string> {
  const roles = new Set<string>();
  if (item.stats.damage) roles.add('weapon');
  for (const e of item.effects as ItemEffect[]) {
    const onEnemy = e.target === 'enemy';
    switch (e.action) {
      case 'remove_status':
      case 'steal_status':
        if ((onEnemy || e.action === 'steal_status') && !e.consume) {
          roles.add('strip_buffs');
          if (!e.status || e.status === 'spike' || e.pick_from?.includes('spike')) roles.add('strip_spike');
          for (const s of e.pick_from ?? (e.status ? [e.status] : [])) roles.add(`strip_${s}`);
        }
        break;
      case 'cleanse':
        roles.add('cleanse');
        break;
      case 'gain_block':
        roles.add('block');
        break;
      case 'heal':
        roles.add('heal');
        break;
      case 'reduce_hit_damage':
        roles.add('reduce_damage');
        break;
      case 'add_combatant_stat':
        if (!onEnemy && /_(reduction|resistance)$/.test(e.combat_stat ?? '')) roles.add('reduce_damage');
        if (onEnemy && /vulnerability$/.test(e.combat_stat ?? '')) roles.add('boost_weapon');
        break;
      case 'apply_status':
        if (e.status) roles.add(onEnemy ? `inflict_${e.status}` : `gain_${e.status}`);
        break;
      case 'trigger_status':
        if (e.status) roles.add(`trigger_${e.status}`);
        break;
      case 'add_player_stat': {
        const m = /^(\w+)_dmg_increase$/.exec(e.player_stat ?? '');
        if (m) roles.add(m[1] === 'attack' || m[1] === 'all' ? 'boost_weapon' : `boost_${m[1]}`);
        break;
      }
      case 'add_stat_pct':
        if (e.stat === 'haste_pct' && (e.amount ?? 0) > 0) roles.add('haste');
        if (e.stat === 'crit_chance_pct' || e.stat === 'crit_damage_pct') roles.add('crit');
        if (e.stat === 'damage_pct' || e.stat === 'atk_dmg_pct') roles.add('boost_weapon');
        break;
      case 'deal_damage':
        roles.add('weapon');
        break;
      default:
        break;
    }
  }
  return roles;
}

/** Roles that cut damage from a source (an enemy status, or its weapon hits). */
export function countersFor(source: string): string[] {
  if (source === 'weapon hits') return ['block', 'reduce_damage', 'gain_dodge', 'heal', 'inflict_freeze', 'inflict_stun'];
  if (source === 'spike') return ['strip_spike', 'strip_buffs', 'block', 'heal'];
  if (source === 'burn' || source === 'poison') return ['cleanse', 'heal', 'block'];
  return ['heal', 'block', 'reduce_damage'];
}

/**
 * Roles that push a damage source of mine further (a status, or a weapon's hits). When my build steals
 * enemy buffs (Trixie), taking the enemy's stacks of a buff status is a way to gain it too.
 */
export function boostsFor(source: string, data: GameData, steals = false): string[] {
  const st = data.statuses.get(source);
  if (st) return [`gain_${source}`, `inflict_${source}`, `boost_${source}`, `trigger_${source}`, ...(steals && st.polarity === 'buff' ? [`strip_${source}`, 'strip_buffs'] : [])];
  return ['weapon', 'boost_weapon', 'haste', 'crit'];
}

/** Does this build steal enemy buffs (a steal effect, or "steal instead of remove")? */
export function buildSteals(lo: Loadout): boolean {
  const owners = [...heroSkillSources(lo).map((s) => s.effects.map((e) => e.effect)), ...[...lo.entries.values()].map((e) => (e.def.effects ?? []) as ItemEffect[])];
  return owners.some((es) => es.some((e) => e.action === 'steal_status' || e.player_stat === 'steal_on_remove_pct'));
}

// ---------------------------------------------------------------- layout helpers

/** The layout with these placements, if every item fits (no overlaps, nothing outside open cells). */
export function tryLayout(data: GameData, profile: Profile, base: LayoutData, placements: Placement[]): Loadout | null {
  const lo = buildLoadout(data, profile, { ...base, placements });
  return lo.layout.issues.length === 0 && lo.issues.every((i) => i.level !== 'error') ? lo : null;
}

/** Shop items this hero may buy (for replacing / adding). */
export function shopItemsFor(data: GameData, lo: Loadout): Item[] {
  const hero = lo.hero;
  return [...data.items.values()].filter(
    (i) =>
      i.kind === 'item' &&
      !i.enemy_item &&
      !i.value_unknown &&
      !i.special_shop &&
      !!i.shape &&
      // Something to do in battle (shop-only cards don't help a fight).
      (!!i.stats.damage || i.effects.length > 0) &&
      (i.class_restriction.length === 0 || (!!hero && i.class_restriction.includes(hero.class))) &&
      (!i.hero_exclusive || i.hero_exclusive === hero?.id),
  );
}

const ROT = [0, 90, 180, 270] as const;
type Rot = (typeof ROT)[number];

const shapeKey = (o: { cells: { x: number; y: number }[]; dots: { x: number; y: number }[] }) =>
  `${o.cells.map((c) => `${c.x},${c.y}`).sort().join(';')}|${o.dots.map((c) => `${c.x},${c.y}`).sort().join(';')}`;

/** Rotations that give a different shape (cells and dots): a 1x1 ring or a symmetric item only needs one or two. */
const rotationCache = new Map<string, Rot[]>();
export function distinctRotations(data: GameData, itemId: string): Rot[] {
  const hit = rotationCache.get(itemId);
  if (hit) return hit;
  const def = data.items.get(itemId) ?? data.gear.get(itemId);
  const fp = def ? footprintOf(def) : null;
  if (!fp) return [...ROT];
  const seen = new Set<string>();
  const out = ROT.filter((r) => {
    const k = shapeKey(orient(fp, r));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  rotationCache.set(itemId, out);
  return out;
}

/** The same shape? (rotating a symmetric item, or to a rotation that looks the same, changes nothing) */
function sameShape(data: GameData, itemId: string, a: Rot, b: Rot): boolean {
  if (a === b) return true;
  const def = data.items.get(itemId) ?? data.gear.get(itemId);
  const fp = def ? footprintOf(def) : null;
  return !!fp && shapeKey(orient(fp, a)) === shapeKey(orient(fp, b));
}

/**
 * How much an item does where it sits: 1 for an attack or an effect that works anywhere, plus 1 for every
 * matching item under its dots for each effect that needs them ("per [dot] Tool", "[dot] Weapon Haste",
 * "On [dot] Spell Activation"). 0 = it does nothing here (Golden Pig with no Tool under its dots).
 */
export function activity(lo: Loadout, id: string, synergy = buildSynergyReport(lo)): number {
  const e = lo.entries.get(id);
  if (!e) return 0;
  const def = e.def as Item;
  let n = def.stats?.damage ? 1 : 0;
  const dots = synergy.get(id)?.dotTargets ?? [];
  const tagsOf = (tid: string) => lo.entries.get(tid)?.def.tags ?? [];
  const match = (f: ItemEffect['filter'] | undefined, tid: string) => {
    const tags = tagsOf(tid);
    return !f || ((!f.tags_any || f.tags_any.some((x) => tags.includes(x))) && (!f.tags_all || f.tags_all.every((x) => tags.includes(x))) && (!f.tags_none || !f.tags_none.some((x) => tags.includes(x))));
  };
  for (const eff of (e.def.effects ?? []) as ItemEffect[]) {
    const dotFilters: (ItemEffect['filter'] | undefined)[] = [];
    if (eff.per_dot) dotFilters.push(eff.per_dot);
    if (eff.uses_dots || eff.target === 'items_under_dots') dotFilters.push(eff.filter);
    if (eff.watch === 'dots' || eff.watch === 'self_and_dots' || (eff.trigger === 'on_weapon_hit' && eff.uses_dots)) dotFilters.push(eff.watch_filter);
    if (dotFilters.length === 0) {
      n += 1;
      continue;
    }
    n += dots.filter((tid) => dotFilters.every((f) => match(f, tid))).length;
  }
  return n;
}

/** Items (not gear) that do nothing where they sit (activity 0), by index in the placements. */
export function idleItems(data: GameData, lo: Loadout, placements: Placement[]): number[] {
  const syn = buildSynergyReport(lo);
  return placements.map((p, k) => [p, k] as const).filter(([p]) => !data.gear.has(p.item) && activity(lo, p.id!, syn) === 0).map(([, k]) => k);
}

/**
 * Make an idle item do something with one or two moves: put it where its dots reach what it needs, or,
 * if one item is in the way of such a spot, move that item somewhere else first. Dot links never drop
 * below `minLinks`. Null if neither works.
 */
export function fixIdle(
  data: GameData,
  profile: Profile,
  base: LayoutData,
  fits: (placements: Placement[]) => Loadout | null,
  placements: Placement[],
  idx: number,
  minLinks: number,
): { placements: Placement[]; lo: Loadout; change: string; reason: string } | null {
  const { width, height } = buildLoadout(data, profile, { ...base, placements: [] }).bag;
  const p = placements[idx]!;
  const name = (q: Placement) => data.items.get(q.item)?.name ?? data.gear.get(q.item)?.name ?? q.item;
  const spots: { x: number; y: number; rotation: Rot }[] = [];
  for (let y = -1; y <= height; y++) for (let x = -1; x <= width; x++) for (const rotation of distinctRotations(data, p.item)) spots.push({ x, y, rotation });
  // One move.
  let one: { placements: Placement[]; lo: Loadout; act: number } | null = null;
  const blocked: { at: (typeof spots)[number]; blocker: number }[] = [];
  for (const at of spots) {
    const next = placements.slice();
    next[idx] = { ...p, ...at };
    const l = fits(next);
    if (l) {
      const a = activity(l, p.id!);
      if (a > (one?.act ?? 0) && totalLinks(l) >= minLinks) one = { placements: next, lo: l, act: a };
      continue;
    }
    // In the way: exactly one other item overlapping it there?
    const raw = buildLoadout(data, profile, { ...base, placements: next });
    const mine = new Set((raw.layout.items.get(p.id!)?.cells ?? []).map((c) => `${c.x},${c.y}`));
    const hits = next.map((q, k) => [q, k] as const).filter(([q, k]) => k !== idx && (raw.layout.items.get(q.id!)?.cells ?? []).some((c) => mine.has(`${c.x},${c.y}`)));
    if (hits.length === 1) blocked.push({ at, blocker: hits[0]![1] });
  }
  if (one) return { placements: one.placements, lo: one.lo, change: `move ${name(p)} to (${one.placements[idx]!.x},${one.placements[idx]!.y})`, reason: `${name(p)} did nothing where it was; here its dots reach what it needs` };
  // Two moves: the spots where it would work once the one item in the way is gone (best 5), then re-place that item.
  const options: { without: Placement[]; blocker: Placement; act: number; at: (typeof spots)[number] }[] = [];
  for (const b of blocked) {
    const next = placements.slice();
    next[idx] = { ...p, ...b.at };
    const without = next.filter((_, k) => k !== b.blocker);
    const l = fits(without);
    if (!l) continue;
    const a = activity(l, p.id!);
    if (a > 0) options.push({ without, blocker: placements[b.blocker]!, act: a, at: b.at });
  }
  options.sort((x, y) => y.act - x.act);
  for (const o of options.slice(0, 5)) {
    let best: { placements: Placement[]; lo: Loadout; links: number } | null = null;
    for (const at of spotsFor(data, o.blocker.item, width, height)) {
      const next = [...o.without, { ...o.blocker, ...at }];
      const l = fits(next);
      if (!l || activity(l, p.id!) === 0) continue;
      const links = totalLinks(l);
      if (links >= minLinks && links > (best?.links ?? -1)) best = { placements: next, lo: l, links };
    }
    if (best) {
      const moved = best.placements.at(-1)!;
      return {
        placements: best.placements,
        lo: best.lo,
        change: `move ${name(o.blocker)} to (${moved.x},${moved.y}) and ${name(p)} to (${o.at.x},${o.at.y})`,
        reason: `${name(p)} did nothing; ${name(o.blocker)} was in the way of a spot where it works`,
      };
    }
  }
  return null;
}

function spotsFor(data: GameData, item: string, width: number, height: number) {
  const out: { x: number; y: number; rotation: Rot }[] = [];
  for (let y = -1; y <= height; y++) for (let x = -1; x <= width; x++) for (const rotation of distinctRotations(data, item)) out.push({ x, y, rotation });
  return out;
}

/** Effects in the layout that reach other items (through dots): the number of links. */
export function totalLinks(lo: Loadout): number {
  let n = 0;
  for (const s of buildSynergyReport(lo).values()) n += s.gives.reduce((a, g) => a + g.targets.length, 0);
  return n;
}

/** How well an item is linked: effects it gives to other items plus effects it receives. */
function links(lo: Loadout, id: string): number {
  const s = buildSynergyReport(lo).get(id);
  return s ? s.gives.reduce((a, g) => a + g.targets.length, 0) + s.receives.length : 0;
}

/** Place `placements[idx]` at the fitting spot (any position / rotation) where it links with the most items. */
function bestSpot(rng: Rng, fits: Fits, placements: Placement[], idx: number, width: number, height: number) {
  let best: { placements: Placement[]; lo: Loadout; links: number } | null = null;
  const p = placements[idx]!;
  for (let y = -1; y <= height; y++) {
    for (let x = -1; x <= width; x++) {
      for (const rotation of distinctRotations(fits.data, p.item)) {
        const next = placements.slice();
        next[idx] = { ...p, x, y, rotation };
        const lo = fits(next);
        if (!lo) continue;
        const l = links(lo, p.id!) + rng.next() * 0.01; // random tie-break
        if (!best || l > best.links) best = { placements: next, lo, links: l };
      }
    }
  }
  return best;
}

/** The loadout for these placements if they're allowed (fit the bag, keep guarded skin quests), else null. */
type Fits = ((placements: Placement[]) => Loadout | null) & { data: GameData };

let nextId = 0;
const newId = (item: string) => `${item}#opt${++nextId}`;

interface Move {
  placements: Placement[];
  change: string;
  reason: string;
  lo: Loadout;
  /** The item id taken out, for replacements. */
  replaced?: string;
}

/** One change to the current build: targeted (from its diagnosis), a re-place at the best spot, or a random tweak. */
function neighbour(rng: Rng, data: GameData, profile: Profile, base: LayoutData, cur: Candidate, opts: OptimizeOptions, shop: Item[], failed: Map<string, number>, fits: Fits): Move | null {
  const placements = cur.placements;
  const { width, height } = buildLoadout(data, profile, { ...base, placements: [] }).bag;
  const nameOf = (p: Placement) => data.items.get(p.item)?.name ?? data.gear.get(p.item)?.name ?? p.item;
  const curLo = buildLoadout(data, profile, { ...base, placements });
  const steals = buildSteals(curLo);
  // Layout-only moves must not lose dot links: moving an item out of a glove's reach for nothing is never tried.
  const curLinks = totalLinks(curLo);
  const keepsLinks = (lo: Loadout) => totalLinks(lo) >= curLinks;
  const hasIdle = idleItems(data, curLo, placements.map((p) => ({ ...p, id: p.id ?? newId(p.item) }))).length > 0;
  const kinds0 = opts.allowItemChanges
    ? ['targeted', 'targeted', 'targeted', 'targeted', 'alternative', 'alternative', 'alternative', 'supply', 'supply', 'add', 'replace_spot', 'replace_spot', 'move', 'swap', 'rotate', 'replace']
    : ['replace_spot', 'replace_spot', 'replace_spot', 'move', 'move', 'swap', 'rotate'];
  // An item doing nothing is the first thing to look at.
  const kinds = hasIdle ? [...kinds0, 'idle', 'idle', 'idle', 'idle'] : kinds0;
  const current = buildValue(buildLoadout(data, profile, { ...base, placements })).total;
  const budget = opts.valueBudget ?? current;
  for (let attempt = 0; attempt < 60; attempt++) {
    const kind = rng.pick(kinds)!;
    const next = placements.map((p) => ({ ...p, id: p.id ?? newId(p.item) }));

    if (kind === 'targeted' || kind === 'replace') {
      const d = cur.diagnosis;
      // Weakness first when losing, strength first otherwise (70 / 30); then fall back through the other ideas.
      const losing = cur.winRate < 0.5 || (d.worst?.score ?? 0) < 0;
      const weakFirst = losing ? rng.chance(75) : rng.chance(30);
      const counter = (d.worst?.threats ?? []).slice(0, 3).map((x) => ({
        want: countersFor(x.source),
        why: `counter: ${x.source} does ${(x.share * 100).toFixed(0)}% of the damage I take vs ${d.worst!.opponent}`,
      }));
      const push = d.strengths.slice(0, 3).map((x) => ({ want: boostsFor(x.source, data, steals), why: `push: ${x.source} is ${(x.share * 100).toFixed(0)}% of my damage` }));
      const ideas = kind === 'targeted' ? (weakFirst ? [...counter, ...push] : [...push, ...counter]) : [];
      let reason = 'random swap';
      let wanted: string[] = [];
      // Drop the weakest shop item (or a random one).
      // Items whose replacement already failed twice are left alone (they matter more than their numbers show).
      const weakIds = d.weakItems.map((w) => w.id).filter((id) => next.some((p) => p.id === id && (failed.get(p.item) ?? 0) < 2));
      const shopIdx = next.map((p, k) => [p, k] as const).filter(([p]) => !p.supply && data.items.get(p.item)?.kind === 'item');
      const pick = kind === 'targeted' && weakIds.length ? shopIdx.find(([p]) => p.id === weakIds[rng.int(Math.min(2, weakIds.length))]) : rng.pick(shopIdx);
      if (!pick) continue;
      const [old, k] = pick;
      const oldValue = data.items.get(old.item)!.value;
      let options = shop.filter((s) => s.id !== old.item && current - oldValue + s.value <= budget);
      if (kind === 'targeted') {
        let found = false;
        for (const idea of ideas) {
          const scored = options.map((s) => ({ s, n: [...rolesOf(s)].filter((r) => idea.want.includes(r)).length })).filter((x) => x.n > 0);
          if (!scored.length) continue;
          options = scored.sort((a, b) => b.n - a.n).slice(0, 12).map((x) => x.s);
          reason = idea.why;
          wanted = idea.want;
          found = true;
          break;
        }
        if (!found) continue; // no item for any idea within the budget: try another kind of change
      }
      const item = rng.pick(options);
      if (!item) continue;
      next[k] = { id: newId(item.id), item: item.id, x: old.x, y: old.y, rotation: old.rotation, supply: false };
      const spot = bestSpot(rng, fits, next, k, width, height);
      const fills = [...rolesOf(item)].filter((x) => wanted.includes(x));
      if (spot)
        return {
          placements: spot.placements,
          lo: spot.lo,
          change: `replace ${nameOf(old)} with ${item.name}`,
          reason: kind === 'targeted' ? `${reason} → ${item.name} (${fills.join(', ')}) for ${nameOf(old)}, which did the least` : reason,
          replaced: old.item,
        };
      continue;
    }

    if (kind === 'idle') {
      const idle = idleItems(data, curLo, next);
      const k = rng.pick(idle);
      if (k === undefined) continue;
      const fix = fixIdle(data, profile, base, fits, next, k, curLinks);
      if (fix) return { ...fix, reason: `an item doing nothing: ${fix.reason}` };
      continue;
    }

    if (kind === 'alternative') {
      // A different item doing a similar job, that still fits what the items pointing at it look for
      // (a Spell under Witch's Mirror and a staff stays a Spell).
      const lo = fits(next);
      if (!lo) continue;
      const shopIdx = next.map((p, k) => [p, k] as const).filter(([p]) => !p.supply && data.items.get(p.item)?.kind === 'item' && (failed.get(p.item) ?? 0) < 2);
      const pick = rng.pick(shopIdx);
      if (!pick) continue;
      const [old, k] = pick;
      const oldItem = data.items.get(old.item)!;
      const synergy = buildSynergyReport(lo);
      const needs: { from: string; tags: string[] }[] = [];
      for (const [yid, s] of synergy) {
        if (yid === old.id || !s.dotTargets.includes(old.id!)) continue;
        for (const e of (lo.entries.get(yid)?.def.effects ?? []) as ItemEffect[]) {
          for (const f of [e.uses_dots ? e.filter : undefined, e.watch === 'dots' || e.watch === 'self_and_dots' ? e.watch_filter : undefined, e.per_dot]) {
            if (f?.tags_any?.length && f.tags_any.some((tag) => oldItem.tags.includes(tag))) needs.push({ from: s.name.replace(/ #\d+$/, ''), tags: f.tags_any });
          }
        }
      }
      // …and it keeps doing what the old item did to the items under its own dots (a staff that activates Spells).
      const gives = (synergy.get(old.id!)?.gives ?? []).filter((g) => g.targets.length > 0).map((g) => g.effect);
      const doesSame = (s: Item) =>
        gives.every((g) =>
          (s.effects as ItemEffect[]).some(
            (e) => e.uses_dots && e.action === g.action && (!g.filter?.tags_any || !e.filter?.tags_any || e.filter.tags_any.some((tag) => g.filter!.tags_any!.includes(tag))),
          ),
        );
      const oldRoles = rolesOf(oldItem);
      const oldValue = oldItem.value;
      const scored = shop
        .filter((s) => s.id !== old.item && current - oldValue + s.value <= budget && needs.every((n) => n.tags.some((tag) => s.tags.includes(tag))) && doesSame(s))
        .map((s) => ({ s, n: s.tags.filter((tag) => oldItem.tags.includes(tag)).length + 2 * [...rolesOf(s)].filter((x) => oldRoles.has(x)).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 10);
      const alt = rng.pick(scored)?.s;
      if (!alt) continue;
      next[k] = { id: newId(alt.id), item: alt.id, x: old.x, y: old.y, rotation: old.rotation, supply: false };
      let placed: { placements: Placement[]; lo: Loadout } | null = null;
      for (const rotation of [old.rotation, ...distinctRotations(data, alt.id)]) {
        const tryNext = next.slice();
        tryNext[k] = { ...next[k]!, rotation };
        const l = fits(tryNext);
        if (l) {
          placed = { placements: tryNext, lo: l };
          break;
        }
      }
      placed ??= bestSpot(rng, fits, next, k, width, height);
      if (!placed) continue;
      const keeps = [...new Set(needs.map((n) => `${n.from} (${n.tags.join('/')})`))];
      return {
        placements: placed.placements,
        lo: placed.lo,
        change: `replace ${nameOf(old)} with ${alt.name}`,
        reason: `alternative to ${nameOf(old)}${keeps.length ? `, still fits ${keeps.join(', ')}` : ''}${gives.length ? `; does the same to its dots (${[...new Set(gives.map((g) => g.action))].join(', ')})` : ''}`,
        replaced: old.item,
      };
    }

    if (kind === 'supply') {
      // Starting equipment: swap one for another unlocked one, or bring one more, within Supply Ability.
      const sum = supplySummary(curLo);
      if (!sum) continue;
      const cost = (id: string) => data.config!.supply_cost[data.items.get(id)!.rarity];
      const have = new Set(next.filter((p) => p.supply).map((p) => p.item));
      const avail = availableSupplies(curLo).filter((a) => !have.has(a.item.id));
      const d = cur.diagnosis;
      const idea = (cur.winRate < 0.5 || (d.worst?.score ?? 0) < 0) && d.worst?.threats[0] ? countersFor(d.worst.threats[0].source) : d.strengths[0] ? boostsFor(d.strengths[0].source, data, steals) : [];
      const rank = (items: typeof avail) => {
        const good = items.filter((a) => [...rolesOf(a.item)].some((x) => idea.includes(x)));
        return good.length ? good : items;
      };
      const work = (id: string) => {
        let w = 0;
        for (const o of cur.opponents) {
          const s = o.breakdown.items[id];
          if (s) w += s.damage + s.healing + s.block + s.statuses + s.moved;
        }
        return w;
      };
      const supplyIdx = next
        .map((p, k) => [p, k] as const)
        .filter(([p]) => p.supply && data.items.has(p.item))
        .sort((x, y) => work(x[0].id!) - work(y[0].id!));
      const swapOut = supplyIdx[rng.int(Math.min(2, supplyIdx.length))];
      if (!swapOut || rng.chance(30)) {
        const options = rank(avail.filter((a) => sum.used + a.cost <= sum.capacity));
        const a = rng.pick(options);
        if (!a) continue;
        const withNew = [...next, { id: newId(a.item.id), item: a.item.id, x: 0, y: 0, rotation: 0 as const, supply: true }];
        const spot = bestSpot(rng, fits, withNew, withNew.length - 1, width, height);
        if (spot) return { placements: spot.placements, lo: spot.lo, change: `bring ${a.item.name} (starting equipment)`, reason: `Supply Ability left (${sum.used} / ${sum.capacity})` };
        continue;
      }
      const [old, k] = swapOut;
      const options = rank(avail.filter((a) => sum.used - cost(old.item) + a.cost <= sum.capacity));
      const a = rng.pick(options);
      if (!a) continue;
      next[k] = { id: newId(a.item.id), item: a.item.id, x: old.x, y: old.y, rotation: old.rotation, supply: true };
      const spot = bestSpot(rng, fits, next, k, width, height);
      if (spot)
        return {
          placements: spot.placements,
          lo: spot.lo,
          change: `starting equipment: ${nameOf(old)} → ${a.item.name}`,
          reason: `${nameOf(old)} did the least of the starting equipment${idea.length ? ` (looking for ${idea.slice(0, 3).join(' / ')})` : ''}`,
          replaced: old.item,
        };
      continue;
    }

    if (kind === 'add') {
      const options = shop.filter((s) => current + s.value <= budget);
      const item = rng.pick(options);
      if (!item) continue;
      const withNew = [...next, { id: newId(item.id), item: item.id, x: 0, y: 0, rotation: 0 as const, supply: false }];
      const spot = bestSpot(rng, fits, withNew, withNew.length - 1, width, height);
      if (spot) return { placements: spot.placements, lo: spot.lo, change: `add ${item.name}`, reason: `value left in the budget (${budget - current})` };
      continue;
    }

    if (kind === 'replace_spot') {
      const k = rng.int(next.length);
      const p = next[k];
      if (!p) continue;
      const spot = bestSpot(rng, fits, next, k, width, height);
      if (!spot) continue;
      const q = spot.placements[k]!;
      if (q.x === p.x && q.y === p.y && sameShape(data, p.item, q.rotation, p.rotation)) continue;
      if (!keepsLinks(spot.lo)) continue;
      return { placements: spot.placements, lo: spot.lo, change: `move ${nameOf(p)} to (${q.x},${q.y})${q.rotation ? ` ${q.rotation}°` : ''}`, reason: 'best-linked spot for its dots' };
    }

    if (kind === 'move' || kind === 'rotate') {
      const i = rng.int(next.length);
      const p = next[i];
      if (!p) continue;
      const rots = distinctRotations(data, p.item);
      if (kind === 'rotate' && rots.length < 2) continue; // symmetric: rotating changes nothing
      for (let t = 0; t < 40; t++) {
        const cand = kind === 'move' ? { ...p, x: rng.int(width), y: rng.int(height), rotation: rots[rng.int(rots.length)]! } : { ...p, rotation: rots[rng.int(rots.length)]! };
        if (cand.x === p.x && cand.y === p.y && sameShape(data, p.item, cand.rotation, p.rotation)) continue;
        next[i] = cand;
        const lo = fits(next);
        if (lo && keepsLinks(lo)) return { placements: next, lo, change: kind === 'move' ? `move ${nameOf(p)} to (${cand.x},${cand.y})${cand.rotation ? ` ${cand.rotation}°` : ''}` : `rotate ${nameOf(p)} to ${cand.rotation}°`, reason: 'random tweak' };
      }
      continue;
    }

    // swap
    if (next.length < 2) continue;
    const [a, b] = rng.sample(next.map((_, k) => k), 2) as [number, number];
    const pa = next[a]!;
    const pb = next[b]!;
    if (pa.item === pb.item) continue;
    next[a] = { ...pa, x: pb.x, y: pb.y };
    next[b] = { ...pb, x: pa.x, y: pa.y };
    for (const ra of [pa.rotation, ...distinctRotations(data, pa.item)]) {
      next[a] = { ...next[a]!, rotation: ra };
      const lo = fits(next);
      if (lo && keepsLinks(lo)) return { placements: next, lo, change: `swap ${nameOf(pa)} ↔ ${nameOf(pb)}`, reason: 'random tweak' };
    }
  }
  return null;
}

/**
 * Skin quests for an optimizer run: the equipped skins whose quest the starting build meets are guarded
 * (when `keep`), and notes say what one battle can't tell or what isn't met.
 */
export function skinQuestGuard(data: GameData, profile: Profile, startLo: Loadout, keep: boolean): { warnings: string[]; guarded: Skin[] } {
  const warnings: string[] = [];
  const guarded: Skin[] = [];
  for (const id of profile.equipped_skins ?? []) {
    const skin = data.skins.get(id);
    const hero = startLo.hero;
    const a = skin?.available;
    if (!skin?.skill || !profile.skins?.some((s) => s.id === id) || !hero || !(a?.all || a?.classes?.includes(hero.class) || a?.heroes?.includes(hero.id))) continue;
    const q = checkSkinQuest(startLo, skin);
    const name = `${skin.skill.name} (${skin.name})`;
    if (q.status === 'run') {
      const done = (profile.skin_quests_done ?? []).includes(id);
      warnings.push(`${name}: its quest (${q.detail}) can't be checked in one battle, so no change can lose it here. It counts as ${done ? 'done' : 'not done'}, from the layout's "quest done" tick.`);
    } else if (q.status === 'not_met') {
      warnings.push(`${name}: the starting build doesn't meet its quest (${q.detail}), so the skill is off until a change meets it.`);
    } else if (q.status === 'met') {
      if (keep) {
        guarded.push(skin);
        warnings.push(`${name}: builds that would break its quest (${q.detail} now) are skipped.`);
      } else warnings.push(`${name}: changes may break its quest (${q.detail} now); a build that does loses the skill in its battles.`);
    }
  }
  return { warnings, guarded };
}

/**
 * An opponent build with my base stats × `multiple` (HP, ATK and Block; Stat Details as mine); its hero,
 * gear, pets, skins and bag stay its own. multiple 2 = an enemy twice as strong as me on paper.
 */
export function withMyBaseStats<B extends { profile: Profile }>(build: B, mine: Profile, multiple = 1): B {
  const m = (v: string | number) => (multiple === 1 ? v : parseAbbrev(v) * multiple);
  const s = mine.basic_stats;
  return {
    ...build,
    profile: { ...build.profile, basic_stats: { hp: m(s.hp), atk: m(s.atk), initial_block: m(s.initial_block) }, detailed_stats: { ...mine.detailed_stats } },
  };
}

/** Run the search; yields after every battle. */
export function* optimize(
  data: GameData,
  profile: Profile,
  base: LayoutData,
  opponents: Opponent[],
  opts: OptimizeOptions,
): Generator<OptimizeProgress, OptimizeResult> {
  if (opponents.length === 0) throw new Error('Pick at least one opponent build.');
  const rng = new Rng(opts.searchSeed);
  let total = (opts.iterations + 1) * opponents.length * opts.seeds;
  let battles = 0;
  const candidates: Candidate[] = opts.sink ?? [];
  let current: Candidate | null = null;
  let best: Candidate | null = null;
  const startLo = buildLoadout(data, profile, base);
  const shop = opts.allowItemChanges ? shopItemsFor(data, startLo) : [];
  const failed = new Map<string, number>();

  function* evaluate(lo: Loadout, placements: Placement[], parent: number | null, change: string, reason: string): Generator<OptimizeProgress, Candidate> {
    const id = candidates.length;
    const sums: OpponentSummary[] = [];
    for (const o of opponents) {
      const matches: MatchScore[] = [];
      const breakdown: Breakdown = { myDamage: {}, foeDamage: {}, items: {} };
      for (let k = 0; k < opts.seeds; k++) {
        const r = runBattle(lo, o.enemy, { mode: opts.mode, durationS: opts.durationS, seed: opts.seedBase + k });
        matches.push(matchScore(r, opts.shieldWeight));
        addToBreakdown(breakdown, r);
        battles++;
        yield { candidate: id, battles, totalBattles: total, best, current, latest: candidates.at(-1) ?? null, candidates, warnings };
      }
      sums.push(summarize(o.name, matches, breakdown));
    }
    const c: Candidate = {
      id,
      parent,
      change,
      reason,
      placements,
      value: buildValue(lo).total,
      opponents: sums,
      meanScore: mean(sums.map((s) => s.meanScore)),
      objective: opts.balance === false ? mean(sums.map((s) => s.meanScore)) : mean(sums.map((s) => balanced(s.meanScore))),
      winRate: mean(sums.map((s) => s.winRate)),
      diagnosis: diagnose(data, lo, sums),
      links: totalLinks(lo),
      accepted: false,
      ...(opts.runLabel !== undefined ? { run: opts.runLabel } : {}),
    };
    candidates.push(c);
    return c;
  }

  const { warnings, guarded } = skinQuestGuard(data, profile, startLo, !!opts.keepSkinQuests);
  const fits: Fits = Object.assign(
    (placements: Placement[]) => {
      const lo = tryLayout(data, profile, base, placements);
      return lo && guarded.every((s) => checkSkinQuest(lo, s).status === 'met') ? lo : null;
    },
    { data },
  );

  const start: Candidate = yield* evaluate(startLo, base.placements.map((p, i) => ({ ...p, id: p.id ?? `${p.item}#${i + 1}` })), opts.startParent ?? null, opts.startParent !== undefined ? `start of run ${opts.runLabel ?? ''}: best build so far` : 'starting build', '');
  start.accepted = true;
  let cur: Candidate = start;
  let top: Candidate = start;
  current = cur;
  best = top;
  let stall = 0; // builds since the best last improved
  let kick = opts.shakeUp?.size ?? 0;
  for (let i = 0; i < opts.iterations; i++) {
    if (opts.shakeUp && stall >= opts.shakeUp.patience) {
      // Stuck: several changes in a row from the best build, kept whatever they score.
      let from: Candidate = top;
      const changes: string[] = [];
      let last: Move | null = null;
      for (let k = 0; k < kick; k++) {
        const m = neighbour(rng, data, profile, base, from, opts, shop, failed, fits);
        if (!m) break;
        last = m;
        changes.push(m.change);
        from = { ...from, placements: m.placements };
      }
      if (last) {
        const c: Candidate = yield* evaluate(last.lo, last.placements, top.id, changes.join('; '), `shake-up: ${stall} builds without a better best, so ${changes.length} changes at once from the best build (kept even if worse)`);
        c.accepted = true;
        cur = c;
        current = cur;
        stall = 0;
        kick += 1;
        if (c.objective > top.objective) {
          top = c;
          best = top;
          kick = opts.shakeUp.size;
        }
        continue;
      }
    }
    const n = neighbour(rng, data, profile, base, cur, opts, shop, failed, fits);
    if (!n) {
      warnings.push(`Stopped after ${candidates.length} builds: no allowed change was found (everything tried would break a skin quest, lose dot links or go over the value budget).`);
      break;
    }
    const c: Candidate = yield* evaluate(n.lo, n.placements, cur.id, n.change, n.reason);
    const temp = opts.temperature * (1 - i / Math.max(1, opts.iterations));
    // Fewer dot links must win outright; otherwise a change may cost up to the temperature.
    if (c.links < cur.links ? c.objective > cur.objective : c.objective >= cur.objective - temp) {
      c.accepted = true;
      cur = c;
      current = cur;
    } else if (n.replaced) failed.set(n.replaced, (failed.get(n.replaced) ?? 0) + 1);
    if (c.objective > top.objective || (c.objective === top.objective && c.links > top.links)) {
      if (c.objective > top.objective) {
        stall = 0;
        kick = opts.shakeUp?.size ?? 0;
      } else stall++;
      top = c;
      best = top;
    } else stall++;
  }
  // Clean-up: an item doing nothing (Golden Pig with no Tool under its dots, a shop-only card) gets one or two
  // moves that make it work (moving the item in its way too), or is dropped when nothing works. Each fix is
  // scored and kept unless it costs more than 1 point; every idle item gets its turn.
  const tried = new Set<string>();
  for (let pass = 0; pass < (opts.cleanup === false ? 0 : 12); pass++) {
    const lo = fits(top.placements);
    if (!lo) break;
    const idle = idleItems(data, lo, top.placements).filter((k) => !tried.has(top.placements[k]!.id!));
    if (!idle.length) break;
    const k = idle[0]!;
    const p = top.placements[k]!;
    tried.add(p.id!);
    const name = data.items.get(p.item)?.name ?? p.item;
    const moved = fixIdle(data, profile, base, fits, top.placements, k, top.links);
    const dropped = top.placements.filter((_, j) => j !== k);
    const dropLo = moved ? null : fits(dropped);
    const fix = moved ?? (dropLo ? { placements: dropped, lo: dropLo, change: `drop ${name}`, reason: `${name} does nothing in this build and no one- or two-move fix makes it work` } : null);
    if (!fix) continue;
    total += opponents.length * opts.seeds;
    const c: Candidate = yield* evaluate(fix.lo, fix.placements, top.id, fix.change, `clean-up: ${fix.reason}`);
    if (c.objective >= top.objective - 1) {
      c.accepted = true;
      top = c;
      best = top;
    }
  }
  return { candidates, start, best: top, warnings };
}

/**
 * Several search seeds in one list. `chain`: each run starts from the best build of the run before (seed 1's
 * best feeds seed 2 …); otherwise every run starts from the original build. Seeds are searchSeed, searchSeed + 1 …
 */
export function* optimizeMany(
  data: GameData,
  profile: Profile,
  base: LayoutData,
  opponents: Opponent[],
  opts: OptimizeOptions,
  runs: number,
  chain: boolean,
): Generator<OptimizeProgress, OptimizeResult> {
  const sink: Candidate[] = [];
  const warnings: string[] = [];
  let best: Candidate | null = null;
  let start: Candidate | null = null;
  let done = 0;
  const perRun = (opts.iterations + 1) * opponents.length * opts.seeds;
  const seed0 = typeof opts.searchSeed === 'number' ? opts.searchSeed : 0;
  for (let k = 0; k < runs; k++) {
    const from = chain && best ? best : null;
    const runBase = from ? { ...base, placements: from.placements } : base;
    const gen = optimize(data, profile, runBase, opponents, {
      ...opts,
      searchSeed: typeof opts.searchSeed === 'number' ? seed0 + k : `${opts.searchSeed}#${k}`,
      sink,
      runLabel: k + 1,
      ...(from ? { startParent: from.id } : {}),
    });
    let r = gen.next();
    let runBattles = 0;
    while (!r.done) {
      runBattles = r.value.battles;
      yield { ...r.value, battles: done + r.value.battles, totalBattles: perRun * runs, best: best && r.value.best && best.objective >= r.value.best.objective ? best : r.value.best };
      r = gen.next();
    }
    done += runBattles;
    start ??= r.value.start;
    if (!best || r.value.best.objective > best.objective) best = r.value.best;
    for (const w of r.value.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  return { candidates: sink, start: start!, best: best!, warnings };
}

