/**
 * Synergy report (SPEC §6 step 4): for every placed item, the item effects it gives, the item
 * effects it receives, and from which item. Effects still written only as text are listed with
 * the items their dots touch, so nothing silently disappears.
 */
import { resolveDots } from '../bag';
import type { Loadout } from '../loadout';
import type { ItemEffect } from '../model';
import { resolveApplications } from './resolve';

export interface GivenEffect {
  index: number;
  effect: ItemEffect;
  text: string;
  targets: string[];
}

export interface ReceivedEffect {
  from: string;
  fromName: string;
  index: number;
  effect: ItemEffect;
  text: string;
}

export interface SynergyEntry {
  instanceId: string;
  name: string;
  gives: GivenEffect[];
  receives: ReceivedEffect[];
  /** Items under this item's dots. */
  dotTargets: string[];
  /** effect_text with no structured effects yet (or only partly structured). */
  textOnly: string | null;
  partial: boolean;
}

/** Short description of an effect when it has no `text`. */
export function describeEffect(e: ItemEffect): string {
  if (e.text) return e.text;
  const when = e.trigger === 'passive' || e.trigger === 'battle_start' ? '' : `${e.trigger}: `;
  if (e.action === 'add_stat_pct') return `${when}${e.amount! >= 0 ? '+' : ''}${e.amount}% ${e.stat!.replace(/_pct$/, '')}`;
  return `${e.trigger}: ${e.action}`;
}

export function buildSynergyReport(loadout: Loadout): Map<string, SynergyEntry> {
  const report = new Map<string, SynergyEntry>();
  for (const id of loadout.layout.items.keys()) {
    const entry = loadout.entries.get(id);
    if (!entry) continue;
    const text = 'effect_text' in entry.def ? entry.def.effect_text : entry.def.gear_effect_text;
    const structured = entry.def.effects.length > 0;
    report.set(id, {
      instanceId: id,
      name: entry.def.name,
      gives: [],
      receives: [],
      dotTargets: resolveDots(loadout.layout, id).targets,
      textOnly: text && entry.def.effects_status !== 'complete' && (!structured || entry.def.effects_status === 'partial') ? text : null,
      partial: entry.def.effects_status === 'partial',
    });
  }
  for (const app of resolveApplications(loadout)) {
    const src = report.get(app.source)!;
    const text = describeEffect(app.effect);
    src.gives.push({ index: app.index, effect: app.effect, text, targets: app.targets });
    for (const t of app.targets) {
      report.get(t)?.receives.push({ from: app.source, fromName: src.name, index: app.index, effect: app.effect, text });
    }
  }
  return report;
}
