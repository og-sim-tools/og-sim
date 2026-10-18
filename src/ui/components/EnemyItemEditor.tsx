/**
 * Enemy item editor: make monster items for enemy builds. Start blank or from any item, set the
 * stats, shape and tags, and give it abilities copied from any item, gear, hero skill or pet, each
 * with every parameter editable. Saved to data/items/manual/user_edits.yaml with enemy_item: true.
 */
import { useMemo, useState } from 'react';
import type { GameData } from '../../engine/loader';
import { ItemRarity, ItemSchema, slugify } from '../../engine/model';
import { useStore } from '../saves';
import { knownTags } from '../state/editor';
import { type EffectDraft, EffectForm, abilityCatalog, effectErrors } from './EffectForm';
import { Num, ScaledEditor, ShapeEditor, TagInput } from './ItemEditor';

type Draft = {
  id: string;
  name: string;
  rarity: (typeof ItemRarity.options)[number];
  value: number;
  tags: string[];
  footprint?: string;
  stats: Record<string, unknown>;
  /** A gear-style skill, so "On Skill Hit" abilities fire (like a player's gear weapon). */
  skill?: Record<string, unknown>;
  effect_text: string;
  effects: EffectDraft[];
};

const BLANK: Draft = { id: '', name: '', rarity: 'common', value: 0, tags: ['weapon'], footprint: '#', stats: { damage: { ratio: 1, scales_with: 'atk' }, cooldown: 2, accuracy: 85 }, effect_text: '', effects: [] };

/** The fields saved for an enemy item (validated with the normal item schema). */
export function enemyItemPayload(d: Draft): Record<string, unknown> {
  return {
    id: d.id || slugify(d.name),
    name: d.name,
    kind: 'item',
    rarity: d.rarity,
    tags: d.tags,
    class_restriction: [],
    footprint: d.footprint,
    stats: d.stats,
    ...(d.skill ? { skill: { text: d.effect_text || 'Skill', ...d.skill } } : {}),
    effect_text: d.effect_text,
    effects: d.effects,
    effects_status: 'complete',
    value: d.value,
    enemy_item: true,
    source: 'manual',
    verified: true,
  };
}

export function enemyItemErrors(d: Draft, data: GameData, isNew: boolean): string[] {
  const p = enemyItemPayload(d);
  const errs: string[] = [];
  if (!d.name.trim()) errs.push('Give it a name.');
  if (isNew && (data.items.has(String(p.id)) || data.gear.has(String(p.id)))) errs.push(`"${p.id}" is already used by another item.`);
  const r = ItemSchema.safeParse(p);
  if (!r.success) errs.push(...r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  d.effects.forEach((e, i) => effectErrors(e).forEach((m) => errs.push(`Ability ${i + 1}: ${m}`)));
  return [...new Set(errs)];
}

function draftOf(it: { id: string; name: string; rarity: Draft['rarity']; value: number; tags: string[]; footprint?: string; stats: object; skill?: object; effect_text: string; effects: readonly unknown[] }): Draft {
  return structuredClone({ id: it.id, name: it.name, rarity: it.rarity, value: it.value, tags: it.tags, footprint: it.footprint, stats: it.stats as Record<string, unknown>, ...(it.skill ? { skill: it.skill as Record<string, unknown> } : {}), effect_text: it.effect_text, effects: it.effects as EffectDraft[] });
}

export function EnemyItemEditor({ data, onSaved, onError }: { data: GameData; onSaved: (msg: string) => void | Promise<void>; onError: (msg: string) => void }) {
  const store = useStore();
  const mine = [...data.items.values()].filter((i) => i.enemy_item).sort((a, b) => a.name.localeCompare(b.name));
  const [editing, setEditing] = useState<string | null>(null); // item id, '' = new
  const [draft, setDraft] = useState<Draft | null>(null);
  const [abilitySearch, setAbilitySearch] = useState('');
  const catalog = useMemo(() => abilityCatalog(data), [data]);
  const tags = useMemo(() => knownTags(data), [data]);
  const isNew = editing === '';
  const errors = draft ? enemyItemErrors(draft, data, isNew) : [];

  const open = (id: string | null, from?: string) => {
    if (id === null) return (setEditing(null), setDraft(null));
    const src = data.items.get(from ?? id);
    setEditing(id);
    if (id === '' && src) setDraft({ ...draftOf(src), id: '', name: `${src.name} (monster)` });
    else setDraft(src ? draftOf(src) : structuredClone(BLANK));
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setStat = (k: string, v: unknown) =>
    setDraft((d) => {
      if (!d) return d;
      const stats = { ...d.stats };
      if (v === undefined || v === false) delete stats[k];
      else stats[k] = v;
      return { ...d, stats };
    });

  const setSkill = (k: string, v: unknown) =>
    setDraft((d) => {
      if (!d) return d;
      const skill = { ...(d.skill ?? {}) };
      if (v === undefined || v === false) delete skill[k];
      else skill[k] = v;
      return { ...d, skill };
    });

  const save = async () => {
    if (!draft || errors.length) return;
    const p = enemyItemPayload(draft);
    try {
      await store.writeEdit('items', p);
      await onSaved(`Saved enemy item ${draft.name} to ${store.editsWhere('items')}`);
      setEditing(String(p.id));
      setDraft({ ...draft, id: String(p.id) });
    } catch (e) {
      onError(`Couldn't save: ${(e as Error).message}`);
    }
  };
  const remove = async () => {
    if (!editing) return;
    try {
      await store.deleteEdit('items', editing);
      await onSaved(`Deleted enemy item ${editing}`);
      open(null);
    } catch (e) {
      onError(`Couldn't delete: ${(e as Error).message}`);
    }
  };

  const found = abilitySearch.trim()
    ? catalog.filter((c) => `${c.source} ${c.text} ${c.effect.action} ${c.effect.trigger}`.toLowerCase().includes(abilitySearch.toLowerCase())).slice(0, 40)
    : [];

  return (
    <div className="main" style={{ gridTemplateColumns: '280px 1fr' }}>
      <div className="stack">
        <div className="panel">
          <h2>Enemy items ({mine.length})</h2>
          <div className="small muted">Monster items for enemy builds. Only offered in the item list while you edit an enemy build.</div>
          <div className="row" style={{ margin: '6px 0' }}>
            <button className="primary" onClick={() => open('')}>
              New enemy item
            </button>
            <select aria-label="Start from an existing item" value="" onChange={(e) => e.target.value && open('', e.target.value)}>
              <option value="">Copy an existing item…</option>
              {[...data.items.values()]
                .filter((i) => !i.enemy_item)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="list">
            {mine.map((i) => (
              <div key={i.id} className={`list-row${editing === i.id ? ' active' : ''}`} style={{ cursor: 'pointer' }} onClick={() => open(i.id)}>
                {i.name} <span className="badge">{i.rarity}</span>
              </div>
            ))}
            {!mine.length && <div className="small muted">None yet.</div>}
          </div>
        </div>
      </div>

      {draft && (
        <div className="stack">
          <div className="panel">
            <h2>
              {isNew ? 'New enemy item' : draft.name}{' '}
              <button className="primary" disabled={errors.length > 0} onClick={() => void save()}>
                Save
              </button>{' '}
              {!isNew && <button onClick={() => void remove()}>Delete</button>}
            </h2>
            {errors.map((e) => (
              <div key={e} className="issue error">
                {e}
              </div>
            ))}
            <h3>Basics</h3>
            <div className="form-grid" style={{ gridTemplateColumns: '130px 1fr' }}>
              <label>Name</label>
              <input aria-label="Enemy item name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
              <label>Id</label>
              <span className="small mono">{isNew ? slugify(draft.name) || '—' : draft.id}</span>
              <label>Rarity</label>
              <select aria-label="Enemy item rarity" value={draft.rarity} onChange={(e) => set('rarity', e.target.value as Draft['rarity'])}>
                {ItemRarity.options.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <label>Value</label>
              <Num label="Enemy item value" value={draft.value} onChange={(v) => set('value', Math.max(0, Math.round(v ?? 0)))} />
              <label>Tags</label>
              <TagInput value={draft.tags} onChange={(v) => set('tags', v)} known={tags} />
              <label>Description</label>
              <input aria-label="Enemy item description" value={draft.effect_text} onChange={(e) => set('effect_text', e.target.value)} placeholder="What it does, in words (shown on the item)" />
            </div>
            <h3>Shape and item dots</h3>
            <ShapeEditor key={editing ?? 'new'} footprint={draft.footprint} onChange={(fp) => set('footprint', fp)} />
            <h3>Stats</h3>
            <div className="form-grid" style={{ gridTemplateColumns: '130px 1fr' }}>
              <label>Damage</label>
              <ScaledEditor label="Damage" rounding={data.config?.observations.display_rounding ?? 'round'} value={draft.stats.damage as Parameters<typeof ScaledEditor>[0]['value']} onChange={(v) => setStat('damage', v)} />
              <label>Cooldown (s)</label>
              <Num label="Cooldown" value={draft.stats.cooldown} onChange={(v) => setStat('cooldown', v && v > 0 ? v : undefined)} />
              <label>Accuracy %</label>
              <Num label="Accuracy" value={draft.stats.accuracy} onChange={(v) => setStat('accuracy', v)} />
              <label>Crit chance %</label>
              <Num label="Crit chance" value={draft.stats.crit_chance} onChange={(v) => setStat('crit_chance', v)} />
              <label>Crit DMG % (extra)</label>
              <Num label="Crit damage" value={draft.stats.crit_damage} onChange={(v) => setStat('crit_damage', v)} />
              <label>Hits per attack</label>
              <Num label="Hits" step="1" value={draft.stats.hits} onChange={(v) => setStat('hits', v && v >= 1 ? Math.round(v) : undefined)} />
              <label>Attacks per battle</label>
              <Num label="Max attacks" step="1" value={draft.stats.max_attacks} onChange={(v) => setStat('max_attacks', v && v >= 1 ? Math.round(v) : undefined)} />
              <label>Always hits</label>
              <input type="checkbox" aria-label="Always hits" checked={draft.stats.always_hit === true} onChange={(e) => setStat('always_hit', e.target.checked)} style={{ justifySelf: 'start' }} />
            </div>
          </div>

          <div className="panel">
            <h2>
              Skill{' '}
              <label className="small">
                <input type="checkbox" aria-label="Has a skill" checked={!!draft.skill} onChange={(e) => set('skill', e.target.checked ? { damage: { ratio: 3, scales_with: 'atk' }, interval_s: 8 } : undefined)} /> has a gear-style skill
              </label>
            </h2>
            <div className="small muted">Like a gear weapon's skill: on a fixed timer (haste and Freeze don't change it) or a Skill Gauge. "On Skill Hit" / "On Skill Activation" abilities fire on it.</div>
            {draft.skill && (
              <div className="form-grid" style={{ gridTemplateColumns: '130px 1fr', marginTop: 6 }}>
                <label>Skill damage</label>
                <ScaledEditor label="Skill damage" rounding={data.config?.observations.display_rounding ?? 'round'} value={draft.skill.damage as Parameters<typeof ScaledEditor>[0]['value']} onChange={(v) => setSkill('damage', v)} />
                <label>Every (s)</label>
                <Num label="Skill interval" value={draft.skill.interval_s} onChange={(v) => setSkill('interval_s', v && v > 0 ? v : undefined)} />
                <label>Skill Gauge</label>
                <input type="checkbox" aria-label="Skill Gauge" checked={draft.skill.gauge === true} onChange={(e) => setSkill('gauge', e.target.checked)} style={{ justifySelf: 'start' }} />
                <label>Hits</label>
                <Num label="Skill hits" step="1" value={draft.skill.hits} onChange={(v) => setSkill('hits', v && v >= 1 ? Math.round(v) : undefined)} />
                <label>Accuracy %</label>
                <Num label="Skill accuracy" value={draft.skill.accuracy} onChange={(v) => setSkill('accuracy', v)} />
                <label>Crit chance %</label>
                <Num label="Skill crit chance" value={draft.skill.crit_chance} onChange={(v) => setSkill('crit_chance', v)} />
                <label>Always hits</label>
                <input type="checkbox" aria-label="Skill always hits" checked={draft.skill.always_hit === true} onChange={(e) => setSkill('always_hit', e.target.checked)} style={{ justifySelf: 'start' }} />
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Abilities ({draft.effects.length})</h2>
            <div className="small muted">Copy any ability the simulator knows (items, gear, hero skills, pets), then change any parameter. Or start a blank one.</div>
            <div className="row" style={{ margin: '6px 0' }}>
              <input aria-label="Search abilities" placeholder="Search abilities: burn, stun, Primal Flame, heal…" value={abilitySearch} onChange={(e) => setAbilitySearch(e.target.value)} style={{ flex: 1 }} />
              <button onClick={() => set('effects', [...draft.effects, { trigger: 'on_hit', target: 'enemy', action: 'apply_status', status: 'burn', stacks: 1 }])}>Blank ability</button>
            </div>
            {found.length > 0 && (
              <div className="list small" style={{ maxHeight: 220, marginBottom: 8 }}>
                {found.map((c) => (
                  <div
                    key={c.key}
                    className="list-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      set('effects', [...draft.effects, structuredClone(c.effect)]);
                      setAbilitySearch('');
                    }}
                  >
                    <span className="muted">{c.source}:</span> {c.text}
                  </div>
                ))}
              </div>
            )}
            {draft.effects.map((e, i) => (
              <EffectForm
                key={i}
                data={data}
                effect={e}
                onChange={(next) => set('effects', draft.effects.map((x, j) => (j === i ? next : x)))}
                onRemove={() => set('effects', draft.effects.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
