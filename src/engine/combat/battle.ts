/**
 * Tick-based battle (SPEC §7): 0.1 s ticks, cooldowns with haste and Freeze, accuracy, crits,
 * damage reduction / vulnerability with the 25% floor, immunities, block, statuses (permanent or
 * timed; Stun, Seal, Invincible, Heal Amount Reduction), cleanse / remove / steal, gear skills,
 * pet-spawned items, spell activation, battle-start order, Berserk, and the Stage, Gauntlet and
 * Boss Rush modes.
 *
 * Deterministic: all randomness comes from one seeded Rng.
 */
import type { Cell } from '../bag';
import { type EffectApi, HANDLERS, isRecast } from '../effects/handlers';
import { isStaticStatEffect } from '../effects/resolve';
import type { Item } from '../loader';
import type { Loadout } from '../loadout';
import type { Config, EffectCondition, ItemEffect, ItemStatPct, ScaledValue, StatusData } from '../model';
import { resolveRatio } from '../numbers';
import { Rng } from '../rng';
import {
  FractionalStacks,
  addStacks,
  expireStacks,
  hasBehaviour,
  removeStacks,
  setNonStacking,
  stacksOf,
  statusPct,
} from '../statuses/runtime';
import { type BerserkBonus, NO_BERSERK, berserkBonus } from './berserk';
import { type EnemyInput, buildEnemy, buildEnemyFromBuild, buildPlayer, combatItemFromDef, enemyKind, enemyPrefix, hasPlayerItems } from './setup';
import {
  type BattleEvent,
  type BattleResult,
  type CombatItem,
  type Combatant,
  type CombatantReport,
  type DamageType,
  type FightResult,
  type ItemReport,
  type Side,
  type StatusMoves,
  other,
} from './types';

export interface BattleOptions {
  /** Battle mode (config `modes`): stage, gauntlet, boss_rush. */
  mode?: string;
  /** Overrides the mode's time limit, in seconds (per fight, or total for Gauntlet). */
  durationS?: number;
  seed?: number | string;
  /** Keep a timestamped event log. */
  log?: boolean;
}

export class BattleSetupError extends Error {}

/** Item events: whose item did it matters (watch: self / dots / any). */
const ITEM_EVENTS = new Set([
  'on_miss',
  'on_hit',
  'on_weapon_hit',
  'on_skill_hit',
  'on_attack',
  'on_activation',
  'on_use',
  'on_crit',
  'on_status_applied',
  'on_damage_dealt',
  'on_skill_activation',
  'on_heal',
]);
const SUPPORTED_MODES = ['stage', 'gauntlet', 'boss_rush', 'arena', 'raid'];

const pctTag = (n: number) => Math.round(n * 10) / 10;

/** Each of my items right after the Start of Battle effects (Haste from gloves, Swift, Focus …). */
export interface StartStats {
  cooldown: number | null;
  hastePct: number;
  accuracy: number | null;
  critChancePct: number;
  critDamagePct: number;
  /** One non-crit hit before the enemy's reductions. */
  damagePerHit: number | null;
  skillDamagePerHit: number | null;
}

/** Battle start for the first fight, then my items' numbers (nothing else is simulated). */
export function battleStartStats(loadout: Loadout, enemy: EnemyInput, opts: BattleOptions = {}): Map<string, StartStats> {
  return new Battle(loadout, [enemy], opts).startSnapshot();
}

/** Run one battle. Gauntlet / Boss Rush take a list of enemies (one per fight). */
export function runBattle(loadout: Loadout, enemies: EnemyInput | EnemyInput[], opts: BattleOptions = {}): BattleResult {
  return new Battle(loadout, Array.isArray(enemies) ? enemies : [enemies], opts).run();
}

interface PerStatusBonus {
  target: string;
  stat: ItemStatPct;
  amount: number;
  status: string;
  on: 'self' | 'enemy';
  max?: number;
}

class Battle implements EffectApi {
  private readonly cfg: Config;
  private readonly defs: ReadonlyMap<string, StatusData>;
  private readonly rng: Rng;
  private readonly tickS: number;
  private readonly sides: Record<Side, Combatant>;
  private readonly itemsById = new Map<string, CombatItem>();
  private order: Side[];
  private readonly mode: string;
  private readonly fightLimit: number;
  private readonly totalLimit: number;
  private readonly berserkPerFight: boolean;
  private readonly bossFights: Set<number>;
  private readonly logOn: boolean;
  private readonly log: BattleEvent[] = [];
  private readonly warnings = new Set<string>();
  private readonly reports: Record<string, ItemReport> = {};
  private readonly frac = new FractionalStacks();
  private readonly limitCounts = new Map<string, number>();
  /** The current fight is against a player (PvP rules). */
  private pvp = false;
  private pvpApplied = false;
  /** The dying Spike holder's Spike is resolving (it may still deal damage). */
  private spikeWindow = false;
  /** The current enemy's loadout when it has a build (transform_item on its side). */
  private enemyLoadout: Loadout | null = null;
  private enemyPrefixNow = 'enemy:';
  /** cooldown_s: the tick an effect can fire again. */
  private readonly readyAt = new Map<string, number>();
  private readonly bumps = new Map<string, number>();
  private rateCounts = new Map<string, number>();
  private readonly hpArmed = new Map<string, boolean>();
  /** Recasts ("activate again"): the tick each weapon spell's next queued recast goes, and recasts per item this tick. */
  private readonly recastAt = new Map<string, number>();
  private recastCounts = { tick: -1, counts: new Map<string, number>() };
  /** The tick each status-reading spell last acted (it acts once per tick). */
  private readonly actedAt = new Map<string, number>();
  private readonly readsCache = new Map<string, boolean>();
  /** The activation being emitted: a recast (hats may not roll on it), or a wasted one (the item's own effects don't run). */
  private actMode: { recast: boolean; muted: CombatItem | null } = { recast: false, muted: null };
  /** Work queued for a later tick: the next hit of a multi-hit, the next activation of "Activates Burn 9 times", a crit repeat. */
  private scheduled: { tick: number; run: () => void }[] = [];
  private readonly timedBonuses: { item: CombatItem; stat: ItemStatPct; amount: number; until: number }[] = [];
  private readonly untilHit: { item: CombatItem; stat: ItemStatPct; amount: number }[] = [];
  private perStatus: PerStatusBonus[] = [];
  private readonly dealt: Record<Side, number> = { player: 0, enemy: 0 };
  private readonly taken: Record<Side, number> = { player: 0, enemy: 0 };
  private readonly statusTotals: Record<string, number> = {};
  private readonly enemyStatusTotals: Record<string, number> = {};
  private readonly moves: Record<Side, StatusMoves> = {
    player: { cleansed: 0, removed: 0, stolen: 0, reflected: 0, spent: {} },
    enemy: { cleansed: 0, removed: 0, stolen: 0, reflected: 0, spent: {} },
  };
  private readonly fights: FightResult[] = [];
  private readonly loadout: Loadout;
  private hitCtx: { reductionPct: number } | null = null;
  /** Sides whose HP reached 0 this tick; settled at the end of the tick (actions in one tick happen together). */
  private readonly dying = new Set<Side>();
  /** Damage the current hit dealt (charge_counter reads it). */
  private lastHitDamage = 0;
  /** Amount of the event being handled (on_heal: overheal). */
  private lastEventAmount = 0;
  /** "every N" triggers: what has built up toward the next firing. */
  private readonly everyAcc = new Map<string, number>();
  /** Set while on_lethal effects run; prevent_lethal turns the killing blow into 1 damage. */
  private lethalCtx: { toOne: boolean; avoid: boolean } | null = null;
  /** Stacks each side removed or stole from the other, by status (amount_from.removed). */
  private readonly removedFromFoe: Record<Side, Record<string, number>> = { player: {}, enemy: {} };
  /** Activations waiting for the activation that set them off to finish (see activate). */
  private readonly activationFrames: [CombatItem, number, boolean][][] = [];
  /** Item bonuses that follow a live value (Forbidden Power: up to +25% as HP goes missing). */
  private scaledBonuses: { target: CombatItem; owner: CombatItem; effect: ItemEffect }[] = [];
  /** One chance roll per (item, roll_group) while an event is handled. */
  private rollCache: Map<string, boolean> | null = null;
  /** The item whose event set off the effect being run (credited with statuses it helped apply). */
  private assistItem: CombatItem | null = null;
  /** The effect being run skips inflict bonuses (ignore_inflict_bonus). */
  private noInflictBonus = false;
  /** Block removed by effects during the trigger being handled (Flesh Burst's bonus). */
  private removedBlock = 0;
  private berserkAnnounced = false;
  /** per_dot multiplier for the effect being handled (value() applies it). */
  private valueScale = 1;
  private tick = 0;
  private fightTick = 0;
  private fightOver = false;
  private fightWinner: Side = 'enemy';
  private fightReason: 'death' | 'timeout' = 'timeout';

  constructor(
    input: Loadout,
    private readonly enemies: EnemyInput[],
    private readonly opts: BattleOptions,
  ) {
    const cfg = input.data.config;
    if (!cfg) throw new BattleSetupError('No config loaded.');
    this.cfg = cfg;
    this.defs = input.data.statuses;
    this.rng = new Rng(opts.seed ?? 1);
    this.tickS = cfg.timing.tick_seconds;
    this.logOn = opts.log ?? false;

    this.mode = opts.mode ?? 'stage';
    const m = cfg.modes[this.mode];
    if (!m) throw new BattleSetupError(`Unknown battle mode "${this.mode}" (config modes: ${Object.keys(cfg.modes).join(', ')}).`);
    if (!SUPPORTED_MODES.includes(this.mode)) throw new BattleSetupError(`Mode "${this.mode}" isn't simulated yet [later].`);
    if (enemies.length === 0) throw new BattleSetupError('No enemy.');
    if (enemies.length !== m.fights) {
      throw new BattleSetupError(
        `${this.mode} has ${m.fights} fight${m.fights === 1 ? '' : 's'} but ${enemies.length} enem${enemies.length === 1 ? 'y was' : 'ies were'} given.`,
      );
    }
    const ticks = (s: number) => Math.round(s / this.tickS);
    if (m.fixed_time) opts = { ...opts, durationS: undefined };
    // Per-fight limit (Stage, Boss Rush) or one total limit (Gauntlet); a duration overrides whichever the mode uses.
    let fightLimit = m.fight_seconds !== undefined ? ticks(opts.durationS ?? m.fight_seconds) : Infinity;
    this.totalLimit = m.total_seconds !== undefined ? ticks(opts.durationS ?? m.total_seconds) : Infinity;
    if (!Number.isFinite(fightLimit) && !Number.isFinite(this.totalLimit)) fightLimit = ticks(opts.durationS ?? 30);
    this.fightLimit = fightLimit;
    this.berserkPerFight = m.fight_seconds !== undefined || cfg.multi_fight.berserk_per_fight;
    this.bossFights = new Set(m.boss_fights);

    const p = buildPlayer(input);
    this.loadout = p.loadout;
    p.warnings.forEach((w) => this.warnings.add(w));
    this.sides = { player: p.player, enemy: p.player /* replaced per fight */ };
    this.sides.player.berserkEnabled = cfg.berserk.sides.chapter === 'both';
    this.order = cfg.timing.side_order === 'enemy_first' ? ['enemy', 'player'] : ['player', 'enemy'];
    for (const it of this.sides.player.items) this.register(it);
    for (const s of this.sides.player.skillSources ?? []) this.register(s);
  }

  /** Item filter in combat (tags, gear, enhanced cells). */
  matches(t: CombatItem, f: NonNullable<ItemEffect['filter']>): boolean {
    if (f.rarity && (!t.rarity || !(f.rarity as string[]).includes(t.rarity))) return false;
    if (f.tags_any && !f.tags_any.some((x) => t.tags.includes(x))) return false;
    if (f.tags_all && !f.tags_all.every((x) => t.tags.includes(x))) return false;
    if (f.tags_none && f.tags_none.some((x) => t.tags.includes(x))) return false;
    if (f.exclude_gear && t.kind === 'gear') return false;
    if (f.enhanced !== undefined && !!t.enhanced !== f.enhanced) return false;
    if (f.applies && !t.effects.some(({ effect }) => effect.action === 'apply_status' && effect.status === f.applies)) return false;
    return true;
  }

  /** Everything whose effects can fire for a side: bag items and hero skills. */
  private owners(c: Combatant): CombatItem[] {
    return c.skillSources?.length ? [...c.items, ...c.skillSources] : c.items;
  }

  /** passive amount_from / per_bag: the amount an effect gives right now. */
  private scaledAmount(owner: CombatItem, effect: ItemEffect): number {
    const c = this.sides[owner.side];
    let amount = effect.amount ?? 0;
    if (effect.per_bag) {
      const f = effect.per_bag;
      const kinds = new Set(
        c.items.filter((i) => (!f.tags_any || f.tags_any.some((x) => i.tags.includes(x))) && (!f.tags_all || f.tags_all.every((x) => i.tags.includes(x)))).map((i) => i.itemId),
      );
      amount = f.inverse ? amount / Math.max(1, kinds.size) : amount * kinds.size;
    }
    if (effect.per_bag_reduce) {
      const f = effect.per_bag_reduce;
      const n = c.items.filter((i) => this.matches(i, f)).length;
      amount = Math.max(f.min ?? 0, amount - f.step * n);
    }
    const a = effect.amount_from;
    if (a) {
      const foe = this.sides[other(c.side)];
      const base = a.missing_hp
        ? (100 * (c.maxHp - Math.max(0, c.hp))) / Math.max(1, c.maxHp)
        : a.remaining_hp
          ? (100 * Math.max(0, c.hp)) / Math.max(1, c.maxHp)
          : a.enemy_remaining_hp
            ? (100 * Math.max(0, foe.hp)) / Math.max(1, foe.maxHp)
        : a.status
          ? stacksOf(a.status_on === 'enemy' ? this.sides[other(c.side)] : c, a.status)
          : a.removed
            ? (this.removedFromFoe[c.side][a.removed] ?? 0)
            : this.stat(c, a.stat ?? '');
      amount = base * a.factor;
      if (a.max !== undefined) amount = Math.min(a.max, amount);
    }
    return amount;
  }

  private register(it: CombatItem) {
    this.itemsById.set(it.id, it);
    this.reports[it.id] ??= { name: it.name, side: it.side, attacks: 0, hits: 0, misses: 0, crits: 0, damage: 0, healing: 0, block: 0, statuses: {}, activations: 0, skillActivations: 0, triggers: 0, assisted: {}, spent: {}, moved: 0 };
  }

  // ---------------------------------------------------------------- fights

  private setupFight(i: number) {
    const modePvp = this.cfg.modes[this.mode]?.pvp ?? false;
    const asTyped = this.enemies[i]!;
    // A player is never a boss, and monster-only settings (DMG reduction, starting statuses, resistances,
    // vulnerabilities, immunities) never apply to one (user, 2026-10-18).
    const player = modePvp || enemyKind(asTyped, this.loadout.data) === 'player';
    const monsterOnly = [
      asTyped.damage_reduction ? 'DMG reduction' : '',
      asTyped.starting_statuses?.length ? 'starting statuses' : '',
      Object.keys(asTyped.resistances ?? {}).length ? 'resistances' : '',
      Object.keys(asTyped.vulnerabilities ?? {}).length ? 'vulnerabilities' : '',
      asTyped.immunities?.length ? 'immunities' : '',
    ].filter(Boolean);
    if (player && monsterOnly.length) this.warnOnce(`${asTyped.name} is a player, so its ${monsterOnly.join(', ')} don't apply (they're for monsters).`);
    const input: EnemyInput = player
      ? { ...asTyped, boss: false, damage_reduction: 0, starting_statuses: [], resistances: {}, vulnerabilities: {}, immunities: [] }
      : asTyped;
    const boss = !player && (this.bossFights.has(i + 1) || (input.boss ?? false));
    const e = input.build
      ? buildEnemyFromBuild(this.loadout.data, input, boss, i)
      : { ...buildEnemy(input, this.cfg.combat.default_crit_damage_pct, boss, i), loadout: null };
    this.enemyLoadout = e.loadout;
    this.enemyPrefixNow = enemyPrefix(i);
    e.warnings.forEach((w) => this.warnings.add(w));
    // PvP (the enemy is a player): both sides' HP and Block × the multiplier, PvP Berserk rules, PvP final DMG.
    // Arena is always PvP; elsewhere the enemy's kind decides (a player when its build has player items).
    if (modePvp && input.kind === 'monster') this.warnOnce(`${this.mode} is PvP: ${input.name} is set to a monster but fights as a player (HP and Block ×${this.cfg.pvp.hp_block_multiplier}).`);
    if (!modePvp && input.kind === 'monster' && hasPlayerItems(this.loadout.data, input)) {
      this.warnOnce(`${input.name} has player items but is set to a monster, so there's no PvP ×${this.cfg.pvp.hp_block_multiplier} HP and Block.`);
    }
    this.pvp = player;
    if (this.pvp) {
      const m = this.cfg.pvp.hp_block_multiplier;
      e.enemy.maxHp *= m;
      e.enemy.hp *= m;
      e.enemy.block *= m;
      if (!this.pvpApplied) {
        const me = this.sides.player;
        me.maxHp *= m;
        me.hp *= m;
        me.block *= m;
        this.pvpApplied = true;
        if (this.enemies.length > 1) this.warnOnce(`A player enemy in a ${this.enemies.length}-fight mode: my HP and Block are ×${m} from fight ${i + 1} on.`);
      }
    }
    const who = this.pvp ? this.cfg.berserk.sides.pvp : this.cfg.berserk.sides.chapter;
    this.sides.player.berserkEnabled = who === 'both';
    e.enemy.berserkEnabled = (who === 'enemy' || who === 'both') && input.berserk !== false && !(input.traits ?? []).includes('short_time_limit');
    this.sides.enemy = e.enemy;
    for (const it of e.enemy.items) this.register(it);
    for (const s of e.enemy.skillSources ?? []) this.register(s);
    this.fightTick = 0;
    this.fightOver = false;
    this.berserkAnnounced = false;
    this.scheduled = [];
    if (this.enemies.length > 1) this.emitLog({ type: 'note', side: 'enemy', detail: `Fight ${i + 1}: ${input.name}${boss ? ' (boss)' : ''}` });
    for (const s of input.starting_statuses ?? []) {
      this.applyStatusTo(this.sides.enemy, s.status, s.stacks, 'enemy', s.duration, undefined, 'starts with');
    }
  }

  /** Between fights: temporary (pet-spawned) items disappear; cooldowns carry over or reset. */
  private nextFight() {
    const p = this.sides.player;
    const gone = p.items.filter((it) => it.temporary);
    if (gone.length) {
      p.items = p.items.filter((it) => !it.temporary);
      this.emitLog({ type: 'note', side: 'player', detail: `${gone.length} temporary item(s) disappear` });
    }
    if (!this.cfg.multi_fight.carry_cooldowns) for (const it of p.items) it.progress = 0;
  }

  run(): BattleResult {
    let lost = false;
    for (let i = 0; i < this.enemies.length && !lost; i++) {
      this.setupFight(i);
      if (i === 0) this.start();
      else this.nextFight();
      while (!this.fightOver && this.fightTick < this.fightLimit && this.tick < this.totalLimit) this.step();
      if (!this.fightOver) {
        this.fightWinner = this.timeoutWinner();
        this.fightReason = 'timeout';
        this.emitLog({ type: 'timeout', side: 'player', detail: `Time limit reached${this.cfg.modes[this.mode]?.timeout_winner === 'hp_pct' ? `: ${this.sides[this.fightWinner].name} has more HP % left` : ''}` });
        // Raids: when time is up I'm defeated, whatever protects me (Invincible, lethal saves).
        if (this.cfg.modes[this.mode]?.timeout_kills) {
          this.sides.player.hp = 0;
          this.fightWinner = 'enemy';
          this.emitLog({ type: 'note', side: 'enemy', detail: 'Time is up: the raid boss defeats you (nothing prevents it)' });
        }
      }
      this.fights.push({
        enemy: this.sides.enemy.name,
        winner: this.fightWinner,
        reason: this.fightReason,
        duration: Math.round(this.fightTick * this.tickS * 1000) / 1000,
        boss: this.sides.enemy.boss,
      });
      if (this.fightWinner !== 'player') lost = true;
    }
    return this.result();
  }

  startSnapshot(): Map<string, StartStats> {
    this.setupFight(0);
    this.start();
    const me = this.sides.player;
    const foe = this.sides.enemy;
    const out = new Map<string, StartStats>();
    const hit = (base: number, typePct: number) =>
      base * (1 + me.atkPct / 100) * this.modifier(typePct, this.stat(me, 'all_dmg_increase') + this.berserk(me).dmgPct) * (1 + this.finalPct(me, foe) / 100);
    for (const it of me.items) {
      const haste = it.staticHastePct + this.bonus(it, 'haste_pct') + statusPct(me, this.defs, 'haste') + this.berserk(me).hastePct;
      out.set(it.id, {
        cooldown: Number.isFinite(this.cooldownOf(it)) ? this.cooldownOf(it) : null,
        hastePct: haste,
        accuracy:
          it.accuracy === null
            ? null
            : it.accuracy + this.bonus(it, 'accuracy_pct') + statusPct(me, this.defs, 'accuracy_bonus') + (this.stat(me, 'accuracy_bonus') - (me.stats.accuracy_bonus ?? 0)),
        critChancePct: Math.min(this.cfg.combat.crit_rate_cap_pct, it.critChancePct + this.bonus(it, 'crit_chance_pct')),
        critDamagePct: it.critDamagePct + this.bonus(it, 'crit_damage_pct'),
        damagePerHit: it.damage ? hit(it.damage.base, it.damage.typePct + this.bonus(it, 'damage_pct')) : null,
        skillDamagePerHit: it.skill?.damage ? hit(it.skill.damage.base, it.skill.damage.typePct + this.bonus(it, 'skill_damage_pct')) : null,
      });
    }
    return out;
  }

  /** Battle start (SPEC §7.2): 1. pet-spawned items (setup), 2. statuses and stats, 3. damaging effects. */
  private start() {
    // Bonuses per status stack, worked out at each hit.
    this.perStatus = [];
    this.scaledBonuses = [];
    for (const it of this.owners(this.sides.player)) {
      for (const { effect } of it.effects) {
        if (effect.action !== 'add_stat_pct' || !effect.per_status || (effect.trigger !== 'passive' && effect.trigger !== 'battle_start')) continue;
        for (const t of this.itemTargets(it, effect)) {
          this.perStatus.push({ target: t.id, stat: effect.stat!, amount: effect.amount!, status: effect.per_status.status, on: effect.per_status.on, max: effect.per_status.max_stacks });
        }
      }
    }
    // Passive detailed-stat bonuses apply while their condition holds ("While Block is active, all DMG +30%").
    for (const side of this.order) {
      const c = this.sides[side];
      for (const it of this.owners(c)) {
        for (const { effect } of it.effects) {
          if (effect.trigger !== 'passive') continue;
          // Hero skills' "+x% to items" passives aren't in the items' fixed stats (stats.ts only sees the bag).
          if (effect.action === 'add_stat_pct' && !effect.per_status) {
            for (const t of this.itemTargets(it, effect)) {
              if (effect.amount_from || effect.condition) this.scaledBonuses.push({ target: t, owner: it, effect });
              else if (it.kind === 'skill' || !isStaticStatEffect(effect)) t.dynamic[effect.stat!] += this.scaledAmount(it, effect);
            }
            continue;
          }
          if (effect.action !== 'add_player_stat') continue;
          if (!this.loadout.data.stats.has(effect.player_stat!)) this.warnOnce(`${it.name}: unknown stat "${effect.player_stat}".`);
          const target = effect.target === 'enemy' ? this.sides[other(side)] : c;
          const dynamic = effect.amount_from?.missing_hp || effect.amount_from?.status || effect.amount_from?.removed ? { owner: it, effect } : undefined;
          target.conditionalStats.push({ stat: effect.player_stat!, amount: dynamic ? 0 : this.scaledAmount(it, effect), when: effect.condition ?? { who: 'self' }, label: it.name, dynamic });
        }
      }
    }
    // Start-of-battle actions in priority order (config battle_start_priority, or an effect's own
    // priority); ties go by side order, then bag position (top to bottom, left to right).
    this.rollOrder();
    const prio = this.cfg.battle_start_priority;
    const jobs: { key: number[]; run: () => void }[] = [];
    this.order.forEach((side, s) => {
      for (const it of [...this.owners(this.sides[side])]) {
        const pos = it.origin ? it.origin.y * 100 + it.origin.x : 0;
        for (const { effect, index } of it.effects) {
          // Readings not confirmed in game are never silent.
          if (effect.assumption) this.warnOnce(`Assumption — ${it.name}: ${effect.assumption}`);
          if (effect.trigger !== 'battle_start' && effect.trigger !== 'passive') continue;
          if (effect.trigger === 'passive' && (effect.action === 'add_stat_pct' || effect.action === 'add_player_stat' || effect.action === 'execute')) continue;
          const p = effect.priority ?? prio[effect.action] ?? prio.default ?? 45;
          jobs.push({ key: [p, s, pos, index], run: () => this.runEffect(it, effect, index, 0) });
        }
        // Gear weapons hit at the start of battle; normal items start on their cooldown.
        if (it.kind === 'gear' && it.damage) {
          jobs.push({ key: [prio.gear_basic_attack ?? prio.attack ?? 50, s, pos, -1], run: () => this.attack(it, 0) });
        }
      }
    });
    jobs.sort((a, b) => a.key.reduce((d, v, i) => d || v - b.key[i]!, 0));
    for (const j of jobs) j.run();
    this.settleDeaths();
  }

  /**
   * End of tick: whoever reached 0 HP dies. Both at once (other than the Spike case) → config
   * combat.mutual_kill_winner (player, enemy, or a seeded coin flip).
   */
  /**
   * death_timing immediate: a fighter at 0 HP does nothing more this tick (no actions, effects or
   * damage), so the first killing blow wins. The Spike bug is the exception (spikeWindow).
   */
  private dead(side: Side): boolean {
    return this.cfg.combat.death_timing === 'immediate' && this.dying.has(side) && !this.spikeWindow;
  }

  /** side_order random: a seeded coin flip for who acts first, each tick and at the start of battle. */
  private rollOrder() {
    if (this.cfg.timing.side_order !== 'random') return;
    this.order = this.rng.chance(50) ? ['player', 'enemy'] : ['enemy', 'player'];
  }

  /** Time ran out: the enemy wins (stages), or the higher remaining HP % (Arena; a tie is settled like a mutual kill). */
  private timeoutWinner(): Side {
    if (this.cfg.modes[this.mode]?.timeout_winner !== 'hp_pct') return 'enemy';
    const pct = (c: Combatant) => Math.max(0, c.hp) / Math.max(1, c.maxHp);
    const me = pct(this.sides.player);
    const foe = pct(this.sides.enemy);
    if (me !== foe) return me > foe ? 'player' : 'enemy';
    const tie = this.cfg.combat.mutual_kill_winner;
    return tie === 'random' ? (this.rng.chance(50) ? 'player' : 'enemy') : tie;
  }

  private settleDeaths() {
    if (this.dying.size === 0) return;
    const tie = this.cfg.combat.mutual_kill_winner;
    const winner: Side = this.dying.size === 2 ? (tie === 'random' ? (this.rng.chance(50) ? 'player' : 'enemy') : tie) : other([...this.dying][0]!);
    if (this.dying.size === 2) this.emitLog({ type: 'note', side: winner, detail: `Both fall in the same tick: ${this.sides[winner].name} wins${tie === 'random' ? ' (coin flip)' : ''}` });
    for (const side of this.dying) {
      const c = this.sides[side];
      c.hp = Math.min(c.hp, 0);
      this.emitLog({ type: 'death', side, detail: `${c.name} is defeated` });
      c.hp = 0;
    }
    this.dying.clear();
    this.fightOver = true;
    this.fightWinner = winner;
    this.fightReason = 'death';
  }

  private step() {
    this.tick++;
    this.fightTick++;
    this.rateCounts = new Map();
    this.rollOrder();
    for (const side of this.order) this.updateBerserk(this.sides[side]);

    // Queued in order; work queued now for this same tick runs too.
    for (let i = 0; i < this.scheduled.length; i++) {
      const job = this.scheduled[i]!;
      if (job.tick !== this.tick) continue;
      this.scheduled.splice(i--, 1);
      job.run();
      if (this.fightOver) return;
    }

    this.statusTimers();
    if (this.fightOver) return;
    this.effectTimers();
    if (this.fightOver) return;
    this.checkExecutes();
    if (this.fightOver) return;
    for (const side of this.order) {
      for (const it of [...this.sides[side].items]) {
        this.advanceSkill(it);
        if (this.fightOver) return;
        this.advance(it);
        if (this.fightOver) return;
      }
    }
    this.settleDeaths();
    // Durations count whole ticks: something applied at tick t for d seconds is active through tick t + d.
    this.expire();
  }

  private get t(): number {
    return Math.round(this.tick * this.tickS * 1000) / 1000;
  }

  private ticksFor(seconds: number): number {
    return Math.max(1, Math.round(seconds / this.tickS));
  }

  private untilFor(durationS: number | undefined): number | undefined {
    return durationS === undefined ? undefined : this.tick + this.ticksFor(durationS);
  }

  /** Timed stacks, stat changes and bonuses whose time is up (run at the end of each tick). */
  private expire() {
    for (const side of ['player', 'enemy'] as const) {
      const c = this.sides[side];
      const before = new Map([...c.statuses].map(([id, s]) => [id, s.stacks]));
      for (const id of expireStacks(c, this.tick)) {
        const left = c.statuses.get(id)?.stacks ?? 0;
        const lost = (before.get(id) ?? 0) - left;
        this.emitLog({ type: 'status', side, target: side, detail: `${c.name}: ${lost} ${id} wears off (now ${left})` });
      }
      for (const s of c.timedStats) {
        if (s.until <= this.tick) this.emitLog({ type: 'note', side, target: side, detail: `${c.name}: ${s.stat} ${s.amount >= 0 ? '+' : ''}${s.amount} ends` });
      }
      c.timedStats = c.timedStats.filter((s) => s.until > this.tick);
      for (const s of c.conditionalStats) {
        if (s.until !== undefined && s.until <= this.tick) {
          this.emitLog({ type: 'note', side, target: side, detail: `${c.name}: ${s.stat} ${s.amount >= 0 ? '+' : ''}${s.amount} (${s.label}) ends` });
        }
      }
      c.conditionalStats = c.conditionalStats.filter((s) => s.until === undefined || s.until > this.tick);
    }
    for (const side of ['player', 'enemy'] as const) {
      for (const it of this.sides[side].items) {
        if (it.sealedUntil > 0 && it.sealedUntil === this.tick) this.emitLog({ type: 'note', side, source: it.id, detail: `${it.name}: Seal ends` });
      }
    }
    for (let i = this.timedBonuses.length - 1; i >= 0; i--) {
      const b = this.timedBonuses[i]!;
      if (b.until <= this.tick) {
        b.item.dynamic[b.stat] -= b.amount;
        this.timedBonuses.splice(i, 1);
        this.emitLog({ type: 'note', side: b.item.side, source: b.item.id, detail: `${b.item.name}: ${b.stat} ${b.amount >= 0 ? '+' : ''}${b.amount} ends` });
      }
    }
  }

  // ---------------------------------------------------------------- berserk

  /**
   * Berserk (SPEC §7.6) on a clock: the fight's (Stage, Boss Rush) or the whole battle's (Gauntlet).
   * Stack 1 arrives at 10.00 s, or as soon as an enemy enters after that; then +1 on every whole
   * interval of the clock (10.0, 11.0, 12.0 … s), not counted from when the enemy entered.
   */
  private updateBerserk(c: Combatant) {
    if (!c.berserkEnabled) return;
    const cfg = this.cfg.berserk;
    const time = Math.round((this.berserkPerFight ? this.fightTick : this.tick) * this.tickS * 1000) / 1000;
    if (time + 1e-9 < cfg.start_seconds) return;
    const k = (time - cfg.start_seconds) / cfg.interval_seconds;
    const onBoundary = Math.abs(k - Math.round(k)) < 1e-6;
    let n = c.berserkStacks;
    if (n === 0) n = 1;
    else if (onBoundary) n++;
    if (n !== c.berserkStacks) {
      const entering = c.berserkStacks === 0;
      c.berserkStacks = n;
      const b = berserkBonus(n, this.cfg.berserk);
      this.emitLog({ type: 'berserk', side: c.side, amount: n, detail: `${c.name} Berserk ${n}: +${b.dmgPct}% DMG, +${b.hastePct}% haste, +${b.accuracyPct}% accuracy` });
      if (entering && !this.berserkAnnounced) {
        this.berserkAnnounced = true;
        for (const side of this.order) this.emit('on_berserk', side, undefined, 0);
      }
    }
  }

  private berserk(c: Combatant): BerserkBonus {
    return c.berserkEnabled ? berserkBonus(c.berserkStacks, this.cfg.berserk) : NO_BERSERK;
  }

  // ---------------------------------------------------------------- item stats in combat

  /** An item's combat-time bonus: gained during battle + per status stack (SPEC §5.2). */
  private bonus(it: CombatItem, stat: ItemStatPct): number {
    let total = it.dynamic[stat];
    for (const s of this.scaledBonuses) {
      if (s.target !== it || s.effect.stat !== stat) continue;
      if (s.effect.condition && !this.conditionHolds(s.owner, s.effect.condition)) continue;
      const over = s.effect.amount_from?.accuracy_over;
      if (s.effect.amount_from?.target_crit && stat !== 'crit_chance_pct') {
        const a = Math.min(this.cfg.combat.crit_rate_cap_pct, it.critChancePct + this.bonus(it, 'crit_chance_pct')) * s.effect.amount_from.factor;
        total += s.effect.amount_from.max !== undefined ? Math.min(s.effect.amount_from.max, a) : a;
      } else if (over !== undefined) {
        // Adrenaline: the target's own accuracy above the threshold (never below 0).
        const acc = (it.accuracy ?? 0) + this.bonus(it, 'accuracy_pct') + statusPct(this.sides[it.side], this.defs, 'accuracy_bonus');
        const a = Math.max(0, acc - over) * s.effect.amount_from!.factor;
        total += s.effect.amount_from!.max !== undefined ? Math.min(s.effect.amount_from!.max, a) : a;
      } else total += this.scaledAmount(s.owner, s.effect);
    }
    for (const b of this.perStatus) {
      if (b.target !== it.id || b.stat !== stat) continue;
      const holder = b.on === 'self' ? this.sides[it.side] : this.sides[other(it.side)];
      const n = stacksOf(holder, b.status);
      total += b.amount * (b.max !== undefined ? Math.min(n, b.max) : n);
    }
    return total;
  }

  private stunned(c: Combatant): boolean {
    return hasBehaviour(c, this.defs, 'stun');
  }

  private sealed(it: CombatItem): boolean {
    return it.sealedUntil >= this.tick && it.sealedUntil > 0;
  }

  combatStat(c: Combatant, id: string): number {
    return (c.combatStats[id] ?? 0) + c.timedStats.filter((s) => s.stat === id).reduce((a, s) => a + s.amount, 0);
  }

  /** cooldown = base / (1 + haste) × (1 + Freeze / 100), clamped to the minimum (SPEC §7.3). */
  cooldownOf(it: CombatItem): number {
    if (it.baseCooldown === null) return Infinity;
    const owner = this.sides[it.side];
    const haste = it.staticHastePct + this.bonus(it, 'haste_pct') + statusPct(owner, this.defs, 'haste') + this.berserk(owner).hastePct;
    const div = 1 + haste / 100;
    if (div <= 0) return Infinity;
    const freeze = 1 + statusPct(owner, this.defs, 'slow') / 100;
    return Math.max(this.cfg.timing.min_cooldown_seconds, (it.baseCooldown / div) * freeze);
  }

  private advance(it: CombatItem) {
    if (it.baseCooldown === null) return;
    if (it.maxAttacks !== null && it.attacks >= it.maxAttacks) return;
    // Stun: cooldowns don't progress. Seal: this item is disabled.
    if (this.stunned(this.sides[it.side]) || this.sealed(it)) return;
    const cd = this.cooldownOf(it);
    if (!Number.isFinite(cd)) return;
    it.progress += this.tickS / cd;
    if (it.progress >= 1 - 1e-9) {
      // At most one activation per tick; leftover progress carries over (never a whole cooldown).
      it.progress = Math.min(Math.max(0, it.progress - 1), 1 - 1e-6);
      this.activate(it, 0, true);
    }
  }

  /** Gear skills on a fixed timer: haste and Freeze never change them (SPEC §4.5). */
  private advanceSkill(it: CombatItem) {
    const s = it.skill;
    if (!s || s.intervalTicks === null) return;
    if (this.sealed(it) || (this.cfg.combat.stun_pauses_gear_skills && this.stunned(this.sides[it.side]))) return;
    s.ticks++;
    if (s.ticks >= s.intervalTicks) {
      s.ticks = 0;
      this.activateSkill(it, 0);
    }
  }

  // ---------------------------------------------------------------- activations, attacks, skills

  activate(it: CombatItem, depth: number, own = false, extra = false, recast = false) {
    if (this.fightOver || this.sealed(it) || this.dead(it.side)) return;
    if (depth > this.cfg.combat.max_chain_depth) {
      this.warnOnce(`Simulator bug: an endless loop of activations (${it.name}) was cut off after ${this.cfg.combat.max_chain_depth} steps. This isn't a game rule; please report the build.`);
      return;
    }
    if (it.maxAttacks !== null && it.attacks >= it.maxAttacks) return;
    // A spell that reads statuses acts once per tick (user, 2026-10-20): another activation in the same tick is
    // wasted. It still counts as an activation for what watches it (Witch's Mirror, the hats).
    const once = this.cfg.combat.recast.status_reading_once_per_tick && this.readsStatuses(it);
    const wasted = once && this.actedAt.get(it.id) === this.tick;
    if (once) this.actedAt.set(it.id, this.tick);
    this.reports[it.id]!.activations++;
    if (!own) this.emitLog({ type: 'activation', side: it.side, source: it.id, detail: `${it.name} activated${recast ? ' again' : ''}${wasted ? ' (wasted: it already acted this tick)' : ''}` });
    // Items this activation sets off (Lightning Rod on the Stun it causes) go after it finishes its own
    // effects, in the same tick: Instant Freeze spends its 25 Freeze before it can be activated again.
    const queued: [CombatItem, number, boolean][] = [];
    this.activationFrames.push(queued);
    const prevMode = this.actMode;
    this.actMode = { recast, muted: wasted ? it : null };
    try {
      this.emit('on_activation', it.side, it, depth);
    } finally {
      this.activationFrames.pop();
      this.actMode = prevMode;
    }
    if (!this.fightOver && it.damage && !wasted) this.attack(it, depth);
    for (const [t, d, r] of queued) this.activate(t, d, false, false, r);
    // "Attack 0 ~ N more time(s)": each extra attack is an activation of its own, one spacing after the last
    // (user, 2026-10-17), so On Activation effects and dot watchers (Witch's Mirror, Wizard's Hat) see it again.
    if (!extra && it.randomExtraHits && !this.fightOver) {
      const n = Math.floor(this.rng.next() * (it.randomExtraHits + 1));
      if (n > 0) {
        this.emitLog({ type: 'note', side: it.side, source: it.id, detail: `${it.name} attacks ${n} more time${n > 1 ? 's' : ''}` });
        this.later(this.cfg.timing.multi_hit_spacing_ticks, () =>
          this.sequence(n, () => {
            this.activate(it, depth, false, true);
            return 1;
          }),
        );
      }
    }
  }

  /**
   * "Activate [dot] Spell" from an effect: right away, or after the activation that caused it. A recast
   * ("activate again", one per hat that rolls it) of a tool spell acts again in the same tick; a weapon spell's
   * recasts queue, each config combat.recast.weapon_spacing_ticks after the last.
   */
  triggerActivation(it: CombatItem, depth: number, recast = false) {
    if (recast) {
      const rc = this.cfg.combat.recast;
      if (this.recastCounts.tick !== this.tick) this.recastCounts = { tick: this.tick, counts: new Map() };
      const n = (this.recastCounts.counts.get(it.id) ?? 0) + 1;
      this.recastCounts.counts.set(it.id, n);
      if (n > rc.max_per_tick) {
        this.warnOnce(`${it.name} was activated again more than ${rc.max_per_tick} times in one tick; the rest were cut off (a simulator guard, not a game rule).`);
        return;
      }
      if (it.damage && rc.weapon_spacing_ticks > 0) {
        const at = Math.max(this.tick + rc.weapon_spacing_ticks, (this.recastAt.get(it.id) ?? -Infinity) + rc.weapon_spacing_ticks);
        this.recastAt.set(it.id, at);
        // A new tick: the chain starts over (it isn't a loop inside one tick).
        this.later(at - this.tick, () => this.activate(it, 0, false, false, true));
        return;
      }
    }
    const frame = this.activationFrames.at(-1);
    if (frame) frame.push([it, depth, recast]);
    else this.activate(it, depth, false, false, recast);
  }

  /** The item's own On Activation effects read statuses: a condition on one, or removing / stealing / triggering them (config). */
  private readsStatuses(it: CombatItem): boolean {
    const known = this.readsCache.get(it.id);
    if (known !== undefined) return known;
    const actions = this.cfg.combat.recast.status_reading_actions;
    const reads = it.effects.some(({ effect: e }) => {
      if ((e.trigger !== 'on_activation' && e.trigger !== 'on_use') || (e.watch ?? 'self') !== 'self') return false;
      const c = e.condition;
      return actions.includes(e.action) || !!(c && (c.status !== undefined || c.no_status !== undefined || c.statuses_total || c.status_over_foe_hp));
    });
    this.readsCache.set(it.id, reads);
    return reads;
  }

  attack(it: CombatItem, depth: number) {
    if (this.fightOver || !it.damage || this.sealed(it) || this.dead(it.side)) return;
    if (it.maxAttacks !== null && it.attacks >= it.maxAttacks) return;
    it.attacks++;
    this.reports[it.id]!.attacks++;
    const hits = it.hits + (it.nextExtraHits ?? 0);
    it.nextExtraHits = 0;
    this.emitLog({ type: 'attack', side: it.side, source: it.id, detail: `${it.name} attacks${hits > 1 ? ` (${hits} hits)` : ''}` });
    this.emit('on_attack', it.side, it, depth);
    this.sequence(hits, () => {
      this.resolveHit(it, 'weapon', depth);
      return 1;
    });
  }

  activateSkill(it: CombatItem, depth: number) {
    const s = it.skill;
    if (!s || this.fightOver || this.sealed(it) || this.dead(it.side)) return;
    s.activations++;
    this.reports[it.id]!.skillActivations++;
    this.emitLog({ type: 'activation', side: it.side, source: it.id, detail: `${it.name}: skill activates` });
    this.emit('on_skill_activation', it.side, it, depth);
    const hits = s.hits + s.bonusHits + (s.extraHitsStatus ? stacksOf(this.sides[it.side], s.extraHitsStatus) : 0);
    if (!s.damage) return;
    this.sequence(hits, () => {
      this.resolveHit(it, 'skill', depth);
      return 1;
    });
  }

  /**
   * A dodged / evaded skill hit still sets off its "Activates <status> N times" (Primal Flame's Burn,
   * Spiral Spear's Spike): those trigger the status directly instead of hitting like a weapon (user, 2026-10-17).
   */
  private skillActivationsThroughDodge(it: CombatItem, depth: number) {
    for (const { effect, index } of it.effects) {
      if (effect.trigger !== 'on_skill_hit' || effect.action !== 'trigger_status') continue;
      if (effect.watch && effect.watch !== 'self') continue;
      this.runEffect(it, effect, index, depth, it);
      if (this.fightOver) return;
    }
  }

  /** Run `fn` now, or `ticks` ticks from now (0 = right away). */
  private later(ticks: number, fn: () => void) {
    if (ticks <= 0) fn();
    else this.scheduled.push({ tick: this.tick + ticks, run: fn });
  }

  /**
   * `times` steps one after another (config timing.multi_hit_spacing_ticks apart): the first now.
   * A step returns how many damage events it took (a crit Burn dealt twice = 2), and the next step
   * waits that many spacings. Stops when a step returns 0 or the fight ends.
   */
  sequence(times: number, step: (i: number) => number) {
    const spacing = this.cfg.timing.multi_hit_spacing_ticks;
    const run = (i: number) => {
      if (i >= times || this.fightOver) return;
      const used = step(i);
      if (used <= 0) return;
      this.later(used * spacing, () => run(i + 1));
    };
    run(0);
  }

  /** Skill Gauge: +pct %. Timer skills: the timer moves forward by pct % of its interval ("Refunds 25% Skill Charge"). */
  chargeSkill(it: CombatItem, pct: number, depth: number) {
    const s = it.skill;
    if (s && !s.gauge && s.intervalTicks !== null) {
      s.ticks += Math.round((s.intervalTicks * pct) / 100);
      while (s.ticks >= s.intervalTicks && !this.fightOver) {
        s.ticks -= s.intervalTicks;
        this.activateSkill(it, depth + 1);
      }
      return;
    }
    if (!s?.gauge) {
      this.warnOnce(`${it.name}: charge_skill on an item without a skill.`);
      return;
    }
    s.gaugePct += pct;
    while (s.gaugePct >= 100 - 1e-9 && !this.fightOver) {
      s.gaugePct -= 100;
      this.activateSkill(it, depth + 1);
    }
  }

  /**
   * One hit of a weapon attack or gear skill: Invincible → accuracy → crit → pre-hit reductions →
   * damage → Vamp / Burn / Spike → item triggers (SPEC §5.2, §7.3).
   */
  private resolveHit(it: CombatItem, kind: 'weapon' | 'skill', depth: number) {
    const isSkill = kind === 'skill';
    const src = isSkill ? it.skill : it;
    if (this.fightOver || !src?.damage || this.dead(it.side)) return;
    const att = this.sides[it.side];
    const def = this.sides[other(it.side)];
    const rep = this.reports[it.id]!;
    const c = this.cfg.combat;
    const weaponLike = !isSkill || c.skill_hits_are_weapon_hits;

    if (hasBehaviour(def, this.defs, 'invincible')) {
      this.emitLog({ type: 'miss', side: it.side, source: it.id, detail: `${it.name}: ${def.name} is Invincible` });
      return;
    }

    if (weaponLike && hasBehaviour(def, this.defs, 'evade_all')) {
      rep.misses++;
      this.emitLog({ type: 'miss', side: it.side, source: it.id, detail: `${it.name}: ${def.name} evades` });
      this.emit('on_dodge', def.side, it, depth);
      this.emit('on_miss', att.side, it, depth);
      this.endUntilHit(it);
      if (isSkill) this.skillActivationsThroughDodge(it, depth);
      return;
    }

    const accuracy = isSkill ? it.skill!.accuracy : it.accuracy;
    const always = isSkill ? it.skill!.alwaysHit : it.alwaysHit;
    if (weaponLike && !always && accuracy !== null) {
      const raw =
        accuracy +
        this.bonus(it, 'accuracy_pct') +
        statusPct(att, this.defs, 'accuracy_bonus') +
        this.berserk(att).accuracyPct +
        // Accuracy gained in battle (Focus Training, Forbidden Power); the profile part is in the item's accuracy.
        (this.stat(att, 'accuracy_bonus') - (att.stats.accuracy_bonus ?? 0)) -
        this.stat(def, 'evasion') -
        statusPct(def, this.defs, 'evasion_bonus');
      const chance = Math.min(c.hit_chance_cap_pct, Math.max(c.hit_chance_floor_pct, raw));
      if (!this.rng.chance(chance)) {
        rep.misses++;
        this.emitLog({ type: 'miss', side: it.side, source: it.id, detail: `${it.name}${isSkill ? ' skill' : ''} missed (${pctTag(chance)}% to hit)` });
        this.emit('on_dodge', def.side, it, depth);
        this.emit('on_miss', att.side, it, depth);
        this.endUntilHit(it);
        if (isSkill) this.skillActivationsThroughDodge(it, depth);
        return;
      }
    }

    const critChance = Math.min(
      c.crit_rate_cap_pct,
      (isSkill ? it.skill!.critChancePct : it.critChancePct) + this.bonus(it, 'crit_chance_pct') - this.stat(att, 'crit_rate_reduction'),
    );
    const crit = (it.autoCritWhen !== undefined && this.conditionHolds(it, it.autoCritWhen)) || this.rng.chance(critChance);
    const critDmg = it.critDamagePct + this.bonus(it, 'crit_damage_pct');
    const typePct =
      src.damage.typePct + this.bonus(it, isSkill ? 'skill_damage_pct' : 'damage_pct') + (this.stunned(def) ? this.stat(att, 'dmg_vs_stunned') : 0);
    const allPct = this.stat(att, 'all_dmg_increase') + this.berserk(att).dmgPct;
    // Hawk Eye: a chance for a weapon crit to deal more.
    const lucky = crit && this.stat(att, 'weapon_crit_proc_chance') > 0 && this.rng.chance(this.stat(att, 'weapon_crit_proc_chance'));
    // Courage to Protect All: extra damage from current Block.
    const fromBlock =
      (att.block * (this.stat(att, 'weapon_dmg_from_block_pct') + this.bonus(it, 'block_dmg_pct'))) / 100 + (this.atkOf(att) * this.bonus(it, 'atk_dmg_pct')) / 100;
    const amount =
      ((src.damage.base + (src.damage.pctOfFoeMaxHp ? (def.maxHp * src.damage.pctOfFoeMaxHp) / 100 : 0)) * (1 + att.atkPct / 100) * this.modifier(typePct, allPct) * (crit ? 1 + critDmg / 100 : 1) * (lucky ? 1 + this.stat(att, 'weapon_crit_proc_dmg') / 100 : 1) +
        fromBlock) *
      (1 + this.finalPct(att, def) / 100);
    rep.hits++;
    if (crit) rep.crits++;
    this.endUntilHit(it);
    this.emitLog({ type: 'hit', side: it.side, source: it.id, crit, detail: `${it.name}${isSkill ? ' skill' : ''} hits${crit ? ' (crit)' : ''}` });

    // Pre-hit reductions ("On Attacked: 50% chance to reduce DMG taken by 20%").
    let extra = 0;
    if (weaponLike) {
      this.hitCtx = { reductionPct: 0 };
      this.emit('before_attacked', def.side, it, depth);
      extra = this.hitCtx.reductionPct;
      this.hitCtx = null;
    }
    const wasDying = this.dying.has(def.side);
    this.lastHitDamage = this.damage(att, def, amount, isSkill ? 'skill' : 'weapon', it, { crit, extraReductionPct: extra });
    if (this.fightOver) return;

    if (weaponLike) this.statusOnWeaponHit(att, def, !wasDying && this.dying.has(def.side));
    if (this.fightOver) return;
    // Event amount = the damage this hit dealt ("extra DMG equal to 50% of Attack DMG").
    const dealt = this.lastHitDamage;
    this.emit(isSkill ? 'on_skill_hit' : 'on_hit', att.side, it, depth, undefined, dealt);
    if (this.fightOver) return;
    if (weaponLike) this.emit('on_weapon_hit', att.side, it, depth, undefined, dealt);
    if (this.fightOver) return;
    if (crit) this.emit('on_crit', att.side, it, depth);
    if (this.fightOver) return;
    if (weaponLike) this.emit('on_attacked', def.side, it, depth);
  }

  private modifier(typePct: number, allPct: number): number {
    return this.cfg.combat.all_dmg_mode === 'separate' ? (1 + typePct / 100) * (1 + allPct / 100) : 1 + (typePct + allPct) / 100;
  }

  /** Final DMG multipliers: vs bosses (PvP comes with Arena). */
  private finalPct(att: Combatant, def: Combatant): number {
    return (def.boss ? (att.stats.final_dmg_boss_increase ?? 0) : 0) + (this.pvp ? (att.stats.final_dmg_pvp_increase ?? 0) : 0);
  }

  // ---------------------------------------------------------------- damage, healing, block

  /**
   * Invincible → reduction & vulnerability (25% floor) → damage-to-1 immunities → Divine Grace →
   * absorb (Waterdrop Cushion) → block → HP (SPEC §7.3). Returns the damage taken.
   */
  private damage(
    from: Combatant,
    to: Combatant,
    amount: number,
    type: DamageType,
    source?: CombatItem,
    opts: { status?: string; crit?: boolean; ignoresBlock?: boolean; extraReductionPct?: number } = {},
  ): number {
    if (this.fightOver || amount <= 0 || this.dead(from.side)) return 0;
    if (hasBehaviour(to, this.defs, 'invincible')) {
      this.emitLog({ type: 'note', side: to.side, detail: `${to.name} is Invincible: no damage` });
      return 0;
    }
    const weaponish = type === 'weapon' || type === 'skill';
    let reduction = opts.extraReductionPct ?? 0;
    let vuln = statusPct(to, this.defs, 'vulnerability') + this.stat(to, 'dmg_taken_increase');
    if (weaponish || type === 'status') reduction += this.combatStat(to, 'dmg_reduction');
    if (weaponish) {
      reduction += this.combatStat(to, 'attack_dmg_reduction');
      vuln += this.combatStat(to, 'attack_dmg_vulnerability');
    }
    if (opts.status) {
      reduction += this.combatStat(to, `${opts.status}_dmg_reduction`);
      vuln += this.combatStat(to, `${opts.status}_vulnerability`);
    }
    if (opts.crit) vuln += this.combatStat(to, 'crit_vulnerability');
    let amt = amount * Math.max(this.cfg.combat.damage_taken_floor_pct / 100, 1 - reduction / 100 + vuln / 100);
    if ((weaponish && to.immunities.has('weapon_attack')) || (opts.status && to.immunities.has(opts.status))) amt = Math.min(amt, 1);
    for (const [id] of [...to.statuses]) {
      if (this.defs.get(id)?.behaviour === 'damage_to_one') {
        amt = Math.min(amt, 1);
        removeStacks(to, id, 1);
        this.emitLog({ type: 'note', side: to.side, detail: `${to.name}: ${id} sets the damage to 1` });
        break;
      }
    }
    let absorbed = 0;
    for (const [id, s] of [...to.statuses]) {
      if (this.defs.get(id)?.behaviour !== 'absorb' || amt - absorbed <= 0) continue;
      const k = Math.min(s.stacks, amt - absorbed);
      removeStacks(to, id, k);
      absorbed += k;
    }
    const left = amt - absorbed;
    const toBlock = opts.ignoresBlock ? 0 : Math.min(to.block, left);
    to.block -= toBlock;
    if (left - toBlock >= to.hp && to.hp > 0 && !this.dying.has(to.side)) {
      const avoided = this.lethalAvoided(to, source);
      if (avoided === 'avoid') {
        this.emitLog({ type: 'note', side: to.side, detail: `${to.name} avoids the killing blow` });
        return 0;
      }
      if (avoided === 'one') {
        const one = to.hp > 1 ? 1 : 0;
        to.hp -= one;
        this.emitLog({ type: 'note', side: to.side, detail: `${to.name}: the killing blow is reduced to 1` });
        return one;
      }
    }
    // Totals count only what was actually taken off: no overkill, nothing after HP reached 0.
    const counted = absorbed + toBlock + Math.max(0, Math.min(left - toBlock, to.hp));
    to.hp -= left - toBlock;
    this.dealt[from.side] += counted;
    this.taken[to.side] += counted;
    if (source) this.reports[source.id]!.damage += counted;
    if (opts.status) {
      const tot = from.side === 'player' ? this.statusTotals : this.enemyStatusTotals;
      tot[opts.status] = (tot[opts.status] ?? 0) + counted;
    }
    this.emitLog({
      type: 'damage',
      side: from.side,
      source: source?.id ?? opts.status,
      target: to.side,
      amount: amt,
      crit: opts.crit,
      detail: `${type}${opts.status ? ` (${opts.status})` : ''}: ${Math.round(amt)} → ${to.name}${toBlock > 0 ? ` (${Math.round(toBlock)} to block)` : ''}${absorbed > 0 ? ` (${Math.round(absorbed)} absorbed)` : ''}`,
    });
    if (to.hp <= 0) {
      // Settled at the end of the tick, so everything else in this tick still happens.
      this.dying.add(to.side);
      return amt;
    }
    this.refill(to);
    const hpLost = Math.max(0, Math.min(left - toBlock, to.hp + (left - toBlock)));
    if (hpLost > 0) this.emit('on_hp_lost', to.side, undefined, 0, undefined, Math.min(hpLost, to.maxHp));
    if (source) this.emit('on_damage_dealt', from.side, source, 0);
    this.checkHp(to);
    return amt;
  }

  /** heal × (1 + heal bonus % − Heal Amount Reduction %), floor 0 (SPEC §5.3). */
  heal(target: Combatant, amount: number, owner?: CombatItem, vamp = false) {
    if (this.fightOver || amount <= 0) return;
    const bonus = this.stat(target, 'healing_power_enhance') + (vamp ? (target.stats.vamp_recovery_amount ?? 0) : 0);
    const mult = Math.max(0, 1 + bonus / 100 - statusPct(target, this.defs, 'heal_reduction') / 100);
    const want = amount * mult;
    const healed = Math.min(want, target.maxHp - target.hp);
    target.hp += healed;
    if (owner) this.reports[owner.id]!.healing += healed;
    this.emitLog({
      type: 'heal',
      side: target.side,
      source: owner?.id,
      amount: healed,
      detail: `${target.name} heals ${Math.round(healed)}${healed < want ? ` (${Math.round(want - healed)} overheal)` : ''}`,
    });
    this.checkHp(target);
    if (this.fightOver || (owner && owner.side !== target.side)) return;
    this.emit('on_heal', target.side, owner, 0, undefined, want - healed);
  }

  gainBlock(target: Combatant, amount: number, owner: CombatItem) {
    if (this.fightOver || amount <= 0) return;
    const gained = amount * (1 + this.stat(target, 'block_gain') / 100);
    target.block += gained;
    this.reports[owner.id]!.block += gained;
    this.emitLog({ type: 'block', side: target.side, source: owner.id, amount: gained, detail: `${target.name} gains ${Math.round(gained)} block` });
    this.emit('on_block_gained', target.side, owner, 0, undefined, gained);
  }

  removeBlock(target: Combatant, amount: number, owner: CombatItem) {
    if (this.fightOver) return;
    const removed = Math.min(target.block, amount);
    target.block -= removed;
    this.removedBlock += removed;
    this.emitLog({ type: 'block_removed', side: owner.side, source: owner.id, amount: removed, detail: `${owner.name} removes ${Math.round(removed)} block` });
  }

  loseHp(target: Combatant, amount: number, owner: CombatItem) {
    if (this.fightOver) return;
    const lost = Math.max(0, Math.min(amount, target.hp - this.cfg.combat.self_hp_loss_floor));
    target.hp -= lost;
    this.emitLog({ type: 'hp_lost', side: target.side, source: owner.id, amount: lost, detail: `${target.name} loses ${Math.round(lost)} HP` });
    this.refill(target);
    this.checkHp(target);
    if (lost > 0 && owner.side === target.side) this.emit('on_self_hp_loss', target.side, owner, 0, undefined, lost);
    if (lost > 0) this.emit('on_hp_lost', target.side, undefined, 0, undefined, lost);
  }

  effectDamage(owner: CombatItem, target: Combatant, amount: number, type: 'effect' | 'weapon' = 'effect', canCrit?: { bonusPct: number }) {
    const from = this.sides[owner.side];
    const allPct = this.stat(from, 'all_dmg_increase') + this.berserk(from).dmgPct;
    // Pet attacks crit with my Crit Rate (+ their own bonus) and my Crit DMG.
    const crit = !!canCrit && this.rng.chance(Math.min(this.cfg.combat.crit_rate_cap_pct, this.stat(from, 'crit_rate') + canCrit.bonusPct - this.stat(from, 'crit_rate_reduction')));
    const critMult = crit ? 1 + (from.stats.crit_dmg ?? this.cfg.combat.default_crit_damage_pct) / 100 : 1;
    if (crit) this.reports[owner.id]!.crits++;
    this.damage(from, target, amount * this.modifier(0, allPct) * critMult * (1 + this.finalPct(from, target) / 100), type, owner, { crit });
  }

  /**
   * A hit is about to kill `c`: run its on_lethal effects. The blow is avoided if `c` is Invincible
   * afterwards (Celestial Shield), or the enemy died during them (Scream's 1-frame invincibility).
   */
  private lethalAvoided(c: Combatant, source?: CombatItem): 'none' | 'avoid' | 'one' {
    if (!this.owners(c).some((it) => it.effects.some(({ effect }) => effect.trigger === 'on_lethal'))) return 'none';
    const foe = other(c.side);
    const foeWasDying = this.dying.has(foe);
    const prev = this.lethalCtx;
    this.lethalCtx = { toOne: false, avoid: false };
    let toOne = false;
    let avoid = false;
    try {
      this.emit('on_lethal', c.side, source, 0);
      toOne = this.lethalCtx.toOne;
      avoid = this.lethalCtx.avoid;
    } finally {
      this.lethalCtx = prev;
    }
    if (avoid || hasBehaviour(c, this.defs, 'invincible') || (!foeWasDying && this.dying.has(foe))) return 'avoid';
    return toOne ? 'one' : 'none';
  }

  chargeCounter(owner: CombatItem, status: string, pct: number) {
    const n = (this.lastHitDamage * pct) / 100;
    if (n <= 0) return;
    addStacks(this.sides[owner.side], status, n, owner.side);
    this.emitLog({ type: 'status', side: owner.side, source: owner.id, detail: `${owner.name}: +${Math.round(n)} ${status} (now ${Math.round(stacksOf(this.sides[owner.side], status))})` });
  }

  releaseCounter(owner: CombatItem, status: string) {
    const own = this.sides[owner.side];
    const n = stacksOf(own, status);
    if (n <= 0) return;
    removeStacks(own, status, n);
    this.countSpent(owner, status, n);
    this.emitLog({ type: 'effect', side: owner.side, source: owner.id, detail: `${owner.name}: releases ${Math.round(n)} ${status}` });
    this.damage(own, this.sides[other(owner.side)], n, 'effect', owner);
  }

  /**
   * Waterdrop Cushion (refill_hp statuses): while below full HP, stacks heal 1% of max HP each, up to
   * full. Runs right after HP drops (before "HP below x%" triggers) and when stacks are gained. Not a
   * heal: healing bonuses / reductions and on_heal don't apply [UNVERIFIED].
   */
  private refill(c: Combatant) {
    if (c.hp <= 0 || c.hp >= c.maxHp || this.dying.has(c.side)) return;
    for (const [id, s] of [...c.statuses]) {
      if (this.defs.get(id)?.behaviour !== 'refill_hp' || s.stacks <= 0) continue;
      const missingPct = (100 * (c.maxHp - c.hp)) / c.maxHp;
      const need = this.cfg.combat.refill_rounding === 'ceil' ? Math.ceil(missingPct - 1e-9) : missingPct;
      const use = Math.min(s.stacks, need);
      const healed = Math.min(c.maxHp - c.hp, (use * c.maxHp) / 100);
      removeStacks(c, id, use);
      c.hp += healed;
      this.emitLog({ type: 'heal', side: c.side, amount: healed, detail: `${c.name}: ${id} refills ${Math.round(healed)} HP (${Number(use.toFixed(2))} stacks, ${Number(stacksOf(c, id).toFixed(2))} left)` });
      if (c.hp >= c.maxHp) break;
    }
  }

  /** hp_below triggers fire when HP crosses the threshold, and re-arm when healed above it. */
  private checkHp(c: Combatant) {
    for (const it of this.owners(c)) {
      for (const { effect, index } of it.effects) {
        if (effect.trigger !== 'hp_below') continue;
        const key = `${it.id}#${index}`;
        const below = c.hp <= (c.maxHp * effect.hp_pct!) / 100;
        const armed = this.hpArmed.get(key) ?? true;
        if (below && armed) {
          this.hpArmed.set(key, false);
          this.runEffect(it, effect, index, 0);
          if (this.fightOver) return;
        } else if (!below) this.hpArmed.set(key, true);
      }
    }
  }

  // ---------------------------------------------------------------- statuses

  applyStatus(owner: CombatItem, target: Combatant, status: string, stacks: number, depth: number, durationS?: number) {
    this.applyStatusTo(target, status, stacks, owner.side, durationS, owner, undefined, depth);
  }

  /**
   * Apply a status: immunity → (Stun: resistance roll) → Inflict Increase × pet multiplier →
   * resistance % → fractional stacks → timed or permanent (SPEC §5.3).
   */
  private applyStatusTo(target: Combatant, status: string, stacks: number, inflicter: Side, durationS?: number, owner?: CombatItem, verb?: string, depth = 0) {
    if (this.fightOver) return;
    const def = this.defs.get(status);
    if (!def) {
      this.warnOnce(`Unknown status "${status}".`);
      return;
    }
    if (target.immunities.has(status)) {
      this.emitLog({ type: 'status', side: inflicter, target: target.side, detail: `${target.name} is immune to ${status}` });
      return;
    }
    // Snowball Fight: timed Burn / Freeze I inflict last longer.
    if (durationS !== undefined && owner && owner.side === inflicter) durationS += this.stat(this.sides[inflicter], `${status}_duration_bonus_s`);
    const until = this.untilFor(durationS);
    if (def.behaviour === 'stun' || def.stacking === false) {
      if (def.behaviour === 'stun') {
        const res = this.combatStat(target, 'stun_resistance');
        const chance = this.cfg.combat.stun_resistance_mode === 'multiply' ? 100 * (1 - res / 100) : 100 - res;
        if (!this.rng.chance(chance)) {
          this.emitLog({ type: 'status', side: inflicter, target: target.side, detail: `${target.name} resists Stun` });
          this.emit('on_status_resisted', target.side, undefined, depth, status);
          return;
        }
      }
      const wasStunned = def.behaviour === 'stun' && this.stunned(target);
      setNonStacking(target, status, inflicter, this.tick, until, this.cfg.combat.stun_reapply);
      if (owner) this.bumpReport(owner, status, 1);
      this.emitLog({
        type: 'status',
        side: inflicter,
        source: owner?.id,
        target: target.side,
        detail: `${owner?.name ?? target.name}: ${verb ?? '+'} ${status} on ${target.name}${durationS ? ` for ${durationS}s` : ''}`,
      });
      if (def.behaviour === 'stun' && owner) this.emit('on_stun', owner.side, owner, depth);
      if (wasStunned && owner) this.emit('on_restun', owner.side, owner, depth);
      if (owner) this.emit('on_status_applied', owner.side, owner, depth, status, 1);
      return;
    }
    const from = this.sides[inflicter];
    const tagged = owner
      ? (from.taggedInflict ?? []).filter((b) => b.statuses.includes(status) && b.tags.some((t) => owner.tags.includes(t))).reduce((a, b) => a + b.pct, 0)
      : 0;
    let exact = this.noInflictBonus
      ? stacks
      : stacks * (1 + ((owner ? this.stat(from, `${status}_inflict_increase`) : 0) + tagged + (owner?.inflictPct?.[status] ?? 0)) / 100) * (owner?.inflictMultiplier[status] ?? 1);
    // Resistance: <status>_resistance, plus All Debuff Resist for statuses that have a resistance stat (Burn, Poison, Freeze).
    if (owner && this.loadout.data.stats.has(`${status}_resistance`)) {
      const res = this.combatStat(target, `${status}_resistance`) + this.combatStat(target, 'all_debuff_resist');
      exact *= Math.max(0, 1 - res / 100);
    }
    const n = owner ? this.frac.take(`${owner.id}>${status}>${target.side}`, exact) : Math.floor(exact + 1e-9);
    if (n <= 0) return;
    addStacks(target, status, n, inflicter, until);
    if (owner) this.bumpReport(owner, status, n);
    if (owner && this.assistItem) {
      const a = this.reports[this.assistItem.id]!.assisted;
      a[status] = (a[status] ?? 0) + n;
    }
    this.emitLog({
      type: 'status',
      side: inflicter,
      source: owner?.id,
      target: target.side,
      amount: n,
      detail: `${owner?.name ?? target.name}: ${verb ?? '+'}${verb ? ' ' : ''}${n} ${status} on ${target.name}${durationS ? ` for ${durationS}s` : ''} (now ${stacksOf(target, status)})`,
    });
    if (def.behaviour === 'refill_hp') this.refill(target);
    if (owner) this.emit('on_status_applied', owner.side, owner, depth, status, n);
    // Consider This Yours: part of a debuff the enemy gives me goes back to them (not reflected again).
    // Stat-like debuffs that can't be removed (Heal Amount Reduction) can't be reflected either (user, 2026-10-18).
    const reflect = this.stat(target, 'debuff_reflect_pct');
    if (reflect > 0 && verb !== 'reflects' && inflicter !== target.side && def.polarity === 'debuff' && def.removable !== false) {
      const back = this.frac.take(`reflect>${target.side}>${status}`, (n * reflect) / 100);
      if (back > 0) {
        const foe = this.sides[inflicter];
        addStacks(foe, status, back, target.side, until);
        this.moves[target.side].reflected += back;
        this.emitLog({ type: 'status', side: target.side, target: foe.side, amount: back, detail: `${target.name}: reflects ${back} ${status} onto ${foe.name} (now ${stacksOf(foe, status)})` });
      }
    }
  }

  private bumpReport(owner: CombatItem, status: string, n: number) {
    const rep = this.reports[owner.id]!;
    rep.statuses[status] = (rep.statuses[status] ?? 0) + n;
  }

  /** Status damage: stacks × ratio × stat, + that status's DMG Increase, can crit (SPEC §5.3, §7.3). */
  private statusDamage(dealer: Combatant, victim: Combatant, status: string, stacks: number, mult = 1): number {
    const def = this.defs.get(status);
    const per = def?.amount_per_stack;
    if (!def || !per) return 0;
    const scaler = per.of === 'holder' ? (def.behaviour === 'damage_attacker' ? dealer : victim) : dealer;
    const base = mult * stacks * per.ratio * (per.scales_with === 'atk' ? this.atkOf(scaler) : scaler.maxHp);
    const typePct = this.stat(dealer, `${status}_dmg_increase`);
    const allPct = this.stat(dealer, 'all_dmg_increase') + this.berserk(dealer).dmgPct;
    // Status crits: the dealer's Crit Rate + the status's own Crit Rate (Archwizard's Ring: Burn Crit
    // Rate, itself capped at 100%); anything at or over 100% always crits.
    const statusRate = Math.min(this.cfg.combat.status_crit_rate_cap_pct, this.stat(dealer, `${status}_crit_rate`));
    const rawChance = this.stat(dealer, 'crit_rate') + (def.crit_chance_pct ?? 0) + statusRate - this.stat(dealer, 'crit_rate_reduction');
    const crit = this.rng.chance(Math.min(this.cfg.combat.crit_rate_cap_pct, rawChance));
    const critDmg =
      (dealer.stats.crit_dmg ?? this.cfg.combat.default_crit_damage_pct) +
      (def.crit_damage_pct ?? 0) +
      this.stat(dealer, `${status}_crit_dmg`) +
      ((this.cfg.combat.status_crit_dmg_per_rate_from === 'bonus' ? statusRate : rawChance) * this.stat(dealer, `${status}_crit_dmg_per_crit_rate`)) / 100;
    const amount = base * this.modifier(typePct, allPct) * (crit ? 1 + critDmg / 100 : 1) * (1 + this.finalPct(dealer, victim) / 100);
    // "Burn that lands as a Critical Hit deals DMG 2 times": each time is its own damage event, a tick apart.
    const times = crit ? 1 + Math.max(0, Math.round(this.stat(dealer, `${status}_crit_repeat`))) : 1;
    const ignoresBlock = this.stat(dealer, 'status_ignores_block') > 0;
    this.sequence(times, () => {
      this.damage(dealer, victim, amount, 'status', undefined, { status, crit, ignoresBlock });
      this.emit('on_status_damage', dealer.side, undefined, 0, status, amount);
      return 1;
    });
    return times;
  }

  private statusHeal(holder: Combatant, status: string, stacks: number) {
    const per = this.defs.get(status)?.amount_per_stack;
    if (!per) return;
    this.heal(holder, stacks * per.ratio * (per.scales_with === 'hp' ? holder.maxHp : this.atkOf(holder)), undefined, status === 'vamp');
    this.emitLog({ type: 'note', side: holder.side, detail: `(${status} ×${stacks})` });
  }

  /** Vamp on the attacker's weapon hit; Burn and Spike on the defender being hit. One roll for all stacks. */
  private statusOnWeaponHit(att: Combatant, def: Combatant, killedByHit = false) {
    for (const [id, s] of [...att.statuses]) {
      const d = this.defs.get(id);
      if (d?.trigger !== 'holder_weapon_hit') continue;
      if (!this.rng.chance(d.chance_pct ?? 100)) continue;
      if (d.behaviour === 'heal_holder') this.statusHeal(att, id, s.stacks);
      if (this.fightOver) return;
    }
    for (const [id, s] of [...def.statuses]) {
      const d = this.defs.get(id);
      if (d?.trigger !== 'holder_hit_by_weapon') continue;
      if (!this.rng.chance(d.chance_pct ?? 100)) continue;
      if (d.behaviour === 'damage_holder') this.statusDamage(this.sides[s.inflicter], def, id, s.stacks);
      else if (d.behaviour === 'damage_attacker') {
        // The Spike bug: the holder's Spike still answers the hit that kills them.
        this.spikeWindow = true;
        try {
          this.statusDamage(def, att, id, s.stacks);
        } finally {
          this.spikeWindow = false;
        }
        // Known game bug: if my hit kills them but their Spike kills me, they survive on 1 HP.
        if (killedByHit && this.dying.has(att.side) && this.dying.has(def.side)) {
          def.hp = 1;
          this.dying.delete(def.side);
          this.emitLog({ type: 'note', side: def.side, detail: `${def.name} survives on 1 HP (Spike killed the attacker)` });
        }
      }
      if (this.fightOver) return;
    }
  }

  /** Timed statuses (Poison, Regen) run on a global timer from battle start (SPEC §5.3). */
  private statusTimers() {
    for (const side of this.order) {
      const c = this.sides[side];
      for (const [id, s] of [...c.statuses]) {
        const d = this.defs.get(id);
        if (d?.trigger !== 'timer') continue;
        // Venom's blessing: the inflicter's Poison ticks faster (<status>_interval_bonus_s, negative = faster).
        const base = d.interval_s ?? this.cfg.timing.status_timer_seconds;
        const bonus = d.behaviour === 'damage_holder' ? this.stat(this.sides[s.inflicter], `${id}_interval_bonus_s`) : 0;
        if (this.tick % this.ticksFor(Math.max(this.tickS, base + bonus)) !== 0) continue;
        if (!this.rng.chance(d.chance_pct ?? 100)) continue;
        if (d.behaviour === 'damage_holder') this.statusDamage(this.sides[s.inflicter], c, id, s.stacks);
        else if (d.behaviour === 'heal_holder') this.statusHeal(c, id, s.stacks);
        if (this.fightOver) return;
      }
    }
  }

  // ---------------------------------------------------------------- item-effect triggers

  /** passive execute effects: the enemy dies the moment the condition holds. */
  private checkExecutes() {
    for (const side of this.order) {
      for (const it of this.owners(this.sides[side])) {
        for (const { effect, index } of it.effects) {
          if (effect.trigger !== 'passive' || effect.action !== 'execute') continue;
          if (effect.condition && !this.conditionHolds(it, effect.condition)) continue;
          this.runEffect(it, effect, index, 0);
          if (this.fightOver || this.dying.size) {
            this.settleDeaths();
            return;
          }
        }
      }
    }
  }

  /** Kill the opponent outright (an Execute ignores block and HP). */
  execute(owner: CombatItem) {
    const foe = this.opponent(owner);
    if (this.fightOver || foe.hp <= 0) return;
    if (foe.immunities.has('execute')) {
      this.warnOnce(`${foe.name} can't be executed: ${owner.name}'s Execute does nothing.`);
      return;
    }
    this.emitLog({ type: 'effect', side: owner.side, source: owner.id, target: foe.side, detail: `${owner.name}: executes ${foe.name}` });
    this.dealt[owner.side] += foe.hp;
    this.taken[foe.side] += foe.hp;
    foe.hp = 0;
    this.dying.add(foe.side);
  }

  private effectTimers() {
    for (const side of this.order) {
      for (const it of [...this.owners(this.sides[side])]) {
        for (const { effect, index } of it.effects) {
          if (effect.trigger !== 'timer') continue;
          if (effect.until_s !== undefined && this.tick > Math.round(effect.until_s / this.tickS)) continue;
          const due =
            (effect.interval_s !== undefined && this.tick % this.ticksFor(effect.interval_s) === 0) ||
            (effect.at_s !== undefined && this.tick === Math.max(1, Math.round(effect.at_s / this.tickS)));
          if (!due) continue;
          this.runEffect(it, effect, index, 0);
          if (this.fightOver) return;
        }
      }
    }
  }

  private watches(owner: CombatItem, effect: ItemEffect, trigger: string, ev: CombatItem | undefined, listening = false): boolean {
    if (!ITEM_EVENTS.has(trigger)) return true; // combatant-level: on_attacked, on_dodge, before_attacked, on_block_gained, on_stun
    // No item behind the event (a status heal): only "any" effects count it.
    if (!ev) return effect.watch === 'any';
    if (trigger === 'on_weapon_hit' && !ev.tags.includes('weapon')) return false;
    const w = effect.watch ?? (trigger === 'on_weapon_hit' ? (effect.uses_dots ? 'dots' : 'any') : 'self');
    const ok =
      w === 'self'
        ? ev.id === owner.id
        : w === 'dots'
          ? owner.dotTargets.includes(ev.id)
          : w === 'self_and_dots'
            ? ev.id === owner.id || owner.dotTargets.includes(ev.id)
            : ev.side === (listening ? other(owner.side) : owner.side);
    if (!ok) return false;
    const f = effect.watch_filter;
    if (f?.tags_any && !f.tags_any.some((t) => ev.tags.includes(t))) return false;
    if (f?.tags_all && !f.tags_all.every((t) => ev.tags.includes(t))) return false;
    // "On Fastest Weapon Hit": only the item that is the fastest / strongest match right now.
    if (f?.pick) {
      const pool = this.sides[ev.side].items.filter((i) => this.matches(i, f));
      if (this.pickOne(pool, f.pick) !== ev) return false;
    }
    return true;
  }

  private emit(trigger: ItemEffect['trigger'], side: Side, ev: CombatItem | undefined, depth: number, status?: string, amount = 0) {
    const prevRolls = this.rollCache;
    const prevRemoved = this.removedBlock;
    const prevAmount = this.lastEventAmount;
    this.rollCache = new Map();
    this.removedBlock = 0;
    // event_pct reads the event amount: overheal (on_heal), hit damage (on_hit), stacks applied (on_status_applied) …
    this.lastEventAmount = amount;
    try {
      this.emitInner(trigger, side, ev, depth, status, amount);
    } finally {
      this.rollCache = prevRolls;
      this.removedBlock = prevRemoved;
      this.lastEventAmount = prevAmount;
    }
  }

  /** Flesh Burst: + bonus × (Block removed in this trigger ÷ my max HP). */
  removedBlockBonus(owner: CombatItem, effect: ItemEffect): number {
    if (!effect.bonus_per_removed_block || this.removedBlock <= 0) return 0;
    const per = this.scaled(owner, effect.bonus_per_removed_block);
    return per === null ? 0 : (per * this.removedBlock) / Math.max(1, this.sides[owner.side].maxHp);
  }

  note(owner: CombatItem, text: string) {
    this.emitLog({ type: 'note', side: owner.side, source: owner.id, detail: `${owner.name}: ${text}` });
  }

  private emitInner(trigger: ItemEffect['trigger'], side: Side, ev: CombatItem | undefined, depth: number, status: string | undefined, amount: number) {
    // My effects, then the opponent's effects that listen to my events (listen: enemy).
    const mine = this.owners(this.sides[side]).map((o) => [o, false] as const);
    const theirs = this.owners(this.sides[other(side)])
      .filter((o) => o.effects.some(({ effect }) => effect.listen === 'enemy'))
      .map((o) => [o, true] as const);
    for (const [owner, listening] of [...mine, ...theirs]) {
      for (const { effect, index } of owner.effects) {
        if ((effect.listen === 'enemy') !== listening) continue;
        const match = effect.trigger === trigger || (trigger === 'on_activation' && effect.trigger === 'on_use');
        if (!match || !this.watches(owner, effect, trigger, ev, listening)) continue;
        if (trigger === 'on_activation') {
          // A wasted activation: the item's own effects don't run.
          if (owner === this.actMode.muted && ev === owner && (effect.watch ?? 'self') !== 'dots') continue;
          // No chain (config): the hats don't roll on a recast (nor what shares their roll: Frost Mage's Hat's Block).
          if (this.actMode.recast && !this.cfg.combat.recast.chain && this.recastRoll(owner, effect)) continue;
        }
        if (
          (trigger === 'on_status_applied' || trigger === 'on_status_damage' || trigger === 'on_status_resisted') &&
          effect.params?.status !== undefined &&
          effect.params.status !== status
        )
          continue;
        const only = effect.params?.statuses as string[] | undefined;
        if (only && (!status || !only.includes(status))) continue;
        // "If removed" on enemy buffs only (Witch's Mirror): params.polarity limits the status kind.
        if (effect.params?.polarity !== undefined && (!status || this.defs.get(status)?.polarity !== effect.params.polarity)) continue;
        if (effect.min_event_amount !== undefined && amount <= effect.min_event_amount) continue;
        if (effect.every !== undefined) {
          // "On Inflicting 100 Freeze": fire once per full threshold built up.
          const key = `${owner.id}#${index}`;
          const step = typeof effect.every === 'number' ? effect.every : this.scaled(owner, effect.every);
          if (!step || step <= 0) continue;
          // The count is stored before the effect runs: an effect that feeds its own count (Blazing Spirit's
          // attack inflicts Burn) must see the threshold already spent, or it fires forever.
          this.everyAcc.set(key, (this.everyAcc.get(key) ?? 0) + amount);
          while ((this.everyAcc.get(key) ?? 0) + 1e-9 >= step && !this.fightOver) {
            this.everyAcc.set(key, this.everyAcc.get(key)! - step);
            this.runEffect(owner, effect, index, depth, ev);
          }
        } else this.runEffect(owner, effect, index, depth, ev);
        if (this.fightOver) return;
      }
    }
  }

  /** An "activate again" effect, or one rolled together with it. */
  private recastRoll(owner: CombatItem, effect: ItemEffect): boolean {
    if (isRecast(effect)) return true;
    return effect.roll_group !== undefined && owner.effects.some(({ effect: e }) => e.roll_group === effect.roll_group && isRecast(e));
  }

  private runEffect(owner: CombatItem, effect: ItemEffect, index: number, depth: number, ev?: CombatItem) {
    if (this.fightOver || this.dead(owner.side)) return;
    if (effect.condition && !this.conditionHolds(owner, effect.condition)) return;
    const scale = effect.per_dot ? this.perDot(owner, effect) : 1;
    if (scale === 0) return;
    if (this.sealed(owner)) return;
    const key = `${owner.id}#${index}`;
    if (effect.limit && (this.limitCounts.get(key) ?? 0) >= effect.limit.per_battle) return;
    const rate = this.cfg.timing.trigger_rate_limits[effect.trigger];
    if (rate !== undefined && (this.rateCounts.get(key) ?? 0) >= rate) return;
    if (effect.chance_pct !== undefined) {
      let chance = effect.chance_pct;
      // Stun Rate (Electrostatic Force, Meteor Hammer): + points on chances to Stun.
      if (effect.action === 'apply_status' && effect.status === 'stun') chance += this.stat(this.sides[owner.side], 'stun_rate');
      const key = effect.roll_group ? `${owner.id}~${effect.roll_group}` : null;
      const hit = key && this.rollCache?.has(key) ? this.rollCache.get(key)! : this.rng.chance(Math.min(100, chance));
      if (key) this.rollCache?.set(key, hit);
      if (!hit) return;
    }
    if (effect.cooldown_s !== undefined && this.tick < (this.readyAt.get(key) ?? 0)) return;
    const handler = HANDLERS[effect.action];
    if (!handler) {
      this.warnOnce(`${owner.name}: action "${effect.action}" isn't simulated yet.`);
      return;
    }
    if (effect.cooldown_s !== undefined) this.readyAt.set(key, this.tick + this.ticksFor(effect.cooldown_s));
    this.limitCounts.set(key, (this.limitCounts.get(key) ?? 0) + 1);
    this.rateCounts.set(key, (this.rateCounts.get(key) ?? 0) + 1);
    if (effect.action !== 'add_stat_pct' || (effect.trigger !== 'battle_start' && effect.trigger !== 'passive')) {
      if (this.reports[owner.id]) this.reports[owner.id]!.triggers++;
      this.emitLog({ type: 'effect', side: owner.side, source: owner.id, detail: `${owner.name}: ${effect.text ?? `${effect.trigger} → ${effect.action}`}` });
    }
    const scaled: ItemEffect =
      scale === 1 ? effect : { ...effect, amount: effect.amount !== undefined ? effect.amount * scale : undefined, stacks: effect.stacks !== undefined ? effect.stacks * scale : undefined };
    this.valueScale = scale;
    const prevAssist = this.assistItem;
    const prevNoBonus = this.noInflictBonus;
    this.assistItem = ev && ev !== owner && ev.side === owner.side && this.reports[ev.id] ? ev : null;
    this.noInflictBonus = effect.ignore_inflict_bonus ?? false;
    try {
      handler(this, owner, scaled, index, depth, ev);
    } finally {
      this.valueScale = 1;
      this.assistItem = prevAssist;
      this.noInflictBonus = prevNoBonus;
    }
  }

  /** A detailed stat in battle: Stat Details + conditional blessing bonuses that currently hold. */
  private stat(c: Combatant, id: string): number {
    let v = c.stats[id] ?? 0;
    for (const b of c.conditionalStats) {
      if (b.stat !== id || (b.until !== undefined && b.until <= this.tick) || !this.holdsFor(c, b.when)) continue;
      v += b.dynamic ? this.scaledAmount(b.dynamic.owner, b.dynamic.effect) : b.amount;
    }
    return v;
  }

  private conditionHolds(owner: CombatItem, cond: EffectCondition): boolean {
    return this.holdsFor(this.sides[owner.side], cond);
  }

  /** Check a condition from `self`'s point of view (who: enemy = the other side). */
  private holdsFor(self: Combatant, cond: EffectCondition): boolean {
    const c = cond.who === 'enemy' ? this.sides[other(self.side)] : self;
    if (cond.has_block !== undefined && cond.has_block !== c.block > 0) return false;
    if (cond.status !== undefined && stacksOf(c, cond.status) < (cond.min_stacks ?? 1)) return false;
    if (cond.no_status !== undefined && stacksOf(c, cond.no_status) > 0) return false;
    if (cond.hp_above_pct !== undefined && c.hp <= (c.maxHp * cond.hp_above_pct) / 100) return false;
    if (cond.hp_below_pct !== undefined && c.hp > (c.maxHp * cond.hp_below_pct) / 100) return false;
    if (cond.statuses_total && cond.statuses_total.statuses.reduce((n, s) => n + stacksOf(c, s), 0) < cond.statuses_total.min) return false;
    if (cond.status_over_foe_hp) {
      const foe = this.sides[other(c.side)];
      const foePct = (100 * Math.max(0, foe.hp)) / Math.max(1, foe.maxHp);
      if (stacksOf(c, cond.status_over_foe_hp.status) <= cond.status_over_foe_hp.factor * foePct) return false;
    }
    return true;
  }

  /** "Per [dot] X": distinct live items under the dots matching the filter; each counts once. */
  private perDot(owner: CombatItem, effect: ItemEffect): number {
    const f = effect.per_dot!;
    const live = new Set(this.sides[owner.side].items.map((i) => i.id));
    return owner.dotTargets.filter((id) => {
      const t = this.itemsById.get(id);
      return live.has(id) && t && this.matches(t, f);
    }).length;
  }

  // ---------------------------------------------------------------- EffectApi

  own(item: CombatItem): Combatant {
    return this.sides[item.side];
  }

  opponent(item: CombatItem): Combatant {
    return this.sides[other(item.side)];
  }

  itemTargets(owner: CombatItem, effect: ItemEffect, ev?: CombatItem): CombatItem[] {
    const ids =
      effect.target === 'self_item'
        ? [owner.id]
        : effect.target === 'event_item'
          ? ev && ev.side === owner.side
            ? [ev.id]
            : []
          : effect.target === 'items_under_dots'
            ? owner.dotTargets
            : effect.target === 'all_items'
              ? this.sides[owner.side].items.map((i) => i.id)
              : [];
    const f = effect.filter;
    if (f?.rarity || f?.class) this.warnOnce(`${owner.name}: rarity / class filters aren't used in combat yet.`);
    const live = new Set(this.sides[owner.side].items.map((i) => i.id));
    const list = ids
      .filter((id) => live.has(id))
      .map((id) => this.itemsById.get(id))
      .filter((t): t is CombatItem => !!t)
      .filter((t) => !f || this.matches(t, f));
    if (f?.pick) {
      const one = this.pickOne(list, f.pick);
      return one ? [one] : [];
    }
    return list;
  }

  /**
   * strongest = highest damage per attack (base damage × hits × its damage bonus); fastest = shortest
   * cooldown right now. Ties: the first in bag order. Items without damage / a cooldown don't count.
   */
  private pickOne(list: CombatItem[], pick: 'strongest' | 'fastest'): CombatItem | null {
    let best: CombatItem | null = null;
    let bestV = 0;
    for (const it of list) {
      const cd = this.cooldownOf(it);
      const v = pick === 'strongest' ? (it.damage ? it.damage.base * it.hits * (1 + this.bonus(it, 'damage_pct') / 100) : 0) : Number.isFinite(cd) ? 1 / cd : 0;
      if (v > bestV) {
        best = it;
        bestV = v;
      }
    }
    return best;
  }

  /** Stacks an item used up as a cost (Spiral Spear's lethal save, Instant Freeze's 25 Freeze): per item and per side. */
  countSpent(owner: CombatItem, status: string, n: number) {
    if (n <= 0) return;
    const rep = this.reports[owner.id];
    if (rep) rep.spent[status] = (rep.spent[status] ?? 0) + n;
    const side = this.moves[owner.side].spent;
    side[status] = (side[status] ?? 0) + n;
  }

  isBuff(status: string) {
    return this.defs.get(status)?.polarity === 'buff';
  }

  isStealable(status: string) {
    return this.defs.get(status)?.stealable !== false;
  }

  countMoves(owner: CombatItem, kind: 'cleansed' | 'removed' | 'stolen', list: { status?: string; stacks: number }[]) {
    const side = owner.side;
    const n = list.reduce((a, r) => a + r.stacks, 0);
    this.moves[side][kind] += n;
    const rep = this.reports[owner.id];
    if (rep) rep.moved = (rep.moved ?? 0) + n;
    if (kind === 'cleansed') return;
    for (const r of list) if (r.status) this.removedFromFoe[side][r.status] = (this.removedFromFoe[side][r.status] ?? 0) + r.stacks;
  }

  mostStacksOf(target: Combatant, ids: string[]): string | null {
    let best: string | null = null;
    for (const id of ids) if (stacksOf(target, id) > (best ? stacksOf(target, best) : 0)) best = id;
    return best;
  }

  /** The enemy's max HP for a value worked out from it (0 against a raid boss: immune to HP-based damage). */
  private foeHpFor(owner: CombatItem, c: Combatant): number {
    const foe = this.sides[other(c.side)];
    if (foe.immunities.has('hp_based')) {
      this.warnOnce(`${foe.name} is immune to damage based on its HP: ${owner.name}'s HP-based value counts as 0.`);
      return 0;
    }
    return foe.maxHp;
  }

  value(owner: CombatItem, effect: ItemEffect): number | null {
    const sv = typeof effect.value === 'string' ? owner.effectValues[effect.value] : effect.value;
    if (!sv) {
      this.warnOnce(`${owner.name}: effect value "${String(effect.value)}" not found in effect_values.`);
      return null;
    }
    const r = resolveRatio(sv, this.cfg.observations.display_rounding).ratio;
    const c = this.sides[owner.side];
    const stat = sv.scales_with === 'atk' ? this.atkOf(c) : sv.scales_with === 'hp' ? c.maxHp : sv.scales_with === 'enemy_hp' ? this.foeHpFor(owner, c) : null;
    if (r === null || stat === null) {
      this.warnOnce(`${owner.name}: can't work out the effect value (unknown ratio or scaling).`);
      return null;
    }
    const sp = effect.scale_per_status;
    const per = sp ? Math.min(sp.max ?? Infinity, stacksOf(sp.on === 'enemy' ? this.sides[other(c.side)] : c, sp.status)) : 1;
    return r * stat * this.valueScale * per;
  }

  /** A scaled value against the owner's basic stats (no per-dot scaling); null if unknown. */
  private scaled(owner: CombatItem, sv: ScaledValue): number | null {
    const r = resolveRatio(sv, this.cfg.observations.display_rounding).ratio;
    const c = this.sides[owner.side];
    const stat = sv.scales_with === 'atk' ? this.atkOf(c) : sv.scales_with === 'hp' ? c.maxHp : sv.scales_with === 'enemy_hp' ? this.foeHpFor(owner, c) : null;
    if (r === null || stat === null) {
      this.warnOnce(`${owner.name}: can't work out a threshold value (unknown ratio or scaling).`);
      return null;
    }
    return r * stat;
  }

  /** ATK including Total ATK % gained in battle. */
  private atkOf(c: Combatant): number {
    return c.atk * (1 + c.atkPct / 100);
  }

  eventAmount(): number {
    return this.lastEventAmount;
  }

  /** Make a status act now: Burn / Poison damage the holder, Spike damages the holder's opponent, Vamp / Regen heal. */
  triggerStatus(owner: CombatItem, holder: Combatant, status: string, times: number, mult: number) {
    const def = this.defs.get(status);
    if (!def) {
      this.warnOnce(`Unknown status "${status}".`);
      return;
    }
    // One activation after another; each uses the stacks there are at that moment.
    this.sequence(times, (i) => {
      const s = holder.statuses.get(status);
      if (!s || s.stacks <= 0) return 0;
      this.emitLog({ type: 'effect', side: owner.side, source: owner.id, detail: `${owner.name}: ${status} activates (${i + 1}/${times}, ${s.stacks} stacks${mult !== 1 ? ` ×${mult}` : ''})` });
      if (def.behaviour === 'damage_holder') return this.statusDamage(this.sides[s.inflicter], holder, status, s.stacks, mult);
      if (def.behaviour === 'damage_attacker') return this.statusDamage(holder, this.sides[other(holder.side)], status, s.stacks, mult);
      if (def.behaviour === 'heal_holder') {
        this.statusHeal(holder, status, s.stacks * mult);
        return 1;
      }
      this.warnOnce(`${owner.name}: ${status} has nothing to activate.`);
      return 0;
    });
  }

  multiplyStatus(owner: CombatItem, target: Combatant, status: string, pct: number) {
    const s = target.statuses.get(status);
    if (!s) return;
    const n = Math.floor((s.stacks * pct) / 100 + 1e-9);
    if (n <= 0) return;
    addStacks(target, status, n, s.inflicter);
    this.emitLog({ type: 'status', side: owner.side, source: owner.id, target: target.side, amount: n, detail: `${owner.name}: ${status} on ${target.name} +${pct}% (+${n}, now ${stacksOf(target, status)})` });
  }

  addPlayerStat(owner: CombatItem, target: Combatant, stat: string, amount: number, durationS?: number) {
    if (!this.loadout.data.stats.has(stat)) this.warnOnce(`${owner.name}: unknown stat "${stat}".`);
    target.conditionalStats.push({ stat, amount, when: { who: 'self' }, label: owner.name, until: this.untilFor(durationS) });
    this.emitLog({ type: 'note', side: target.side, source: owner.id, detail: `${target.name}: ${stat} ${amount >= 0 ? '+' : ''}${amount}${durationS ? ` for ${durationS}s` : ''}` });
  }

  preventLethal(owner: CombatItem, key: string, status: string | undefined, stacks: number, growth: number, avoid = false) {
    if (!this.lethalCtx) {
      this.warnOnce(`${owner.name}: prevent_lethal only works with the on_lethal trigger.`);
      return;
    }
    const own = this.sides[owner.side];
    // Already saved by another on_lethal effect (e.g. Celestial Shield's Invincible): nothing to pay for.
    if (this.lethalCtx.toOne || this.lethalCtx.avoid || hasBehaviour(own, this.defs, 'invincible')) return;
    const used = this.bumps.get(`lethal:${key}`) ?? 0;
    const cost = stacks + growth * used;
    if (status && cost > 0) {
      if (stacksOf(own, status) < cost) return;
      removeStacks(own, status, cost);
      this.countSpent(owner, status, cost);
    }
    this.bumps.set(`lethal:${key}`, used + 1);
    if (avoid) this.lethalCtx.avoid = true;
    else this.lethalCtx.toOne = true;
    this.emitLog({ type: 'effect', side: owner.side, source: owner.id, detail: `${owner.name}: consumes ${cost} ${status ?? ''} to ${avoid ? 'evade the attack' : 'survive'}` });
  }

  addSkillHits(item: CombatItem, amount: number) {
    if (!item.skill) {
      this.warnOnce(`${item.name}: add_skill_hits on an item without a skill.`);
      return;
    }
    item.skill.bonusHits += amount;
  }

  scaleSkillDamage(item: CombatItem, factor: number) {
    if (!item.skill?.damage) {
      this.warnOnce(`${item.name}: scale_skill_damage on an item without skill damage.`);
      return;
    }
    item.skill.damage = { ...item.skill.damage, base: item.skill.damage.base * factor };
  }

  addMaxHpPct(target: Combatant, amount: number, owner: CombatItem) {
    target.baseMaxHp ??= target.maxHp;
    const gain = (target.baseMaxHp * amount) / 100;
    target.maxHp += gain;
    if (target.hp > 0) target.hp += gain;
    target.stats.hp_pct = (target.stats.hp_pct ?? 0) + amount;
    this.emitLog({ type: 'note', side: target.side, source: owner.id, detail: `${target.name}: Max HP +${amount}% (+${Math.round(gain)}, now ${Math.round(target.maxHp)})` });
  }

  addAtkPct(target: Combatant, amount: number) {
    target.atkPct += amount;
    this.emitLog({ type: 'note', side: target.side, detail: `${target.name}: Total ATK +${amount}% (now +${target.atkPct}%)` });
  }

  /** "The enemy's most common debuff": the removable debuff with the most stacks (ties: random). */
  pickStatus(target: Combatant, _pick: NonNullable<ItemEffect['pick']>): string | null {
    let best: string[] = [];
    let most = 0;
    for (const [id, s] of target.statuses) {
      const d = this.defs.get(id);
      if (!d || d.polarity !== 'debuff' || d.removable === false || d.stacking === false || s.stacks <= 0) continue;
      if (s.stacks > most) {
        most = s.stacks;
        best = [id];
      } else if (s.stacks === most) best.push(id);
    }
    if (!best.length) return null;
    return best.length === 1 ? best[0]! : best[this.rng.int(best.length)]!;
  }

  /** Give back pct % of the cooldown, or of what's left of it (pct_of: remaining). */
  refund(item: CombatItem, pct: number, ofRemaining = false) {
    const share = ofRemaining ? ((1 - item.progress) * pct) / 100 : pct / 100;
    item.progress = Math.min(1 - 1e-6, item.progress + share);
  }

  /** A seeded random pick of `n` items (activate_item / attack with pick_random). */
  pickRandom(list: CombatItem[], n: number | undefined): CombatItem[] {
    return n === undefined ? list : this.rng.sample(list, n);
  }

  /** Roll an in-battle chance stat of a side (Ill Be Having That: steal instead of remove). */
  rollStat(side: Side, stat: string): boolean {
    const v = this.stat(this.sides[side], stat);
    return v > 0 && this.rng.chance(Math.min(100, v));
  }

  addBonus(item: CombatItem, stat: ItemStatPct, amount: number, durationS?: number, untilHit?: boolean) {
    item.dynamic[stat] += amount;
    if (untilHit) this.untilHit.push({ item, stat, amount });
    else if (durationS !== undefined) this.timedBonuses.push({ item, stat, amount, until: this.tick + this.ticksFor(durationS) });
  }

  /** Bonuses that last "until the next hit" end once the item hits or misses. */
  private endUntilHit(it: CombatItem) {
    for (let i = this.untilHit.length - 1; i >= 0; i--) {
      const b = this.untilHit[i]!;
      if (b.item !== it) continue;
      it.dynamic[b.stat] -= b.amount;
      this.untilHit.splice(i, 1);
    }
  }

  growth(owner: CombatItem, effect: ItemEffect, index: number): number {
    const n = this.bump(`growth:${owner.id}#${index}`) - 1;
    const sv = typeof effect.value === 'string' ? owner.effectValues[effect.value] : effect.value;
    const c = this.sides[owner.side];
    const stat = sv?.scales_with === 'atk' ? this.atkOf(c) : sv?.scales_with === 'enemy_hp' ? this.foeHpFor(owner, c) : c.maxHp;
    return (effect.value_growth ?? 0) * stat * n;
  }

  addCombatStat(target: Combatant, stat: string, amount: number, durationS?: number) {
    if (durationS === undefined) target.combatStats[stat] = (target.combatStats[stat] ?? 0) + amount;
    else target.timedStats.push({ stat, amount, until: this.tick + this.ticksFor(durationS) });
    this.emitLog({ type: 'note', side: target.side, detail: `${target.name}: ${stat} ${amount >= 0 ? '+' : ''}${amount}${durationS ? ` for ${durationS}s` : ''}` });
  }

  reduceHit(pct: number, owner: CombatItem) {
    if (!this.hitCtx) {
      this.warnOnce(`${owner.name}: reduce_hit_damage only works with the before_attacked trigger.`);
      return;
    }
    this.hitCtx.reductionPct += pct;
  }

  seal(item: CombatItem, durationS: number, by: CombatItem) {
    item.sealedUntil = Math.max(item.sealedUntil, this.tick + this.ticksFor(durationS));
    this.emitLog({ type: 'status', side: by.side, source: by.id, detail: `${by.name}: seals ${item.name} for ${durationS}s` });
  }

  randomOpponentItems(owner: CombatItem, n: number): CombatItem[] {
    return this.rng.sample(this.opponent(owner).items, n);
  }

  /**
   * Remove random stacks (or whole statuses) of the matching statuses from a combatant. "Random"
   * goes through the seeded RNG. Returns what was removed.
   */
  removeStatuses(
    target: Combatant,
    match: { polarity?: 'buff' | 'debuff'; status?: string; steal?: boolean },
    count: number,
    unit: 'stacks' | 'statuses' | undefined,
  ): { status: string; stacks: number; timed: { stacks: number; until: number }[] }[] {
    const by = unit ?? this.cfg.combat.removal_unit;
    // Statuses that behave like stats (Heal Amount Reduction, Scream, Wish) can't be removed or stolen.
    const eligible = () =>
      [...target.statuses.keys()].filter(
        (id) => this.defs.get(id)?.removable !== false && !(match.steal && this.defs.get(id)?.stealable === false) && (match.status ? id === match.status : this.defs.get(id)?.polarity === match.polarity),
      );
    const removed = new Map<string, { stacks: number; timed: { stacks: number; until: number }[] }>();
    for (let i = 0; i < count; i++) {
      const pick = this.rng.pick(eligible());
      if (!pick) break;
      const r = removed.get(pick) ?? { stacks: 0, timed: [] };
      r.stacks += removeStacks(target, pick, by === 'statuses' ? Infinity : 1, r.timed);
      removed.set(pick, r);
    }
    const out = [...removed].map(([status, r]) => ({ status, ...r }));
    if (out.length) this.emitLog({ type: 'status', side: target.side, target: target.side, detail: `${target.name} loses ${out.map((r) => `${r.stacks} ${r.status}`).join(', ')}` });
    for (const r of out) this.emit('on_status_removed', other(target.side), undefined, 0, r.status, r.stacks);
    return out;
  }

  /** Steal: the opponent loses the stacks and I gain them (SPEC §5.3). */
  giveStatuses(to: Combatant, list: { status: string; stacks: number; timed?: { stacks: number; until: number }[] }[]) {
    for (const r of list) {
      // Stolen stacks keep their remaining time; only the permanent ones stay for the whole battle.
      const timed = r.timed ?? [];
      const permanent = r.stacks - timed.reduce((a, t) => a + t.stacks, 0);
      const def = this.defs.get(r.status);
      if (def?.behaviour === 'stun' || def?.stacking === false) {
        const until = permanent > 0 ? undefined : Math.max(...timed.map((t) => t.until));
        setNonStacking(to, r.status, to.side, this.tick, until, 'longest');
        continue;
      }
      if (permanent > 0) addStacks(to, r.status, permanent, to.side);
      for (const t of timed) addStacks(to, r.status, t.stacks, to.side, t.until);
    }
    if (list.length) this.emitLog({ type: 'status', side: to.side, target: to.side, detail: `${to.name} gains ${list.map((r) => `${r.stacks} ${r.status}`).join(', ')}` });
  }

  /** Replace an item in place with another (an egg hatching). */
  transform(item: CombatItem, newItemId: string) {
    const def = this.loadout.data.items.get(newItemId);
    const lo = item.side === 'enemy' ? this.enemyLoadout : this.loadout;
    if (!def || !item.origin || !lo) {
      this.warnOnce(`${item.name}: can't transform into "${newItemId}".`);
      return;
    }
    const { bag, layout } = lo;
    const pre = item.side === 'enemy' ? this.enemyPrefixNow : '';
    const occupant = (c: Cell) => {
      const at = c.x >= 0 && c.y >= 0 && c.x < bag.width && c.y < bag.height ? layout.occupancy[c.y * bag.width + c.x]?.[0] : undefined;
      return at === undefined ? undefined : pre + at;
    };
    const next = combatItemFromDef(lo, this.sides[item.side], def as Item, item.id, item.origin, occupant);
    next.side = item.side;
    next.inflictMultiplier = item.inflictMultiplier;
    const list = this.sides[item.side].items;
    const at = list.indexOf(item);
    if (at >= 0) list[at] = next;
    this.itemsById.set(item.id, next);
    this.reports[item.id]!.name = `${item.name} → ${def.name}`;
    this.emitLog({ type: 'note', side: item.side, source: item.id, detail: `${item.name} becomes ${def.name}` });
  }

  bump(key: string): number {
    const n = (this.bumps.get(key) ?? 0) + 1;
    this.bumps.set(key, n);
    return n;
  }

  warnOnce(message: string) {
    this.warnings.add(message);
  }

  // ---------------------------------------------------------------- output

  private emitLog(e: Omit<BattleEvent, 't'>) {
    if (this.logOn) this.log.push({ t: this.t, ...e });
  }

  private report(c: Combatant): CombatantReport {
    return {
      hp: c.hp,
      maxHp: c.maxHp,
      block: c.block,
      statuses: Object.fromEntries([...c.statuses].map(([k, v]) => [k, v.stacks])),
      damageDealt: this.dealt[c.side],
      damageTaken: this.taken[c.side],
    };
  }

  /** Once-per-battle saves from a killing blow (Celestial Shield's Invincible) a side hasn't used yet. */
  private lethalSavesLeft(c: Combatant): number {
    let n = 0;
    for (const it of this.owners(c)) {
      const saves = it.effects.filter(({ effect }) => effect.trigger === 'on_lethal' && effect.limit);
      if (saves.length && saves.some(({ effect, index }) => (this.limitCounts.get(`${it.id}#${index}`) ?? 0) < effect.limit!.per_battle)) n++;
    }
    return n;
  }

  private result(): BattleResult {
    const duration = this.t;
    const won = this.fights.length === this.enemies.length && this.fights.every((f) => f.winner === 'player');
    const last = this.fights[this.fights.length - 1]!;
    return {
      mode: this.mode,
      fights: this.fights,
      winner: won ? 'player' : 'enemy',
      reason: last.reason,
      duration,
      player: this.report(this.sides.player),
      enemy: this.report(this.sides.enemy),
      items: this.reports,
      statusDamage: this.statusTotals,
      enemyStatusDamage: this.enemyStatusTotals,
      statusMoves: this.moves,
      lethalSavesLeft: { player: this.lethalSavesLeft(this.sides.player), enemy: this.lethalSavesLeft(this.sides.enemy) },
      dps: duration > 0 ? this.dealt.player / duration : 0,
      seed: this.opts.seed ?? 1,
      log: this.log,
      warnings: [...this.warnings],
    };
  }
}
