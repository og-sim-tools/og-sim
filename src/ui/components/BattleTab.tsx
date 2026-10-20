/**
 * Battle tab (user, 2026-10-19 and 2026-10-20): a bar to pick Arena, Raid or Chapter; my bag and my opponent's
 * side by side (half the width each), each with its hero, blessings, gear rarities, pets, skins and auras under
 * it and its detailed stats folded away; the fight below both.
 *
 * - Arena: PvP against a build only (one of mine, a copy of mine, or a build file); both bags can be rearranged.
 * - Raid: a fixed boss (a placeholder for now); 15 s, then I'm defeated; what counts is the damage dealt.
 * - Chapter: pick the chapter; its enemies aren't entered yet, so a stand-in is fought (sandbox). The full
 *   playthrough is [later].
 *
 * Items moved here are a try-out: Keep puts the change in the build, Undo forgets it.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { chapterInfo } from '../../engine/chapters';
import type { GameData } from '../../engine/loader';
import { buildLoadout } from '../../engine/loadout';
import type { EnemyBuild, LayoutData, Profile } from '../../engine/model';
import { parseAbbrev } from '../../engine/numbers';
import { validateLoadout } from '../../engine/validate';
import { useDragLook, dragJustEnded } from '../drag';
import { dropInBag, keyOnSelected, landing, lookOf } from '../state/bagEdit';
import { type KeyAction, type UiLayout, withIds } from '../state/layoutOps';
import { imageUrl } from '../staticData';
import { BagGrid } from './BagGrid';
import { BattlePanel, playerEnemy } from './BattlePanel';
import { DetailedStats } from './DetailedStats';
import { Panel } from './Panel';

type Battle = NonNullable<LayoutData['battle']>;
type Inline = Exclude<NonNullable<Battle['enemy']>, string>;
export type BattleKind = 'arena' | 'raid' | 'chapter';

interface Props {
  data: GameData;
  /** My open build, and my profile with it put in. */
  layout: UiLayout;
  profile: Profile;
  /** The open build ('' = the temp build). */
  layoutName: string;
  builds: string[];
  battle: Battle | undefined;
  onChange: (b: Battle) => void;
  myBuild: () => EnemyBuild;
  layoutAsBuild: (name: string) => Promise<EnemyBuild>;
  /** Edit the opponent's bag, hero, gear and pets in the Build tab. */
  onEditEnemy: () => void;
  /** Open one of my builds (null = the temp build) to fight with. */
  onOpenBuild: (name: string | null) => void;
  /** Keep the bag changes made here in the open build. */
  onKeep: (layout: UiLayout) => void;
  /** A build file as the opponent (Arena). */
  onImportOpponent?: (file: File) => void;
  /** Phones: one part at a time. */
  only?: 'me' | 'opponent' | 'fight';
}

const TEMP = '\u0000temp';
const DEFAULT_BATTLE: Battle = { mode: 'stage', seed: 1, runs: 1 };
const CHAPTER_MODES = ['stage', 'boss_rush', 'gauntlet'];

export const kindOf = (b: Battle | undefined): BattleKind => (b?.mode === 'arena' ? 'arena' : b?.mode === 'raid' ? 'raid' : 'chapter');

export function BattleTab(p: Props) {
  const { data, layout, profile, layoutName, builds, onChange } = p;
  const b = p.battle ?? DEFAULT_BATTLE;
  const kind = kindOf(b);
  const inline: Inline | null = typeof b.enemy === 'object' ? b.enemy : null;
  const monster = typeof b.enemy === 'string' ? (data.enemies.get(b.enemy) ?? null) : null;
  const foeBuild = inline?.build ?? monster?.build ?? null;

  // Try-out moves: kept apart from the build until Keep. They belong to the bag they started from.
  const [myEdit, setMyEdit] = useState<{ base: UiLayout; layout: UiLayout } | null>(null);
  const [foeEdit, setFoeEdit] = useState<{ base: EnemyBuild; build: EnemyBuild } | null>(null);
  const mine = myEdit && myEdit.base === layout ? myEdit.layout : layout;
  const foe = foeEdit && foeBuild && foeEdit.base === foeBuild ? foeEdit.build : foeBuild;
  const myChanged = mine !== layout;
  const foeChanged = !!foe && foe !== foeBuild;
  useEffect(() => setMyEdit(null), [layoutName]);

  const myLoadout = useMemo(() => buildLoadout(data, profile, mine), [data, profile, mine]);
  const fightBattle: Battle = foeChanged && inline ? { ...b, enemy: { ...inline, build: foe! } } : b;

  const setKind = (k: BattleKind) => {
    if (k === kind) return;
    const hasBuild = !!inline?.build;
    if (k === 'arena') onChange({ ...b, mode: 'arena', enemy: hasBuild ? b.enemy : undefined, enemies: undefined, duration_s: undefined });
    else if (k === 'raid') onChange({ ...b, mode: 'raid', enemy: 'raid_boss', enemies: undefined, duration_s: undefined });
    else {
      const ch = b.chapter ?? { number: 1, play: 'sandbox' as const, fight: 1 };
      onChange({ ...b, mode: chapterInfo(data, ch.number).bossChapter ? 'boss_rush' : 'stage', chapter: ch, enemy: hasBuild || b.enemy === 'raid_boss' ? undefined : b.enemy, enemies: undefined });
    }
  };

  const modeBar = (
    <Panel id="battle.mode" title="Battle" className="battle-mode">
      <div className="row">
        <div className="tabs" role="tablist" aria-label="Kind of battle">
          {(
            [
              ['arena', 'Arena'],
              ['raid', 'Raid'],
              ['chapter', 'Chapter'],
            ] as [BattleKind, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="small muted">
          {kind === 'arena'
            ? 'Player against player: your build against another build (yours, a copy, or a file someone shared). Both bags can be rearranged.'
            : kind === 'raid'
              ? 'A fixed raid boss for 15 s; when time is up you are defeated. What counts is the damage you deal.'
              : 'Pick a chapter and which of its enemies to fight (sandbox).'}
        </span>
      </div>
    </Panel>
  );

  const shopItems = [...myLoadout.entries.values()].filter((e) => e.kind === 'item' && !e.supply && (e.def as { kind?: string }).kind !== 'pet_spawn');

  const me = (
    <Panel id="battle.me" title="You">
      <label className="row small" style={{ marginBottom: 6 }}>
        <span className="muted">Build</span>
        <select aria-label="Your build" value={layoutName || TEMP} onChange={(e) => p.onOpenBuild(e.target.value === TEMP ? null : e.target.value)} style={{ flex: 1 }}>
          <option value={TEMP}>Temp build</option>
          {builds.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          {layoutName && !builds.includes(layoutName) && <option value={layoutName}>{layoutName} (not saved)</option>}
        </select>
      </label>
      <EditableBag data={data} profile={profile} layout={mine} scope="battle-me" onChange={(l) => setMyEdit({ base: layout, layout: l })} />
      <TryOutBar
        changed={myChanged}
        what="your build"
        onKeep={() => {
          p.onKeep(mine);
          setMyEdit(null);
        }}
        onUndo={() => setMyEdit(null)}
      />
      {kind === 'raid' && shopItems.length > 0 && (
        <div className="issue warning small">
          A raid bag has no shop items in game (only gear and starting equipment); this one has {shopItems.length}: {shopItems.slice(0, 5).map((e) => e.def.name).join(', ')}
          {shopItems.length > 5 ? ' …' : ''}. They fight here anyway.
        </div>
      )}
      <SideSummary data={data} profile={myLoadout.profile} heroId={myLoadout.hero?.id ?? null} />
      <DetailedStats loadout={myLoadout} label="My" />
    </Panel>
  );

  const foeLoadout = useMemo(() => {
    if (!foe) return null;
    try {
      return buildLoadout(data, foe.profile, { placements: foe.placements, bag: foe.bag, enhanced_cells: foe.enhanced_cells });
    } catch {
      return null;
    }
  }, [data, foe]);

  const foeSide = foe && foeLoadout && (
    <div style={{ marginTop: 8 }}>
      {inline ? (
        <EditableBag
          data={data}
          profile={foe.profile}
          layout={withIds({ placements: foe.placements, bag: foe.bag, enhanced_cells: foe.enhanced_cells })}
          scope="battle-foe"
          onChange={(l) => setFoeEdit({ base: foeBuild!, build: { ...foe, placements: l.placements } })}
        />
      ) : (
        <BagGrid loadout={foeLoadout} issues={[]} selected={null} hovered={null} maskEdit={false} readOnly onSelect={() => {}} onHover={() => {}} onToggleMask={() => {}} onDrop={() => {}} onKey={() => {}} />
      )}
      {inline && (
        <TryOutBar
          changed={foeChanged}
          what={`${inline.name}'s build here`}
          onKeep={() => {
            onChange({ ...b, enemy: { ...inline, build: foe } });
            setFoeEdit(null);
          }}
          onUndo={() => setFoeEdit(null)}
        />
      )}
      <SideSummary data={data} profile={foe.profile} heroId={foe.profile.active_hero} />
      <DetailedStats loadout={foeLoadout} label={`${inline?.name ?? monster?.name ?? 'Opponent'}'s`} />
      {inline && (
        <button className="small" onClick={p.onEditEnemy} style={{ marginTop: 6 }}>
          Edit its hero, gear and pets in the Build tab
        </button>
      )}
    </div>
  );

  const opponent =
    kind === 'arena' ? (
      <ArenaOpponent {...p} b={b} inline={inline}>
        {foeSide}
      </ArenaOpponent>
    ) : kind === 'raid' ? (
      <RaidBoss data={data} id={typeof b.enemy === 'string' ? b.enemy : 'raid_boss'} />
    ) : (
      <BattlePanel
        part="opponent"
        opponentTitle="Opponent"
        loadout={myLoadout}
        battle={b}
        onChange={onChange}
        layouts={builds}
        myBuild={p.myBuild}
        layoutAsBuild={p.layoutAsBuild}
        onEditEnemy={p.onEditEnemy}
        choices={['monsters', 'typed']}
        opponentHead={<ChapterBox data={data} b={b} onChange={onChange} />}
        opponentExtra={
          inline?.build ? (
            <div className="issue warning small" style={{ marginTop: 6 }}>
              This opponent is a player's build: fight it in the Arena.{' '}
              <button className="small" onClick={() => setKind('arena')}>
                Go to Arena
              </button>
            </div>
          ) : monster ? (
            <MonsterSummary enemy={monster} />
          ) : null
        }
      />
    );

  const playthrough = kind === 'chapter' && b.chapter?.play === 'playthrough';
  const fight = (
    <div className="battle-fight">
      <BattlePanel
        part="fight"
        loadout={myLoadout}
        battle={fightBattle}
        // Settings changed here never keep the opponent's try-out moves.
        onChange={(nb) => onChange({ ...nb, enemy: b.enemy })}
        layouts={builds}
        myBuild={p.myBuild}
        layoutAsBuild={p.layoutAsBuild}
        onEditEnemy={p.onEditEnemy}
        modes={kind === 'chapter' ? CHAPTER_MODES : [b.mode]}
        showFights={kind === 'chapter'}
        blocked={playthrough ? 'A full playthrough isn\'t built yet: use Sandbox for now.' : undefined}
      />
    </div>
  );

  if (p.only === 'me')
    return (
      <div className="main battle-tab one">
        {modeBar}
        {me}
      </div>
    );
  if (p.only === 'opponent')
    return (
      <div className="main battle-tab one">
        {modeBar}
        {opponent}
      </div>
    );
  if (p.only === 'fight') return <div className="main battle-tab one">{fight}</div>;
  return (
    <div className="main battle-tab">
      {modeBar}
      {me}
      {opponent}
      {fight}
    </div>
  );
}

/** "You moved items here": keep them in the build, or undo. */
function TryOutBar({ changed, what, onKeep, onUndo }: { changed: boolean; what: string; onKeep: () => void; onUndo: () => void }) {
  if (!changed) return <div className="small muted try-out">Drag items to try another arrangement here; you choose whether to keep it.</div>;
  return (
    <div className="row small try-out changed" role="status">
      <span className="warn">Moved here, not in {what} yet.</span>
      <button className="primary small" onClick={onKeep}>
        Keep it
      </button>
      <button className="small" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

/** A bag whose items can be moved, turned and removed here (nothing new is added). */
function EditableBag({ data, profile, layout, scope, onChange }: { data: GameData; profile: Profile; layout: UiLayout; scope: string; onChange: (l: UiLayout) => void }) {
  const lo = useMemo(() => buildLoadout(data, profile, layout), [data, profile, layout]);
  const issues = useMemo(() => validateLoadout(lo), [lo]);
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  useDragLook(scope, (d) => lookOf(lo, d));
  const key = (a: KeyAction) => {
    if (!sel) return;
    const r = keyOnSelected(layout, lo, sel, a);
    if (!r) return;
    if (r.layout) onChange(r.layout);
    setSel(r.selected);
  };
  return (
    <div
      className="editable-bag"
      onClick={(e) => {
        if (!dragJustEnded() && !(e.target as HTMLElement).closest('.item-cell')) setSel(null);
      }}
    >
      <BagGrid
        loadout={lo}
        issues={issues}
        selected={sel}
        hovered={hov}
        maskEdit={false}
        scope={scope}
        onSelect={setSel}
        onRotate={() => key('rotate')}
        onHover={setHov}
        onToggleMask={() => {}}
        dropTarget={(d, x, y) => landing(lo, d, x, y)}
        onDrop={(d, x, y) => {
          const at = landing(lo, d, x, y);
          if (!at) return;
          const r = dropInBag(layout, d, at);
          onChange(r.layout);
          setSel(r.selected);
        }}
        onKey={key}
      />
      {sel && <div className="small muted">Arrows move it, space or another click turns it, Delete removes it.</div>}
    </div>
  );
}

/** Arena: the opponent is a build (one of mine, a copy of mine, or a file). */
function ArenaOpponent({ b, inline, builds, layoutAsBuild, myBuild, onChange, onImportOpponent, children }: Props & { b: Battle; inline: Inline | null; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const from = inline?.build?.source_layout && inline.name === inline.build.source_layout ? inline.build.source_layout : '';
  return (
    <Panel id="battle.opponent" title="Opponent">
      <div className="row small">
        <select
          aria-label="Opponent build"
          value={inline?.build ? (from ? `b:${from}` : 'current') : ''}
          style={{ flex: 1, minWidth: 0 }}
          onChange={async (e) => {
            const v = e.target.value;
            setError(null);
            if (v === 'copy') return onChange({ ...b, enemy: playerEnemy('Copy of my build', myBuild()) });
            if (!v.startsWith('b:')) return;
            const name = v.slice(2);
            try {
              onChange({ ...b, enemy: playerEnemy(name, await layoutAsBuild(name)) });
            } catch (err) {
              setError(`Couldn't load "${name}": ${(err as Error).message}`);
            }
          }}
        >
          <option value="">— pick a build —</option>
          {inline?.build && !from && <option value="current">{inline.name}</option>}
          <option value="copy">A copy of my build</option>
          {builds.length > 0 && (
            <optgroup label="My saved builds">
              {builds.map((n) => (
                <option key={n} value={`b:${n}`}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {onImportOpponent && (
          <>
            <button className="small" onClick={() => file.current?.click()} title="A build file (.yaml) someone shared">
              Import a build…
            </button>
            <input
              ref={file}
              type="file"
              accept=".yaml,.yml"
              aria-label="Import a build as the opponent"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImportOpponent(f);
              }}
            />
          </>
        )}
      </div>
      {error && <div className="issue error small">{error}</div>}
      {!inline?.build && <div className="small muted" style={{ marginTop: 8 }}>The Arena is player against player: pick one of your builds, a copy of yours, or import a build someone shared.</div>}
      {children}
    </Panel>
  );
}

/** Raid: the fixed boss (a placeholder until the real one is entered). */
function RaidBoss({ data, id }: { data: GameData; id: string }) {
  const boss = data.enemies.get(id);
  if (!boss) return <Panel id="battle.opponent" title="Raid boss"><div className="issue error small">The raid boss ({id}) isn't in the data.</div></Panel>;
  const img = boss.image_item ? data.items.get(boss.image_item)?.image : undefined;
  return (
    <Panel id="battle.opponent" title="Raid boss">
      <div className="raid-boss">
        {img && <img src={imageUrl(img)} alt="" />}
        <div>
          <b>{boss.name}</b>
          {!boss.verified && (
            <div className="issue warning small" style={{ marginTop: 4 }}>
              A placeholder: the real raid boss isn't entered yet. It can't be beaten and only hits weakly (about 4.5% of your HP over the 15 s).
            </div>
          )}
        </div>
      </div>
      <MonsterSummary enemy={boss} />
      <div className="small muted" style={{ marginTop: 6 }}>
        A raid lasts 15 s. When time is up you're defeated, whatever protects you (Invincible too). The result is the damage you dealt.
      </div>
    </Panel>
  );
}

/** Chapter: which chapter, its enemies (not known yet), sandbox or full playthrough, which enemy. */
function ChapterBox({ data, b, onChange }: { data: GameData; b: Battle; onChange: (b: Battle) => void }) {
  const ch = b.chapter ?? { number: 1, play: 'sandbox' as const, fight: 1 };
  const info = chapterInfo(data, ch.number);
  const count = data.config!.chapters.count;
  const set = (patch: Partial<typeof ch>) => {
    const next = { ...ch, ...patch };
    const ni = chapterInfo(data, next.number);
    next.number = ni.number;
    next.fight = Math.min(next.fight, ni.enemies);
    // A boss chapter is a Boss Rush, another one a Stage (Gauntlet stays if picked).
    const mode = b.mode === 'gauntlet' ? 'gauntlet' : ni.bossChapter ? 'boss_rush' : 'stage';
    onChange({ ...b, chapter: next, mode });
  };
  return (
    <div className="chapter-box">
      <div className="row small">
        <span className="muted">Chapter</span>
        <button className="small" aria-label="Previous chapter" disabled={info.number <= 1} onClick={() => set({ number: info.number - 1 })}>
          −
        </button>
        <input type="number" min={1} max={count} aria-label="Chapter" value={info.number} style={{ width: 64 }} onChange={(e) => set({ number: Number(e.target.value) || 1 })} />
        <button className="small" aria-label="Next chapter" disabled={info.number >= count} onClick={() => set({ number: info.number + 1 })}>
          +
        </button>
        <span className="muted">
          of {count} · {info.enemies} enemies{info.bossChapter ? ' (every 5th chapter)' : ''}
          {info.sameAs ? ` · same enemies as chapter ${info.sameAs}, other base stats` : ''}
        </span>
      </div>
      <div className="chapter-format" aria-label="Chapter enemies">
        {Array.from({ length: info.enemies }, (_, i) => (
          <span key={i} className={`chip${info.known ? '' : ' unknown'}${ch.fight === i + 1 ? ' on' : ''}`} title={info.known ? '' : 'Not known yet'}>
            {i + 1}: {info.known ? '' : 'Unknown'}
          </span>
        ))}
      </div>
      {!info.known && (
        <div className="issue error small">
          Chapter {info.number}'s enemies aren't known yet{info.sameAs ? ` (nor chapter ${info.sameAs}'s)` : ''}. Pick a stand-in below to fight in the meantime.
        </div>
      )}
      <div className="row small" role="radiogroup" aria-label="Play">
        <label>
          <input type="radio" name="chapter-play" checked={ch.play !== 'playthrough'} onChange={() => set({ play: 'sandbox' })} /> Sandbox: fight one of its enemies
        </label>
        <label>
          <input type="radio" name="chapter-play" checked={ch.play === 'playthrough'} onChange={() => set({ play: 'playthrough' })} /> Full playthrough
        </label>
      </div>
      {ch.play === 'playthrough' ? (
        <div className="small muted">A full playthrough isn't built yet: it comes with a later update.</div>
      ) : (
        <label className="row small">
          <span className="muted">Enemy</span>
          <select aria-label="Chapter enemy" value={ch.fight} onChange={(e) => set({ fight: Number(e.target.value) })}>
            {Array.from({ length: info.enemies }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1} of {info.enemies}
                {info.known ? '' : ' (unknown)'}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** Hero, blessings, gear rarities, pets, skins, auras and HP / ATK / Block of one side. */
export function SideSummary({ data, profile, heroId }: { data: GameData; profile: Profile; heroId: string | null }) {
  const hero = heroId ? data.heroes.get(heroId) : undefined;
  const owned = profile.heroes.find((h) => h.id === heroId);
  const g = profile.gear;
  const gear = [g.weapon, g.shield, ...g.rings, ...g.gloves].filter((x): x is NonNullable<typeof g.weapon> => !!x);
  const bl = owned?.blessings;
  const skins = profile.equipped_skins ?? [];
  return (
    <table className="stats side-summary" style={{ marginTop: 8 }}>
      <tbody>
        <tr>
          <td>Hero</td>
          <td>
            {hero ? (
              <>
                <b>{hero.name}</b> {owned ? `${owned.stars}★` : <span className="warn">not owned</span>} <span className="muted">{hero.class}</span>
              </>
            ) : (
              <span className="muted">none</span>
            )}
          </td>
        </tr>
        <tr>
          <td>Blessings</td>
          <td>{bl?.equipped.length ? bl.equipped.map((x) => `${data.blessings.get(x.id)?.name ?? x.id} ${pct(x.value)} (${x.rarity})`).join(', ') : <span className="muted">none</span>}</td>
        </tr>
        <tr>
          <td>Gear</td>
          <td>{gear.length ? gear.map((r) => `${data.gear.get(r.id)?.name ?? r.id} ${r.rarity}+${r.tier ?? 0}`).join(' · ') : <span className="muted">none</span>}</td>
        </tr>
        <tr>
          <td>Pets</td>
          <td>{profile.pets.length ? profile.pets.map((pt) => `${data.pets.get(pt.id)?.name ?? pt.id} ${pt.stars}★${pt.active ? '' : ' (not active)'}`).join(', ') : <span className="muted">none</span>}</td>
        </tr>
        <tr>
          <td>Skins</td>
          <td>
            {skins.length
              ? skins.map((id) => `${data.skins.get(id)?.skill?.name ?? data.skins.get(id)?.name ?? id} ${profile.skins.find((s) => s.id === id)?.stars ?? 0}★${(profile.skin_quests_done ?? []).includes(id) ? ' (quest done)' : ''}`).join(', ')
              : <span className="muted">none</span>}
          </td>
        </tr>
        <tr>
          <td>Auras</td>
          <td>{profile.auras.length ? profile.auras.map((a) => `${data.auras.get(a.id)?.name ?? a.id} ${a.stars}★`).join(', ') : <span className="muted">none</span>}</td>
        </tr>
        <tr>
          <td>Stats</td>
          <td>
            HP {String(profile.basic_stats.hp)} · ATK {String(profile.basic_stats.atk)} · Block {String(profile.basic_stats.initial_block)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

type MonsterLike = {
  name: string;
  hp: string | number;
  atk: string | number;
  block: string | number;
  attacks: { damage: string | number; pct_max_hp?: number; cooldown: number; hits: number; on_hit?: { status: string; stacks: number; self?: boolean }[] }[];
  traits: string[];
  boss: boolean;
};

export function MonsterSummary({ enemy }: { enemy: MonsterLike }) {
  const attack = (a: MonsterLike['attacks'][number]) =>
    [
      a.pct_max_hp ? `${a.pct_max_hp}% of your max HP` : '',
      a.damage && String(a.damage) !== '0' ? String(a.damage) : '',
    ]
      .filter(Boolean)
      .join(' + ') +
    ` every ${a.cooldown}s${a.hits > 1 ? ` ×${a.hits}` : ''}${a.on_hit?.length ? `, on hit ${a.on_hit.map((h) => `${h.self ? 'gains' : 'inflicts'} ${h.stacks} ${h.status}`).join(', ')}` : ''}`;
  return (
    <table className="stats side-summary" style={{ marginTop: 8 }}>
      <tbody>
        <tr>
          <td>Monster</td>
          <td>
            <b>{enemy.name}</b>
            {enemy.boss ? ' (boss)' : ''}
          </td>
        </tr>
        <tr>
          <td>Stats</td>
          <td>
            HP {parseAbbrev(enemy.hp) >= 1e18 ? "∞ (can't be beaten)" : String(enemy.hp)} · ATK {String(enemy.atk)} · Block {String(enemy.block)}
          </td>
        </tr>
        <tr>
          <td>Attacks</td>
          <td>{enemy.attacks.length ? enemy.attacks.map(attack).join('; ') : <span className="muted">none</span>}</td>
        </tr>
        {enemy.traits.length > 0 && (
          <tr>
            <td>Traits</td>
            <td>{enemy.traits.join(', ')}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

