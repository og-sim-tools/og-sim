/**
 * One structured item effect as a form (enemy item editor): a control per parameter, the ones the
 * trigger and action use shown first, any other parameter addable, YAML for the nested ones.
 */
import { useState } from 'react';
import { parse } from 'yaml';
import type { GameData } from '../../engine/loader';
import { ACTIONS, EffectTarget, ITEM_STAT_PCTS, ItemEffectSchema, RARITIES, TRIGGERS, Watch } from '../../engine/model';

export type EffectDraft = Record<string, unknown>;

type Kind =
  | { t: 'enum'; options: readonly string[] }
  | { t: 'number' }
  | { t: 'bool' }
  | { t: 'text' }
  | { t: 'scaled' }
  | { t: 'status' }
  | { t: 'stat'; group: 'detailed' | 'combat' | 'any' }
  | { t: 'item' }
  | { t: 'yaml'; hint: string };

/** Every effect parameter and how to edit it (from model/effects.ts). */
export const FIELDS: Record<string, { kind: Kind; label: string }> = {
  text: { kind: { t: 'text' }, label: 'Description' },
  trigger: { kind: { t: 'enum', options: TRIGGERS }, label: 'Trigger' },
  action: { kind: { t: 'enum', options: ACTIONS }, label: 'Action' },
  target: { kind: { t: 'enum', options: EffectTarget.options }, label: 'Target' },
  watch: { kind: { t: 'enum', options: Watch.options }, label: 'Whose events' },
  listen: { kind: { t: 'enum', options: ['enemy'] }, label: "Listen to the opponent's events" },
  uses_dots: { kind: { t: 'bool' }, label: 'Uses item dots' },
  chance_pct: { kind: { t: 'number' }, label: 'Chance %' },
  status: { kind: { t: 'status' }, label: 'Status' },
  stacks: { kind: { t: 'number' }, label: 'Stacks' },
  value: { kind: { t: 'scaled' }, label: 'Value' },
  amount: { kind: { t: 'number' }, label: 'Amount' },
  stat: { kind: { t: 'enum', options: ITEM_STAT_PCTS }, label: 'Item stat' },
  player_stat: { kind: { t: 'stat', group: 'any' }, label: 'Stat' },
  combat_stat: { kind: { t: 'stat', group: 'combat' }, label: 'Combat stat' },
  duration_s: { kind: { t: 'number' }, label: 'Duration (s)' },
  interval_s: { kind: { t: 'number' }, label: 'Every (s)' },
  at_s: { kind: { t: 'number' }, label: 'Once at (s)' },
  hp_pct: { kind: { t: 'number' }, label: 'HP threshold %' },
  pct: { kind: { t: 'number' }, label: 'Percent' },
  count: { kind: { t: 'number' }, label: 'Count' },
  count_unit: { kind: { t: 'enum', options: ['stacks', 'statuses'] }, label: 'Count unit' },
  hits: { kind: { t: 'number' }, label: 'Hits (a tick apart)' },
  damage_type: { kind: { t: 'enum', options: ['effect', 'weapon'] }, label: 'Damage type' },
  can_crit: { kind: { t: 'bool' }, label: 'Can crit' },
  crit_bonus_pct: { kind: { t: 'number' }, label: 'Extra crit rate %' },
  event_pct: { kind: { t: 'number' }, label: '% of the event amount' },
  min_event_amount: { kind: { t: 'number' }, label: 'Only if event amount above' },
  max_stacks: { kind: { t: 'number' }, label: 'Max stacks' },
  cooldown_s: { kind: { t: 'number' }, label: 'Internal cooldown (s)' },
  until_s: { kind: { t: 'number' }, label: 'Timer stops after (s)' },
  priority: { kind: { t: 'number' }, label: 'Start-of-battle priority' },
  item: { kind: { t: 'item' }, label: 'Item' },
  pick: { kind: { t: 'enum', options: ['most_stacks_debuff'] }, label: 'Pick status' },
  pick_from: { kind: { t: 'yaml', hint: '[focus, dodge]' }, label: 'Whichever has most of' },
  pick_random: { kind: { t: 'number' }, label: 'Pick N random targets' },
  pct_of: { kind: { t: 'enum', options: ['cooldown', 'remaining'] }, label: 'Percent of' },
  pct_of_current: { kind: { t: 'number' }, label: '% of current Block' },
  ignore_inflict_bonus: { kind: { t: 'bool' }, label: 'Ignore inflict bonuses' },
  consume: { kind: { t: 'bool' }, label: 'Consumes the stacks' },
  avoid: { kind: { t: 'bool' }, label: 'Avoid the blow entirely' },
  stacks_growth: { kind: { t: 'number' }, label: 'Extra cost per use' },
  roll_group: { kind: { t: 'text' }, label: 'Shared chance roll group' },
  every: { kind: { t: 'number' }, label: 'Every N (stacks / block)' },
  gear_min_rarity: { kind: { t: 'enum', options: RARITIES }, label: 'From gear rarity' },
  gear_max_rarity: { kind: { t: 'enum', options: RARITIES }, label: 'Up to gear rarity' },
  min_stars: { kind: { t: 'number' }, label: 'From pet stars' },
  max_stars: { kind: { t: 'number' }, label: 'Up to pet stars' },
  filter: { kind: { t: 'yaml', hint: '{ tags_any: [weapon] }' }, label: 'Target filter' },
  watch_filter: { kind: { t: 'yaml', hint: '{ tags_any: [weapon] }' }, label: 'Event filter' },
  condition: { kind: { t: 'yaml', hint: '{ who: enemy, status: burn, min_stacks: 10 }' }, label: 'Condition' },
  limit: { kind: { t: 'yaml', hint: '{ per_battle: 5 }' }, label: 'Limit' },
  per_status: { kind: { t: 'yaml', hint: '{ status: burn, on: enemy, max_stacks: 40 }' }, label: 'Per status stack' },
  per_dot: { kind: { t: 'yaml', hint: '{ tags_any: [armor] }' }, label: 'Per item under dots' },
  amount_from: { kind: { t: 'yaml', hint: '{ status: burn, status_on: enemy, factor: 1, max: 40 }' }, label: 'Amount from' },
  per_bag: { kind: { t: 'yaml', hint: '{ tags_any: [spirit] }' }, label: 'Per matching bag item' },
  per_bag_reduce: { kind: { t: 'yaml', hint: '{ tags_none: [spear], step: 10 }' }, label: 'Less per bag item' },
  bonus_per_removed_block: { kind: { t: 'scaled' }, label: 'Bonus per Block removed' },
  params: { kind: { t: 'yaml', hint: '{ status: burn }' }, label: 'Trigger parameters' },
  assumption: { kind: { t: 'text' }, label: 'Unconfirmed reading (shown in battle)' },
};

const BY_TRIGGER: Record<string, string[]> = {
  timer: ['interval_s', 'at_s', 'until_s'],
  hp_below: ['hp_pct'],
  on_status_applied: ['params', 'every'],
  on_status_damage: ['params'],
  on_status_resisted: ['params'],
  on_block_gained: ['every'],
  on_heal: ['min_event_amount'],
  on_hit: ['watch'],
  on_weapon_hit: ['watch', 'uses_dots', 'watch_filter'],
  on_crit: ['watch', 'watch_filter'],
  on_activation: ['watch'],
};
const BY_ACTION: Record<string, string[]> = {
  add_stat_pct: ['stat', 'amount', 'duration_s', 'filter', 'max_stacks'],
  deal_damage: ['value', 'damage_type', 'hits', 'can_crit'],
  gain_block: ['value'],
  remove_block: ['value'],
  heal: ['value'],
  lose_hp: ['value'],
  apply_status: ['status', 'stacks', 'duration_s'],
  remove_status: ['status', 'count'],
  cleanse: ['count'],
  steal_status: ['count'],
  refund_cooldown: ['pct', 'filter'],
  charge_skill: ['pct'],
  activate_item: ['filter'],
  attack: ['filter'],
  spawn_item: ['item'],
  transform_item: ['item'],
  seal_item: ['duration_s', 'count'],
  reduce_hit_damage: ['pct'],
  add_combatant_stat: ['combat_stat', 'amount', 'duration_s'],
  charge_counter: ['status', 'pct'],
  release_counter: ['status'],
  trigger_status: ['status', 'count', 'amount'],
  multiply_status: ['status', 'pct'],
  add_player_stat: ['player_stat', 'amount', 'duration_s'],
  prevent_lethal: ['status', 'stacks', 'stacks_growth'],
  add_skill_hits: ['amount'],
  scale_skill_damage: ['amount'],
  execute: ['condition'],
  add_inflict_pct: ['status', 'amount', 'filter'],
  add_atk_pct: ['amount'],
  add_cooldown_s: ['amount', 'filter'],
};
const ALWAYS = ['text', 'trigger', 'action', 'target', 'chance_pct'];

/** The parameters shown for an effect: the basics, what its trigger and action use, then any others it has. */
export function shownFields(e: EffectDraft): string[] {
  const want = [...ALWAYS, ...(BY_TRIGGER[String(e.trigger)] ?? []), ...(BY_ACTION[String(e.action)] ?? []), ...Object.keys(e)];
  return [...new Set(want)].filter((k) => k in FIELDS);
}

/** Problems with an effect (the same checks the loader runs). */
export function effectErrors(e: EffectDraft): string[] {
  const r = ItemEffectSchema.safeParse(e);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || 'effect'}: ${i.message}`);
}

/** Every structured effect the game data has, as a starting point for a monster item. */
export function abilityCatalog(data: GameData): { key: string; source: string; text: string; effect: EffectDraft }[] {
  const out: { key: string; source: string; text: string; effect: EffectDraft }[] = [];
  const add = (source: string, list: readonly unknown[]) =>
    list.forEach((e, i) => {
      const effect = structuredClone(e) as EffectDraft;
      delete effect.min_stars;
      delete effect.max_stars;
      delete effect.gear_min_rarity;
      delete effect.gear_max_rarity;
      out.push({ key: `${source}#${i}`, source, text: String(effect.text ?? `${effect.trigger} → ${effect.action}`), effect });
    });
  for (const it of data.items.values()) add(`Item: ${it.name}`, it.effects);
  for (const g of data.gear.values()) add(`Gear: ${g.name}`, g.effects);
  for (const h of data.heroes.values()) for (const [skill, s] of Object.entries(h.skill_effects ?? {})) add(`Hero: ${h.name} (${h.skills.find((x) => x.id === skill)?.name ?? skill})`, s.effects);
  for (const p of data.pets.values()) add(`Pet: ${p.name}`, p.effects);
  return out;
}

function Yaml({ value, onChange, label, hint }: { value: unknown; onChange: (v: unknown) => void; label: string; hint: string }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value).replace(/"([a-z_]+)":/g, '$1: ').replace(/,/g, ', '));
  const [bad, setBad] = useState(false);
  return (
    <input
      aria-label={label}
      className="mono"
      style={{ width: '100%', ...(bad ? { borderColor: 'var(--error)' } : {}) }}
      placeholder={hint}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(e.target.value.trim() ? parse(e.target.value) : undefined);
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

export function EffectForm({ effect, onChange, onRemove, data }: { effect: EffectDraft; onChange: (e: EffectDraft) => void; onRemove: () => void; data: GameData }) {
  const set = (k: string, v: unknown) => {
    const next = { ...effect };
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const fields = shownFields(effect);
  const errors = effectErrors(effect);
  const statuses = [...data.statuses.keys()].sort();
  const stats = (group: 'detailed' | 'combat' | 'any') =>
    [...data.stats.values()].filter((s) => s.group !== 'basic' && s.group !== 'economy' && (group === 'any' || s.group === group)).map((s) => s.id);

  const control = (k: string) => {
    const { kind, label } = FIELDS[k]!;
    const v = effect[k];
    const aria = `${label}`;
    switch (kind.t) {
      case 'enum':
        return (
          <select aria-label={aria} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || undefined)}>
            <option value="">—</option>
            {kind.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      case 'number':
        return <input type="number" step="any" aria-label={aria} value={typeof v === 'number' ? v : ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} style={{ width: 90 }} />;
      case 'bool':
        return <input type="checkbox" aria-label={aria} checked={v === true} onChange={(e) => set(k, e.target.checked || undefined)} style={{ justifySelf: 'start' }} />;
      case 'text':
        return <input aria-label={aria} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || undefined)} style={{ width: '100%' }} />;
      case 'status':
        return (
          <select aria-label={aria} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || undefined)}>
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        );
      case 'stat':
        return (
          <select aria-label={aria} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || undefined)}>
            <option value="">—</option>
            {stats(kind.group).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        );
      case 'item':
        return (
          <select aria-label={aria} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || undefined)}>
            <option value="">—</option>
            {[...data.items.values()].map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        );
      case 'scaled': {
        const s = (typeof v === 'object' && v ? v : {}) as { ratio?: number; scales_with?: string };
        return (
          <span className="row">
            <input type="number" step="any" aria-label={`${aria} ratio`} value={s.ratio ?? ''} style={{ width: 80 }} onChange={(e) => set(k, e.target.value === '' ? undefined : { scales_with: s.scales_with ?? 'atk', ratio: Number(e.target.value) })} />
            x
            <select aria-label={`${aria} scales with`} value={s.scales_with ?? 'atk'} onChange={(e) => set(k, { ratio: s.ratio ?? 1, scales_with: e.target.value })}>
              <option value="atk">ATK</option>
              <option value="hp">max HP</option>
              <option value="enemy_hp">enemy max HP</option>
            </select>
          </span>
        );
      }
      case 'yaml':
        return <Yaml label={aria} hint={kind.hint} value={v} onChange={(x) => set(k, x)} />;
    }
  };

  const addable = Object.keys(FIELDS).filter((k) => !fields.includes(k));
  return (
    <div className="hero-card" style={{ marginBottom: 8 }}>
      <div className="form-grid" style={{ gridTemplateColumns: '170px 1fr' }}>
        {fields.map((k) => (
          <FieldRow key={k} label={FIELDS[k]!.label} k={k} onClear={ALWAYS.includes(k) ? undefined : () => set(k, undefined)}>
            {control(k)}
          </FieldRow>
        ))}
      </div>
      <div className="row small" style={{ marginTop: 6 }}>
        <select aria-label="Add parameter" value="" onChange={(e) => e.target.value && set(e.target.value, FIELDS[e.target.value]!.kind.t === 'bool' ? true : FIELDS[e.target.value]!.kind.t === 'number' ? 0 : FIELDS[e.target.value]!.kind.t === 'scaled' ? { ratio: 1, scales_with: 'atk' } : FIELDS[e.target.value]!.kind.t === 'yaml' ? undefined : '')}>
          <option value="">Add parameter…</option>
          {addable.map((k) => (
            <option key={k} value={k}>
              {FIELDS[k]!.label} ({k})
            </option>
          ))}
        </select>
        <button onClick={onRemove}>Remove ability</button>
      </div>
      {errors.map((e) => (
        <div key={e} className="field-error small">
          {e}
        </div>
      ))}
    </div>
  );
}

function FieldRow({ label, k, onClear, children }: { label: string; k: string; onClear?: () => void; children: React.ReactNode }) {
  return (
    <>
      <label title={k}>{label}</label>
      <span className="row">
        {children}
        {onClear && (
          <button className="small" aria-label={`Remove ${label}`} onClick={onClear}>
            ✕
          </button>
        )}
      </span>
    </>
  );
}
