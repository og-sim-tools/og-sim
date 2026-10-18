/** What a placed item is worth, for the item panel: coins (shop price, SPEC §4.5), Supply points, or nothing. */
import type { Item } from '../../engine/loader';
import type { Loadout } from '../../engine/loadout';
import { sellValue } from '../../engine/model';
import type { ItemWorth } from '../components/ItemDrawer';

export function itemWorth(loadout: Loadout, instanceId: string): ItemWorth | undefined {
  const e = loadout.entries.get(instanceId);
  if (!e) return undefined;
  if (e.kind === 'gear') return { kind: 'none', why: 'Gear: brought to every battle, no coin value.' };
  const item = e.def as Item;
  if (item.kind === 'pet_spawn') return { kind: 'none', why: 'Put in the bag by a pet: no coin value.' };
  const coins = item.value_unknown ? null : item.value;
  if (e.supply) return { kind: 'starting', points: loadout.data.config?.supply_cost[item.rarity] ?? 0, coins };
  return coins === null ? { kind: 'unknown' } : { kind: 'coins', coins, sells: sellValue(item) };
}
