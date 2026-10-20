/** Runtime types for the tick-based battle (SPEC §7). */
import type { EffectCondition, ItemEffect, ItemStatPct, ScaledValue } from '../model';

export type Side = 'player' | 'enemy';
export const other = (s: Side): Side => (s === 'player' ? 'enemy' : 'player');

export type DamageType = 'weapon' | 'skill' | 'status' | 'effect';

export interface CombatItem {
  /** Instance id (enemy attacks: "enemy:<n>"). */
  id: string;
  itemId: string;
  name: string;
  side: Side;
  kind: 'item' | 'gear' | 'enemy_attack' | 'skill';
  tags: string[];
  /** Bag items: the item's rarity (gear: the equipped piece's rarity), for rarity filters. */
  rarity?: string;
  /** Weapon damage before crits: base (ratio × ATK, or flat for enemies), its type bonus %, and (enemy attacks) a % of the target's max HP added to the base. */
  damage: { base: number; typePct: number; pctOfFoeMaxHp?: number } | null;
  baseCooldown: number | null;
  /** Haste % fixed before combat (item bonuses + Item Haste from Stat Details). */
  staticHastePct: number;
  /** Raw accuracy before evasion, fixed before combat. */
  accuracy: number | null;
  critChancePct: number;
  critDamagePct: number;
  hits: number;
  /** "Attack 0 ~ N more times". */
  randomExtraHits?: number;
  /** Always crits while this holds. */
  autoCritWhen?: EffectCondition;
  maxAttacks: number | null;
  alwaysHit: boolean;
  effects: { effect: ItemEffect; index: number }[];
  effectValues: Record<string, ScaledValue>;
  /** Instance ids under this item's dots. */
  dotTargets: string[];
  /** Gear weapon skill (structured), if any. */
  skill: CombatSkill | null;
  /** Status factor for what this item inflicts (pet star effects: "inflict x2 Poison"). */
  inflictMultiplier: Record<string, number>;
  /** Extra % on statuses this item inflicts, gained in battle (add_inflict_pct). */
  inflictPct?: Record<string, number>;
  /** Covers an enhanced bag cell (layout enhanced_cells). */
  enhanced?: boolean;
  /** Pet-spawned and "Disappears after battle": gone after the first fight. */
  temporary: boolean;
  /** Bag position, for items that transform in place. */
  origin: { x: number; y: number; rotation: 0 | 90 | 180 | 270 } | null;
  // ---- runtime
  /** Cooldown progress, 0 → 1. */
  progress: number;
  attacks: number;
  /** Bonuses gained during combat (on-hit haste etc.). */
  dynamic: Record<ItemStatPct, number>;
  /** Sealed until this tick (exclusive). */
  sealedUntil: number;
  /** Extra hits for the next attack only (Black Bow). */
  nextExtraHits?: number;
}

export interface CombatSkill {
  damage: { base: number; typePct: number; pctOfFoeMaxHp?: number } | null;
  hits: number;
  /** Fixed timer in ticks (not affected by haste or Freeze). */
  intervalTicks: number | null;
  gauge: boolean;
  accuracy: number | null;
  critChancePct: number;
  alwaysHit: boolean;
  /** One more hit per stack of this status on me (Wish). */
  extraHitsStatus: string | null;
  /** Hits added during battle (add_skill_hits). */
  bonusHits: number;
  // runtime
  ticks: number;
  gaugePct: number;
  activations: number;
}

export interface StatusStack {
  stacks: number;
  /** Who inflicted it (Burn / Poison scale with the inflicter's ATK). */
  inflicter: Side;
  /** Stacks that expire at a tick; the rest last the whole battle. */
  timed: { stacks: number; until: number }[];
}

export interface Combatant {
  side: Side;
  name: string;
  maxHp: number;
  hp: number;
  block: number;
  atk: number;
  /** Detailed stats by registry id (enemies: zeros except crit_dmg). */
  stats: Record<string, number>;
  /** Combat-group stats by registry id: damage reductions, vulnerabilities, resistances. */
  combatStats: Record<string, number>;
  /** Timed changes to combat stats (add_combatant_stat with a duration). */
  timedStats: { stat: string; amount: number; until: number }[];
  immunities: Set<string>;
  /** Stat bonuses that apply only while a condition holds (conditional blessings). */
  conditionalStats: {
    stat: string;
    amount: number;
    when: EffectCondition;
    label: string;
    until?: number;
    /** Amount worked out live from this effect (amount_from: missing HP). */
    dynamic?: { owner: CombatItem; effect: ItemEffect };
  }[];
  /** Effect owners that aren't bag items (hero skills): their effects fire like an item's, but nothing can target them. */
  skillSources?: CombatItem[];
  /** Blessings: statuses inflicted/gained by items with any of `tags` are +pct% (added to the inflict stat). */
  taggedInflict?: { tags: string[]; statuses: string[]; pct: number }[];
  /** Total ATK % gained during battle (add_atk_pct). */
  atkPct: number;
  /** Max HP before in-battle "Max HP +x%" effects (they scale from this). */
  baseMaxHp?: number;
  boss: boolean;
  statuses: Map<string, StatusStack>;
  items: CombatItem[];
  berserkEnabled: boolean;
  berserkStacks: number;
}

export interface BattleEvent {
  /** Seconds. */
  t: number;
  type:
    | 'attack'
    | 'hit'
    | 'miss'
    | 'damage'
    | 'heal'
    | 'block'
    | 'block_removed'
    | 'hp_lost'
    | 'status'
    | 'effect'
    | 'activation'
    | 'berserk'
    | 'death'
    | 'timeout'
    | 'note';
  side: Side;
  source?: string;
  target?: string;
  amount?: number;
  crit?: boolean;
  detail?: string;
}

export interface ItemReport {
  name: string;
  side: Side;
  attacks: number;
  hits: number;
  misses: number;
  crits: number;
  damage: number;
  healing: number;
  block: number;
  statuses: Record<string, number>;
  activations: number;
  /** Times its gear weapon skill went off (on its own timer or gauge; not in `activations`). */
  skillActivations: number;
  /** Times one of this item's effects fired (passive stat bonuses not counted). */
  triggers: number;
  /** Status stacks other items applied because of this item's event (Gloves of Plague on this bow's hits). */
  assisted: Record<string, number>;
  /** Stacks this item used up as a cost, by status. */
  spent: Record<string, number>;
  /** Buff / debuff stacks this item cleansed, removed or stole. */
  moved?: number;
}

export interface CombatantReport {
  hp: number;
  maxHp: number;
  block: number;
  statuses: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
}

export interface FightResult {
  enemy: string;
  winner: Side;
  reason: 'death' | 'timeout';
  /** Seconds this fight lasted. */
  duration: number;
  boss: boolean;
}

export interface BattleResult {
  mode: string;
  /** One entry per fight (Gauntlet / Boss Rush have several). */
  fights: FightResult[];
  winner: Side;
  reason: 'death' | 'timeout';
  /** Seconds. */
  duration: number;
  player: CombatantReport;
  enemy: CombatantReport;
  items: Record<string, ItemReport>;
  /** Status damage dealt by me, per status. */
  statusDamage: Record<string, number>;
  /** The enemy's status damage to me, by status. */
  enemyStatusDamage: Record<string, number>;
  /** Buff / debuff stacks each side cleansed from itself, removed from the other, stole, and reflected back. */
  statusMoves: Record<Side, StatusMoves>;
  /** Once-per-battle saves from a killing blow (Celestial Shield) each side still had at the end. */
  lethalSavesLeft: Record<Side, number>;
  /** My damage per second. */
  dps: number;
  seed: number | string;
  log: BattleEvent[];
  /** Things the simulation couldn't do (unsupported effects / conditions / statuses). */
  warnings: string[];
}

export interface StatusMoves {
  cleansed: number;
  removed: number;
  stolen: number;
  reflected: number;
  /** Stacks this side used up as a cost (own Spike for Spiral Spear's save, the enemy's Freeze for Instant Freeze), by status. */
  spent: Record<string, number>;
}
