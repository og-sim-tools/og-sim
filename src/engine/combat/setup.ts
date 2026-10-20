/** Build the two combatants for a battle from a loadout and an enemy (SPEC §7). */
import { type Cell, type Rotation, buildLayout, findFirstFit, footprintOf, placeFootprint, resolveDots } from '../bag';
import { activeEffects } from '../effects/resolve';
import type { GameData, Gear, Item, Skin } from '../loader';
import { type Loadout, buildLoadout, copyName, copyNumbers } from '../loadout';
import { type EnemyData, ItemEffectSchema } from '../model';
import { parseAbbrev, resolveRatio } from '../numbers';
import { checkSkinQuest } from '../skinQuests';
import { aggregateStats, blessingTagBonus } from '../stats';
import type { Combatant, CombatItem, CombatSkill } from './types';

/** An enemy from data/enemies or typed into a layout. */
export type EnemyInput = Omit<EnemyData, 'source' | 'verified' | 'url' | 'observed_with'> & { source?: string; verified?: boolean };

export const zeroDynamic = () => ({ haste_pct: 0, damage_pct: 0, accuracy_pct: 0, crit_chance_pct: 0, crit_damage_pct: 0, skill_damage_pct: 0, block_dmg_pct: 0, atk_dmg_pct: 0 });

// ---------------------------------------------------------------- pet-spawned items

export interface SpawnResult {
  loadout: Loadout;
  /** Instance id → status factors for what it inflicts. */
  multipliers: Map<string, Record<string, number>>;
  warnings: string[];
}

/**
 * Active pets that put items in the bag fill empty cells at the start of battle (SPEC §4.5):
 * scan left to right, top to bottom, place each in the first spot it fits, unrotated. Items I
 * placed by hand count towards the number spawned.
 */
export function withPetSpawns(loadout: Loadout): SpawnResult {
  const { data, profile } = loadout;
  const warnings: string[] = [];
  const multipliers = new Map<string, Record<string, number>>();
  const want = new Map<string, number>();
  const factors: { items: Set<string>; status: string; factor: number }[] = [];
  for (const p of profile.pets) {
    const pet = data.pets.get(p.id);
    if (!pet || !p.active || pet.ignored) continue;
    const items = new Set<string>();
    for (const s of pet.spawns) {
      items.add(s.item);
      if (p.stars >= s.stars) want.set(s.item, (want.get(s.item) ?? 0) + s.count);
    }
    for (const m of pet.spawn_inflict_multiplier) if (p.stars >= m.stars) factors.push({ items, status: m.status, factor: m.factor });
  }
  // Skin skills that summon items ("My minions!": Blood Moon Familiars).
  for (const { skin, stars } of activeSkins(loadout)) for (const s of skin.spawns) if (stars >= s.stars) want.set(s.item, (want.get(s.item) ?? 0) + s.count);
  if (want.size === 0) return { loadout, multipliers, warnings };

  const placements = [...loadout.layoutData.placements];
  const defs = new Map<string, Item | Gear>([...data.items, ...data.gear]);
  let layout = loadout.layout;
  for (const [itemId, count] of want) {
    const def = data.items.get(itemId);
    const fp = def ? footprintOf(def) : null;
    if (!def || !fp) {
      warnings.push(`Spawned item "${itemId}" is unknown or has no shape.`);
      continue;
    }
    const already = placements.filter((p) => p.item === itemId).length;
    for (let k = 1; k <= count - already; k++) {
      const at = findFirstFit(layout, fp, 0);
      if (!at) {
        warnings.push(`No room for ${count - already - k + 1} more ${def.name} (${def.kind === 'skin_spawn' ? 'skin' : 'pet'}-spawned).`);
        break;
      }
      placements.push({ id: `spawn:${itemId}#${k}`, item: itemId, x: at.x, y: at.y, rotation: 0, supply: false });
      layout = buildLayout(loadout.bag, placements.map((p, i) => ({ instanceId: p.id ?? `p${i}`, itemId: p.item, x: p.x, y: p.y, rotation: p.rotation })), defs);
    }
  }
  const next = buildLoadout(data, profile, { ...loadout.layoutData, placements });
  for (const e of next.entries.values()) {
    for (const f of factors) {
      if (!f.items.has(e.def.id)) continue;
      const m = multipliers.get(e.instanceId) ?? {};
      m[f.status] = (m[f.status] ?? 1) * f.factor;
      multipliers.set(e.instanceId, m);
    }
  }
  return { loadout: next, multipliers, warnings };
}

// ---------------------------------------------------------------- player

/** The active hero's blessings that only apply while a condition holds. */
export function conditionalBlessings(loadout: Loadout): Combatant['conditionalStats'] {
  const hero = loadout.profile.heroes.find((h) => h.id === loadout.heroId);
  return (hero?.blessings?.equipped ?? []).flatMap((b) => {
    const def = loadout.data.blessings.get(b.id);
    return def?.combat_bonus ? [{ stat: def.combat_bonus.stat, amount: b.value, when: def.combat_bonus.when, label: def.name }] : [];
  });
}

/**
 * The active hero's skills in battle: both of their own skills plus the skills linked into their
 * link slots (profile links). Each becomes an effect owner outside the bag (kind 'skill').
 */
export function heroSkillSources(loadout: Loadout, warnings: string[] = []): CombatItem[] {
  const hero = loadout.hero;
  if (!hero) return [];
  const owner = new Map<string, { heroName: string; skill: { id: string; name: string }; data: (typeof hero.skill_effects)[string] | undefined }>();
  for (const h of loadout.data.heroes.values()) for (const s of h.skills) owner.set(s.id, { heroName: h.name, skill: s, data: h.skill_effects[s.id] });
  const owned = loadout.profile.heroes.find((h) => h.id === hero.id);
  const ids = [...hero.skills.map((s) => s.id), ...(owned?.links ?? [])];
  const out: CombatItem[] = [];
  for (const id of [...new Set(ids)]) {
    const o = owner.get(id);
    if (!o) continue;
    if (!o.data) {
      warnings.push(`Hero skill "${o.skill.name}" isn't entered yet, so it isn't simulated.`);
      continue;
    }
    if (o.data.status === 'needs_values' || o.data.status === 'partial') {
      warnings.push(`Hero skill "${o.skill.name}" is ${o.data.status === 'partial' ? 'only partly' : 'not'} simulated${o.data.notes ? `: ${o.data.notes}` : '.'}`);
    }
    if (o.data.effects.length === 0) continue;
    // Unique blessings of the active hero that buff this skill change its numbers.
    const effects = o.data.effects.map((effect) => structuredClone(effect));
    for (const b of owned?.blessings?.equipped ?? []) {
      const def = loadout.data.blessings.get(b.id);
      if (def?.buffs_skill !== id || !def.skill_mods) continue;
      for (const m of def.skill_mods) {
        const e = effects[m.effect] as Record<string, unknown> | undefined;
        if (!e) continue;
        const keys = m.path.split('.');
        let obj: Record<string, unknown> = e;
        for (const k of keys.slice(0, -1)) obj = (obj[k] as Record<string, unknown>) ?? {};
        const last = keys.at(-1)!;
        const cur = typeof obj[last] === 'number' ? (obj[last] as number) : 0;
        obj[last] = m.op === 'add' ? cur + b.value : m.op === 'add_pct_of_one' ? cur + b.value / 100 : cur * (1 + b.value / 100);
      }
    }
    out.push({
      id: `skill:${id}`,
      itemId: id,
      name: `${o.heroName}: ${o.skill.name}`,
      side: 'player',
      kind: 'skill',
      tags: [],
      damage: null,
      baseCooldown: null,
      staticHastePct: 0,
      accuracy: null,
      critChancePct: 0,
      critDamagePct: 0,
      hits: 1,
      maxAttacks: null,
      alwaysHit: false,
      effects: effects.map((effect, index) => ({ effect, index })),
      effectValues: {},
      dotTargets: [],
      skill: null,
      inflictMultiplier: {},
      temporary: false,
      origin: null,
      progress: 0,
      attacks: 0,
      dynamic: zeroDynamic(),
      sealedUntil: 0,
    });
  }
  return out;
}

/**
 * Equipped skin skills (profile equipped_skins, up to 2) that work right now: owned, quest done, and
 * available to the active hero (everyone, the hero's class, or the hero). Problems go to `warnings`.
 */
export function activeSkins(loadout: Loadout, warnings: string[] = []): { skin: Skin; stars: number }[] {
  const hero = loadout.hero;
  const out: { skin: Skin; stars: number }[] = [];
  for (const id of loadout.profile.equipped_skins ?? []) {
    const skin = loadout.data.skins.get(id);
    const owned = loadout.profile.skins?.find((s) => s.id === id);
    if (!skin || !skin.skill) continue;
    if (!owned) {
      warnings.push(`Skin skill "${skin.skill.name}" is equipped but ${skin.name} isn't in my owned skins.`);
      continue;
    }
    const a = skin.available;
    const ok = !!hero && !!a && (a.all || (a.classes ?? []).includes(hero.class) || (a.heroes ?? []).includes(hero.id));
    if (!ok) {
      warnings.push(`Skin skill "${skin.skill.name}" isn't available to ${hero?.name ?? 'this hero'}, so it does nothing.`);
      continue;
    }
    // Forced on: whatever the bag holds now (the quest was met earlier in the run).
    if ((loadout.profile.skin_quests_forced ?? []).includes(id)) {
      out.push({ skin, stars: owned.stars });
      continue;
    }
    // The bag decides quests about what's in it; for the rest, the profile's "quest done" tick does.
    const q = checkSkinQuest(loadout, skin);
    if (q.status === 'not_met') {
      warnings.push(`Skin skill "${skin.skill.name}" is off: this bag doesn't meet its quest (${q.detail}).`);
      continue;
    }
    if (q.status !== 'met' && !(loadout.profile.skin_quests_done ?? []).includes(id)) continue;
    out.push({ skin, stars: owned.stars });
  }
  return out;
}

/** Skin skills in battle: an effect owner outside the bag each, the effects for the skin's stars. */
export function skinSkillSources(loadout: Loadout, warnings: string[] = []): CombatItem[] {
  const out: CombatItem[] = [];
  for (const { skin, stars } of activeSkins(loadout, warnings)) {
    if (skin.status === 'needs_values' || skin.status === 'partial') {
      warnings.push(`Skin skill "${skin.skill!.name}" is ${skin.status === 'partial' ? 'only partly' : 'not'} simulated${skin.notes ? `: ${skin.notes}` : '.'}`);
    }
    const effects = skin.effects.map((effect, index) => ({ effect, index })).filter(({ effect }) => (effect.min_stars ?? 0) <= stars && (effect.max_stars ?? Infinity) >= stars);
    if (effects.length === 0) continue;
    out.push({
      id: `skin:${skin.id}`,
      itemId: skin.id,
      name: `${skin.name}: ${skin.skill!.name}`,
      side: 'player',
      kind: 'skill',
      tags: [],
      damage: null,
      baseCooldown: null,
      staticHastePct: 0,
      accuracy: null,
      critChancePct: 0,
      critDamagePct: 0,
      hits: 1,
      maxAttacks: null,
      alwaysHit: false,
      effects,
      effectValues: {},
      dotTargets: [],
      skill: null,
      inflictMultiplier: {},
      temporary: false,
      origin: null,
      progress: 0,
      attacks: 0,
      dynamic: zeroDynamic(),
      sealedUntil: 0,
    });
  }
  return out;
}

/** Active pets with battle effects: an effect owner outside the bag each, effects up to the pet's stars. */
export function petSkillSources(loadout: Loadout): CombatItem[] {
  const out: CombatItem[] = [];
  for (const p of loadout.profile.pets) {
    const pet = loadout.data.pets.get(p.id);
    if (!pet || !p.active || pet.ignored) continue;
    const effects = pet.effects.map((effect, index) => ({ effect, index })).filter(({ effect }) => (effect.min_stars ?? 0) <= p.stars && (effect.max_stars ?? Infinity) >= p.stars);
    if (effects.length === 0) continue;
    out.push({
      id: `pet:${pet.id}`,
      itemId: pet.id,
      name: `${pet.name}: ${pet.skill.name}`,
      side: 'player',
      kind: 'skill',
      tags: [],
      damage: null,
      baseCooldown: null,
      staticHastePct: 0,
      accuracy: null,
      critChancePct: 0,
      critDamagePct: 0,
      hits: 1,
      maxAttacks: null,
      alwaysHit: false,
      effects,
      effectValues: {},
      dotTargets: [],
      skill: null,
      inflictMultiplier: {},
      temporary: false,
      origin: null,
      progress: 0,
      attacks: 0,
      dynamic: zeroDynamic(),
      sealedUntil: 0,
    });
  }
  return out;
}

/** The active hero's blessings that raise statuses inflicted or gained by tagged items. */
export function taggedInflictBlessings(loadout: Loadout): NonNullable<Combatant['taggedInflict']> {
  const hero = loadout.profile.heroes.find((h) => h.id === loadout.heroId);
  return (hero?.blessings?.equipped ?? []).flatMap((b) => {
    const def = loadout.data.blessings.get(b.id);
    return def?.item_inflict_statuses ? [{ tags: def.target_tags, statuses: def.item_inflict_statuses, pct: b.value }] : [];
  });
}

function buildSkill(gear: { skill?: Gear['skill'] }, loadout: Loadout, atk: number, attackDmg: number, basicAcc: number | null, basicCrit: number, tickS: number, critRate: number): CombatSkill | null {
  const s = gear.skill;
  if (!s || (s.damage === undefined && s.interval_s === undefined && !s.gauge)) return null;
  const cfg = loadout.data.config!;
  const ratio = s.damage ? resolveRatio(s.damage, cfg.observations.display_rounding).ratio : null;
  return {
    damage: ratio !== null ? { base: ratio * atk, typePct: cfg.combat.skill_damage_gets_attack_dmg ? attackDmg : 0 } : null,
    hits: s.hits ?? 1,
    intervalTicks: s.interval_s !== undefined ? Math.max(1, Math.round(s.interval_s / tickS)) : null,
    gauge: s.gauge ?? false,
    accuracy: s.accuracy ?? basicAcc,
    critChancePct: s.crit_chance !== undefined ? s.crit_chance + critRate : basicCrit,
    alwaysHit: s.always_hit ?? false,
    extraHitsStatus: s.extra_hits_per_status ?? null,
    bonusHits: 0,
    ticks: 0,
    gaugePct: 0,
    activations: 0,
  };
}

export function buildPlayer(input: Loadout): { player: Combatant; loadout: Loadout; warnings: string[] } {
  const spawn = withPetSpawns(input);
  const loadout = spawn.loadout;
  const warnings = [...spawn.warnings];
  const cfg = loadout.data.config!;
  const { player: stats, items: final, issues } = aggregateStats(loadout);
  for (const i of issues) if (i.code === 'blessing_not_simulated' || i.code === 'gear_bonus_missing') warnings.push(i.message);
  const items: CombatItem[] = [];
  const copies = copyNumbers(loadout.layout);
  const enhancedCells = new Set((loadout.layoutData.enhanced_cells ?? []).map((c) => `${c.x},${c.y}`));
  for (const [id, placed] of loadout.layout.items) {
    const entry = loadout.entries.get(id);
    const s = final.get(id);
    if (!entry || !s) continue;
    const raw = entry.kind === 'item' ? (entry.def as Item).stats : ((entry.def as Gear).basic_attack ?? {});
    const p = placed.placement;
    items.push({
      id,
      itemId: entry.def.id,
      name: copyName(entry.def.name, copies.get(id)),
      side: 'player',
      kind: entry.kind,
      tags: entry.def.tags,
      rarity: entry.kind === 'gear' ? entry.gearRarity : (entry.def as Item).rarity,
      damage: s.damage ? { base: s.damage.base, typePct: s.damage.typePct.total } : null,
      baseCooldown: s.cooldown?.base ?? null,
      staticHastePct: s.cooldown?.haste.total ?? 0,
      accuracy: s.accuracy?.total ?? null,
      critChancePct: s.critChance?.total ?? 0,
      critDamagePct: s.critDamage?.total ?? stats.detailed.crit_dmg ?? 100,
      hits: raw.hits ?? 1,
      randomExtraHits: (raw as Item['stats']).random_extra_hits,
      autoCritWhen: (raw as Item['stats']).auto_crit_when,
      maxAttacks: (raw as Item['stats']).max_attacks ?? null,
      alwaysHit: (raw as Item['stats']).always_hit ?? false,
      effects: activeEffects(entry),
      effectValues: entry.kind === 'item' ? (entry.def as Item).effect_values : {},
      dotTargets: resolveDots(loadout.layout, id).targets,
      // Gear skills, and gear-style skills on custom items.
      skill:
        entry.kind === 'gear' || (entry.def as Item).skill
          ? buildSkill(entry.def as Gear, loadout, stats.atk, stats.detailed.attack_dmg_increase ?? 0, s.accuracy?.total ?? null, s.critChance?.total ?? 0, cfg.timing.tick_seconds, stats.detailed.crit_rate ?? 0)
          : null,
      inflictMultiplier: spawn.multipliers.get(id) ?? {},
      temporary: entry.kind === 'item' && (entry.def as Item).temporary,
      enhanced: placed.cells.some((c) => enhancedCells.has(`${c.x},${c.y}`)),
      origin: { x: p.x, y: p.y, rotation: p.rotation },
      progress: 0,
      attacks: 0,
      dynamic: zeroDynamic(),
      sealedUntil: 0,
    });
  }
  const player: Combatant = {
    side: 'player',
    name: loadout.hero?.name ?? 'Hero',
    maxHp: stats.hp,
    hp: stats.hp,
    block: stats.initialBlock,
    atk: stats.atk,
    stats: stats.detailed,
    combatStats: {},
    timedStats: [],
    immunities: new Set(),
    boss: false,
    statuses: new Map(),
    items,
    berserkEnabled: false,
    berserkStacks: 0,
    conditionalStats: conditionalBlessings(loadout),
    taggedInflict: taggedInflictBlessings(loadout),
    skillSources: [...heroSkillSources(loadout, warnings), ...petSkillSources(loadout), ...skinSkillSources(loadout, warnings)],
    atkPct: 0,
  };
  return { player, loadout, warnings };
}

/**
 * A combat item for an item that appears mid-battle (transform_item), at the same bag position.
 * Uses global bonuses and blessing tag bonuses; bonuses from other items' start-of-battle effects
 * don't apply to it (they already resolved).
 */
export function combatItemFromDef(loadout: Loadout, player: Combatant, def: Item, id: string, origin: NonNullable<CombatItem['origin']>, occupantAt: (c: Cell) => string | undefined): CombatItem {
  const st = player.stats;
  const s = def.stats;
  const ratio = s.damage ? resolveRatio(s.damage, loadout.data.config!.observations.display_rounding).ratio : null;
  const typePct =
    (def.tags.includes('weapon') ? (st.attack_dmg_increase ?? 0) : 0) + [...loadout.data.stats.values()].filter((d) => d.item_tags?.some((t) => def.tags.includes(t))).reduce((a, d) => a + (st[d.id] ?? 0), 0) + blessingTagBonus(loadout, def.tags);
  const fp = footprintOf(def);
  const dots = fp ? placeFootprint(fp, { x: origin.x, y: origin.y, rotation: origin.rotation as Rotation }).dots : [];
  const dotTargets = [...new Set(dots.map(occupantAt).filter((x): x is string => !!x && x !== id))];
  return {
    id,
    itemId: def.id,
    name: def.name,
    side: 'player',
    kind: 'item',
    tags: def.tags,
    damage: ratio !== null ? { base: ratio * player.atk, typePct } : null,
    baseCooldown: s.cooldown ?? null,
    staticHastePct: st.item_haste ?? 0,
    accuracy: s.accuracy !== undefined ? s.accuracy + (st.accuracy_bonus ?? 0) : null,
    critChancePct: (s.crit_chance ?? 0) + (st.crit_rate ?? 0),
    critDamagePct: (st.crit_dmg ?? 100) + (s.crit_damage ?? 0),
    hits: s.hits ?? 1,
    maxAttacks: s.max_attacks ?? null,
    alwaysHit: s.always_hit ?? false,
    effects: def.effects.map((effect, index) => ({ effect, index })),
    effectValues: def.effect_values,
    dotTargets,
    skill: null,
    inflictMultiplier: {},
    temporary: def.temporary,
    origin,
    progress: 0,
    attacks: 0,
    dynamic: zeroDynamic(),
    sealedUntil: 0,
  };
}

// ---------------------------------------------------------------- enemy

/** Is this enemy a player (PvP rules) or a monster? Missing kind: player with a build, monster without. */
/** Does the enemy's build hold player items (shop items or gear, not items made in the enemy item editor)? */
export function hasPlayerItems(data: GameData, e: { build?: { placements: { item: string }[] } }): boolean {
  return (e.build?.placements ?? []).some((p) => data.gear.has(p.item) || (data.items.has(p.item) && !data.items.get(p.item)!.enemy_item));
}

/** Monster or player (PvP). Unless set, a player when its build has player items (without data: when it has a build). */
export const enemyKind = (e: { kind?: 'monster' | 'player'; build?: { placements: { item: string }[] } }, data?: GameData): 'monster' | 'player' =>
  e.kind ?? (e.build ? (!data || hasPlayerItems(data, e) ? 'player' : 'monster') : 'monster');

/** Instance-id prefix for an enemy's items (kept apart from mine in reports and lookups). */
export const enemyPrefix = (index: number) => (index > 0 ? `enemy${index + 1}:` : 'enemy:');

/**
 * An enemy with a build: built exactly like me (bag items, gear and its skills, hero skills,
 * blessings, pets, auras, calculated stats), then moved to the enemy side.
 */
export function buildEnemyFromBuild(data: GameData, enemy: EnemyInput, boss: boolean, index = 0): { enemy: Combatant; loadout: Loadout; warnings: string[] } {
  const b = enemy.build!;
  const lo = buildLoadout(data, b.profile, { placements: b.placements, bag: b.bag, enhanced_cells: b.enhanced_cells });
  const p = buildPlayer(lo);
  const prefix = enemyPrefix(index);
  const move = (it: CombatItem) => {
    it.id = prefix + it.id;
    it.side = 'enemy';
    it.dotTargets = it.dotTargets.map((d) => prefix + d);
  };
  p.player.items.forEach(move);
  p.player.skillSources?.forEach(move);
  const c = p.player;
  c.side = 'enemy';
  c.name = enemy.name;
  c.boss = boss;
  c.combatStats = { ...c.combatStats, ...(enemy.resistances ?? {}), ...(enemy.vulnerabilities ?? {}) };
  if (enemy.damage_reduction) c.combatStats.dmg_reduction = (c.combatStats.dmg_reduction ?? 0) + enemy.damage_reduction;
  c.immunities = new Set(enemy.immunities ?? []);
  const warnings = p.warnings.map((w) => `${enemy.name}: ${w}`);
  if ((enemy.attacks ?? []).length) warnings.push(`${enemy.name}: has a build, so its typed-in attacks are ignored.`);
  const others = (enemy.traits ?? []).filter((t) => t !== 'short_time_limit');
  if (others.length) warnings.push(`${enemy.name}: traits (${others.join(', ')}) are descriptions only [later].`);
  return { enemy: c, loadout: p.loadout, warnings };
}

export function buildEnemy(enemy: EnemyInput, defaultCritDmg: number, boss = enemy.boss ?? false, index = 0): { enemy: Combatant; warnings: string[] } {
  const warnings: string[] = [];
  const others = (enemy.traits ?? []).filter((t) => t !== 'short_time_limit');
  if (others.length) warnings.push(`${enemy.name}: traits (${others.join(', ')}) are descriptions only [later].`);
  const hp = parseAbbrev(enemy.hp);
  const prefix = index > 0 ? `enemy${index + 1}` : 'enemy';
  const items: CombatItem[] = (enemy.attacks ?? []).map((a, i) => ({
    id: `${prefix}:${i + 1}`,
    itemId: `enemy_attack_${i + 1}`,
    name: a.name ?? `${enemy.name} attack${(enemy.attacks ?? []).length > 1 ? ` ${i + 1}` : ''}`,
    side: 'enemy',
    kind: 'enemy_attack',
    tags: ['weapon'],
    damage: { base: parseAbbrev(a.damage), typePct: 0, ...(a.pct_max_hp ? { pctOfFoeMaxHp: a.pct_max_hp } : {}) },
    baseCooldown: a.cooldown,
    staticHastePct: 0,
    accuracy: a.accuracy,
    critChancePct: a.crit_chance ?? 0,
    critDamagePct: defaultCritDmg,
    hits: a.hits ?? 1,
    maxAttacks: null,
    alwaysHit: false,
    // "On Hit: inflict …" typed in on the attack.
    effects: (a.on_hit ?? []).map((st, index) => ({
      index,
      effect: ItemEffectSchema.parse({
        text: `On Hit: Inflict ${st.stacks} ${st.status}${st.duration_s ? ` for ${st.duration_s}s` : ''}.`,
        trigger: 'on_hit',
        action: 'apply_status',
        target: 'enemy',
        status: st.status,
        stacks: st.stacks,
        ...(st.duration_s ? { duration_s: st.duration_s } : {}),
      }),
    })),
    effectValues: {},
    dotTargets: [],
    skill: null,
    inflictMultiplier: {},
    temporary: false,
    origin: null,
    progress: 0,
    attacks: 0,
    dynamic: zeroDynamic(),
    sealedUntil: 0,
  }));
  return {
    enemy: {
      side: 'enemy',
      name: enemy.name,
      maxHp: hp,
      hp,
      block: parseAbbrev(enemy.block ?? 0),
      atk: parseAbbrev(enemy.atk ?? 0),
      stats: { crit_dmg: defaultCritDmg },
      combatStats: { ...(enemy.resistances ?? {}), ...(enemy.vulnerabilities ?? {}), dmg_reduction: enemy.damage_reduction ?? 0 },
      timedStats: [],
      immunities: new Set(enemy.immunities ?? []),
      boss,
      statuses: new Map(),
      items,
      berserkEnabled: false,
      berserkStacks: 0,
      conditionalStats: [],
      atkPct: 0,
    },
    warnings,
  };
}
