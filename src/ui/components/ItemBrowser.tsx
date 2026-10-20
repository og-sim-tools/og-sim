/**
 * Item browser (SPEC §8): shop items and pet spawns with search, filters and a Sort menu, and a tab with the
 * starting equipment the build's hero can bring (against its Supply Ability), with the same filters. Gear
 * isn't listed: it's put in the bag from the Gear box. Click an item to put it in the bag, or drag it.
 */
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { footprintOf, placeFootprint } from '../../engine/bag';
import type { GameData, Item } from '../../engine/loader';
import { CLASSES, RARITIES } from '../../engine/model';
import type { AvailableSupply } from '../../engine/validate';
import { type BrowserEntry, type BrowserFilter, type BrowserSort, EMPTY_FILTER, allTags, browserEntries, filterEntries, nameMatches, sortEntries } from '../state/browser';
import { rarityColor } from './BagGrid';
import { beginDrag, dragJustEnded } from '../drag';
import { imageUrl } from '../staticData';

export interface StartingEquipment {
  heroName: string | null;
  used: number;
  capacity: number;
  available: AvailableSupply[];
  /** Ids already in the bag (one of each). */
  inBag: ReadonlySet<string>;
  onAdd: (s: AvailableSupply) => void;
  /** Take it out of the bag. */
  onRemove?: (itemId: string) => void;
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
  /** The build's hero's class: the class filter follows it until it's changed by hand (user, 2026-10-20). */
  heroClass?: string | null;
}

const ITEM_RARITIES = RARITIES.slice(0, 5);

function Icon({ def, kind }: { def: BrowserEntry['def']; kind: string }) {
  const src = kind === 'gear' && 'icon' in def && def.icon ? def.icon : 'image' in def && def.image ? def.image : null;
  return <span className="icon">{src ? <img src={imageUrl(src)} alt="" draggable={false} /> : null}</span>;
}

/** Pick an item up from a list (held by its first cell); a press that doesn't move is a click. */
const dragFromList = (ev: PointerEvent, item: { id: string }, supply = false) =>
  beginDrag(ev, { kind: 'item', id: item.id, item: item.id, rotation: 0, grab: 0, inCell: { x: 0.5, y: 0.5 }, scope: 'build', ...(supply ? { supply: true } : {}) });

/** The list's order and rarity filter (rarity sorts common → legendary; hovering it offers one rarity only). */
interface Order {
  sort: BrowserSort;
  rarity: string;
}

const orderLabel = (o: Order) =>
  o.rarity ? `${o.rarity[0]!.toUpperCase()}${o.rarity.slice(1)} only` : o.sort === 'value' ? 'Value (low → high)' : o.sort === 'rarity' ? 'Rarity (common → legendary)' : 'Alphabetical';

/** Sort menu: Alphabetical, Value, Rarity (click: all, common → legendary; hover or ▸: one rarity only). */
export function SortMenu({ value, onChange }: { value: Order; onChange: (o: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (o: Order) => {
    onChange(o);
    setOpen(false);
    setSub(false);
  };
  const isOn = (o: Order) => o.sort === value.sort && o.rarity === value.rarity;
  return (
    <div className="sort-menu" ref={box}>
      <button
        className="sort-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sort: ${orderLabel(value)}`}
        onClick={() => {
          setOpen((x) => !x);
          setSub(false);
        }}
      >
        <span className="muted">Sort:</span> {orderLabel(value)} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Sort">
          <button role="menuitemradio" aria-checked={isOn({ sort: 'name', rarity: '' })} onMouseEnter={() => setSub(false)} onClick={() => pick({ sort: 'name', rarity: '' })}>
            Alphabetical
          </button>
          <button role="menuitemradio" aria-checked={isOn({ sort: 'value', rarity: '' })} onMouseEnter={() => setSub(false)} onClick={() => pick({ sort: 'value', rarity: '' })}>
            Value (low → high)
          </button>
          <div className="menu-row" onMouseEnter={() => setSub(true)}>
            <button role="menuitemradio" aria-checked={value.sort === 'rarity'} onClick={() => pick({ sort: 'rarity', rarity: '' })}>
              Rarity (common → legendary)
            </button>
            <button className="sub-arrow" aria-label="One rarity only" aria-haspopup="menu" aria-expanded={sub} onClick={() => setSub((x) => !x)}>
              ▸
            </button>
            {sub && (
              <div className="menu submenu" role="menu" aria-label="Rarity">
                <button role="menuitemradio" aria-checked={isOn({ sort: 'rarity', rarity: '' })} onClick={() => pick({ sort: 'rarity', rarity: '' })}>
                  All, common → legendary
                </button>
                {ITEM_RARITIES.map((r) => (
                  <button key={r} role="menuitemradio" aria-checked={value.rarity === r} onClick={() => pick({ sort: 'rarity', rarity: r })}>
                    <span className="swatch" style={{ background: rarityColor(r) }} /> {r[0]!.toUpperCase() + r.slice(1)} only
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Search, kind, class, tag and hero filters with the Sort menu (the starting equipment tab leaves some out). */
function Filters({ f, set, tags, data, kinds = true, heroes = true }: { f: BrowserFilter & Order; set: (patch: Partial<BrowserFilter & Order> & { clsByHand?: boolean }) => void; tags: string[]; data: GameData; kinds?: boolean; heroes?: boolean }) {
  return (
    <div className="filters">
      <input placeholder="Search by name…" value={f.text} onChange={(e) => set({ text: e.target.value })} aria-label={kinds ? 'Search items' : 'Search starting equipment'} />
      {kinds && (
        <select value={f.kind === 'supply' ? '' : f.kind} onChange={(e) => set({ kind: e.target.value as BrowserFilter['kind'] })} aria-label="Kind">
          <option value="">All kinds</option>
          <option value="item">Shop items</option>
          <option value="pet_spawn">Pet-spawned</option>
        </select>
      )}
      <select value={f.cls} onChange={(e) => set({ cls: e.target.value, clsByHand: true })} aria-label="Class">
        <option value="">Any class</option>
        {CLASSES.map((c) => (
          <option key={c} value={c}>
            {c}
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
      <SortMenu value={{ sort: f.sort, rarity: f.rarity }} onChange={(o) => set(o)} />
      {heroes && (
        <select value={f.hero} onChange={(e) => set({ hero: e.target.value })} aria-label="Hero" style={{ gridColumn: '1 / -1' }}>
          <option value="">Any hero (exclusive items)</option>
          {[...data.heroes.values()].map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} exclusives
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const START: BrowserFilter & Order = { ...EMPTY_FILTER, sort: 'name' };

/** The searches and filters, kept in this browser over reloads and tab changes (user, 2026-10-20). */
const SEARCH_KEY = 'og-sim/item-search';
interface SavedSearch {
  tab: 'items' | 'starting';
  f: BrowserFilter & Order;
  sf: BrowserFilter & Order;
  /** The class was picked by hand (else it follows the hero's). */
  manual: boolean;
}
function loadSearch(): SavedSearch | null {
  try {
    const s = JSON.parse(localStorage.getItem(SEARCH_KEY) ?? 'null') as SavedSearch | null;
    return s && typeof s === 'object' && s.f && s.sf ? { tab: s.tab === 'starting' ? 'starting' : 'items', f: { ...START, ...s.f }, sf: { ...START, ...s.sf }, manual: !!s.manual } : null;
  } catch {
    return null;
  }
}

export function ItemBrowser({ data, supplyIds, onPick, onEdit, showEnemyItems = false, starting, heroClass = null }: Props) {
  const saved = useMemo(loadSearch, []);
  const [tab, setTab] = useState<'items' | 'starting'>(saved?.tab ?? 'items');
  const [f, setF] = useState<BrowserFilter & Order>(() => ({ ...(saved?.f ?? START), ...(saved?.manual ? {} : { cls: heroClass ?? '' }) }));
  const [sf, setSf] = useState<BrowserFilter & Order>(() => ({ ...(saved?.sf ?? START), ...(saved?.manual ? {} : { cls: heroClass ?? '' }) }));
  // The class filter follows the hero's class (items for any class always show) until it's picked by hand.
  const manualCls = useRef(saved?.manual ?? false);
  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_KEY, JSON.stringify({ tab, f, sf, manual: manualCls.current } satisfies SavedSearch));
    } catch {
      /* a convenience only */
    }
  }, [tab, f, sf]);
  useEffect(() => {
    if (manualCls.current) return;
    setF((x) => ({ ...x, cls: heroClass ?? '' }));
    setSf((x) => ({ ...x, cls: heroClass ?? '' }));
  }, [heroClass]);
  // Gear isn't listed: the Gear box puts it in the bag.
  const entries = useMemo(
    () => browserEntries(data).filter((e) => e.kind !== 'gear' && (showEnemyItems || !data.items.get(e.id)?.enemy_item)),
    [data, showEnemyItems],
  );
  const tags = useMemo(() => allTags(entries), [entries]);
  const shown = useMemo(() => sortEntries(filterEntries(entries, f, supplyIds), f.sort), [entries, f, supplyIds]);
  const set = ({ clsByHand, ...patch }: Partial<BrowserFilter & Order> & { clsByHand?: boolean }) => {
    if (clsByHand) manualCls.current = true;
    setF((x) => ({ ...x, ...patch }));
  };
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
        <StartingList
          s={starting}
          f={sf}
          set={({ clsByHand, ...patch }) => {
            if (clsByHand) manualCls.current = true;
            setSf((x) => ({ ...x, ...patch }));
          }}
          data={data}
        />
      ) : (
        <>
          <Filters f={f} set={set} tags={tags} data={data} />
          <div className="small muted">
            {shown.length} of {entries.length}. Click one to put it in the bag, or drag it onto the bag or the storage.
          </div>
          <div className="list">
            {shown.map((e) => (
              <div
                key={`${e.kind}:${e.id}`}
                className="list-row"
                onPointerDown={(ev) => !e.needsShape && dragFromList(ev, e)}
                onClick={() => !dragJustEnded() && (e.needsShape ? onEdit(e) : onPick(e))}
                title={`${e.name}\n${'effect_text' in e.def ? e.def.effect_text || e.def.flavor : e.def.gear_effect_text}`}
              >
                <span className="swatch" style={{ background: rarityColor(e.rarity, e.kind === 'gear') }} />
                <Icon def={e.def} kind={e.kind} />
                <span className="name">{e.name}</span>
                {e.kind === 'pet_spawn' && <span className="badge">pet</span>}
                {e.classes.length > 0 && <span className="badge class">{e.classes.join('/')}</span>}
                {e.hero && <span className="badge class">🔒{heroName(e.hero)}</span>}
                {supplyIds.has(e.id) && (
                  <span className="badge" title="Can also be brought as starting equipment">
                    starting eq.
                  </span>
                )}
                {f.sort === 'value' && <span className="small muted">{e.value ?? '?'}</span>}
                {e.needsShape && <span className="badge err">needs shape</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Starting equipment the hero can bring: one of each, within its Supply Ability. Same filters as the shop items. */
function StartingList({ s, f, set, data }: { s: StartingEquipment; f: BrowserFilter & Order; set: (patch: Partial<BrowserFilter & Order> & { clsByHand?: boolean }) => void; data: GameData }) {
  const entries = useMemo(
    () =>
      s.available.map((a) => ({
        a,
        id: a.item.id,
        name: a.item.name,
        kind: 'item' as const,
        rarity: a.item.rarity,
        tags: a.item.tags,
        classes: a.item.class_restriction,
        hero: a.item.hero_exclusive ?? null,
        value: a.item.value_unknown ? null : a.item.value,
      })),
    [s.available],
  );
  const tags = useMemo(() => [...new Set(entries.flatMap((e) => e.tags))].sort(), [entries]);
  if (!s.heroName) return <div className="small muted">Pick the build's hero (Hero box) to see their starting equipment.</div>;
  const text = f.text.trim().toLowerCase();
  const sorted = sortEntries(
    entries.filter(
      (e) =>
        nameMatches(e.name, text, e.id) &&
        (!f.cls || e.classes.length === 0 || (e.classes as string[]).includes(f.cls)) &&
        (!f.rarity || e.rarity === f.rarity) &&
        (!f.tag || e.tags.includes(f.tag)),
    ),
    f.sort,
  );
  // What's in the bag first.
  const list = [...sorted.filter((e) => s.inBag.has(e.id)), ...sorted.filter((e) => !s.inBag.has(e.id))];
  const inUse = entries.filter((e) => s.inBag.has(e.id));
  return (
    <>
      <div className="small">
        {s.heroName}: {s.used} / {s.capacity} Supply points
      </div>
      <div className={`meter${s.used > s.capacity ? ' over' : ''}`}>
        <div style={{ width: `${Math.min(100, (s.used / Math.max(1, s.capacity)) * 100)}%` }} />
      </div>
      <div className="small in-use" aria-label="In use">
        In use: {inUse.length ? inUse.map((e) => e.name).join(', ') : <span className="muted">nothing yet</span>}
      </div>
      <Filters f={f} set={set} tags={tags} data={data} kinds={false} heroes={false} />
      <div className="small muted">
        {list.length} of {entries.length}. Click one to put it in the bag, or drag it.
      </div>
      <div className="list">
        {s.available.length === 0 && (
          <div className="muted small" style={{ padding: 6 }}>
            Nothing unlocked for this class yet (hero stars unlock starting equipment).
          </div>
        )}
        {list.map(({ a }) => {
          const inBag = s.inBag.has(a.item.id);
          const over = s.used + a.cost > s.capacity;
          const blocked = inBag ? 'Already in the bag (one of each)' : over ? 'Would go over the Supply Ability' : a.item.shape === null ? 'Needs a shape (Item editor)' : null;
          return (
            <div
              key={a.item.id}
              className={`list-row${inBag ? ' in-bag' : blocked ? ' blocked' : ''}`}
              role="button"
              aria-disabled={!!blocked}
              title={`${a.item.name}: ${blocked ?? 'click to put it in the bag'}\nUnlocked by ${a.unlockedBy.join(', ')}`}
              onPointerDown={(ev) => !blocked && dragFromList(ev, a.item, true)}
              onClick={() => !blocked && !dragJustEnded() && s.onAdd(a)}
            >
              <span className="swatch" style={{ background: rarityColor(a.item.rarity, false) }} />
              <Icon def={a.item} kind="item" />
              <span className="name">{a.item.name}</span>
              {inBag && <span className="badge ok">✓ in use</span>}
              <span className="small muted">{a.cost} pt</span>
              {inBag && s.onRemove && (
                <button
                  className="small"
                  aria-label={`Take ${a.item.name} out of the bag`}
                  title="Take it out of the bag"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    s.onRemove!(a.item.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
