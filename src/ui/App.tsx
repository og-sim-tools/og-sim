/** Overgeared Hero backpack simulator — local web UI (SPEC §8). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stringify } from 'yaml';
import { type Rotation, findFirstFit, footprintOf, isUsable, occupantsAt, placeFootprint } from '../engine/bag';
import { buildSynergyReport } from '../engine/effects/synergy';
import { type GameData, type Gear, type Item, loadGameData, loadProfile } from '../engine/loader';
import { applySetup, setupFromProfile } from '../engine/layoutSetup';
import { buildLoadout, buildValue, nextGearDef } from '../engine/loadout';
import type { EnemyBuild, LayoutData, Profile } from '../engine/model';
import { type SaveNote, accountToProfile, profileToAccount, readAccount, readBuild, writeAccount, writeBuild } from '../engine/saves';
import { aggregateStats } from '../engine/stats';
import { availableSupplies, supplySummary, validateLoadout } from '../engine/validate';
import { type Snapshot, downloadText } from './api';
import { Dialog } from './components/Dialog';
import { type SaveStore, StoreContext, fileStore, lastBuild, readDraft, writeDraft } from './saves';
import { type AccountImport, accountArchive, downloadBytes, looksLikeBuild, readAccountArchive } from './state/accountArchive';
import { unzipFiles } from './state/zip';
import { safeBuildName } from '../engine/saves/names';
import { BagGrid, type Ghost, rarityColor, spriteOf } from './components/BagGrid';
import { ItemDrawer } from './components/ItemDrawer';
import { battleStartStats } from '../engine/combat/battle';
import { resolveEnemy } from '../engine/combat/montecarlo';
import { BattlePanel } from './components/BattlePanel';
import { DataPanel } from './components/DataPanel';
import { EnemyItemEditor } from './components/EnemyItemEditor';
import { ItemBrowser } from './components/ItemBrowser';
import { type EditTarget, ItemEditor } from './components/ItemEditor';
import { BuildPicker } from './components/BuildPicker';
import { Panel } from './components/Panel';
import { BuildStats, GearEditor, HeroEditor, PetsEditor, SkinsEditor, petPoints } from './components/SetupEditors';
import { OptimizePanel } from './components/OptimizePanel';
import { ProfileEditor } from './components/ProfileEditor';
import { IssuesPanel, ItemStats } from './components/StatsPanel';
import { itemWorth } from './state/worth';
import { buildDataRefs, buildFlags } from './state/dataFlags';
import { Guide, guideDone } from './components/Guide';
import {
  type KeyAction,
  type UiLayout,
  addPlacement,
  moveBy,
  removePlacement,
  rotateCw,
  updatePlacement,
  withIds,
} from './state/layoutOps';

type Tab = 'bag' | 'optimize' | 'profile' | 'editor' | 'data';
type InlineEnemy = Exclude<NonNullable<NonNullable<LayoutData['battle']>['enemy']>, string>;

interface Pending {
  item: string;
  x: number;
  y: number;
  rotation: Rotation;
  supply: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  basic_stats: { hp: '1M', atk: '100K', initial_block: 0 },
  detailed_stats: {},
  heroes: [],
  active_hero: null,
  gear: { weapon: null, shield: null, rings: [], gloves: [] },
  pets: [],
  aura: null,
  auras: [],
  skins: [],
  equipped_skins: [],
  skin_quests_done: [],
};

const FULL_MASK = () => new Array(48).fill(1) as number[];
type Raw = Record<string, unknown>;

/** The account-wide part of a profile, normalised (heroes' stars and links, auras). */
const accountOf = (p: Profile): Profile => accountToProfile(profileToAccount(p));

export function App({ store: givenStore }: { store?: SaveStore } = {}) {
  const store = useMemo(() => givenStore ?? fileStore(), [givenStore]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('bag');
  /** The account: heroes I own with stars and links, auras. Saved automatically. */
  const [account, setAccount] = useState<Profile | null>(null);
  /** The version-1 profile the account came from (older builds are completed from it). */
  const [migratedFromV1, setMigratedFromV1] = useState<Raw | null>(null);
  const v1Ref = useRef<Raw | null>(null);
  v1Ref.current = migratedFromV1;
  /** The account text last saved (or loaded), so only real changes are written. */
  const savedAccount = useRef<string | null>(null);
  const [builds, setBuilds] = useState<string[]>([]);
  /** What loading or importing a file had to change or drop. */
  const [notice, setNotice] = useState<{ title: string; notes: SaveNote[] } | null>(null);
  const [importing, setImporting] = useState<(AccountImport & { file: string; replaceAccount: boolean }) | null>(null);
  const [layout, setLayout] = useState<UiLayout>({ placements: [] });
  const [layoutName, setLayoutName] = useState('');
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** The item whose side panel is open: only set by clicking it. */
  const [inspected, setInspected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [maskEdit, setMaskEdit] = useState(false);
  const [enhanceEdit, setEnhanceEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean; action?: { label: string; run: () => void } } | null>(null);
  /** Whose build the Bag and Profile tabs edit: mine, or the typed-in enemy's (when it has a build). */
  const [side, setSide] = useState<'me' | 'enemy'>('me');
  /** Item editor tab: the game's data, or monster items for enemies. */
  const [editorMode, setEditorMode] = useState<'game' | 'enemy'>('game');
  /** The Data tab opened from the Battle tab's note: only what this build uses. */
  const [dataFocus, setDataFocus] = useState(false);
  const [showGuide, setShowGuide] = useState(() => !guideDone.get());

  const say = (text: string, error = false, action?: { label: string; run: () => void }) => setMessage({ text, error, ...(action ? { action } : {}) });
  /** Show what loading a file had to change; info-only notes are shown too (they explain an upgrade). */
  const showNotes = (title: string, notes: SaveNote[]) => setNotice(notes.length ? { title, notes } : null);

  // ---------------------------------------------------------------- loading
  const loaded = useMemo(() => (snap ? loadGameData(snap.data) : null), [snap]);
  const data: GameData | null = loaded?.data ?? null;

  const refresh = useCallback(async () => {
    try {
      setSnap({ data: await store.readData(), profile: null, layouts: [] });
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [store]);

  /** A saved build as the app uses it (any file version). */
  const loadBuild = useCallback(
    async (name: string) => {
      const r = readBuild(await store.readBuild(name), { v1Profile: v1Ref.current }, `"${name}"`);
      return { layout: withIds(r.layout), notes: r.notes };
    },
    [store],
  );

  const openLayout = useCallback(
    async (name: string) => {
      try {
        const r = await loadBuild(name);
        // Loading a build only changes MY build: the enemy (battle settings) already set up stays, so I can
        // pair any build of mine with any enemy. The first load (nothing set up yet) takes the file's battle too.
        setLayout((cur) => (cur.battle ? { ...r.layout, battle: cur.battle } : r.layout));
        setLayoutName(name);
        setLayoutDirty(false);
        lastBuild.set(name);
        setSelected(null);
        setPending(null);
        showNotes(`Loaded "${name}"`, r.notes);
      } catch (e) {
        say(`Couldn't load "${name}": ${(e as Error).message}`, true);
      }
    },
    [loadBuild],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First load: the account, then my unsaved changes if I left any, else the last build I had open (or the example).
  const started = useRef(false);
  useEffect(() => {
    if (!snap || !data || started.current) return;
    started.current = true;
    void (async () => {
      const draft = readDraft();
      let acc = readAccount(null);
      try {
        acc = readAccount(await store.readAccount());
      } catch (e) {
        say(`Couldn't read ${store.where()}: ${(e as Error).message}`, true);
      }
      v1Ref.current = acc.migratedFromV1;
      setMigratedFromV1(acc.migratedFromV1);
      savedAccount.current = writeAccount(acc.profile, acc.migratedFromV1);
      const names = await store.listBuilds().catch(() => [] as string[]);
      setBuilds(names);
      const notes = [...acc.notes];
      if (draft) {
        const r = readBuild(draft.text, { v1Profile: acc.migratedFromV1 }, 'Your unsaved changes');
        notes.push(...r.notes);
        setLayout(withIds(r.layout));
        setLayoutName(draft.name);
        setLayoutDirty(true);
        const when = draft.at ? new Date(draft.at).toLocaleString() : 'earlier';
        say(`Brought back your unsaved changes${draft.name ? ` to "${draft.name}"` : ''} (${when}).`, false, {
          label: 'Discard them',
          run: () => {
            writeDraft(null);
            if (draft.name && names.includes(draft.name)) void openLayout(draft.name);
            else {
              setLayout({ placements: [], setup: setupFromProfile(DEFAULT_PROFILE) });
              setLayoutName('');
              setLayoutDirty(false);
            }
            setMessage(null);
          },
        });
      } else {
        const last = lastBuild.get();
        const pick = last && names.includes(last) ? last : names.includes('example') ? 'example' : null;
        if (pick) await openLayout(pick);
      }
      showNotes('Your saved files were updated to the new format', notes);
      setAccount(acc.profile);
    })();
  }, [snap, data, store, openLayout]);

  // The account saves itself (it's the same for every build).
  const accountText = useMemo(() => (account ? writeAccount(account, migratedFromV1) : null), [account, migratedFromV1]);
  useEffect(() => {
    if (!accountText || savedAccount.current === null || accountText === savedAccount.current) return;
    const t = setTimeout(() => {
      store
        .writeAccount(accountText)
        .then(() => void (savedAccount.current = accountText))
        .catch((e: Error) => say(`Couldn't save the account to ${store.where()}: ${e.message}`, true));
    }, 400);
    return () => clearTimeout(t);
  }, [accountText, store]);

  // Unsaved build changes are kept in this browser, so closing the tab doesn't lose them.
  useEffect(() => {
    if (!account) return;
    if (!layoutDirty) return writeDraft(null);
    const t = setTimeout(() => writeDraft({ name: layoutName, text: writeBuild(layout), at: new Date().toISOString() }), 300);
    return () => clearTimeout(t);
  }, [account, layout, layoutDirty, layoutName]);

  // Closing or reloading the tab with unsaved build changes asks first (the browser's own "Leave site?" box).
  useEffect(() => {
    if (!layoutDirty) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [layoutDirty]);

  /** My profile as the engine uses it: the account with this build's setup put in. */
  const profile = useMemo(() => (account ? applySetup(account, layout.setup) : null), [account, layout.setup]);

  // ---------------------------------------------------------------- derived
  // The enemy's build (when the typed-in enemy has one) is edited with the same Bag / Profile tabs.
  const inlineEnemy: InlineEnemy | null = typeof layout.battle?.enemy === 'object' ? layout.battle.enemy : null;
  const enemyBuild = inlineEnemy?.build ?? null;
  const editingEnemy = side === 'enemy' && !!enemyBuild;
  const bagLayout: UiLayout = useMemo(
    () => (editingEnemy && enemyBuild ? withIds({ placements: enemyBuild.placements, bag: enemyBuild.bag, enhanced_cells: enemyBuild.enhanced_cells }) : layout),
    [editingEnemy, enemyBuild, layout],
  );
  const bagProfile: Profile | null = editingEnemy && enemyBuild ? enemyBuild.profile : profile;
  const playerLoadout = useMemo(() => (data && profile ? buildLoadout(data, profile, layout) : null), [data, profile, layout]);
  const loadout = useMemo(
    () => (editingEnemy ? (data && bagProfile ? buildLoadout(data, bagProfile, bagLayout) : null) : playerLoadout),
    [editingEnemy, data, bagProfile, bagLayout, playerLoadout],
  );
  const issues = useMemo(() => (loadout ? validateLoadout(loadout) : []), [loadout]);
  const value = useMemo(() => (loadout ? buildValue(loadout) : null), [loadout]);
  const stats = useMemo(() => (loadout ? aggregateStats(loadout) : null), [loadout]);
  const synergy = useMemo(() => (loadout ? buildSynergyReport(loadout) : new Map()), [loadout]);
  // Battle-start numbers for the side panel (against the layout's enemy, or a dummy).
  const startStats = useMemo(() => {
    if (!loadout || !data || !inspected || editingEnemy) return null;
    try {
      return battleStartStats(loadout, resolveEnemy(data, layout.battle?.enemy));
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadout, data, inspected !== null, layout.battle?.enemy]);
  const supplyIds = useMemo(() => new Set(loadout ? availableSupplies(loadout).map((s) => s.item.id) : []), [loadout]);
  const profileIssues = useMemo(
    () => (data && bagProfile ? loadProfile({ path: 'profile', text: stringify(bagProfile) }, data).issues : []),
    [data, bagProfile],
  );

  const defOf = (id: string): Item | Gear | undefined => data?.items.get(id) ?? data?.gear.get(id);

  const ghost: Ghost | null = useMemo(() => {
    if (!pending || !loadout) return null;
    // Gear shows the footprint for its equipped rarity (gloves' wider epic+ shape).
    const def = data?.gear.has(pending.item) ? nextGearDef(loadout, pending.item) : defOf(pending.item);
    const fp = def ? footprintOf(def) : null;
    if (!def || !fp) return null;
    const abs = placeFootprint(fp, pending);
    const valid = abs.cells.every((c) => isUsable(loadout.bag, c.x, c.y) && occupantsAt(loadout.layout, c.x, c.y).length === 0);
    const color = rarityColor('rarity' in def ? (def.rarity as string) : null, !('rarity' in def));
    const sprite = spriteOf(def as Parameters<typeof spriteOf>[0], pending.rotation) ?? undefined;
    return { name: def.name, color, cells: abs.cells, dots: abs.dots, valid, effects: def.effects, sprite, origin: { x: pending.x, y: pending.y } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, loadout]);

  // ---------------------------------------------------------------- layout edits
  const editLayout = (fn: (l: UiLayout) => UiLayout) => {
    setLayout((l) => fn(l));
    setLayoutDirty(true);
  };

  /** Edit the bag being shown: mine, or the enemy build's. */
  const editBag = (fn: (l: UiLayout) => UiLayout) => {
    if (!editingEnemy) return editLayout(fn);
    editLayout((l) => {
      const en = l.battle?.enemy;
      if (!en || typeof en !== 'object' || !en.build) return l;
      const b = en.build;
      const next = fn(withIds({ placements: b.placements, bag: b.bag, enhanced_cells: b.enhanced_cells }));
      const build: EnemyBuild = { ...b, placements: next.placements, bag: next.bag, enhanced_cells: next.enhanced_cells };
      return { ...l, battle: { ...l.battle!, enemy: { ...en, build } } };
    });
  };
  const setEnemyBuild = (fn: (b: EnemyBuild) => EnemyBuild) =>
    editLayout((l) => {
      const en = l.battle?.enemy;
      if (!en || typeof en !== 'object' || !en.build) return l;
      return { ...l, battle: { ...l.battle!, enemy: { ...en, build: fn(en.build) } } };
    });
  /**
   * An edit to my profile (Profile tab, hero picker): the account-wide part goes to the account (saved
   * automatically), the rest (hero, blessings, gear, pets, skins, HP / ATK / Block) to this build.
   */
  const editMyProfile = (p: Profile) => {
    const acc = accountOf(p);
    setAccount((cur) => (cur && writeAccount(cur, null) === writeAccount(acc, null) ? cur : acc));
    const heroId = p.active_hero ?? layout.hero ?? null;
    const setup = setupFromProfile(p, heroId);
    // A hero I don't own keeps whatever the build saved for it.
    if (heroId && !setup.hero) setup.hero = layout.setup?.hero?.id === heroId ? layout.setup.hero : { id: heroId, stars: 0, links: [], skin: null };
    const next: UiLayout = { ...layout, ...(heroId ? { hero: heroId } : {}), setup };
    if (writeBuild(next) !== writeBuild(layout)) editLayout((l) => ({ ...l, ...(heroId ? { hero: heroId } : {}), setup }));
  };
  const setBagProfile = (p: Profile) => {
    if (editingEnemy) setEnemyBuild((b) => ({ ...b, profile: p }));
    else editMyProfile(p);
  };
  /** Pick this build's hero: its blessings start empty unless the build already had them for that hero. */
  const setBuildHero = (heroId: string | null) =>
    editLayout((l) => {
      const keep = l.setup?.hero?.id === heroId ? l.setup.hero : heroId ? { id: heroId, stars: 0, links: [], skin: null } : undefined;
      const { hero: _old, ...rest } = l.setup ?? {};
      return { ...l, hero: heroId ?? undefined, setup: { ...rest, ...(keep ? { hero: keep } : {}) } };
    });
  /** My current build, as an enemy build (a starting point for the enemy). */
  const myBuild = (): EnemyBuild => ({
    profile: structuredClone({ ...(profile ?? DEFAULT_PROFILE), active_hero: layout.hero ?? profile?.active_hero ?? null }),
    placements: structuredClone(layout.placements),
    ...(layout.bag ? { bag: structuredClone(layout.bag) } : {}),
    ...(layout.enhanced_cells ? { enhanced_cells: structuredClone(layout.enhanced_cells) } : {}),
  });
  /** A saved build as an enemy build: its bag, and my account with the build's setup put in. */
  const layoutAsBuild = async (name: string): Promise<EnemyBuild> => {
    const l = (await loadBuild(name)).layout;
    return {
      source_layout: name,
      profile: applySetup(account ?? DEFAULT_PROFILE, l.setup),
      placements: l.placements,
      ...(l.bag ? { bag: l.bag } : {}),
      ...(l.enhanced_cells ? { enhanced_cells: l.enhanced_cells } : {}),
    };
  };

  const focusBag = () => setTimeout(() => document.querySelector<HTMLElement>('.bag')?.focus(), 0);

  const startPlacing = (itemId: string, supply = false) => {
    const def = loadout && data?.gear.has(itemId) ? nextGearDef(loadout, itemId) : defOf(itemId);
    const fp = def ? footprintOf(def) : null;
    if (!fp || !loadout) {
      say(`${def?.name ?? itemId} has no shape yet. Enter it in the item editor.`, true);
      return;
    }
    const at = findFirstFit(loadout.layout, fp, 0) ?? { x: 0, y: 0 };
    setPending({ item: itemId, x: at.x, y: at.y, rotation: 0, supply });
    setSelected(null);
    setMaskEdit(false);
    focusBag();
  };

  const commitPending = () => {
    if (!pending) return;
    const { layout: next, id } = addPlacement(bagLayout, pending);
    editBag(() => next);
    setSelected(id);
    setPending(null);
  };

  const onKey = (action: KeyAction) => {
    const d = moveBy(action);
    if (pending) {
      if (d) setPending({ ...pending, x: pending.x + d.dx, y: pending.y + d.dy });
      else if (action === 'rotate') setPending({ ...pending, rotation: rotateCw(pending.rotation) });
      else if (action === 'place') commitPending();
      else setPending(null); // cancel / remove
      return;
    }
    if (!selected) return;
    const p = bagLayout.placements.find((x) => x.id === selected);
    if (!p) return;
    if (d) editBag((l) => updatePlacement(l, selected, { x: p.x + d.dx, y: p.y + d.dy }));
    else if (action === 'rotate') editBag((l) => updatePlacement(l, selected, { rotation: rotateCw(p.rotation) }));
    else if (action === 'remove') {
      editBag((l) => removePlacement(l, selected));
      setSelected(null);
    } else if (action === 'cancel') setSelected(null);
  };

  const onDrop = (drop: { itemId?: string; instanceId?: string; pending?: boolean }, x: number, y: number) => {
    if (drop.pending) {
      // Moving the not-yet-placed item: it stays unplaced until Enter / Place.
      if (pending) setPending({ ...pending, x, y });
      focusBag();
      return;
    }
    setPending(null);
    if (drop.instanceId) {
      editBag((l) => updatePlacement(l, drop.instanceId!, { x, y }));
      setSelected(drop.instanceId);
    } else if (drop.itemId) {
      if (!defOf(drop.itemId) || !footprintOf(defOf(drop.itemId)!)) return;
      const { layout: next, id } = addPlacement(bagLayout, { item: drop.itemId, x, y, rotation: 0, supply: false });
      editBag(() => next);
      setSelected(id);
    }
    focusBag();
  };

  const mask = bagLayout.bag?.mask ?? FULL_MASK();
  const toggleMask = (x: number, y: number) =>
    editBag((l) => {
      const m = [...(l.bag?.mask ?? FULL_MASK())];
      m[y * 8 + x] = m[y * 8 + x] ? 0 : 1;
      return { ...l, bag: { mask: m } };
    });
  const toggleEnhanced = (x: number, y: number) =>
    editBag((l) => {
      const cells = l.enhanced_cells ?? [];
      const has = cells.some((c) => c.x === x && c.y === y);
      return { ...l, enhanced_cells: has ? cells.filter((c) => c.x !== x || c.y !== y) : [...cells, { x, y }] };
    });
  const setRows = (rows: number) =>
    editBag((l) => {
      const m = [...(l.bag?.mask ?? FULL_MASK())];
      const want = rows * 8;
      return { ...l, bag: { mask: want <= m.length ? m.slice(0, want) : [...m, ...new Array(want - m.length).fill(1)] } };
    });

  const addBuildName = (name: string) => setBuilds((b) => (b.includes(name) ? b : [...b, name].sort()));

  /** Save the enemy's build as its own build (so it can be loaded for either side later). */
  const doSaveEnemyBuild = async (name: string) => {
    if (!enemyBuild) return;
    try {
      const file: LayoutData = { name, placements: enemyBuild.placements, bag: enemyBuild.bag, enhanced_cells: enemyBuild.enhanced_cells, setup: setupFromProfile(enemyBuild.profile) };
      await store.writeBuild(name, writeBuild(file));
      setEnemyBuild((b) => ({ ...b, source_layout: name }));
      addBuildName(name);
      say(`Saved ${enemyName}'s build to ${store.where(name)}`);
    } catch (e) {
      say(`Couldn't save: ${(e as Error).message}`, true);
    }
  };
  const doDeleteLayout = async (name: string) => {
    try {
      await store.deleteBuild(name);
      setBuilds((b) => b.filter((l) => l !== name));
      if (layoutName === name) {
        setLayoutName('');
        lastBuild.set('');
      }
      say(`Deleted ${store.where(name)}`);
    } catch (e) {
      say(`Couldn't delete "${name}": ${(e as Error).message}`, true);
    }
  };

  const doSaveLayout = async (name: string) => {
    try {
      const next = { ...layout, name };
      await store.writeBuild(name, writeBuild(next));
      setLayout(next);
      setLayoutName(name);
      setLayoutDirty(false);
      lastBuild.set(name);
      addBuildName(name);
      say(`Saved ${store.where(name)}`);
    } catch (e) {
      say(`Couldn't save: ${(e as Error).message}`, true);
    }
  };

  /** One file with everything needed to rebuild this build elsewhere. */
  const doExportBuild = () => {
    const name = layoutName || layout.name || 'build';
    downloadText(`${name.replace(/[^\w\- ]+/g, '_')}.yaml`, writeBuild({ ...layout, name }));
  };
  const doImportBuild = async (file: File) => {
    try {
      const r = readBuild(await file.text(), { v1Profile: v1Ref.current }, file.name);
      setLayout((cur) => {
        const next = withIds(r.layout);
        return cur.battle ? { ...next, battle: cur.battle } : next;
      });
      setLayoutName(safeBuildName(file.name.replace(/\.ya?ml$/i, '')));
      setLayoutDirty(true);
      setSelected(null);
      setPending(null);
      showNotes(`Imported ${file.name}`, r.notes);
      say(`Imported ${file.name}. Save it to keep it.`);
    } catch (e) {
      say(`Couldn't import ${file.name}: ${(e as Error).message}`, true);
    }
  };

  /** The enemy's build as a build file, and a build file as the enemy's build. */
  const doExportEnemyBuild = () => {
    if (!enemyBuild) return;
    const name = enemyBuild.source_layout || enemyName;
    const file: LayoutData = { name, placements: enemyBuild.placements, bag: enemyBuild.bag, enhanced_cells: enemyBuild.enhanced_cells, setup: setupFromProfile(enemyBuild.profile) };
    downloadText(`${name.replace(/[^\w\- ]+/g, '_')}.yaml`, writeBuild(file));
  };
  const doImportEnemyBuild = async (file: File) => {
    try {
      const r = readBuild(await file.text(), { v1Profile: v1Ref.current }, file.name);
      const l = r.layout;
      setEnemyBuild((b) => ({
        ...b,
        source_layout: undefined,
        profile: applySetup(b.profile, l.setup),
        placements: l.placements,
        bag: l.bag,
        enhanced_cells: l.enhanced_cells,
      }));
      showNotes(`Imported ${file.name}`, r.notes);
      say(`Imported ${file.name} as ${enemyName}'s build.`);
    } catch (e) {
      say(`Couldn't import ${file.name}: ${(e as Error).message}`, true);
    }
  };

  /** Everything (account and every saved build) as one .zip. */
  const doExportAccount = async () => {
    if (!account) return;
    try {
      const names = await store.listBuilds();
      const saved = await Promise.all(names.map(async (name) => ({ name, text: await store.readBuild(name) })));
      const { filename, bytes } = accountArchive(writeAccount(account, migratedFromV1), saved, new Date(), await store.listEdits());
      downloadBytes(filename, bytes);
      say(`Exported your account and ${saved.length} build${saved.length === 1 ? '' : 's'} as ${filename}.${layoutDirty ? ' Unsaved changes to the open build aren\'t in it.' : ''}`);
    } catch (e) {
      say(`Couldn't export: ${(e as Error).message}`, true);
    }
  };
  /** Read an account export (or a profile.yaml) and ask what to do with it. */
  const doPickAccountFile = async (file: File) => {
    try {
      let imp: AccountImport;
      if (/\.zip$/i.test(file.name)) imp = readAccountArchive(await unzipFiles(new Uint8Array(await file.arrayBuffer())));
      else {
        const text = await file.text();
        if (looksLikeBuild(text)) return void doImportBuild(file);
        imp = { accountText: text, builds: [], edits: [], notes: [] };
      }
      if (!imp.accountText && imp.builds.length === 0 && imp.edits.length === 0) throw new Error('it has no profile.yaml, builds/ or edits/ folder');
      setImporting({ ...imp, file: file.name, replaceAccount: !!imp.accountText });
    } catch (e) {
      say(`Couldn't import ${file.name}: ${(e as Error).message}`, true);
    }
  };
  const doImportAccount = async (imp: NonNullable<typeof importing>) => {
    setImporting(null);
    const notes: SaveNote[] = imp.notes.map((message) => ({ level: 'info', message }));
    try {
      let v1 = v1Ref.current;
      if (imp.replaceAccount && imp.accountText) {
        const acc = readAccount(imp.accountText);
        notes.push(...acc.notes);
        const text = writeAccount(acc.profile, acc.migratedFromV1);
        await store.writeAccount(text);
        savedAccount.current = text;
        v1 = acc.migratedFromV1;
        v1Ref.current = v1;
        setMigratedFromV1(v1);
        setAccount(acc.profile);
      }
      // Builds are stored in today's format, completed from the account they were exported with.
      const ctx = imp.accountText ? (readAccount(imp.accountText).migratedFromV1 ?? v1) : v1;
      for (const b of imp.builds) {
        const r = readBuild(b.text, { v1Profile: ctx }, `"${b.name}"`);
        notes.push(...r.notes);
        await store.writeBuild(b.name, writeBuild(r.layout));
      }
      // Item editor edits (exported from the hosted site): kept in the browser; a local project keeps them in data/.
      for (const e of imp.edits) {
        if (store.writeEdits) await store.writeEdits(e.category, e.text);
        else notes.push({ level: 'warning', message: `Item edits for ${e.category} weren't applied: in the local project they live in data/${e.category}/manual/ (copy them there to use them).` });
      }
      if (imp.edits.length && store.writeEdits) await refresh();
      setBuilds(await store.listBuilds());
      showNotes(`Imported ${imp.file}`, notes);
      say(`Imported ${imp.replaceAccount && imp.accountText ? 'your account and ' : ''}${imp.builds.length} build${imp.builds.length === 1 ? '' : 's'} from ${imp.file}.`);
      if (layoutName && imp.builds.some((b) => b.name === layoutName) && !layoutDirty) void openLayout(layoutName);
    } catch (e) {
      say(`Import stopped: ${(e as Error).message}`, true);
    }
  };

  // ---------------------------------------------------------------- render
  if (loadError) {
    return (
      <div className="panel" style={{ margin: 24 }}>
        <h2>Couldn't load the game data</h2>
        <p>{loadError}</p>
        <p className="muted">{store.kind === 'files' ? 'Start the app with `npm run dev` from the project folder.' : 'Reload the page; if it keeps happening, the site may be updating.'}</p>
      </div>
    );
  }
  if (!snap || !loaded || !data || !profile || !bagProfile || !loadout || !playerLoadout || !stats) return <div style={{ padding: 24 }}>Loading game data…</div>;

  const dataErrors = loaded.errors.length;
  const enemyName = inlineEnemy?.name ?? 'Enemy';

  const supply = supplySummary(loadout);
  const flags = buildFlags(loadout, loaded);
  const pets = petPoints(data, bagProfile);
  /** Edit the profile being shown (mine or the enemy's) with a mutating function. */
  const updateBag = (fn: (p: Profile) => void) => {
    const next = structuredClone(bagProfile);
    fn(next);
    setBagProfile(next);
  };

  const buildPanel = (
    <Panel id="battle.build" title={editingEnemy ? `${enemyName}'s build` : 'Build'}>
      <BuildPicker
        builds={builds}
        active={editingEnemy ? (enemyBuild?.source_layout ?? '') : layoutName}
        dirty={editingEnemy ? false : layoutDirty}
        saveEnabled={editingEnemy}
        what={editingEnemy ? `${enemyName}'s build` : 'your build'}
        onSave={(n) => void (editingEnemy ? doSaveEnemyBuild(n) : doSaveLayout(n))}
        onDelete={(n) => void doDeleteLayout(n)}
        onLoad={(n) => {
          if (!editingEnemy) return void openLayout(n);
          layoutAsBuild(n)
            .then((b) => {
              editLayout((l) => {
                const en = l.battle?.enemy;
                return en && typeof en === 'object' ? { ...l, battle: { ...l.battle!, enemy: { ...en, name: n, build: b } } } : l;
              });
              say(`Loaded "${n}" as ${enemyName}'s build.`);
            })
            .catch((e) => say(`Couldn't load "${n}": ${(e as Error).message}`, true));
        }}
        onExport={editingEnemy ? doExportEnemyBuild : doExportBuild}
        onImport={(f) => void (editingEnemy ? doImportEnemyBuild(f) : doImportBuild(f))}
        onNew={() => {
          if (editingEnemy) {
            editBag(() => ({ placements: [] }));
            setSelected(null);
            return;
          }
          // A new build starts with this build's hero, blessings, gear, pets and skins, and an empty bag.
          setLayout((l) => ({ placements: [], ...(l.hero ? { hero: l.hero } : {}), ...(l.setup ? { setup: l.setup } : {}), ...(l.battle ? { battle: l.battle } : {}) }));
          setLayoutName('');
          setLayoutDirty(false);
          lastBuild.set('');
          setSelected(null);
        }}
      />
    </Panel>
  );

  return (
    <StoreContext.Provider value={store}>
    <div className="app">
      <div className="topbar">
        <h1>OG Backpack Simulator</h1>
        <div className="tabs" role="tablist">
          {(
            [
              ['bag', 'Battle'],
              ['optimize', 'Optimize'],
              ['profile', 'Profile'],
              ['editor', 'Item editor'],
              ['data', `Data${dataErrors ? ` (${dataErrors} errors)` : ''}`],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => {
                if (t === 'data') setDataFocus(false);
                setTab(t);
              }}>
              {label}
            </button>
          ))}
        </div>
        {enemyBuild && (
          <div className="tabs" role="radiogroup" aria-label="Whose build" title="Which build the Battle and Profile tabs edit: yours, or the enemy's (it has its own bag, hero, gear and pets)">
            <span className="small muted" style={{ alignSelf: 'center' }}>
              Editing
            </span>
            <button role="radio" aria-checked={side === 'me'} className={side === 'me' ? 'active' : ''} onClick={() => setSide('me')}>
              My build
            </button>
            <button role="radio" aria-checked={side === 'enemy'} className={side === 'enemy' ? 'active enemy-side' : ''} onClick={() => setSide('enemy')}>
              ⚔ {enemyName}
            </button>
          </div>
        )}
        {message && (
          <span className={`small ${message.error ? 'field-error' : 'muted'}`}>
            <span onClick={() => setMessage(null)}>{message.text}</span>
            {message.action && (
              <>
                {' '}
                <button className="small" onClick={message.action.run}>
                  {message.action.label}
                </button>
              </>
            )}
          </span>
        )}
        <span className="status row">
          <button aria-label="How to use the simulator" title="How to use the simulator" aria-pressed={showGuide} onClick={() => setShowGuide((g) => !g)}>
            ?
          </button>
          <button onClick={() => void doExportAccount()} title={`Download your account and every saved build as one .zip (a backup you can import later). Saved now in ${store.where()}.`}>
            Export account
          </button>
          <label title="Load an account export (.zip) or a profile.yaml">
            <input
              type="file"
              accept=".zip,.yaml,.yml"
              aria-label="Import account"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doPickAccountFile(f);
                e.target.value = '';
              }}
            />
            <span role="button" className="badge" style={{ cursor: 'pointer', padding: '4px 8px' }}>
              Import account…
            </span>
          </label>
        </span>
      </div>
      {showGuide && tab === 'bag' && (
        <Guide
          empty={(account?.heroes.length ?? 0) === 0}
          savedIn={store.kind === 'browser' ? 'this browser' : 'the project folder (profile/ and layouts/)'}
          onProfile={() => setTab('profile')}
          onClose={() => {
            guideDone.set(true);
            setShowGuide(false);
          }}
        />
      )}
      {notice && (
        <div className={`issue ${notice.notes.some((n) => n.level === 'warning') ? 'warning' : ''} notice`} role="status">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{notice.title}</b>
            <button className="small" aria-label="Dismiss" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
          <ul>
            {notice.notes.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </div>
      )}
      {importing && (
        <Dialog
          title={`Import ${importing.file}?`}
          onCancel={() => setImporting(null)}
          actions={[{ label: 'Import', kind: 'primary', disabled: !importing.replaceAccount && importing.builds.length === 0, onClick: () => void doImportAccount(importing) }]}
        >
          {importing.accountText && (
            <label className="check-line">
              <input type="checkbox" checked={importing.replaceAccount} onChange={(e) => setImporting({ ...importing, replaceAccount: e.target.checked })} />
              <span>Replace my account (heroes, stars, skill links, auras) with the one in this file</span>
            </label>
          )}
          {importing.builds.length > 0 ? (
            <>
              <div style={{ marginTop: 8 }}>
                {importing.builds.length} build{importing.builds.length === 1 ? '' : 's'}:
              </div>
              <ul className="small">
                {importing.builds.map((b) => (
                  <li key={b.name}>
                    {b.name}
                    {builds.includes(b.name) && <span className="warn"> (replaces your saved build with this name)</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="small muted" style={{ marginTop: 8 }}>
              No builds in this file.
            </div>
          )}
          {importing.notes.map((n) => (
            <div key={n} className="small muted">
              {n}
            </div>
          ))}
          {importing.edits.length > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              Item editor changes for: {importing.edits.map((e) => e.category).join(', ')}
              {store.writeEdits ? ' (they replace yours for those kinds)' : <span className="warn"> (not applied in the local project: they live in data/)</span>}
            </div>
          )}
          <div className="small muted">Your other saved builds stay as they are.</div>
        </Dialog>
      )}

      {tab === 'bag' && (
        <div className={`main battle${editingEnemy ? ' editing-enemy' : ''}`}>
          <div className="stack">
            {buildPanel}
            <Panel id="battle.items" title="Items">
              <ItemBrowser
                data={data}
                showEnemyItems={editingEnemy}
                supplyIds={supplyIds}
                onPick={(e) => startPlacing(e.id)}
                onEdit={(e) => {
                  setEditTarget({ category: e.kind === 'gear' ? 'gear' : 'items', id: e.id });
                  setTab('editor');
                }}
                starting={{
                  heroName: loadout.hero?.name ?? null,
                  used: supply?.used ?? 0,
                  capacity: supply?.capacity ?? 0,
                  available: availableSupplies(loadout),
                  inBag: new Set([...loadout.entries.values()].filter((e) => e.supply).map((e) => e.def.id)),
                  onAdd: (s) => startPlacing(s.item.id, true),
                }}
              />
            </Panel>
          </div>
          <div className="stack">
            {editingEnemy && (
              <div className="issue warning">
                Editing <b>{enemyName}</b>'s build: bag, hero, gear, pets and skins here, its heroes and auras in the Profile tab. It's saved with your build.{' '}
                <button onClick={() => setSide('me')}>Back to my build</button>
              </div>
            )}
            <Panel id="battle.bag" title="Bag" aside={`${mask.filter((v) => v).length} cells · ${bagLayout.placements.length} placed`}>
              <div className="row small bag-status">
                {pending ? (
                  <>
                    <span>
                      Placing <b>{ghost?.name}</b>: drag it or use the arrows, space rotates, enter places.
                    </span>
                    <button onClick={commitPending}>Place</button>
                    <button onClick={() => setPending(null)}>Cancel</button>
                  </>
                ) : selected ? (
                  <>
                    <span className="muted">Arrows move it, space rotates.</span>
                    <button onClick={() => onKey('rotate')}>Rotate</button>
                    <button onClick={() => onKey('remove')}>Remove</button>
                    {bagLayout.placements.find((p) => p.id === selected)?.supply && <span className="badge">starting equipment</span>}
                  </>
                ) : maskEdit ? (
                  <span>Click cells to open or close them.</span>
                ) : enhanceEdit ? (
                  <span>Click cells to mark them enhanced (Venom: Poison Coating, Cecilia: Instant Casting).</span>
                ) : (
                  <span className="muted">Pick an item on the left, or click one in the bag for its details.</span>
                )}
              </div>
              <BagGrid
                loadout={loadout}
                issues={issues}
                selected={selected}
                hovered={hovered}
                ghost={ghost}
                maskEdit={maskEdit}
                enhanced={bagLayout.enhanced_cells ?? []}
                enhanceEdit={enhanceEdit}
                onToggleEnhanced={toggleEnhanced}
                onSelect={(id) => {
                  setSelected(id);
                  if (id === null) setInspected(null);
                }}
                onInspect={setInspected}
                onHover={setHovered}
                onToggleMask={toggleMask}
                onDrop={onDrop}
                onKey={onKey}
              />
              <div className="row small" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                {value && (
                  <span
                    className="build-value"
                    title={`Shop value of the ${value.items} bought item(s) in the bag; starting equipment, gear and pet / skin spawns don't count.${value.unknown.length ? `\nValue not known: ${value.unknown.join(', ')}` : ''}`}
                  >
                    Build value <b>{value.total}</b> coins
                    {value.unknown.length > 0 && <span className="warn"> + ? ({value.unknown.length} unknown)</span>}
                  </span>
                )}
                <span className="row">
                  <button
                    className={maskEdit ? 'primary small' : 'small'}
                    onClick={() => {
                      setMaskEdit((m) => !m);
                      setEnhanceEdit(false);
                    }}
                    title="Open or close bag cells (a smaller bag before every cell is unlocked)"
                  >
                    {maskEdit ? 'Done' : 'Edit cells'}
                  </button>
                  {mask.some((v) => !v) || mask.length !== 48 ? (
                    <button className="small" onClick={() => editBag((l) => ({ ...l, bag: undefined }))} title="Back to the full 8 × 6 bag">
                      Full bag
                    </button>
                  ) : null}
                  {maskEdit && (
                    <label className="muted">
                      Rows <input type="number" min={1} max={12} aria-label="Bag rows" value={loadout.bag.height} onChange={(e) => setRows(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 52 }} />
                    </label>
                  )}
                  <button
                    className={enhanceEdit ? 'primary small' : 'small'}
                    onClick={() => {
                      setEnhanceEdit((m) => !m);
                      setMaskEdit(false);
                    }}
                    title="Mark the slots a hero skill enhanced this run (Venom: Poison Coating, Cecilia: Instant Casting)"
                  >
                    {enhanceEdit ? 'Done' : `Enhanced cells${bagLayout.enhanced_cells?.length ? ` (${bagLayout.enhanced_cells.length})` : ''}`}
                  </button>
                </span>
              </div>
            </Panel>
            <IssuesPanel
              issues={issues}
              onSelect={setSelected}
              extra={
                flags.length > 0 && (
                  <div className="issue warning small data-note" title={flags.map((f) => `${f.name} (${f.id})${f.problems.length ? `: ${f.problems.length} problem(s)` : ''}`).join('\n')}>
                    Some game data this build uses isn't confirmed in game yet{flags.some((f) => f.problems.length) ? ', or has problems in the data files' : ''}:{' '}
                    {flags
                      .slice(0, 8)
                      .map((f) => f.name)
                      .join(', ')}
                    {flags.length > 8 ? ` and ${flags.length - 8} more` : ''}. Results that depend on it may be off.{' '}
                    <button
                      className="small"
                      onClick={() => {
                        setDataFocus(true);
                        setTab('data');
                      }}
                    >
                      Look in the Data tab
                    </button>
                  </div>
                )
              }
            />
            <BattlePanel
              loadout={playerLoadout}
              battle={layout.battle}
              onChange={(b) => editLayout((l) => ({ ...l, battle: b }))}
              layouts={builds}
              myBuild={myBuild}
              layoutAsBuild={layoutAsBuild}
              onEditEnemy={() => {
                setSide('enemy');
                setSelected(null);
                setPending(null);
              }}
            />
          </div>
          <div className="stack">
            <Panel id="battle.hero" title="Hero">
              <HeroEditor data={data} profile={bagProfile} heroId={editingEnemy ? bagProfile.active_hero : (layout.hero ?? null)} onHero={(id) => (editingEnemy ? setBagProfile({ ...bagProfile, active_hero: id }) : setBuildHero(id))} update={updateBag} />
            </Panel>
            <Panel id="battle.gear" title="Gear">
              <GearEditor data={data} profile={bagProfile} update={updateBag} loadout={loadout} onPlace={(g) => startPlacing(g.id)} />
            </Panel>
            <Panel id="battle.pets" title="Pets" aside={`${pets.used} / ${pets.max} points`}>
              <PetsEditor data={data} profile={bagProfile} update={updateBag} />
            </Panel>
            <Panel id="battle.skins" title="Skins" aside={`${(bagProfile.equipped_skins ?? []).length} / 2`}>
              <SkinsEditor data={data} profile={bagProfile} update={updateBag} />
            </Panel>
            <Panel id="battle.stats" title="Stats">
              <BuildStats data={data} profile={bagProfile} update={updateBag} />
              <ItemStats
                stats={stats}
                synergy={synergy}
                selected={inspected}
                onSelect={(id) => {
                  setSelected(id);
                  setInspected(id);
                }}
              />
            </Panel>
          </div>
          {inspected && stats?.items.get(inspected) && (
            <ItemDrawer
              s={stats.items.get(inspected)!}
              syn={synergy.get(inspected)}
              start={startStats?.get(inspected)}
              names={(id) => stats.items.get(id)?.name ?? id}
              image={(loadout?.layout.items.get(inspected)?.def as { image?: string } | undefined)?.image}
              worth={itemWorth(loadout, inspected)}
              onClose={() => setInspected(null)}
            />
          )}
        </div>
      )}

      {/* Kept mounted (only hidden) so a run and its results survive switching tabs. */}
      <div style={tab === 'optimize' ? undefined : { display: 'none' }}>
        <OptimizePanel
          data={data}
          profile={playerLoadout.profile}
          layout={layout}
          layoutName={layoutName}
          loadout={playerLoadout}
          layouts={builds}
          layoutAsBuild={layoutAsBuild}
          setup={tab === 'optimize' ? buildPanel : null}
          onApply={(placements) => {
            editLayout((l) => ({ ...l, placements: placements.map((p, i) => ({ ...p, id: p.id ?? `${p.item}#${i + 1}` })) }));
            setSide('me');
            setTab('bag');
            say('Optimized build put in the Battle tab (not saved yet).');
          }}
        />
      </div>

      {tab === 'profile' && (
        <>
          {editingEnemy && (
            <div className="issue warning" style={{ margin: '8px 12px 0' }}>
              Editing <b>{enemyName}</b>'s profile (stats, heroes, blessings, gear, pets, auras). Saving saves the layout it belongs to.{' '}
              <button onClick={() => setSide('me')}>Back to my profile</button>
            </div>
          )}
          <ProfileEditor
            data={data}
            profile={bagProfile}
            issues={profileIssues}
            loadoutIssues={issues.filter((i) => /^(gear_|pet_|blessing_|link_|hero_)/.test(i.code))}
            editingEnemy={editingEnemy}
            // My Profile tab is the account only: heroes, stars, links, auras. It never touches the build's setup.
            onChange={(p) => (editingEnemy ? setBagProfile(p) : setAccount(accountOf(p)))}
          />
        </>
      )}

      {tab === 'editor' && (
        <>
          <div className="row editor-head">
            <div className="tabs" role="tablist" aria-label="Item editor mode">
              <button role="tab" aria-selected={editorMode === 'game'} className={editorMode === 'game' ? 'active' : ''} onClick={() => setEditorMode('game')}>
                Game items, gear and pets
              </button>
              <button role="tab" aria-selected={editorMode === 'enemy'} className={editorMode === 'enemy' ? 'active' : ''} onClick={() => setEditorMode('enemy')}>
                Monster items
              </button>
            </div>
            <span className="small muted">
              {editorMode === 'game'
                ? `Fix or add game data: shapes and item dots, stats, effects. Your changes override the wiki field by field${store.kind === 'files' ? ' and are saved in data/<kind>/manual/user_edits.yaml' : ' and are kept in this browser (they go into your account export)'}.`
                : 'Items only enemies use (a monster\'s attacks and abilities), to give a typed-in enemy a bag.'}
            </span>
          </div>
          {editorMode === 'game' ? (
            <ItemEditor
              data={data}
              target={editTarget}
              onTarget={setEditTarget}
              onSaved={async (msg) => {
                say(msg);
                await refresh();
              }}
              onError={(msg) => say(msg, true)}
            />
          ) : (
            <EnemyItemEditor
              data={data}
              onSaved={async (msg) => {
                say(msg);
                await refresh();
              }}
              onError={(msg) => say(msg, true)}
            />
          )}
        </>
      )}

      {tab === 'data' && <DataPanel key={dataFocus ? 'build' : 'all'} result={loaded} buildRefs={buildDataRefs(playerLoadout)} focusBuild={dataFocus} />}
    </div>
    </StoreContext.Provider>
  );
}
