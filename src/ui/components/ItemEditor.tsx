/**
 * Item editor (SPEC §8.2): add or correct items, gear and pets without hand-editing YAML.
 * Saves only the changed fields to data/<category>/manual/user_edits.yaml, so the wiki version is
 * overridden field by field. Includes the "needs shape" queue.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import type { GameData } from '../../engine/loader';
import { CLASSES, ItemRarity, PetRarity, slugify } from '../../engine/model';
import { resolveRatio } from '../../engine/numbers';
import { useStore } from '../saves';
import { imageUrl } from '../staticData';
import { sortPets } from './ProfileEditor';
import {
  type Draft,
  type EditCategory,
  type ShapeCell,
  GRID,
  diffFields,
  footprintFromGrid,
  gridFromFootprint,
  knownTags,
  nextShapeCell,
  suggestTags,
  toDraft,
  validateDraft,
} from '../state/editor';

export interface EditTarget {
  category: EditCategory;
  /** null = a new entry. */
  id: string | null;
}

interface Props {
  data: GameData;
  target: EditTarget | null;
  onTarget: (t: EditTarget | null) => void;
  onSaved: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}

const NEW_DRAFT: Record<EditCategory, Draft> = {
  items: { id: '', name: '', kind: 'item', rarity: 'common', tags: [], class_restriction: [], value: 0, effect_text: '', source: 'manual', verified: true },
  gear: { id: '', name: '', slot: 'weapon', tags: ['weapon'], gear_effect_text: '', source: 'manual', verified: true },
  pets: { id: '', name: '', rarity: 'rare', activation_cost: 3, skill: { name: '', text: '' }, star_effects: [], role: 'battle', source: 'manual', verified: true },
};

function entryOf(data: GameData, t: EditTarget): Record<string, unknown> | undefined {
  if (!t.id) return undefined;
  return (data[t.category] as Map<string, Record<string, unknown>>).get(t.id);
}

// ---------------------------------------------------------------- small field components

export function Num({ value, onChange, label, step = 'any' }: { value: unknown; onChange: (v: number | undefined) => void; label: string; step?: string }) {
  return (
    <input
      type="number"
      step={step}
      aria-label={label}
      value={typeof value === 'number' ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/**
 * Tags as chips, with suggestions from tags already in use. Enter / Tab / comma takes the first
 * suggestion (or the typed text); a tag nothing else uses is flagged so typos stand out.
 */
export function TagInput({ value, onChange, known }: { value: unknown; onChange: (v: string[]) => void; known: string[] }) {
  const tags = Array.isArray(value) ? (value as string[]) : [];
  const [text, setText] = useState('');
  const suggestions = suggestTags(known, text, tags);
  const typed = slugify(text);
  const add = (t: string) => {
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText('');
  };
  const unknown = tags.filter((t) => !known.includes(t));
  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {tags.map((t) => (
          <span key={t} className={`badge${known.includes(t) ? '' : ' warn'}`} title={known.includes(t) ? undefined : 'No other item or gear uses this tag'}>
            {t}{' '}
            <span role="button" aria-label={`Remove tag ${t}`} style={{ cursor: 'pointer' }} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ✕
            </span>
          </span>
        ))}
        <input
          aria-label="Tags"
          value={text}
          placeholder="add tag…"
          style={{ flex: 1, minWidth: 120 }}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(suggestTags(known, v.slice(0, -1), tags)[0] ?? slugify(v.slice(0, -1)));
            else setText(v);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
              e.preventDefault();
              add(suggestions[0] ?? typed);
            } else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
          }}
        />
      </div>
      {text.trim() && (
        <div className="row small" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {suggestions.map((s) => (
            <button key={s} className="small" onClick={() => add(s)}>
              {s}
            </button>
          ))}
          {!suggestions.length && <span className="field-warn">"{typed}" isn't a known tag — Enter adds it as a new tag.</span>}
        </div>
      )}
      {unknown.length > 0 && <div className="field-warn">New tag{unknown.length > 1 ? 's' : ''} nothing else uses: {unknown.join(', ')} — check the spelling.</div>}
    </div>
  );
}

/** YAML textarea for structured fields (effects, rarity effects, star effects, effect values). */
function YamlField({ value, onChange, label, placeholder }: { value: unknown; onChange: (v: unknown) => void; label: string; placeholder?: string }) {
  const toText = (v: unknown) => (v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && Object.keys(v).length === 0) ? '' : stringify(v, { lineWidth: 0 }));
  const [text, setText] = useState(toText(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(toText(value));
    setErr(null);
  }, [value]);
  return (
    <div>
      <textarea
        className="code"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const v = e.target.value.trim() === '' ? undefined : (parse(e.target.value) as unknown);
            setErr(null);
            onChange(v);
          } catch (x) {
            setErr((x as Error).message.split('\n')[0]!);
          }
        }}
      />
      {err && <div className="field-error">{err}</div>}
    </div>
  );
}

type Scaled = { ratio?: number; scales_with: 'atk' | 'hp' | 'unknown'; observations?: { shown: string; stat: string }[] };

/** Ratio typed directly or from in-game observations, with the resulting range (SPEC §4.3). */
export function ScaledEditor({ value, onChange, rounding, label }: { value: Scaled | undefined; onChange: (v: Scaled | undefined) => void; rounding: 'round' | 'truncate'; label: string }) {
  const v: Scaled = value ?? { scales_with: 'atk' };
  const obs = v.observations ?? [];
  const set = (patch: Partial<Scaled>) => {
    const next = { ...v, ...patch };
    if (next.ratio === undefined) delete next.ratio;
    if (next.observations && next.observations.length === 0) delete next.observations;
    onChange(next.ratio === undefined && !next.observations ? undefined : next);
  };
  let summary = '';
  let problem = '';
  try {
    if (value) {
      const r = resolveRatio(value, rounding);
      if (r.range) summary = `observed ${r.range.lo.toFixed(4)}–${r.range.hi.toFixed(4)} (±${(r.uncertainty! * 100).toFixed(2)}%)`;
      if (r.ratio !== null) summary += `${summary ? ' · ' : ''}uses ${Number(r.ratio.toFixed(4))}x`;
      problem = [...r.errors, ...r.warnings].join(' ');
    }
  } catch (e) {
    problem = (e as Error).message;
  }
  return (
    <div>
      <div className="row">
        <Num label={`${label} ratio`} value={v.ratio} onChange={(ratio) => set({ ratio })} />
        <span className="muted">x</span>
        <select aria-label={`${label} scales with`} value={v.scales_with} onChange={(e) => set({ scales_with: e.target.value as Scaled['scales_with'] })}>
          <option value="atk">ATK</option>
          <option value="hp">HP</option>
          <option value="unknown">unknown</option>
        </select>
        <button onClick={() => set({ observations: [...obs, { shown: '', stat: '' }] })}>+ observation</button>
      </div>
      {obs.map((o, i) => (
        <div key={i} className="row small" style={{ marginTop: 2 }}>
          shown <input value={o.shown} placeholder="2.01M" style={{ width: 80 }} aria-label="Shown value" onChange={(e) => set({ observations: obs.map((x, j) => (j === i ? { ...x, shown: e.target.value.trim() } : x)) })} />
          at stat <input value={o.stat} placeholder="1.34M" style={{ width: 80 }} aria-label="Basic stat" onChange={(e) => set({ observations: obs.map((x, j) => (j === i ? { ...x, stat: e.target.value.trim() } : x)) })} />
          <button aria-label="Remove observation" onClick={() => set({ observations: obs.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      {summary && <div className="small muted">{summary}</div>}
      {problem && <div className="field-warn">{problem}</div>}
    </div>
  );
}

export function ShapeEditor({ footprint, onChange, image }: { footprint: string | undefined; onChange: (fp: string | undefined) => void; image?: string }) {
  const [grid, setGrid] = useState<ShapeCell[]>(() => gridFromFootprint(footprint));
  // The latest grid, so quick clicks never work from a stale copy.
  const latest = useRef(grid);
  useEffect(() => {
    // Only re-lay the board when the footprint changed from outside (another entry, Clear).
    if (footprintFromGrid(latest.current) !== footprint) {
      latest.current = gridFromFootprint(footprint);
      setGrid(latest.current);
    }
  }, [footprint]);
  const click = (i: number) => {
    const g = [...latest.current];
    g[i] = nextShapeCell(g[i]!);
    latest.current = g;
    setGrid(g);
    onChange(footprintFromGrid(g));
  };
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="shape-grid" style={{ gridTemplateColumns: `repeat(${GRID}, 26px)` }} role="grid" aria-label="Shape editor">
          {grid.map((v, i) => (
            <div key={i} className={v === 1 ? 'c' : v === 2 ? 'd' : ''} onClick={() => click(i)} title="Click: empty → item cell → dot → empty" />
          ))}
        </div>
        <div className="small muted">
          Footprint: <span className="mono">{footprint ?? '(none — needs shape)'}</span>
        </div>
        <button className="small" onClick={() => onChange(undefined)}>
          Clear
        </button>
      </div>
      {image && (
        <div>
          <div className="small muted">Reference</div>
          <img src={imageUrl(image)} alt="Reference sprite" style={{ maxWidth: 160, imageRendering: 'pixelated' }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- editor

export function ItemEditor({ data, target, onTarget, onSaved, onError }: Props) {
  const store = useStore();
  const [category, setCategory] = useState<EditCategory>(target?.category ?? 'items');
  const [search, setSearch] = useState('');
  const entry = target ? entryOf(data, target) : undefined;
  const orig = useMemo<Draft>(() => (target ? (entry ? toDraft(entry) : structuredClone(NEW_DRAFT[target.category])) : {}), [target, entry]);
  const [draft, setDraft] = useState<Draft>(orig);
  const [source, setSource] = useState<'observed' | 'manual'>('observed');
  const [checked, setChecked] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    setDraft(orig);
    setConfirm(false);
    setNote('');
  }, [orig]);
  useEffect(() => {
    if (target) setCategory(target.category);
  }, [target]);

  const rounding = data.config?.observations.display_rounding ?? 'round';
  const set = (k: string, v: unknown) =>
    setDraft((d) => {
      const n = { ...d };
      if (v === undefined) delete n[k];
      else n[k] = v;
      return n;
    });
  const setIn = (k: string, sub: string, v: unknown) => {
    const obj = { ...((draft[k] as Record<string, unknown> | undefined) ?? {}) };
    if (v === undefined) delete obj[sub];
    else obj[sub] = v;
    set(k, Object.keys(obj).length ? obj : undefined);
  };

  const isNew = !!target && !target.id;
  const working: Draft = { ...draft, id: isNew ? slugify(String(draft.name ?? '')) : draft.id };
  const errors = target ? validateDraft(target.category, working) : [];
  const changes = target ? (isNew ? working : diffFields(orig, working)) : {};
  const changed = Object.keys(changes).filter((k) => !['id', 'source', 'verified'].includes(k));
  const hasEdits = !!entry && (entry.meta as { origins: string[] }).origins.some((o) => o.includes('/manual/user_edits.yaml') || o.includes('/manual/your_edits.yaml'));

  const queue = useMemo(
    () => [
      ...[...data.items.values()].filter((i) => i.shape === null).map((i) => ({ category: 'items' as const, id: i.id, name: i.name })),
      ...[...data.gear.values()].filter((g) => g.shape === null).map((g) => ({ category: 'gear' as const, id: g.id, name: g.name })),
    ],
    [data],
  );
  const tags = useMemo(() => knownTags(data), [data]);
  const list = useMemo(() => {
    const m = data[category] as Map<string, { id: string; name: string; rarity?: string; slot?: string }>;
    const q = search.toLowerCase();
    const found = [...m.values()].filter((e) => !q || e.name.toLowerCase().includes(q));
    return category === 'pets' ? sortPets(found as { id: string; name: string; rarity: string }[]) : found.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, category, search]);

  const save = async (andNext = false) => {
    if (!target) return;
    if (errors.length) return onError('Fix the errors before saving.');
    if (!changed.length && !confirm) return onError('Nothing changed.');
    const id = String(working.id);
    if (isNew && (data[target.category] as Map<string, unknown>).has(id)) return onError(`"${id}" already exists.`);
    const payload: Draft = { id, ...changes, source, verified: checked };
    if (confirm) payload.confirmed = true;
    if (note.trim()) payload.notes = note.trim();
    try {
      await store.writeEdit(target.category, payload);
      await onSaved(`Saved ${working.name} to ${store.editsWhere(target.category)}`);
      if (andNext) {
        const next = queue.find((q) => !(q.category === target.category && q.id === id));
        onTarget(next ? { category: next.category, id: next.id } : null);
      } else onTarget({ category: target.category, id });
    } catch (e) {
      onError(`Couldn't save: ${(e as Error).message}`);
    }
  };

  const revert = async () => {
    if (!target?.id) return;
    try {
      await store.deleteEdit(target.category, target.id);
      await onSaved(`Removed my editor edits to ${target.id}`);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const stats = (draft.stats as Record<string, unknown> | undefined) ?? {};
  const basic = (draft.basic_attack as Record<string, unknown> | undefined) ?? {};
  const skill = (draft.skill as Record<string, unknown> | undefined) ?? {};

  return (
    <div className="page wide">
      <div className="stack">
        <div className="panel">
          <h2>Needs shape ({queue.length})</h2>
          <div className="list" style={{ maxHeight: 200 }}>
            {queue.map((q) => (
              <div key={`${q.category}${q.id}`} className="list-row" style={{ cursor: 'pointer' }} onClick={() => onTarget({ category: q.category, id: q.id })}>
                <span className="name">{q.name}</span>
                <span className="badge">{q.category === 'gear' ? 'gear' : 'item'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="tabs" style={{ marginBottom: 6 }}>
            {(['items', 'gear', 'pets'] as const).map((c) => (
              <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="row">
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} aria-label="Search entries" />
            <button onClick={() => onTarget({ category, id: null })}>New</button>
          </div>
          <div className="list" style={{ maxHeight: 420, marginTop: 6 }}>
            {list.map((e) => (
              <div key={e.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => onTarget({ category, id: e.id })}>
                <span className="name">{e.name}</span>
                {category === 'pets' && <span className="badge">{(e as { rarity?: string }).rarity}</span>}
                {category === 'gear' && <span className="badge">{(e as { slot?: string }).slot}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        {!target ? (
          <div className="muted">Pick an entry on the left, or click New.</div>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>
                {isNew ? `New ${target.category === 'items' ? 'item' : target.category === 'gear' ? 'gear' : 'pet'}` : String(draft.name)}{' '}
                <span className="small muted mono">{String(working.id || '')}</span>
              </h2>
              <div className="row">
                {hasEdits && <button onClick={revert}>Revert my edits</button>}
                <button className="primary" onClick={() => void save()}>
                  Save
                </button>
                {queue.length > 0 && target.category !== 'pets' && <button onClick={() => void save(true)}>Save &amp; next needing shape</button>}
              </div>
            </div>
            {entry && (
              <div className="small muted">
                From {(entry.meta as { origins: string[] }).origins.join(' + ')} · {String(entry.source)}
                {entry.verified ? ' · verified' : ' · unverified'}
              </div>
            )}
            {errors.map((e, i) => (
              <div key={i} className="field-error">
                {e}
              </div>
            ))}

            <h3>Basics</h3>
            <div className="form-grid">
              <label>Name</label>
              <input value={String(draft.name ?? '')} onChange={(e) => set('name', e.target.value)} aria-label="Name" />
              {target.category === 'items' && (
                <>
                  <label>Kind</label>
                  <select value={String(draft.kind ?? 'item')} onChange={(e) => set('kind', e.target.value)}>
                    <option value="item">shop item</option>
                    <option value="pet_spawn">pet-spawned</option>
                  </select>
                  <label>Rarity</label>
                  <select value={String(draft.rarity)} onChange={(e) => set('rarity', e.target.value)} aria-label="Rarity">
                    {ItemRarity.options.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <label>Value (gold)</label>
                  <Num label="Value" step="1" value={draft.value} onChange={(v) => set('value', v ?? 0)} />
                  <label>Class restriction</label>
                  <div className="row">
                    {CLASSES.map((c) => {
                      const cur = (draft.class_restriction as string[] | undefined) ?? [];
                      return (
                        <label key={c} className="small">
                          <input type="checkbox" checked={cur.includes(c)} onChange={(e) => set('class_restriction', e.target.checked ? [...cur, c] : cur.filter((x) => x !== c))} /> {c}
                        </label>
                      );
                    })}
                    <span className="small muted">(none = any class)</span>
                  </div>
                  <label>Hero exclusive</label>
                  <select value={String(draft.hero_exclusive ?? '')} onChange={(e) => set('hero_exclusive', e.target.value || undefined)} aria-label="Hero exclusive">
                    <option value="">—</option>
                    {[...data.heroes.values()].map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {target.category === 'gear' && (
                <>
                  <label>Slot</label>
                  <select value={String(draft.slot)} onChange={(e) => set('slot', e.target.value)}>
                    {['weapon', 'shield', 'ring', 'glove'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <label>S-rank</label>
                  <input type="checkbox" checked={!!draft.s_rank} onChange={(e) => set('s_rank', e.target.checked || undefined)} style={{ justifySelf: 'start' }} />
                </>
              )}
              {target.category !== 'pets' && (
                <>
                  <label>Tags</label>
                  <TagInput value={draft.tags} known={tags} onChange={(v) => set('tags', v)} />
                </>
              )}
              {target.category === 'pets' && (
                <>
                  <label>Rarity</label>
                  <select value={String(draft.rarity)} onChange={(e) => set('rarity', e.target.value)}>
                    {PetRarity.options.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <label>Activation cost</label>
                  <Num label="Activation cost" step="1" value={draft.activation_cost} onChange={(v) => set('activation_cost', v)} />
                  <label>Role</label>
                  <select value={String(draft.role)} onChange={(e) => set('role', e.target.value)}>
                    <option value="bag_items">puts items in the bag</option>
                    <option value="battle">battle effect</option>
                    <option value="economy">shop / merge only</option>
                  </select>
                  <label>Not simulated</label>
                  <input type="checkbox" checked={!!draft.ignored} onChange={(e) => set('ignored', e.target.checked || undefined)} style={{ justifySelf: 'start' }} />
                </>
              )}
            </div>

            {target.category !== 'pets' && (
              <>
                <h3>Shape and item dots</h3>
                <ShapeEditor footprint={draft.footprint as string | undefined} onChange={(fp) => set('footprint', fp)} image={draft.image as string | undefined} />
              </>
            )}

            {target.category === 'items' && (
              <>
                <h3>Stats</h3>
                <div className="form-grid">
                  <label>Damage</label>
                  <ScaledEditor label="Damage" rounding={rounding} value={stats.damage as Scaled | undefined} onChange={(v) => setIn('stats', 'damage', v)} />
                  <label>Cooldown (s)</label>
                  <Num label="Cooldown" value={stats.cooldown} onChange={(v) => setIn('stats', 'cooldown', v)} />
                  <label>Accuracy %</label>
                  <Num label="Accuracy" value={stats.accuracy} onChange={(v) => setIn('stats', 'accuracy', v)} />
                  <label>Crit rate %</label>
                  <Num label="Crit rate" value={stats.crit_chance} onChange={(v) => setIn('stats', 'crit_chance', v)} />
                  <label>Hits per attack</label>
                  <Num label="Hits" step="1" value={stats.hits} onChange={(v) => setIn('stats', 'hits', v)} />
                </div>
              </>
            )}

            {target.category === 'gear' && draft.slot === 'weapon' && (
              <>
                <h3>Basic attack</h3>
                <div className="form-grid">
                  <label>Damage</label>
                  <ScaledEditor label="Basic attack damage" rounding={rounding} value={basic.damage as Scaled | undefined} onChange={(v) => setIn('basic_attack', 'damage', v)} />
                  <label>Cooldown (s)</label>
                  <Num label="Basic attack cooldown" value={basic.cooldown} onChange={(v) => setIn('basic_attack', 'cooldown', v)} />
                  <label>Accuracy %</label>
                  <Num label="Basic attack accuracy" value={basic.accuracy} onChange={(v) => setIn('basic_attack', 'accuracy', v)} />
                  <label>Crit rate %</label>
                  <Num label="Basic attack crit" value={basic.crit_chance} onChange={(v) => setIn('basic_attack', 'crit_chance', v)} />
                  <label>Hits per attack</label>
                  <Num label="Basic attack hits" step="1" value={basic.hits} onChange={(v) => setIn('basic_attack', 'hits', v)} />
                </div>
              </>
            )}

            <h3>Effects</h3>
            {target.category === 'items' && (
              <>
                <textarea className="code" style={{ minHeight: 60 }} aria-label="Effect text" value={String(draft.effect_text ?? '')} onChange={(e) => set('effect_text', e.target.value)} />
                <div className="small muted">Scaled effect values (YAML), e.g. block: {'{'} ratio: 0.04, scales_with: hp {'}'}</div>
                <YamlField label="Effect values" value={draft.effect_values} onChange={(v) => set('effect_values', v)} />
              </>
            )}
            {target.category === 'gear' && (
              <div className="form-grid">
                <label>Skill</label>
                <textarea className="code" style={{ minHeight: 40 }} value={String((draft.skill as { text?: string } | undefined)?.text ?? '')} onChange={(e) => setIn('skill', 'text', e.target.value || undefined)} />
                {draft.slot === 'weapon' && (
                  <>
                    <label>Skill damage</label>
                    <ScaledEditor label="Skill damage" rounding={rounding} value={skill.damage as Scaled | undefined} onChange={(v) => setIn('skill', 'damage', v)} />
                    <label>Skill: every N s</label>
                    <Num label="Skill interval" value={skill.interval_s} onChange={(v) => setIn('skill', 'interval_s', v)} />
                    <label>Skill Gauge (charges to 100%)</label>
                    <input type="checkbox" checked={!!skill.gauge} onChange={(e) => setIn('skill', 'gauge', e.target.checked || undefined)} style={{ justifySelf: 'start' }} aria-label="Skill gauge" />
                    <label>Skill hits</label>
                    <Num label="Skill hits" step="1" value={skill.hits} onChange={(v) => setIn('skill', 'hits', v)} />
                    <label>Skill always hits</label>
                    <input type="checkbox" checked={!!skill.always_hit} onChange={(e) => setIn('skill', 'always_hit', e.target.checked || undefined)} style={{ justifySelf: 'start' }} aria-label="Skill always hits" />
                  </>
                )}
                <label>Gear effect</label>
                <textarea className="code" style={{ minHeight: 40 }} value={String(draft.gear_effect_text ?? '')} onChange={(e) => set('gear_effect_text', e.target.value)} />
                <label title='e.g. - { min_rarity: epic, footprint: "oo#oo" }'>Footprint from a rarity up (YAML)</label>
                <YamlField label="Rarity footprints" value={draft.rarity_footprints} placeholder='- { min_rarity: epic, footprint: "oo#oo" }' onChange={(v) => set('rarity_footprints', v)} />
                <label>Effects by rarity (YAML)</label>
                <YamlField label="Rarity effects" value={draft.rarity_effects} onChange={(v) => set('rarity_effects', v)} />
              </div>
            )}
            {target.category === 'pets' && (
              <div className="form-grid">
                <label>Skill name</label>
                <input value={String((draft.skill as { name?: string }).name ?? '')} onChange={(e) => setIn('skill', 'name', e.target.value)} />
                <label>Skill text</label>
                <textarea className="code" style={{ minHeight: 40 }} value={String((draft.skill as { text?: string }).text ?? '')} onChange={(e) => setIn('skill', 'text', e.target.value)} />
                <label>Star effects (YAML)</label>
                <YamlField label="Star effects" value={draft.star_effects} onChange={(v) => set('star_effects', v ?? [])} placeholder="- { stars: 1, text: ..., activation_cost_delta: -1 }" />
                <label>Puts in the bag (YAML)</label>
                <YamlField label="Spawns" value={draft.spawns} onChange={(v) => set('spawns', v ?? [])} placeholder="- { item: poison_bug_egg, count: 15, stars: 0 }" />
              </div>
            )}
            {target.category !== 'pets' && (
              <>
                <div className="small muted">Structured effects (YAML, SPEC §5.2)</div>
                <YamlField label="Structured effects" value={draft.effects} onChange={(v) => set('effects', v ?? [])} placeholder="- { trigger: battle_start, uses_dots: true, target: items_under_dots, action: add_stat_pct, stat: haste_pct, amount: 15 }" />
                <div className="row small">
                  <label className="muted">Effects cover the text:</label>
                  <select value={String(draft.effects_status ?? '')} onChange={(e) => set('effects_status', e.target.value || undefined)}>
                    <option value="">not at all</option>
                    <option value="partial">partly</option>
                    <option value="complete">completely</option>
                  </select>
                </div>
              </>
            )}

            <h3>Where this comes from</h3>
            <div className="form-grid">
              <label>Source of my changes</label>
              <select value={source} onChange={(e) => setSource(e.target.value as 'observed' | 'manual')}>
                <option value="observed">observed in-game</option>
                <option value="manual">manual (my decision)</option>
              </select>
              <label>I checked these values</label>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ justifySelf: 'start' }} />
              {!isNew && (
                <>
                  <label>Mark the whole entry verified</label>
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ justifySelf: 'start' }} />
                </>
              )}
              <label>Note</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. checked at 6.9M HP" />
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {changed.length ? `Will save: ${changed.join(', ')}` : confirm ? 'Will mark the entry verified.' : 'No changes yet.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
