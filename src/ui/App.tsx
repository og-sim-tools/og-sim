/** Overgeared Hero backpack simulator — local web UI (SPEC §8). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parse as parseYaml, stringify } from 'yaml';
import { findFirstFit, footprintOf, isUsable, occupantsAt, placeFootprint } from '../engine/bag';
import { buildSynergyReport } from '../engine/effects/synergy';
import { type GameData, type Gear, type Item, loadGameData, loadProfile } from '../engine/loader';
import { applySetup, setupFromProfile } from '../engine/layoutSetup';
import { buildLoadout, buildValue, nextGearDef } from '../engine/loadout';
import type { EnemyBuild, LayoutData, Profile } from '../engine/model';
import { type SaveNote, accountToProfile, adoptLegacy, profileToAccount, readAccount, readBuild, writeAccount, writeBuild } from '../engine/saves';
import { aggregateStats } from '../engine/stats';
import { availableSupplies, supplySummary, validateLoadout } from '../engine/validate';
import { type Snapshot, downloadText } from './api';
import { Dialog } from './components/Dialog';
import { type SaveStore, StoreContext, TEMP_BUILD, fileStore, lastBuild, readDraft, tempBuild, writeDraft } from './saves';
import { BagPreview } from './components/BagPreview';
import { type AccountImport, accountArchive, downloadBytes, looksLikeBuild, readAccountArchive } from './state/accountArchive';
import { unzipFiles } from './state/zip';
import { safeBuildName } from '../engine/saves/names';
import { BagGrid, marginFor, rarityColor, spriteOf } from './components/BagGrid';
import { TrashIcon } from './components/BuildPicker';
import { useDragState } from './drag';
import { ANCHORS, RARITY_LOOKS, type RarityLook, type Settings, setSettings, useSettings } from './settings';
import { type DragItem, DragLayer, dragUnder, nearestBox, useDragLook, useDropElsewhere, useDropTarget } from './drag';
import { type Landing, dropInBag, dropInBin, keyOnSelected, landing, lookOf, turnedCells } from './state/bagEdit';
import { Storage, type StoredView } from './components/Storage';
import { bagSizesFor, enhancerOf, sizeOf } from './state/bagSizes';
import { ItemDrawer } from './components/ItemDrawer';
import { battleStartStats } from '../engine/combat/battle';
import { resolveEnemy } from '../engine/combat/montecarlo';
import { BattleTab } from './components/BattleTab';
import { playerEnemy } from './components/BattlePanel';
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
import { APP_TOUR, Tour } from './components/Tour';
import {
  type KeyAction,
  type UiLayout,
  addPlacement,
  addStored,
  fromStorage,
  moveBy,
  reachShift,
  removePlacement,
  removeStored,
  rotateCw,
  toStorage,
  updatePlacement,
  updateStored,
  withIds,
} from './state/layoutOps';

type Tab = 'bag' | 'battle' | 'optimize' | 'profile' | 'editor' | 'data';
type InlineEnemy = Exclude<NonNullable<NonNullable<LayoutData['battle']>['enemy']>, string>;

export const DEFAULT_PROFILE: Profile = {
  basic_stats: { hp: '1M', atk: '100K', initial_block: 0 },
  detailed_stats: {},
  heroes: [],
  active_hero: null,
  gear: { weapon: null, shield: null, rings: [], gloves: [] },
  pets: [],
  owned_pets: [],
  aura: null,
  auras: [],
  skins: [],
  equipped_skins: [],
  skin_quests_done: [],
};

const FULL_MASK = () => new Array(48).fill(1) as number[];

/** Phones (user, 2026-10-20): one section at a time, in this order, with Back / Next. */
const STEPS = [
  { id: 'profile', label: 'Profile', tab: 'profile' },
  { id: 'hero', label: 'Hero & blessings', tab: 'bag' },
  { id: 'gear', label: 'Gear', tab: 'bag' },
  { id: 'pets', label: 'Pets', tab: 'bag' },
  { id: 'skins', label: 'Skins', tab: 'bag' },
  { id: 'opponent', label: 'Opponent', tab: 'battle' },
  { id: 'items', label: 'Items & bag', tab: 'bag' },
  { id: 'fight', label: 'Fight', tab: 'battle' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

/** True while the screen is narrower than `query` says (phones). */
function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, [query]);
  return on;
}
type Raw = Record<string, unknown>;

/** The account-wide part of a profile, normalised: HP / ATK / Block, heroes with stars, links and blessings, owned pets and skins with stars, auras. */
const accountOf = (p: Profile): Profile => accountToProfile(profileToAccount(p));
/** A profile edited in the Build tab: the stars set on the build's pets are the account's stars for those pets. */
const withPetStars = (p: Profile): Profile => {
  const owned = p.owned_pets.filter((o) => !p.pets.some((x) => x.id === o.id));
  return { ...p, owned_pets: [...owned, ...p.pets.map((x) => ({ id: x.id, stars: x.stars }))] };
};

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
  /** The account as of now, for loading builds (an older build's own stars and blessings move into it). */
  const accountRef = useRef<Profile | null>(null);
  accountRef.current = account ?? accountRef.current;
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
  const [maskEdit, setMaskEdit] = useState(false);
  const [enhanceEdit, setEnhanceEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean; action?: { label: string; run: () => void } } | null>(null);
  /** Whose build the Build and Profile tabs edit: mine, or the typed-in enemy's (when it has a build). */
  const [side, setSide] = useState<'me' | 'enemy'>('me');
  /** Item editor tab: the game's data, or monster items for enemies. */
  const [editorMode, setEditorMode] = useState<'game' | 'enemy'>('game');
  /** The Data tab opened from the Build tab's note: only what this build uses. */
  const [dataFocus, setDataFocus] = useState(false);
  const [showGuide, setShowGuide] = useState(() => !guideDone.get());
  /** The tutorial: asking whether to start it, then running. */
  const [askTour, setAskTour] = useState(false);
  const [touring, setTouring] = useState(false);
  const settings = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const mobile = useMedia('(max-width: 820px)');
  const [step, setStep] = useState<StepId>('profile');
  /** On a phone, only the current step's sections show. */
  const showIf = (ids: StepId[]) => (!mobile || ids.includes(step) ? undefined : { display: 'none' as const });
  const goStep = (id: StepId) => {
    setStep(id);
    setTab(STEPS.find((x) => x.id === id)!.tab as Tab);
    document.documentElement.scrollTop = 0;
  };
  /** The account as the tour started: if the profile was filled in during it, the end offers a backup. */
  const tourStartAccount = useRef<string | null>(null);
  const [askBackup, setAskBackup] = useState(false);
  /** Opening a build from the Battle tab while the open one has unsaved changes: asks first. */
  const [askOpen, setAskOpen] = useState<{ name: string | null } | null>(null);
  /** The build list shows each build's bag (remembered in this browser). */
  const [previewOn, setPreviewOn] = useState(() => {
    try {
      return localStorage.getItem('og-sim/preview-bags') === '1';
    } catch {
      return false;
    }
  });
  /** Saved builds' files, read when the list opens with previews on. */
  const [previewTexts, setPreviewTexts] = useState<Record<string, string>>({});

  const say = (text: string, error = false, action?: { label: string; run: () => void }) => setMessage({ text, error, ...(action ? { action } : {}) });
  /** Show what loading a file had to change; info-only notes are shown too (they explain an upgrade). */
  const showNotes = (title: string, notes: SaveNote[]) => setNotice(notes.length ? { title, notes } : null);

  // ---------------------------------------------------------------- loading
  const loaded = useMemo(() => (snap ? loadGameData(snap.data) : null), [snap]);
  const data: GameData | null = loaded?.data ?? null;
  const dataRef = useRef<GameData | null>(null);
  dataRef.current = data;

  /**
   * A build read from a file, with what an older file saved per build (blessings, pet and skin stars, HP / ATK /
   * Block) moved into the account where it has none yet (notes say what moved, and what differed).
   */
  const adopt = useCallback((layout: LayoutData, what: string): { layout: LayoutData; notes: SaveNote[] } => {
    const acc = accountRef.current;
    if (!acc) return { layout, notes: [] };
    const d = dataRef.current;
    const a = adoptLegacy(
      acc,
      layout,
      what,
      (kind, id) => (kind === 'hero' ? d?.heroes.get(id)?.name : kind === 'pet' ? d?.pets.get(id)?.name : d?.skins.get(id)?.name) ?? id,
      (id) => d?.blessings.get(id)?.name ?? id,
    );
    if (a.changed) {
      accountRef.current = a.account;
      setAccount(a.account);
    }
    return { layout: a.layout, notes: a.notes };
  }, []);

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
  /** A saved build to edit: read, with its older per-build values moved into the account. */
  const loadMine = useCallback(
    async (name: string) => {
      const r = await loadBuild(name);
      const a = adopt(r.layout, `"${name}"`);
      return { layout: withIds(a.layout), notes: [...r.notes, ...a.notes] };
    },
    [loadBuild, adopt],
  );

  /** Open a saved build; its notes are shown (or added to `collect`, to show with others). */
  const openLayout = useCallback(
    async (name: string, collect?: SaveNote[]) => {
      try {
        const r = await loadMine(name);
        // Loading a build only changes MY build: the enemy (battle settings) already set up stays, so I can
        // pair any build of mine with any enemy. The first load (nothing set up yet) takes the file's battle too.
        setLayout((cur) => (cur.battle ? { ...r.layout, battle: cur.battle } : r.layout));
        setLayoutName(name);
        setLayoutDirty(false);
        lastBuild.set(name);
        setSelected(null);
        if (collect) collect.push(...r.notes);
        else showNotes(`Loaded "${name}"`, r.notes);
      } catch (e) {
        say(`Couldn't load "${name}": ${(e as Error).message}`, true);
      }
    },
    [loadMine],
  );

  /** Open the temp build (a scratch build that isn't in the list; empty if there's none yet). */
  const openTemp = useCallback((collect?: SaveNote[]) => {
    const t = tempBuild.read();
    const read = t ? readBuild(t.text, { v1Profile: v1Ref.current }, 'The temp build') : null;
    const a = read ? adopt(read.layout, 'the temp build') : null;
    const r = read && a ? { layout: a.layout, notes: [...read.notes, ...a.notes] } : null;
    setLayout((cur) => {
      const base: UiLayout = r ? withIds(r.layout) : { placements: [], ...(cur.hero ? { hero: cur.hero } : {}), ...(cur.setup ? { setup: cur.setup } : {}) };
      return cur.battle ? { ...base, battle: cur.battle } : base;
    });
    setLayoutName('');
    setLayoutDirty(false);
    lastBuild.set(TEMP_BUILD);
    setSelected(null);
    setInspected(null);
    if (r && collect) collect.push(...r.notes);
    else if (r) showNotes('Opened the temp build', r.notes);
  }, [adopt]);

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
      accountRef.current = acc.profile;
      setMigratedFromV1(acc.migratedFromV1);
      savedAccount.current = writeAccount(acc.profile, acc.migratedFromV1);
      const names = await store.listBuilds().catch(() => [] as string[]);
      setBuilds(names);
      const notes = [...acc.notes];
      // Unsaved changes to a new build (before the temp build existed) become the temp build.
      if (draft && !draft.name) {
        if (!tempBuild.read()) tempBuild.write(draft.text);
        writeDraft(null);
        openTemp(notes);
      } else if (draft) {
        const r = readBuild(draft.text, { v1Profile: acc.migratedFromV1 }, 'Your unsaved changes');
        const a = adopt(r.layout, `your unsaved changes to "${draft.name}"`);
        notes.push(...r.notes, ...a.notes);
        setLayout(withIds(a.layout));
        setLayoutName(draft.name);
        setLayoutDirty(true);
        const when = draft.at ? new Date(draft.at).toLocaleString() : 'earlier';
        say(`Brought back your unsaved changes${draft.name ? ` to "${draft.name}"` : ''} (${when}).`, false, {
          label: 'Discard them',
          run: () => {
            writeDraft(null);
            if (draft.name && names.includes(draft.name)) void openLayout(draft.name);
            else openTemp();
            setMessage(null);
          },
        });
      } else {
        const last = lastBuild.get();
        const pick = last && names.includes(last) ? last : last !== TEMP_BUILD && names.includes('example') ? 'example' : null;
        // Its notes (what moved into the account) are shown with the account's.
        if (pick) await openLayout(pick, notes);
        else openTemp(notes);
      }
      showNotes('Your saved files were updated to the new format', notes);
      setAccount(accountRef.current ?? acc.profile);
    })();
  }, [snap, data, store, openLayout, openTemp, adopt]);

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
  // The temp build is kept as it's edited.
  useEffect(() => {
    if (!account) return;
    if (!layoutName) {
      writeDraft(null);
      const t = setTimeout(() => tempBuild.write(writeBuild(layout)), 300);
      return () => clearTimeout(t);
    }
    if (!layoutDirty) return writeDraft(null);
    const t = setTimeout(() => writeDraft({ name: layoutName, text: writeBuild(layout), at: new Date().toISOString() }), 300);
    return () => clearTimeout(t);
  }, [account, layout, layoutDirty, layoutName]);
  /** Unsaved changes to a saved build (the temp build is never "unsaved": it's kept as it's edited). */
  const unsaved = layoutDirty && !!layoutName;

  // Closing or reloading the tab with unsaved build changes asks first (the browser's own "Leave site?" box).
  useEffect(() => {
    if (!unsaved) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [unsaved]);

  /** My profile as the engine uses it: the account with this build's setup put in. */
  const profile = useMemo(() => (account ? applySetup(account, layout.setup) : null), [account, layout.setup]);

  // ---------------------------------------------------------------- derived
  // The enemy's build (when the typed-in enemy has one) is edited with the same Build / Profile tabs.
  const inlineEnemy: InlineEnemy | null = typeof layout.battle?.enemy === 'object' ? layout.battle.enemy : null;
  const enemyBuild = inlineEnemy?.build ?? null;
  const editingEnemy = side === 'enemy' && !!enemyBuild;
  const bagLayout: UiLayout = useMemo(
    () => (editingEnemy && enemyBuild ? withIds({ placements: enemyBuild.placements, bag: enemyBuild.bag, enhanced_cells: enemyBuild.enhanced_cells, storage: enemyBuild.storage }) : layout),
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
  // Held items of the Build tab's bag and lists look like this under the pointer.
  useDragLook('build', (d) => (loadout ? lookOf(loadout, d) : null));
  // Dropped in another box of the page (or in the gap nearest to one): the item is removed (user, 2026-10-20).
  // Inside the Bag box (or nearest to it), off the bag and the storage: it goes back.
  const bagBoxRef = useRef<HTMLDivElement>(null);
  useDropTarget(bagBoxRef, { accepts: (d) => d.kind !== 'item' && d.scope === 'build', drop: () => {} });
  useDropElsewhere('build', (d, x, y, under) => {
    const box = removeBoxAt(x, y, under);
    if (box && !box.classList.contains('bag-box')) onTrashRef.current(d);
  });
  const onTrashRef = useRef<(d: DragItem) => void>(() => {});
  /** An item in the storage box, for its details: on its own (it has no neighbours there). */
  const inspectedStored = inspected ? bagLayout.storage?.find((x) => x.id === inspected) : undefined;
  const storedAlone = useMemo(() => {
    if (!inspectedStored || !data || !bagProfile) return null;
    const lo = buildLoadout(data, bagProfile, { placements: [{ id: inspectedStored.id, item: inspectedStored.item, x: 0, y: 0, rotation: inspectedStored.rotation, supply: inspectedStored.supply }] });
    return { loadout: lo, stats: aggregateStats(lo), synergy: buildSynergyReport(lo) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectedStored?.id, inspectedStored?.item, inspectedStored?.rotation, data, bagProfile]);
  const profileIssues = useMemo(
    () => (data && bagProfile ? loadProfile({ path: 'profile', text: stringify(bagProfile) }, data).issues : []),
    [data, bagProfile],
  );

  const defOf = (id: string): Item | Gear | undefined => data?.items.get(id) ?? data?.gear.get(id);

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
      const next = fn(withIds({ placements: b.placements, bag: b.bag, enhanced_cells: b.enhanced_cells, storage: b.storage }));
      const build: EnemyBuild = { ...b, placements: next.placements, bag: next.bag, enhanced_cells: next.enhanced_cells, storage: next.storage };
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
   * An edit to my profile in the Build tab: the account-wide part (stars, blessings, HP / ATK / Block) goes to
   * the account (saved automatically), the rest (hero, gear, which pets and skins) to this build.
   */
  const editMyProfile = (p: Profile) => {
    const acc = accountOf(withPetStars(p));
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

  /** An item or gear piece as it would be placed now (gear at the rarity it's equipped at). */
  const placeDef = (itemId: string) => (loadout && data?.gear.has(itemId) ? nextGearDef(loadout, itemId) : defOf(itemId));

  /** Clicked in a list (or Place on a gear piece): it goes straight into the first free spot, unrotated. */
  const startPlacing = (itemId: string, supply = false) => {
    const def = placeDef(itemId);
    const fp = def ? footprintOf(def) : null;
    if (!fp || !loadout) {
      say(`${def?.name ?? itemId} has no shape yet. Enter it in the item editor.`, true);
      return;
    }
    setMaskEdit(false);
    setEnhanceEdit(false);
    const at = findFirstFit(loadout.layout, fp, 0);
    if (!at) {
      say(`No room for ${def!.name} in the bag (only spots where it fits unrotated count). Make room, or drag it in or to the storage.`, true);
      return;
    }
    const { layout: next, id } = addPlacement(bagLayout, { item: itemId, x: at.x, y: at.y, rotation: 0, supply });
    editBag(() => next);
    setSelected(id);
    focusBag();
  };

  /** Where a held item lands in the bag (its held cell over x, y), kept within reach. */
  const dropTarget = (drag: DragItem, x: number, y: number): Landing | null => (loadout ? landing(loadout, drag, x, y) : null);

  const onKey = (action: KeyAction) => {
    if (!selected || !loadout) return;
    const r = keyOnSelected(bagLayout, loadout, selected, action);
    if (!r) return;
    if (r.layout) {
      const next = r.layout;
      editBag(() => next);
    }
    setSelected(r.selected);
    if (!r.selected) setInspected(null);
  };

  /** Dropped on the bag with its held cell over (x, y). */
  const onDrop = (drag: DragItem, x: number, y: number) => {
    const at = dropTarget(drag, x, y);
    if (!at) return;
    const r = dropInBag(bagLayout, drag, at);
    editBag(() => r.layout);
    setSelected(r.selected);
    focusBag();
  };
  /** Dropped in the storage box with its top-left corner at (fx, fy). */
  const onStore = (drag: DragItem, fx: number, fy: number) => {
    if (drag.kind === 'placed') editBag((l) => updateStored(toStorage(l, drag.id, fx, fy), drag.id, { rotation: drag.rotation }));
    else if (drag.kind === 'stored') editBag((l) => updateStored(l, drag.id, { x: fx, y: fy, rotation: drag.rotation }));
    else {
      const def = placeDef(drag.id);
      if (!def || !footprintOf(def)) return;
      const { layout: next, id } = addStored(bagLayout, drag.id, fx, fy);
      editBag(() => updateStored(next, id, { rotation: drag.rotation, supply: !!drag.supply }));
      setSelected(id);
      return;
    }
    setSelected(drag.id);
  };
  /** Dropped outside the Bag box: removed. */
  const onTrash = (drag: DragItem) => {
    editBag((l) => dropInBin(l, drag));
    if (selected === drag.id) {
      setSelected(null);
      setInspected(null);
    }
  };
  onTrashRef.current = onTrash;
  /** How a held item looks (the Build tab's bag and lists; the Battle tab draws its own). */
  const lookBuild = (d: DragItem) => (loadout ? lookOf(loadout, d) : null);

  /** The storage box's items, drawn like the bag's. */
  const storedViews: StoredView[] = (bagLayout.storage ?? []).flatMap((st) => {
    const def = placeDef(st.item);
    const cells = turnedCells(def, st.rotation);
    if (!def || !cells) return [];
    const isGear = !!data?.gear.has(st.item);
    return [
      {
        id: st.id,
        item: st.item,
        name: def.name,
        cells,
        rotation: st.rotation,
        color: rarityColor('rarity' in def ? (def.rarity as string) : null, isGear),
        gear: isGear,
        sprite: spriteOf(def as Parameters<typeof spriteOf>[0], st.rotation),
        x: st.x,
        y: st.y,
      },
    ];
  });

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
      // Deleting the open build leaves its bag open as the temp build.
      if (layoutName === name) {
        setLayoutName('');
        setLayoutDirty(false);
        lastBuild.set(TEMP_BUILD);
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
      // Saving the temp build under a name moves it into the list.
      if (!layoutName) tempBuild.write(null);
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

  /** Rename a saved build (the file is written under the new name, then the old one is deleted). */
  const doRename = async (from: string, to: string) => {
    try {
      // The file is copied as it is (an older build keeps its own values until it's opened), with the new name.
      const raw: unknown = parseYaml(await store.readBuild(from));
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Raw) : {};
      await store.writeBuild(to, stringify({ ...obj, name: to }, { lineWidth: 0 }));
      await store.deleteBuild(from);
      setBuilds((b) => [...b.filter((x) => x !== from && x !== to), to].sort());
      if (layoutName === from) {
        setLayoutName(to);
        setLayout((l) => ({ ...l, name: to }));
        lastBuild.set(to);
      }
      setPreviewTexts((t) => {
        const { [from]: text, ...rest } = t;
        return text ? { ...rest, [to]: text } : rest;
      });
      say(`Renamed "${from}" to "${to}".`);
    } catch (e) {
      say(`Couldn't rename "${from}": ${(e as Error).message}`, true);
    }
  };
  const loadPreviews = async () => {
    if (!previewOn) return;
    const names = await store.listBuilds().catch(() => [] as string[]);
    const out: Record<string, string> = {};
    for (const n of names) {
      try {
        out[n] = await store.readBuild(n);
      } catch {
        /* no preview for it */
      }
    }
    setPreviewTexts(out);
  };

  /** One file with everything needed to rebuild this build elsewhere. */
  const doExportBuild = () => {
    const name = layoutName || layout.name || 'build';
    downloadText(`${name.replace(/[^\w\- ]+/g, '_')}.yaml`, writeBuild({ ...layout, name }));
  };
  const doImportBuild = async (file: File) => {
    try {
      const read = readBuild(await file.text(), { v1Profile: v1Ref.current }, file.name);
      const a = adopt(read.layout, file.name);
      const r = { layout: a.layout, notes: [...read.notes, ...a.notes] };
      setLayout((cur) => {
        const next = withIds(r.layout);
        return cur.battle ? { ...next, battle: cur.battle } : next;
      });
      setLayoutName(safeBuildName(file.name.replace(/\.ya?ml$/i, '')));
      setLayoutDirty(true);
      setSelected(null);
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

  /** A build file someone shared as my Arena opponent (with my account, like my own builds). */
  const doImportOpponent = async (file: File) => {
    try {
      const r = readBuild(await file.text(), { v1Profile: v1Ref.current }, file.name);
      const l = r.layout;
      const name = (l.name || file.name.replace(/\.ya?ml$/i, '')).slice(0, 64);
      const build: EnemyBuild = {
        profile: applySetup(account ?? DEFAULT_PROFILE, l.setup),
        placements: l.placements,
        ...(l.bag ? { bag: l.bag } : {}),
        ...(l.enhanced_cells ? { enhanced_cells: l.enhanced_cells } : {}),
      };
      editLayout((cur) => ({ ...cur, battle: { ...(cur.battle ?? { mode: 'arena', seed: 1, runs: 1 }), mode: 'arena', enemy: playerEnemy(name, build) } }));
      showNotes(`Imported ${file.name}`, r.notes);
      say(`${name} is your Arena opponent.`);
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
        accountRef.current = acc.profile;
        setAccount(acc.profile);
      }
      // Builds are stored in today's format, completed from the account they were exported with.
      const ctx = imp.accountText ? (readAccount(imp.accountText).migratedFromV1 ?? v1) : v1;
      for (const b of imp.builds) {
        const r = readBuild(b.text, { v1Profile: ctx }, `"${b.name}"`);
        const a = adopt(r.layout, `"${b.name}"`);
        notes.push(...r.notes, ...a.notes);
        await store.writeBuild(b.name, writeBuild(a.layout));
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
  const selectedPlacement = selected ? bagLayout.placements.find((x) => x.id === selected) : undefined;
  const selectedStored = selected ? bagLayout.storage?.find((x) => x.id === selected) : undefined;
  const selectedName = (() => {
    const it = selectedPlacement ?? selectedStored;
    return it ? (defOf(it.item)?.name ?? it.item) : '';
  })();
  const bagHeroId = editingEnemy ? bagProfile.active_hero : (layout.hero ?? null);
  const heroClass = bagHeroId ? (data.heroes.get(bagHeroId)?.class ?? null) : null;
  const bagSizes = bagSizesFor(data, heroClass);
  const bagSize = sizeOf(bagLayout.bag?.mask, bagSizes);
  const enhancer = enhancerOf(data, bagProfile, bagHeroId);
  // The storage box: as tall as the bag (with its 1-cell border), level with it, about a third as wide.
  // As tall as the bag's own cells and level with them (the border around the bag isn't counted); wide enough
  // for items at full size.
  const bagMargin = marginFor(loadout.bag.width, loadout.bag.height, [...loadout.layout.items.values()].flatMap((i) => i.cells));
  const storageH = loadout.bag.height * 40;
  const storageW = 4 * 40;
  const flags = buildFlags(loadout, loaded);
  const pets = petPoints(data, bagProfile);
  /** Edit the profile being shown (mine or the enemy's) with a mutating function. */
  const updateBag = (fn: (p: Profile) => void) => {
    const next = structuredClone(bagProfile);
    fn(next);
    setBagProfile(next);
  };

  /** A build's bag for the list's previews (null = the temp build); the open build is shown as it is now. */
  const previewOf = (name: string | null) => {
    if (!data || !account) return null;
    try {
      let l: LayoutData;
      if (!editingEnemy && (name ?? '') === layoutName) l = layout;
      else if (name === null) {
        const t = tempBuild.read();
        l = t ? readBuild(t.text, { v1Profile: v1Ref.current }).layout : { placements: [] };
      } else {
        const text = previewTexts[name];
        if (!text) return <span className="small muted">…</span>;
        l = readBuild(text, { v1Profile: v1Ref.current }).layout;
      }
      return <BagPreview loadout={buildLoadout(data, applySetup(account, l.setup), l)} />;
    } catch {
      return <span className="small muted">no preview</span>;
    }
  };

  const buildPanel = (
    <Panel
      id="battle.build"
      title={editingEnemy ? `${enemyName}'s build` : 'Build'}
      aside={
        <button
          className={`small toggle${previewOn ? ' on' : ''}`}
          aria-pressed={previewOn}
          title="Show each build's bag in the build list"
          onClick={() => {
            const next = !previewOn;
            setPreviewOn(next);
            try {
              localStorage.setItem('og-sim/preview-bags', next ? '1' : '0');
            } catch {
              /* a convenience only */
            }
          }}
        >
          Preview bag
        </button>
      }
    >
      <BuildPicker
        builds={builds}
        active={editingEnemy ? (enemyBuild?.source_layout ?? '') : layoutName}
        dirty={editingEnemy ? false : unsaved}
        saveEnabled={editingEnemy}
        noTemp={editingEnemy}
        tempHasItems={!layoutName && layout.placements.length > 0}
        what={editingEnemy ? `${enemyName}'s build` : 'your build'}
        previews={previewOn}
        renderPreview={previewOf}
        onOpenList={() => void loadPreviews()}
        onSave={(n) => void (editingEnemy ? doSaveEnemyBuild(n) : doSaveLayout(n))}
        onRename={(from, to) => void doRename(from, to)}
        onDelete={(n) => void doDeleteLayout(n)}
        onOpenTemp={openTemp}
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
          // A new build starts in the temp build, with this build's hero, blessings, gear, pets and skins, and an empty bag.
          setLayout((l) => ({ placements: [], ...(l.hero ? { hero: l.hero } : {}), ...(l.setup ? { setup: l.setup } : {}), ...(l.battle ? { battle: l.battle } : {}) }));
          setLayoutName('');
          setLayoutDirty(false);
          lastBuild.set(TEMP_BUILD);
          setSelected(null);
          setInspected(null);
        }}
      />
    </Panel>
  );

  return (
    <StoreContext.Provider value={store}>
    <DragLayer />
    <div className={`app${settings.animateRotation ? ' anim-rot' : ''}`} style={{ ['--rot-ms' as string]: `${settings.rotationMs}ms` }}>
      {showSettings && <SettingsDialog settings={settings} onClose={() => setShowSettings(false)} />}
      <div className="topbar">
        <h1>OG Backpack Simulator</h1>
        <div className="tabs" role="tablist" data-tour="topbar.tabs">
          {(
            [
              ['bag', 'Build'],
              ['battle', 'Battle'],
              ['optimize', 'Optimize'],
              ['profile', 'Profile'],
              ['editor', 'Item editor'],
              ['data', `Data${dataErrors ? ` (${dataErrors} errors)` : ''}`],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => {
                if (t === 'data') setDataFocus(false);
                setTab(t);
                // On a phone, a tab opens its first step (or stays on the current one if it's in that tab).
                const inTab = STEPS.filter((x) => x.tab === t);
                if (mobile && inTab.length && !inTab.some((x) => x.id === step)) setStep(inTab[0]!.id);
              }}>
              {label}
            </button>
          ))}
        </div>
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
          {!showGuide && (
            <button data-tour="topbar.tutorial" onClick={() => setAskTour(true)} title="A guided tour of every part of the simulator">
              Tutorial
            </button>
          )}
          <span className="row" data-tour="topbar.account">
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
          <button className="icon-button gear" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)}>
            <GearIcon />
          </button>
        </span>
      </div>
      {mobile && STEPS.some((x) => x.tab === tab) && (
        <nav className="steps" aria-label="Steps">
          {STEPS.map((x, i) => (
            <button key={x.id} aria-current={step === x.id ? 'step' : undefined} className={step === x.id ? 'active' : ''} onClick={() => goStep(x.id)}>
              {i + 1}. {x.label}
            </button>
          ))}
        </nav>
      )}
      {showGuide && tab === 'bag' && (
        <Guide
          empty={(account?.heroes.length ?? 0) === 0}
          savedIn={store.kind === 'browser' ? 'this browser' : 'the project folder (profile/ and layouts/)'}
          onProfile={() => setTab('profile')}
          onTour={() => setAskTour(true)}
          onClose={() => {
            guideDone.set(true);
            setShowGuide(false);
          }}
        />
      )}
      {askTour && (
        <Dialog
          title="Take the tour?"
          onCancel={() => setAskTour(false)}
          actions={[
            {
              label: 'Start the tour',
              kind: 'primary',
              onClick: () => {
                setAskTour(false);
                setSide('me');
                // The welcome card makes way: the tour ends on the Tutorial button that replaces it.
                guideDone.set(true);
                setShowGuide(false);
                tourStartAccount.current = accountText;
                setTouring(true);
              },
            },
          ]}
        >
          <p className="small">A few minutes. It moves between the tabs, highlights each part with a short explanation, and lets you fill in your profile on the way. You can skip it at any step.</p>
        </Dialog>
      )}
      {touring && (
        <Tour
          steps={APP_TOUR}
          onTab={(t) => setTab(t as Tab)}
          onClose={() => {
            setTouring(false);
            setTab('bag');
            // Done with the tour = done with the welcome card; the Tutorial button stays in the top bar.
            guideDone.set(true);
            setShowGuide(false);
            if (accountText !== tourStartAccount.current) setAskBackup(true);
          }}
        />
      )}
      {askBackup && (
        <Dialog
          title="Back up your account?"
          onCancel={() => setAskBackup(false)}
          actions={[
            {
              label: 'Export account',
              kind: 'primary',
              onClick: () => {
                setAskBackup(false);
                void doExportAccount();
              },
            },
          ]}
        >
          <p className="small">
            Your profile is saved in {store.kind === 'browser' ? 'this browser' : 'the project folder'} already. Export account also downloads it (with every saved build) as one file, so you can bring
            it back on another browser or computer with Import account.
          </p>
        </Dialog>
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
        <div className={`main build${editingEnemy ? ' editing-enemy' : ''}`}>
          <div className="build-strip" style={showIf(['hero', 'gear', 'pets', 'skins', 'items'])}>
            {buildPanel}
          </div>
          <RemoveOverlay />
          <div className="stack build-items" style={showIf(['items'])}>
            <div className="items-box">
            <Panel id="battle.items" title="Items">
              <ItemBrowser
                data={data}
                heroClass={heroClass}
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
                  onRemove: (itemId) => {
                    editBag((l) => ({ ...l, placements: l.placements.filter((p) => !(p.supply && p.item === itemId)) }));
                    setSelected(null);
                  },
                }}
              />
            </Panel>
            </div>
          </div>
          <div className="stack build-bag" style={showIf(['items'])}>
            {editingEnemy && (
              <div className="issue warning">
                Editing <b>{enemyName}</b>'s build: bag, hero, gear, pets and skins here, its heroes and auras in the Profile tab. It's saved with your build.{' '}
                <button onClick={() => setSide('me')}>Back to my build</button>
              </div>
            )}
            <div
              ref={bagBoxRef}
              className="bag-box"
              // A click anywhere in the box that isn't on an item or a control lets go of the selected item.
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('.item-cell, .stored-item, button, input, select, label, a, summary, .cell')) {
                  setSelected(null);
                  setInspected(null);
                }
              }}
            >
            <Panel
              id="battle.bag"
              title="Bag"
              aside={`${mask.filter((v) => v).length} cells · ${bagLayout.placements.length} placed${bagLayout.storage?.length ? ` · ${bagLayout.storage.length} stored` : ''}`}
              tools={
                enemyBuild && (
                  <span className="tabs whose" role="radiogroup" aria-label="Whose build" title="Which bag this box edits: yours, or your opponent's (it has its own bag, hero, gear and pets)">
                    <button role="radio" aria-checked={side === 'me'} className={`small${side === 'me' ? ' active' : ''}`} onClick={() => setSide('me')}>
                      My build
                    </button>
                    <button role="radio" aria-checked={side === 'enemy'} className={`small${side === 'enemy' ? ' active enemy-side' : ''}`} onClick={() => setSide('enemy')}>
                      ⚔ {enemyName}
                    </button>
                  </span>
                )
              }
            >
              <div className="bag-status small">
                {selectedStored || selectedPlacement ? (
                  <>
                    <div className="muted">
                      {selectedStored
                        ? 'In the storage: drag it into the bag. Space or another click rotates it, Delete removes it.'
                        : 'Arrows move it, space or another click rotates it (space works while dragging too), Delete removes it (or drag it out of this box).'}
                    </div>
                    <div className="row bag-actions">
                      <button className="primary details-button" onClick={() => setInspected(selected)} aria-pressed={inspected === selected}>
                        Item details
                      </button>
                      <button className="small" onClick={() => onKey('rotate')}>
                        Rotate
                      </button>
                      <button className="small" onClick={() => onKey('remove')}>
                        Remove
                      </button>
                      <b className="selected-name">{selectedName}</b>
                      {selectedPlacement?.supply && <span className="badge">starting equipment</span>}
                    </div>
                  </>
                ) : maskEdit ? (
                  <div>Click cells to open or close them.</div>
                ) : enhanceEdit ? (
                  <div>
                    Click the {enhancer?.count === 1 ? 'slot' : `${enhancer?.count ?? ''} slots`} {enhancer?.skill ?? 'the hero skill'} enhanced this run
                    {enhancer ? ` (${enhancer.label})` : ''}: they're random in game.
                  </div>
                ) : (
                  <div className="muted">Click an item on the right to put it in the bag, or drag it in. Click an item in the bag to select it.</div>
                )}
              </div>
              <div className="bag-and-storage">
                <div className="bag-column">
                  <BagGrid
                    loadout={loadout}
                    issues={issues}
                    selected={selected}
                    hovered={hovered}
                    maskEdit={maskEdit}
                    enhanced={bagLayout.enhanced_cells ?? []}
                    enhancedLook={enhancer}
                    enhanceEdit={enhanceEdit}
                    onToggleEnhanced={toggleEnhanced}
                    onSelect={(id) => {
                      setSelected(id);
                      if (id === null) setInspected(null);
                    }}
                    onRotate={() => onKey('rotate')}
                    onHover={setHovered}
                    onToggleMask={toggleMask}
                    dropTarget={dropTarget}
                    onDrop={onDrop}
                    onKey={onKey}
                    acceptsNew
                  />
                </div>
                <Storage
                  items={storedViews}
                  width={storageW}
                  height={storageH}
                  selected={selected}
                  look={lookBuild}
                  onSelect={setSelected}
                  onRotate={() => onKey('rotate')}
                  onDrop={onStore}
                  top={bagMargin * 40}
                />
              </div>
              <div className="row small" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                {value && (
                  <span
                    className="build-value"
                    title={`Shop value of the ${value.items} bought item(s) in the bag; starting equipment, gear, pet / skin spawns and stored items don't count.${value.unknown.length ? `\nValue not known: ${value.unknown.join(', ')}` : ''}`}
                  >
                    Build value <b>{value.total}</b> coins
                    {value.unknown.length > 0 && <span className="warn"> + ? ({value.unknown.length} unknown)</span>}
                  </span>
                )}
                <span className="row">
                  <label className="muted" title={`The bags ${heroClass ? `a ${heroClass}` : 'this class'} can have: the full 8 × 6 one, or a smaller one`}>
                    Bag{' '}
                    <select
                      aria-label="Bag size"
                      value={bagSize ?? ''}
                      onChange={(e) => {
                        const size = bagSizes.find((b) => b.name === e.target.value);
                        if (!size) return;
                        setMaskEdit(false);
                        editBag((l) => (size.mask ? { ...l, bag: { mask: size.mask } } : { ...l, bag: undefined }));
                      }}
                    >
                      {bagSize === null && <option value="">Custom</option>}
                      {bagSizes.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name === 'Full' ? 'Full (48)' : b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={maskEdit ? 'primary small' : 'small'}
                    onClick={() => {
                      setMaskEdit((m) => !m);
                      setEnhanceEdit(false);
                    }}
                    title="Open or close bag cells one by one"
                  >
                    {maskEdit ? 'Done' : 'Edit cells'}
                  </button>
                  {maskEdit && (
                    <label className="muted">
                      Rows <input type="number" min={1} max={12} aria-label="Bag rows" value={loadout.bag.height} onChange={(e) => setRows(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 52 }} />
                    </label>
                  )}
                  {(enhancer || (bagLayout.enhanced_cells?.length ?? 0) > 0) && (
                    <button
                      className={enhanceEdit ? 'primary small' : 'small'}
                      onClick={() => {
                        setEnhanceEdit((m) => !m);
                        setMaskEdit(false);
                      }}
                      style={enhancer && !enhanceEdit ? { borderColor: enhancer.color } : undefined}
                      title={enhancer ? `Mark the ${enhancer.count === 1 ? 'slot' : `${enhancer.count} slots`} ${enhancer.skill} enhanced this run: ${enhancer.label}` : "This hero has no skill that enhances slots: these marks do nothing"}
                    >
                      {enhanceEdit ? 'Done' : `${enhancer ? `${enhancer.skill} slots` : 'Enhanced cells'}${bagLayout.enhanced_cells?.length ? ` (${bagLayout.enhanced_cells.length})` : ''}`}
                    </button>
                  )}
                </span>
              </div>
              {!enhancer && (bagLayout.enhanced_cells?.length ?? 0) > 0 && (
                <div className="issue warning small">
                  {bagLayout.enhanced_cells!.length} enhanced cell(s) are marked, but this hero has no skill that enhances slots, so they do nothing.{' '}
                  <button className="small" onClick={() => editBag((l) => ({ ...l, enhanced_cells: undefined }))}>
                    Clear them
                  </button>
                </div>
              )}
              {enhancer && (bagLayout.enhanced_cells?.length ?? 0) > enhancer.count && (
                <div className="issue warning small">
                  {enhancer.skill} enhances {enhancer.count} slot{enhancer.count === 1 ? '' : 's'}; {bagLayout.enhanced_cells!.length} are marked.
                </div>
              )}
            </Panel>
            </div>
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
          </div>
          <div className="stack build-setup" style={showIf(['hero', 'gear', 'pets', 'skins'])}>
            <div style={showIf(['hero'])}>
            <Panel id="battle.hero" title="Hero">
              <HeroEditor data={data} profile={bagProfile} heroId={editingEnemy ? bagProfile.active_hero : (layout.hero ?? null)} onHero={(id) => (editingEnemy ? setBagProfile({ ...bagProfile, active_hero: id }) : setBuildHero(id))} update={updateBag} account={!editingEnemy} />
            </Panel>
            </div>
            <div style={showIf(['gear'])}>
            <Panel id="battle.gear" title="Gear">
              <GearEditor data={data} profile={bagProfile} update={updateBag} loadout={loadout} onPlace={(g) => startPlacing(g.id)} />
            </Panel>
            </div>
            <div style={showIf(['pets'])}>
            <Panel id="battle.pets" title="Pets" aside={`${pets.used} / ${pets.max} points`}>
              <PetsEditor data={data} profile={bagProfile} update={updateBag} account={!editingEnemy} />
            </Panel>
            </div>
            <div style={showIf(['skins'])}>
            <Panel id="battle.skins" title="Skins" aside={`${(bagProfile.equipped_skins ?? []).length} / 2`}>
              <SkinsEditor data={data} profile={bagProfile} update={updateBag} account={!editingEnemy} />
            </Panel>
            </div>
          </div>
          {inspected && storedAlone?.stats.items.get(inspected) && (
            <ItemDrawer
              s={storedAlone.stats.items.get(inspected)!}
              syn={storedAlone.synergy.get(inspected)}
              start={undefined}
              names={(id) => storedAlone.stats.items.get(id)?.name ?? id}
              image={(storedAlone.loadout.layout.items.get(inspected)?.def as { image?: string } | undefined)?.image}
              worth={itemWorth(storedAlone.loadout, inspected)}
              note="In the storage: its numbers on its own, without neighbours in the bag."
              onClose={() => setInspected(null)}
            />
          )}
          {inspected && !inspectedStored && stats?.items.get(inspected) && (
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

      {/* Kept mounted (only hidden) so a battle's results survive switching tabs. */}
      <div style={tab === 'battle' ? undefined : { display: 'none' }}>
        <BattleTab
          only={mobile ? (step === 'fight' ? 'fight' : 'opponent') : undefined}
          data={data}
          layout={layout}
          profile={profile}
          layoutName={layoutName}
          builds={builds}
          battle={layout.battle}
          onChange={(b) => editLayout((l) => ({ ...l, battle: b }))}
          myBuild={myBuild}
          layoutAsBuild={layoutAsBuild}
          onEditEnemy={() => {
            setSide('enemy');
            setSelected(null);
            setTab('bag');
          }}
          onOpenBuild={(name) => {
            if ((name ?? '') === layoutName) return;
            if (unsaved) setAskOpen({ name });
            else if (name === null) openTemp();
            else void openLayout(name);
          }}
          onKeep={(l) => {
            editLayout((cur) => ({ ...cur, placements: l.placements, ...(l.storage ? { storage: l.storage } : {}) }));
            say(layoutName ? `Kept the new arrangement in "${layoutName}" (not saved yet).` : 'Kept the new arrangement in the temp build.');
          }}
          onImportOpponent={(f) => void doImportOpponent(f)}
        />
      </div>
      {askOpen && (
        <Dialog
          title={askOpen.name === null ? 'Open the temp build?' : `Open "${askOpen.name}"?`}
          onCancel={() => setAskOpen(null)}
          actions={[
            {
              label: 'Open it',
              kind: 'primary',
              onClick: () => {
                if (askOpen.name === null) openTemp();
                else void openLayout(askOpen.name);
                setAskOpen(null);
              },
            },
          ]}
        >
          <p>Your unsaved changes to "{layoutName}" will be lost.</p>
        </Dialog>
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
            say('Optimized build put in the Build tab (not saved yet).');
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
            // Only what's about the account (the build's own checks are in the Build tab).
            loadoutIssues={issues.filter((i) => /^(blessing_|link_)/.test(i.code))}
            editingEnemy={editingEnemy}
            // My Profile tab is the account only: heroes, stars, links, auras. It never touches the build's setup.
            onChange={(p) => (editingEnemy ? setBagProfile(p) : setAccount(accountOf(p)))}
          />
        </>
      )}

      {tab === 'editor' && (
        <>
          <div className="row editor-head" data-tour="editor.head">
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

      {mobile && STEPS.some((x) => x.tab === tab) && (
        <div className="step-nav">
          {(() => {
            const i = STEPS.findIndex((x) => x.id === step);
            return (
              <>
                <button disabled={i <= 0} onClick={() => goStep(STEPS[i - 1]!.id)}>
                  ← Back
                </button>
                <span className="small muted">
                  {i + 1} / {STEPS.length}
                </span>
                <button className="primary" disabled={i >= STEPS.length - 1} onClick={() => goStep(STEPS[i + 1]!.id)}>
                  {i < STEPS.length - 1 ? `Next: ${STEPS[i + 1]!.label} →` : 'Done'}
                </button>
              </>
            );
          })()}
        </div>
      )}
      {tab === 'data' && <DataPanel key={dataFocus ? 'build' : 'all'} result={loaded} buildRefs={buildDataRefs(playerLoadout)} focusBuild={dataFocus} />}
    </div>
    </StoreContext.Provider>
  );
}

/**
 * The Build tab's boxes a held item can be dropped in: the Bag box keeps it, any other removes it. Each box is a
 * panel (the Bag box counts as one, with what's in it).
 */
function removeBoxAt(x: number, y: number, under: Element | null): Element | null {
  const page = document.querySelector('.main.build');
  if (!page) return null;
  const boxes = [...page.querySelectorAll('.bag-box, .panel')].filter((b) => b.classList.contains('bag-box') || !b.closest('.bag-box'));
  return nearestBox(boxes, x, y, under);
}

/** While a bag's item is held over a box other than the Bag box (or the gap nearest it): dropping it there removes it. */
function RemoveOverlay() {
  const d = useDragState();
  if (!d || d.kind === 'item' || d.scope !== 'build') return null;
  const box = removeBoxAt(d.x, d.y, dragUnder());
  if (!box || box.classList.contains('bag-box')) return null;
  const r = box.getBoundingClientRect();
  return (
    <div className="remove-overlay" aria-hidden="true" style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
      <TrashIcon />
      <span>Remove item</span>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.49.42l-.36 2.54c-.58.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.66 8.84a.5.5 0 00.12.64l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.39 1.05.7 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.25 0 .45-.18.49-.42l.36-2.54c.58-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"
      />
    </svg>
  );
}

/** Settings: items turning smoothly (and how fast), and what a held item turns around. */
function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const NAMES: Record<string, string> = {
    cursor: 'around the cursor (the part you hold stays under it)',
    center: 'around the centre of its cells',
    'top-left': 'keeping its top-left corner',
    'top-right': 'keeping its top-right corner',
    'bottom-left': 'keeping its bottom-left corner',
    'bottom-right': 'keeping its bottom-right corner',
  };
  const pivot = (key: 'squarePivot' | 'otherPivot' | 'placedSquarePivot' | 'placedOtherPivot', label: string) => (
    <label className="row small settings-pivot">
      <span className="muted">{label}</span>
      <select aria-label={label} value={settings[key]} onChange={(e) => setSettings({ [key]: e.target.value } as Partial<Settings>)}>
        {(key.startsWith('placed') ? ANCHORS : ['cursor', ...ANCHORS]).map((v) => (
          <option key={v} value={v}>
            {NAMES[v]}
          </option>
        ))}
      </select>
    </label>
  );
  const LOOKS: Record<RarityLook, string> = { full: 'full background', ring: 'a ring of that colour', none: 'nothing' };
  const percent = (key: keyof Settings, label: string, disabled: boolean) => (
    <label className="row small">
      <span className="muted">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        aria-label={label}
        disabled={disabled}
        value={settings[key] as number}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) setSettings({ [key]: Math.max(0, Math.min(100, Math.round(v))) } as Partial<Settings>);
        }}
        style={{ width: 64 }}
      />
      %
    </label>
  );
  const rarity = (kind: 'item' | 'gear', label: string) => {
    const look = settings[`${kind}Look`];
    return (
      <div className="settings-rarity">
        <label className="row small settings-pivot">
          <span className="muted">{label}</span>
          <select aria-label={`${label}: rarity colour`} value={look} onChange={(e) => setSettings({ [`${kind}Look`]: e.target.value } as Partial<Settings>)}>
            {RARITY_LOOKS.map((v) => (
              <option key={v} value={v}>
                {LOOKS[v]}
              </option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 12 }}>
          {percent(`${kind}Opacity`, `${label}: opacity`, look === 'none')}
          {percent(`${kind}SelectedOpacity`, `${label}: opacity when selected`, look === 'none')}
        </div>
      </div>
    );
  };
  return (
    <Dialog title="Settings" onCancel={onClose} actions={[]}>
      <h3>Rotating</h3>
      <label className="check-line small">
        <input type="checkbox" checked={settings.animateRotation} onChange={(e) => setSettings({ animateRotation: e.target.checked })} />
        <span>Show items turning (instead of jumping to the new direction)</span>
      </label>
      <label className="row small" style={{ marginTop: 4 }}>
        <span className="muted">Turn time</span>
        <input
          type="number"
          min={0}
          max={2000}
          step={25}
          aria-label="Turn time (ms)"
          disabled={!settings.animateRotation}
          value={settings.rotationMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v)) setSettings({ rotationMs: Math.max(0, Math.min(2000, Math.round(v))) });
          }}
        />
        ms
      </label>
      <h3>Rarity colour behind items</h3>
      {rarity('item', 'Items')}
      {rarity('gear', 'Gear')}
      <div className="small muted">For items with a picture; one without a picture always has its full colour.</div>
      <h3>Turning an item in the bag (space or a click)</h3>
      {pivot('placedSquarePivot', 'Square items (as wide as they are tall)')}
      {pivot('placedOtherPivot', 'Other items')}
      <h3>Turning an item while dragging it (space)</h3>
      {pivot('squarePivot', 'Square items, held')}
      {pivot('otherPivot', 'Other items, held')}
      <div className="small muted">Kept in this browser.</div>
    </Dialog>
  );
}
