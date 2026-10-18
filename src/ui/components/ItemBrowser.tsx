/**
 * Item browser (SPEC §8): shop items, gear and pet spawns with search and filters, and a tab with the
 * starting equipment the build's hero can bring (against its Supply Ability).
 */
import { useMemo, useState } from 'react';
import type { GameData } from '../../engine/loader';
import { CLASSES, RARITIES } from '../../engine/model';
import type { AvailableSupply } from '../../engine/validate';
import { type BrowserEntry, type BrowserFilter, EMPTY_FILTER, allTags, browserEntries, filterEntries } from '../state/browser';
import { DRAG_ITEM, rarityColor } from './BagGrid';
import { imageUrl } from '../staticData';

export interface StartingEquipment {
  heroName: string | null;
  used: number;
  capacity: number;
  available: AvailableSupply[];
  /** Ids already in the bag (one of each). */
  inBag: ReadonlySet<string>;
  onAdd: (s: AvailableSupply) => void;
}

interface Props {
  data: GameData;
  /** Ids of starting equipment available to the build's hero. */
  supplyIds: ReadonlySet<string>;
  onPick: (entry: BrowserEntry) => void;
  onEdit: (entry: BrowserEntry) => void;
  /** Show the monster items made in the enemy item editor (only while building an enemy). */
  showEnemyItems?: boolean;
  /** The starting equipment tab (left out: no tab). */
  starting?: StartingEquipment;
}

function Icon({ def, kind }: { def: BrowserEntry['def']; kind: string }) {
  const src = kind === 'gear' && 'icon' in def && def.icon ? def.icon : 'image' in def && def.image ? def.image : null;
  return <span className="icon">{src ? <img src={imageUrl(src)} alt="" draggable={false} /> : null}</span>;
}

export function ItemBrowser({ data, supplyIds, onPick, onEdit, showEnemyItems = false, starting }: Props) {
  const [tab, setTab] = useState<'items' | 'starting'>('items');
  const [f, setF] = useState<BrowserFilter>(EMPTY_FILTER);
  const [startText, setStartText] = useState('');
  const entries = useMemo(
    () => browserEntries(data).filter((e) => showEnemyItems || !(e.kind !== 'gear' && data.items.get(e.id)?.enemy_item)),
    [data, showEnemyItems],
  );
  const tags = useMemo(() => allTags(entries), [entries]);
  const shown = useMemo(() => filterEntries(entries, f, supplyIds), [entries, f, supplyIds]);
  const set = (patch: Partial<BrowserFilter>) => setF((x) => ({ ...x, ...patch }));
  const heroName = (id: string) => data.heroes.get(id)?.name ?? id;
  const onStart = tab === 'starting' && !!starting;

  return (
    <>
      {starting && (
        <div className="tabs" role="tablist" aria-label="Which items" style={{ marginBottom: 6 }}>
          <button role="tab" aria-selected={!onStart} className={!onStart ? 'active' : ''} onClick={() => setTab('items')}>
            Shop items
          </button>
          <button role="tab" aria-selected={onStart} className={onStart ? 'active' : ''} onClick={() => setTab('starting')}>
            Starting equipment {starting.heroName ? `${starting.used}/${starting.capacity}` : ''}
          </button>
        </div>
      )}
      {onStart ? (
        <StartingList s={starting} text={startText} setText={setStartText} />
      ) : (
        <>
          <div className="filters">
            <input placeholder="Search by name…" value={f.text} onChange={(e) => set({ text: e.target.value })} aria-label="Search items" />
            <select value={f.kind === 'supply' ? '' : f.kind} onChange={(e) => set({ kind: e.target.value as BrowserFilter['kind'] })} aria-label="Kind">
              <option value="">All kinds</option>
              <option value="item">Shop items</option>
              <option value="gear">Gear</option>
              <option value="pet_spawn">Pet-spawned</option>
            </select>
            <select value={f.cls} onChange={(e) => set({ cls: e.target.value })} aria-label="Class">
              <option value="">Any class</option>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={f.rarity} onChange={(e) => set({ rarity: e.target.value })} aria-label="Rarity">
              <option value="">Any rarity</option>
              {RARITIES.slice(0, 5).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select value={f.tag} onChange={(e) => set({ tag: e.target.value })} aria-label="Tag">
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={f.hero} onChange={(e) => set({ hero: e.target.value })} aria-label="Hero" style={{ gridColumn: '1 / -1' }}>
              <option value="">Any hero (exclusive items)</option>
              {[...data.heroes.values()].map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} exclusives
                </option>
              ))}
            </select>
          </div>
          <div className="small muted">
            {shown.length} of {entries.length}. Drag one onto the bag, or click it and place it with the arrow keys.
          </div>
          <div className="list">
            {shown.map((e) => (
              <div
                key={`${e.kind}:${e.id}`}
                className="list-row"
                draggable={!e.needsShape}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(DRAG_ITEM, e.id);
                  ev.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => (e.needsShape ? onEdit(e) : onPick(e))}
                title={`${e.name}\n${'effect_text' in e.def ? e.def.effect_text || e.def.flavor : e.def.gear_effect_text}`}
              >
                <span className="swatch" style={{ background: rarityColor(e.rarity, e.kind === 'gear') }} />
                <Icon def={e.def} kind={e.kind} />
                <span className="name">{e.name}</span>
                {e.kind === 'gear' && <span className="badge">gear{'s_rank' in e.def && e.def.s_rank ? ' ⭐S' : ''}</span>}
                {e.kind === 'pet_spawn' && <span className="badge">pet</span>}
                {e.classes.length > 0 && <span className="badge class">{e.classes.join('/')}</span>}
                {e.hero && <span className="badge class">🔒{heroName(e.hero)}</span>}
                {supplyIds.has(e.id) && (
                  <span className="badge" title="Can also be brought as starting equipment">
                    starting eq.
                  </span>
                )}
                {e.needsShape && <span className="badge err">needs shape</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Starting equipment the hero can bring: one of each, within its Supply Ability. */
function StartingList({ s, text, setText }: { s: StartingEquipment; text: string; setText: (t: string) => void }) {
  if (!s.heroName) return <div className="small muted">Pick the build's hero (Hero box) to see their starting equipment.</div>;
  const q = text.trim().toLowerCase();
  const list = s.available.filter((a) => !q || a.item.name.toLowerCase().includes(q));
  return (
    <>
      <div className="small">
        {s.heroName}: {s.used} / {s.capacity} Supply points
      </div>
      <div className={`meter${s.used > s.capacity ? ' over' : ''}`}>
        <div style={{ width: `${Math.min(100, (s.used / Math.max(1, s.capacity)) * 100)}%` }} />
      </div>
      <input placeholder="Search starting equipment…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search starting equipment" style={{ width: '100%', margin: '6px 0' }} />
      <div className="list">
        {s.available.length === 0 && (
          <div className="muted small" style={{ padding: 6 }}>
            Nothing unlocked for this class yet (hero stars unlock starting equipment).
          </div>
        )}
        {list.map((a) => {
          const inBag = s.inBag.has(a.item.id);
          const over = s.used + a.cost > s.capacity;
          const blocked = inBag ? 'Already in the bag (one of each)' : over ? 'Would go over the Supply Ability' : a.item.shape === null ? 'Needs a shape (Item editor)' : null;
          return (
            <div
              key={a.item.id}
              className={`list-row${blocked ? ' blocked' : ''}`}
              role="button"
              aria-disabled={!!blocked}
              title={`${a.item.name}: ${blocked ?? 'click to put it in the bag'}\nUnlocked by ${a.unlockedBy.join(', ')}`}
              onClick={() => !blocked && s.onAdd(a)}
            >
              <span className="swatch" style={{ background: rarityColor(a.item.rarity, false) }} />
              <Icon def={a.item} kind="item" />
              <span className="name">{a.item.name}</span>
              {inBag && <span className="badge">in bag</span>}
              <span className="small muted">{a.cost} pt</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
