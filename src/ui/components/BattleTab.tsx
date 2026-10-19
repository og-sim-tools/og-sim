/**
 * Battle tab: my bag and my opponent's side by side (half the width each), each with its hero, blessings,
 * gear rarities, pets, skins and auras under it; the fight (mode, runs, Run battle, results) below both.
 * The Build tab is only for building the bag.
 */
import { useMemo, useState } from 'react';
import type { GameData } from '../../engine/loader';
import { type Loadout, buildLoadout } from '../../engine/loadout';
import type { EnemyBuild, LayoutData, Profile } from '../../engine/model';
import { BagGrid } from './BagGrid';
import { BattlePanel } from './BattlePanel';
import { Panel } from './Panel';

type Battle = NonNullable<LayoutData['battle']>;

interface Props {
  data: GameData;
  /** My open build, as the engine plays it. */
  loadout: Loadout;
  /** The open build ('' = the temp build). */
  layoutName: string;
  builds: string[];
  battle: Battle | undefined;
  onChange: (b: Battle) => void;
  myBuild: () => EnemyBuild;
  layoutAsBuild: (name: string) => Promise<EnemyBuild>;
  onEditEnemy: () => void;
  /** Open one of my builds (null = the temp build) to fight with. */
  onOpenBuild: (name: string | null) => void;
}

const TEMP = '\u0000temp';

export function BattleTab({ data, loadout, layoutName, builds, battle, onChange, myBuild, layoutAsBuild, onEditEnemy, onOpenBuild }: Props) {
  const enemy = battle?.enemy === undefined ? null : typeof battle.enemy === 'string' ? (data.enemies.get(battle.enemy) ?? null) : battle.enemy;
  const enemyBuild = enemy?.build ?? null;
  const enemyLoadout = useMemo(() => {
    if (!enemyBuild) return null;
    try {
      return buildLoadout(data, enemyBuild.profile, { placements: enemyBuild.placements, bag: enemyBuild.bag, enhanced_cells: enemyBuild.enhanced_cells });
    } catch {
      return null;
    }
  }, [data, enemyBuild]);

  return (
    <div className="main battle-tab">
      <Panel id="battle.me" title="You">
        <label className="row small" style={{ marginBottom: 6 }}>
          <span className="muted">Build</span>
          <select aria-label="Your build" value={layoutName || TEMP} onChange={(e) => onOpenBuild(e.target.value === TEMP ? null : e.target.value)} style={{ flex: 1 }}>
            <option value={TEMP}>Temp build</option>
            {builds.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {layoutName && !builds.includes(layoutName) && <option value={layoutName}>{layoutName} (not saved)</option>}
          </select>
        </label>
        <SideBag loadout={loadout} />
        <SideSummary data={data} profile={loadout.profile} heroId={loadout.hero?.id ?? null} />
      </Panel>
      <BattlePanel
        part="opponent"
        loadout={loadout}
        battle={battle}
        onChange={onChange}
        layouts={builds}
        myBuild={myBuild}
        layoutAsBuild={layoutAsBuild}
        onEditEnemy={onEditEnemy}
        opponentExtra={
          enemyLoadout && enemyBuild ? (
            <div style={{ marginTop: 8 }}>
              <SideBag loadout={enemyLoadout} />
              <SideSummary data={data} profile={enemyBuild.profile} heroId={enemyBuild.profile.active_hero} />
              <button className="small" onClick={onEditEnemy} style={{ marginTop: 6 }}>
                Edit this bag in the Build tab
              </button>
            </div>
          ) : enemy ? (
            <MonsterSummary enemy={enemy} />
          ) : (
            <div className="small muted" style={{ marginTop: 8 }}>
              Pick a monster, one of your saved builds (it fights as a player, with your account), or type an enemy in.
            </div>
          )
        }
      />
      <div className="battle-fight">
        <BattlePanel part="fight" loadout={loadout} battle={battle} onChange={onChange} layouts={builds} myBuild={myBuild} layoutAsBuild={layoutAsBuild} onEditEnemy={onEditEnemy} />
      </div>
    </div>
  );
}

/** A bag to look at: hover or click an item for its dots. */
function SideBag({ loadout }: { loadout: Loadout }) {
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  return (
    <BagGrid loadout={loadout} issues={[]} selected={sel} hovered={hov} maskEdit={false} readOnly onSelect={setSel} onHover={setHov} onToggleMask={() => {}} onDrop={() => {}} onKey={() => {}} />
  );
}

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** Hero, blessings, gear rarities, pets, skins, auras and HP / ATK / Block of one side. */
export function SideSummary({ data, profile, heroId }: { data: GameData; profile: Profile; heroId: string | null }) {
  const hero = heroId ? data.heroes.get(heroId) : undefined;
  const owned = profile.heroes.find((h) => h.id === heroId);
  const g = profile.gear;
  const gear = [
    ['Weapon', g.weapon],
    ['Shield', g.shield],
    ...g.rings.map((r, i) => [`Ring ${i + 1}`, r] as const),
    ...g.gloves.map((r, i) => [`Gloves ${i + 1}`, r] as const),
  ].filter((x): x is [string, NonNullable<typeof g.weapon>] => !!x[1]);
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
          <td>
            {bl?.equipped.length ? (
              <>
                <span className="muted">level {bl.level}: </span>
                {bl.equipped.map((b) => `${data.blessings.get(b.id)?.name ?? b.id} ${pct(b.value)} (${b.rarity})`).join(', ')}
              </>
            ) : (
              <span className="muted">none</span>
            )}
          </td>
        </tr>
        <tr>
          <td>Gear</td>
          <td>{gear.length ? gear.map(([, r]) => `${data.gear.get(r.id)?.name ?? r.id} ${r.rarity}${r.tier ? `+${r.tier}` : '+0'}`).join(' · ') : <span className="muted">none</span>}</td>
        </tr>
        <tr>
          <td>Pets</td>
          <td>
            {profile.pets.length
              ? profile.pets.map((pt) => `${data.pets.get(pt.id)?.name ?? pt.id} ${pt.stars}★${pt.active ? '' : ' (not active)'}`).join(', ')
              : <span className="muted">none</span>}
          </td>
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

function MonsterSummary({ enemy }: { enemy: { name: string; hp: string | number; atk: string | number; block: string | number; attacks: { damage: string | number; cooldown: number; hits: number }[]; traits: string[]; boss: boolean } }) {
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
            HP {String(enemy.hp)} · ATK {String(enemy.atk)} · Block {String(enemy.block)}
          </td>
        </tr>
        <tr>
          <td>Attacks</td>
          <td>{enemy.attacks.length ? enemy.attacks.map((a) => `${String(a.damage)} every ${a.cooldown}s${a.hits > 1 ? ` ×${a.hits}` : ''}`).join(', ') : <span className="muted">none</span>}</td>
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
