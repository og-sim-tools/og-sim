/**
 * Loadout validation (SPEC §6 step 1): bag placement, class / hero restrictions, starting
 * equipment capacity, gear slots and tiers, pets, blessings and skill links. Every failure
 * has a clear message; rules that the game only warns about are warnings.
 */
import { checkSkinQuest } from './skinQuests';
import type { Item } from './loader';
import { type Loadout, type LoadoutIssue } from './loadout';
import type { BlessingValue, Rarity } from './model';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface SupplySummary {
  used: number;
  capacity: number;
}

/** Supply Ability of the active hero and the points used by placed starting equipment. */
export function supplySummary(loadout: Loadout): SupplySummary | null {
  const { hero, data, profile } = loadout;
  if (!hero || !data.config) return null;
  const owned = profile.heroes.find((h) => h.id === hero.id);
  const cfg = data.config;
  const capacity = cfg.heroes.supply_ability_base[hero.rarity] + cfg.heroes.supply_ability_per_star * (owned?.stars ?? 0);
  let used = 0;
  for (const e of loadout.entries.values()) {
    if (e.supply && e.kind === 'item') used += cfg.supply_cost[(e.def as Item).rarity];
  }
  return { used, capacity };
}

export interface AvailableSupply {
  item: Item;
  cost: number;
  /** "Beta 3★" — the owned same-class heroes whose stars unlock it. */
  unlockedBy: string[];
}

/**
 * Starting equipment the active hero can bring: unlocked by any owned hero of the same class with
 * enough stars, allowed for the class, and not pet-spawned.
 */
export function availableSupplies(loadout: Loadout): AvailableSupply[] {
  const { hero, data, profile } = loadout;
  if (!hero || !data.config) return [];
  const stars = new Map(profile.heroes.map((h) => [h.id, h.stars]));
  const out = new Map<string, AvailableSupply>();
  for (const h of data.heroes.values()) {
    if (h.class !== hero.class) continue;
    const have = stars.get(h.id);
    if (have === undefined) continue;
    for (const s of h.supplies) {
      if (s.stars > have) continue;
      const item = data.items.get(s.item);
      if (!item || item.kind !== 'item') continue;
      if (item.class_restriction.length > 0 && !item.class_restriction.includes(hero.class)) continue;
      const entry = out.get(item.id) ?? { item, cost: data.config.supply_cost[item.rarity], unlockedBy: [] };
      entry.unlockedBy.push(`${h.name} ${s.stars}★`);
      out.set(item.id, entry);
    }
  }
  return [...out.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** Activation cost of a pet at its star level (star effects can lower it). */
export function petCost(loadout: Loadout, petId: string, stars: number): number | null {
  const pet = loadout.data.pets.get(petId);
  if (!pet) return null;
  const delta = pet.star_effects.filter((s) => s.stars <= stars).reduce((sum, s) => sum + (s.activation_cost_delta ?? 0), 0);
  return Math.max(0, pet.activation_cost + delta);
}

function inRange(v: BlessingValue, x: number): boolean {
  if ('value' in v) return Math.abs(v.value - x) < 1e-9;
  const [lo, hi] = v.min <= v.max ? [v.min, v.max] : [v.max, v.min];
  return x >= lo - 1e-9 && x <= hi + 1e-9;
}
const showValue = (v: BlessingValue) => ('value' in v ? `${v.value}` : `${v.min} ~ ${v.max}`);

export function validateLoadout(loadout: Loadout): LoadoutIssue[] {
  const { data, profile, hero, heroId } = loadout;
  const cfg = data.config!;
  const issues: LoadoutIssue[] = [...loadout.issues];
  const err = (code: string, message: string, instanceIds?: string[]) => issues.push({ level: 'error', code, message, instanceIds });
  const warn = (code: string, message: string, instanceIds?: string[]) => issues.push({ level: 'warning', code, message, instanceIds });

  // ---------------------------------------------------------------- bag placement (phase 1)
  for (const i of loadout.layout.issues) {
    issues.push({ level: 'error', code: i.code, message: i.message, instanceIds: i.instanceIds, cells: i.cells });
  }

  // ---------------------------------------------------------------- active hero
  const ownedHeroes = new Map(profile.heroes.map((h) => [h.id, h]));
  if (!heroId) err('no_hero', 'No hero chosen: set active_hero in the profile or hero in the layout.');
  else if (!hero) err('unknown_hero', `Unknown hero "${heroId}".`);
  else if (!ownedHeroes.has(hero.id)) err('hero_not_owned', `${hero.name} is not among the heroes in your profile.`);

  // ---------------------------------------------------------------- skin skills (up to 2 equipped)
  for (const id of profile.equipped_skins ?? []) {
    const skin = data.skins.get(id);
    if (!skin) continue;
    if (!skin.skill) {
      warn('skin_no_skill', `${skin.name} has no skin skill.`);
      continue;
    }
    const owned = profile.skins?.find((s) => s.id === id);
    const a = skin.available;
    if (!owned) warn('skin_not_owned', `${skin.name} (${skin.skill.name}) is equipped but not in my owned skins.`);
    else if (hero && !(a?.all || (a?.classes ?? []).includes(hero.class) || (a?.heroes ?? []).includes(hero.id))) {
      warn('skin_unavailable', `${skin.skill.name} (${skin.name}) isn't available to ${hero.name}, so it does nothing.`);
    } else if ((profile.skin_quests_forced ?? []).includes(id)) {
      // Forced on: no quest warning.
    } else if (checkSkinQuest(loadout, skin).status === 'not_met') {
      warn('skin_quest_not_met', `${skin.skill.name} (${skin.name}) is off: this bag doesn't meet its quest (${checkSkinQuest(loadout, skin).detail}).`);
    } else if (checkSkinQuest(loadout, skin).status !== 'met' && !(profile.skin_quests_done ?? []).includes(id)) warn('skin_quest', `${skin.skill.name} (${skin.name}) does nothing until its quest is done.`);
  }

  // ---------------------------------------------------------------- items: class, hero-exclusive, supplies
  for (const e of loadout.entries.values()) {
    if (e.kind !== 'item') continue;
    const item = e.def as Item;
    const id = [e.instanceId];
    if (hero && item.class_restriction.length > 0 && !item.class_restriction.includes(hero.class)) {
      err('class_restriction', `${item.name} is ${item.class_restriction.join('/')} only; ${hero.name} is a ${hero.class}.`, id);
    }
    if (e.supply) {
      if (item.kind === 'pet_spawn' || item.kind === 'skin_spawn') {
        err('supply_pet_spawn', `${item.name} is ${item.kind === 'pet_spawn' ? 'pet' : 'skin'}-spawned and can't be starting equipment.`, id);
        continue;
      }
      if (hero) {
        // Unlocked by any owned hero of the same class with enough stars.
        const unlockers = [...data.heroes.values()].filter(
          (h) => h.class === hero.class && h.supplies.some((s) => s.item === item.id && s.stars <= (ownedHeroes.get(h.id)?.stars ?? -1)),
        );
        if (unlockers.length === 0) {
          const where = [...data.heroes.values()]
            .flatMap((h) => h.supplies.filter((s) => s.item === item.id).map((s) => `${h.name} ${s.stars}★`))
            .join(', ');
          err(
            'supply_locked',
            `${item.name} isn't unlocked as starting equipment for ${hero.class}s` + (where ? ` (unlocked by ${where}).` : ' (no hero unlocks it).'),
            id,
          );
        }
      }
    } else if (item.hero_exclusive && hero && item.hero_exclusive !== hero.id) {
      const owner = data.heroes.get(item.hero_exclusive)?.name ?? item.hero_exclusive;
      err('hero_exclusive_shop', `${item.name} is ${owner}'s exclusive item: only in the shop when playing ${owner} (or bring it as starting equipment).`, id);
    }
  }
  const supply = supplySummary(loadout);
  if (supply && supply.used > supply.capacity) {
    const ids = [...loadout.entries.values()].filter((e) => e.supply).map((e) => e.instanceId);
    err('supply_capacity', `Starting equipment uses ${supply.used} / ${supply.capacity} Supply Ability points.`, ids);
  }
  const supplyCopies = new Map<string, string[]>();
  for (const e of loadout.entries.values()) if (e.supply) supplyCopies.set(e.def.id, [...(supplyCopies.get(e.def.id) ?? []), e.instanceId]);
  for (const [id, ids] of supplyCopies) {
    if (ids.length > 1) err('supply_duplicate', `${data.items.get(id)?.name ?? id} is starting equipment ${ids.length}× (only one of each at a time).`, ids);
  }

  // ---------------------------------------------------------------- gear
  const slotLists: [string, 'weapon' | 'shield' | 'ring' | 'glove', ({ id: string; rarity: Rarity; tier: number } | null)[]][] = [
    ['weapon', 'weapon', [profile.gear.weapon]],
    ['shield', 'shield', [profile.gear.shield]],
    ['rings', 'ring', profile.gear.rings],
    ['gloves', 'glove', profile.gear.gloves],
  ];
  const equippedCount = new Map<string, number>();
  for (const [field, slot, refs] of slotLists) {
    const present = refs.filter((r): r is NonNullable<typeof r> => r !== null);
    if (present.length > cfg.gear.slots[slot]) {
      err('gear_slot_count', `${plural(present.length, slot)} equipped; the limit is ${cfg.gear.slots[slot]}.`);
    }
    present.forEach((ref, i) => {
      const where = refs.length > 1 ? `gear.${field}[${i}]` : `gear.${field}`;
      equippedCount.set(ref.id, (equippedCount.get(ref.id) ?? 0) + 1);
      const gear = data.gear.get(ref.id);
      if (!gear) return; // reported by the profile loader
      if (gear.slot !== slot) err('gear_slot', `${where}: ${gear.name} is a ${gear.slot}, not a ${slot}.`);
      if (!cfg.rarities.gear.includes(ref.rarity)) err('gear_rarity', `${where}: ${gear.name} can't be ${ref.rarity}.`);
      const maxTier = cfg.gear.max_tier[ref.rarity] ?? 0;
      if (ref.tier > maxTier) err('gear_tier', `${where}: ${gear.name} is ${ref.rarity}+${ref.tier}, but ${ref.rarity} goes up to +${maxTier}.`);
    });
  }
  const placedGear = new Map<string, string[]>();
  for (const e of loadout.entries.values()) {
    if (e.kind !== 'gear') continue;
    placedGear.set(e.def.id, [...(placedGear.get(e.def.id) ?? []), e.instanceId]);
    if (e.supply) err('supply_gear', `${e.def.name} is gear, not starting equipment.`, [e.instanceId]);
  }
  for (const [gid, ids] of placedGear) {
    const n = equippedCount.get(gid) ?? 0;
    if (ids.length > n) err('gear_not_equipped', `${data.gear.get(gid)!.name} is placed ${ids.length}× but equipped ${n}× in the profile.`, ids);
  }
  for (const [gid, n] of equippedCount) {
    const gear = data.gear.get(gid);
    if (!gear) continue;
    const placed = placedGear.get(gid)?.length ?? 0;
    if (gear.shape === null) warn('gear_needs_shape', `${gear.name} is equipped but has no shape yet, so it isn't in the bag. Enter its shape in the item editor.`);
    else if (placed < n) warn('gear_not_placed', `${gear.name} is equipped but not placed in the bag (gear is brought into every battle).`);
  }

  // ---------------------------------------------------------------- pets
  if (profile.pets.length > cfg.pets.max_equipped) err('pet_count', `${profile.pets.length} pets equipped; the limit is ${cfg.pets.max_equipped}.`);
  let cost = 0;
  for (const p of profile.pets) {
    const pet = data.pets.get(p.id);
    if (!pet) continue;
    if (p.stars > cfg.pets.max_stars) err('pet_stars', `${pet.name}: ${p.stars}★, the maximum is ${cfg.pets.max_stars}★.`);
    if (!p.active) continue;
    cost += petCost(loadout, p.id, p.stars) ?? 0;
    if (pet.ignored) warn('pet_ignored', `${pet.name} is active but isn't simulated.`);
  }
  if (cost > cfg.pets.activation_points) warn('pet_cost', `Active pets cost ${cost} points; each hero has ${cfg.pets.activation_points} per run.`);

  // ---------------------------------------------------------------- per-hero: stars, blessings, links
  for (const owned of profile.heroes) {
    const h = data.heroes.get(owned.id);
    if (!h) continue;
    const eq = owned.blessings?.equipped ?? [];
    if (eq.length > cfg.blessings.max_per_hero) err('blessing_count', `${h.name} has ${eq.length} blessings; the maximum is ${cfg.blessings.max_per_hero}.`);
    const seen = new Set<string>();
    for (const b of eq) {
      const def = data.blessings.get(b.id);
      if (!def) continue;
      if (seen.has(b.id)) err('blessing_duplicate', `${h.name} has ${def.name} more than once (at most one of each blessing).`);
      seen.add(b.id);
      if (def.kind === 'class' && def.class !== h.class) err('blessing_class', `${def.name} is a ${def.class} blessing; ${h.name} is a ${h.class}.`);
      if (def.kind === 'unique' && def.hero !== h.id) {
        err('blessing_hero', `${def.name} is ${data.heroes.get(def.hero!)?.name ?? def.hero}'s blessing, not ${h.name}'s.`);
      }
      const range = def.values[b.rarity];
      if (!range) {
        err('blessing_rarity', `${h.name}: ${def.name} doesn't exist at ${b.rarity} (available: ${Object.keys(def.values).join(', ')}).`);
      } else if (!inRange(range, b.value)) {
        warn('blessing_value', `${h.name}: ${def.name} ${b.rarity} is ${showValue(range)}, but you entered ${b.value}.`);
      }
    }

    const slots = cfg.heroes.skill_link_stars.filter((s) => s <= owned.stars).length;
    if (owned.links.length > slots) {
      err('link_slots', `${h.name} at ${owned.stars}★ has ${plural(slots, 'link slot')} but ${owned.links.length} links are set.`);
    }
    const linked = new Set<string>();
    for (const l of owned.links) {
      const skill = data.skills.get(l);
      if (!skill) continue;
      if (linked.has(l)) err('link_duplicate', `${h.name} links ${skill.name} twice.`);
      linked.add(l);
      const owner = data.heroes.get(skill.hero)!;
      if (owner.id === h.id) {
        err('link_own_skill', `${h.name} can't link their own skill ${skill.name}.`);
        continue;
      }
      if (owner.class !== h.class) err('link_class', `${skill.name} is a ${owner.class} skill (${owner.name}); ${h.name} is a ${h.class}.`);
      const need = owner.skill_links.find((s) => s.skill === l)?.stars;
      const have = ownedHeroes.get(owner.id)?.stars;
      if (need === undefined) err('link_unavailable', `${owner.name}'s ${skill.name} can't be linked.`);
      else if (have === undefined || have < need) {
        err('link_locked', `${skill.name} needs ${owner.name} at ${need}★ (you have ${have === undefined ? 'no ' + owner.name : `${have}★`}).`);
      }
    }
  }
  return issues;
}
