/**
 * Skin quests checked against the bag (skin `quest_check`). A skin skill only works when its quest is
 * met: the bag decides for quests about what's in it; quests that need rounds or the shop can't be
 * checked in one battle, so the profile's "quest done" tick decides for those.
 */
import type { Item, Skin } from './loader';
import type { Loadout } from './loadout';

export interface QuestStatus {
  status: 'met' | 'not_met' | 'run' | 'none';
  /** e.g. "Creature value 17 / 30". */
  detail: string;
}

export function checkSkinQuest(lo: Loadout, skin: Skin): QuestStatus {
  const q = skin.quest_check;
  if (!q) return { status: 'none', detail: '' };
  if (q.type === 'run') return { status: 'run', detail: q.note };
  // Only what I placed counts (not items pets or skins add at the start of battle).
  const placed = [...lo.entries.values()].filter((e) => e.kind === 'item' && (e.def as Item).kind === 'item');
  const spawned = (id: string) => {
    const e = lo.entries.get(id);
    return e?.kind === 'item' && (e.def as Item).kind !== 'item';
  };
  if (q.type === 'bag_value') {
    const total = placed.filter((e) => q.tags_any.some((t) => e.def.tags.includes(t))).reduce((a, e) => a + ((e.def as Item).value ?? 0), 0);
    return { status: total >= q.min ? 'met' : 'not_met', detail: `${q.tags_any.join('/')} value ${total} / ${q.min}` };
  }
  if (q.type === 'bag_items') {
    const missing = q.items.filter((w) => placed.filter((e) => e.def.id === w.item).length < w.count);
    const name = (id: string) => lo.data.items.get(id)?.name ?? id;
    return {
      status: missing.length ? 'not_met' : 'met',
      detail: q.items.map((w) => `${placed.filter((e) => e.def.id === w.item).length}/${w.count} ${name(w.item)}`).join(', '),
    };
  }
  const open = lo.bag.mask.filter((v) => v).length;
  const filled = new Set<string>();
  for (const [id, it] of lo.layout.items) if (!spawned(id)) for (const c of it.cells) if (c.x >= 0 && c.y >= 0 && c.x < lo.bag.width && c.y < lo.bag.height && lo.bag.mask[c.y * lo.bag.width + c.x]) filled.add(`${c.x},${c.y}`);
  const pct = (100 * filled.size) / Math.max(1, open);
  return { status: pct + 1e-9 >= q.min_pct ? 'met' : 'not_met', detail: `${filled.size} / ${open} cells filled (${Math.floor(pct)}%, needs ${q.min_pct}%)` };
}
