/**
 * Battle panel (SPEC §8, §8.1): enemy (from data/enemies or typed in), mode, time limit, seed,
 * Monte Carlo runs; run a battle and see the summary, per-item results and event log.
 */
import { useMemo, useState } from 'react';
import { BattleSetupError, runBattle } from '../../engine/combat/battle';
import { type MonteCarloResult, resolveEnemies, runMonteCarlo, runSeed } from '../../engine/combat/montecarlo';
import { IMMUNITIES } from '../../engine/model';
import type { BattleResult } from '../../engine/combat/types';
import type { Loadout } from '../../engine/loadout';
import { ABBREV_RE, type EnemyBuild, type LayoutData } from '../../engine/model';
import { formatShown } from '../../engine/numbers';
import { enemyKind, hasPlayerItems } from '../../engine/combat/setup';
import { Dialog } from './Dialog';
import { Panel } from './Panel';

type Battle = NonNullable<LayoutData['battle']>;
type Inline = Exclude<NonNullable<Battle['enemy']>, string>;

const NEW_ENEMY: Inline = {
  id: 'custom_enemy',
  name: 'Custom enemy',
  hp: '10M',
  atk: 0,
  block: 0,
  damage_reduction: 0,
  attacks: [{ damage: '100K', cooldown: 2, accuracy: 85, hits: 1, crit_chance: 0 }],
  boss: false,
  starting_statuses: [],
  resistances: {},
  vulnerabilities: {},
  immunities: [],
  traits: [],
};

const DEFAULT_BATTLE: Battle = { mode: 'stage', seed: 1, runs: 1 };
const fmt = (n: number) => formatShown(n);
const fmtStacks = (n: number) => String(Math.round(n * 10) / 10);

interface Props {
  loadout: Loadout;
  battle: Battle | undefined;
  onChange: (b: Battle) => void;
  /** Saved layouts, my current build, and a layout as a build: starting points for an enemy build. */
  layouts?: string[];
  myBuild?: () => EnemyBuild;
  layoutAsBuild?: (name: string) => Promise<EnemyBuild>;
  /** Switch the Bag / Profile tabs to the enemy's build. */
  onEditEnemy?: () => void;
}

export function BattlePanel({ loadout, battle, onChange, layouts = [], myBuild, layoutAsBuild, onEditEnemy }: Props) {
  const b = battle ?? DEFAULT_BATTLE;
  const { data } = loadout;
  const cfg = data.config!;
  const set = (patch: Partial<Battle>) => onChange({ ...b, ...patch });
  const [single, setSingle] = useState<BattleResult | null>(null);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  /** The seed of the battle shown in detail (a Monte Carlo run can be picked). */
  const [shownSeed, setShownSeed] = useState<number | string | null>(null);
  const showSeed = (seed: number | string) => {
    try {
      setSingle(runBattle(loadout, resolveEnemies(data, b), { mode: b.mode, durationS: b.duration_s, seed, log: true }));
      setShownSeed(seed);
    } catch (e) {
      setError(`Battle failed: ${(e as Error).message}`);
    }
  };
  /** Whose breakdown the results table shows. */
  const [view, setView] = useState<'player' | 'enemy'>('player');

  const inline = typeof b.enemy === 'object' ? b.enemy : null;
  const fights = cfg.modes[b.mode]?.fights ?? 1;
  const modeDefault = cfg.modes[b.mode]?.fight_seconds ?? cfg.modes[b.mode]?.total_seconds ?? 30;

  const run = () => {
    setError(null);
    setRunning(true);
    // Let the "Running…" state paint before a long Monte Carlo.
    setTimeout(() => {
      try {
        const enemy = resolveEnemies(data, b);
        const opts = { mode: b.mode, durationS: b.duration_s, seed: b.seed };
        if (b.runs <= 1) {
          setSingle(runBattle(loadout, enemy, { ...opts, log: true }));
          setShownSeed(b.seed);
          setMc(null);
        } else {
          const r = runMonteCarlo(loadout, enemy, b.runs, opts);
          setMc(r);
          setSingle(runBattle(loadout, enemy, { ...opts, log: true }));
          setShownSeed(b.seed);
        }
      } catch (e) {
        setError(e instanceof BattleSetupError ? e.message : `Battle failed: ${(e as Error).message}`);
      } finally {
        setRunning(false);
      }
    }, 10);
  };

  const log = useMemo(
    () => (single?.log ?? []).filter((e) => !logFilter || (e.detail ?? e.type).toLowerCase().includes(logFilter.toLowerCase())),
    [single, logFilter],
  );
  const viewDealt = single ? (view === 'player' ? single.player.damageDealt : single.enemy.damageDealt) : 0;
  const pctOf = (n: number) => (viewDealt > 0 ? `${((100 * n) / viewDealt).toFixed(1)}%` : '');

  const setInline = (patch: Partial<Inline>) => set({ enemy: { ...(inline ?? NEW_ENEMY), ...patch } });

  return (
    <Panel id="battle.battle" title="Battle">
      <div className="form-grid" style={{ gridTemplateColumns: '110px 1fr' }}>
        <label>Enemy</label>
        <select
          aria-label="Enemy"
          value={inline ? '__custom' : typeof b.enemy === 'string' ? b.enemy : ''}
          onChange={(e) => set({ enemy: e.target.value === '__custom' ? structuredClone(NEW_ENEMY) : e.target.value || undefined })}
        >
          <option value="">— choose —</option>
          {[...data.enemies.values()].map((en) => (
            <option key={en.id} value={en.id}>
              {en.name}
              {en.boss ? ' (boss)' : ''}
            </option>
          ))}
          <option value="__custom">Type one in…</option>
        </select>
        <label>Mode</label>
        <select aria-label="Mode" value={b.mode} onChange={(e) => set({ mode: e.target.value })}>
          {Object.entries(cfg.modes).map(([m, def]) => (
            <option key={m} value={m} disabled={def.later}>
              {m}
              {def.later ? ' [later]' : def.fights > 1 ? ` (${def.fights} fights)` : ''}
            </option>
          ))}
        </select>
        <label>Time limit (s)</label>
        <input
          type="number"
          min={1}
          aria-label="Time limit"
          disabled={!!cfg.modes[b.mode]?.fixed_time}
          title={cfg.modes[b.mode]?.fixed_time ? 'Always 30 s in this mode' : undefined}
          placeholder={String(modeDefault)}
          value={b.duration_s ?? ''}
          onChange={(e) => set({ duration_s: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
        />
        <label>Seed</label>
        <input aria-label="Seed" value={String(b.seed)} onChange={(e) => set({ seed: /^-?\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} />
        <label>Runs</label>
        <span className="row">
          <input type="number" min={1} max={100000} aria-label="Runs" value={b.runs} onChange={(e) => set({ runs: Math.max(1, Number(e.target.value) || 1) })} />
          <span className="small muted">{b.runs > 1 ? `seeds ${String(runSeed(b.seed, 0))} … ${String(runSeed(b.seed, b.runs - 1))} (1 battle per seed)` : `seed ${String(b.seed)}`}</span>
        </span>
      </div>

      {inline && (
        <EnemyEditor
          enemy={inline}
          statuses={[...data.statuses.values()].map((s) => s.id)}
          combatStats={[...data.stats.values()].filter((s) => s.group === 'combat').map((s) => s.id)}
          onChange={setInline}
          bossFixed={b.mode === 'boss_rush'}
          kindInfo={{ playerItems: hasPlayerItems(data, inline), modePvp: !!cfg.modes[b.mode]?.pvp, mode: b.mode, auto: enemyKind(inline, data) }}
          buildTools={
            myBuild
              ? {
                  layouts,
                  heroName: (id) => data.heroes.get(id ?? '')?.name ?? 'no hero',
                  gearName: (id) => data.gear.get(id)?.name ?? id,
                  start: () => onChange({ ...b, enemy: { ...inline, attacks: [], build: myBuild() } }),
                  load: async (name) => {
                    try {
                      setError(null);
                      onChange({ ...b, enemy: { ...inline, name, attacks: [], build: await layoutAsBuild!(name) } });
                    } catch (e) {
                      setError(`Couldn't load "${name}": ${(e as Error).message}`);
                    }
                  },
                  edit: () => onEditEnemy?.(),
                }
              : undefined
          }
        />
      )}
      {fights > 1 && (
        <div className="hero-card" style={{ marginTop: 8 }}>
          <div className="small muted">Enemies, in order ({b.mode}: {fights} fights{cfg.modes[b.mode]?.boss_fights.length ? `, bosses: ${cfg.modes[b.mode]!.boss_fights.join(', ')}` : ''})</div>
          {Array.from({ length: fights }, (_, i) => {
            const cur = b.enemies?.[i];
            const val = typeof cur === 'string' ? cur : cur ? '__inline' : '';
            return (
              <div key={i} className="row small" style={{ marginTop: 4 }}>
                <span className="muted">Fight {i + 1}</span>
                <select
                  aria-label={`Fight ${i + 1} enemy`}
                  value={val}
                  onChange={(e) => {
                    const list = [...(b.enemies ?? [])];
                    while (list.length < fights) list.push(list[0] ?? '');
                    list[i] = e.target.value === '__inline' ? structuredClone(inline ?? NEW_ENEMY) : e.target.value;
                    set({ enemies: list.filter((x) => x !== '') as Battle['enemies'] });
                  }}
                >
                  <option value="">— choose —</option>
                  {[...data.enemies.values()].map((en) => (
                    <option key={en.id} value={en.id}>
                      {en.name}
                    </option>
                  ))}
                  {inline && <option value="__inline">Typed-in: {inline.name}</option>}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={run} disabled={running || (fights === 1 ? !b.enemy : (b.enemies?.length ?? 0) !== fights)}>
          {running ? 'Running…' : b.runs > 1 ? `Run ${b.runs} battles` : 'Run battle'}
        </button>
        <span className="small muted">Saved with the build.</span>
      </div>
      {error && <div className="issue error" style={{ marginTop: 6 }}>{error}</div>}

      {mc && (
        <div style={{ marginTop: 10 }}>
          <h3>
            Monte Carlo: win rate {(mc.winRate * 100).toFixed(1)}% ({mc.wins}/{mc.runs})
          </h3>
          <table className="stats">
            <tbody>
              <tr>
                <td>Duration</td>
                <td>mean {mc.duration.mean.toFixed(1)}s</td>
                <td>p10 {mc.duration.p10.toFixed(1)}s</td>
                <td>p50 {mc.duration.p50.toFixed(1)}s</td>
                <td>p90 {mc.duration.p90.toFixed(1)}s</td>
              </tr>
              <tr>
                <td>DPS</td>
                <td>mean {fmt(mc.dps.mean)}</td>
                <td>p10 {fmt(mc.dps.p10)}</td>
                <td>p50 {fmt(mc.dps.p50)}</td>
                <td>p90 {fmt(mc.dps.p90)}</td>
              </tr>
              <tr>
                <td>HP left</td>
                <td colSpan={4}>
                  me {mc.playerHpLeftPct.toFixed(1)}% · enemy {mc.enemyHpLeftPct.toFixed(1)}% · {mc.timeouts} time-outs
                </td>
              </tr>
            </tbody>
          </table>
          <details className="small">
            <summary>Each battle ({mc.perRun.length}) — click one to see it below</summary>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {mc.perRun.map((p) => (
                <button
                  key={String(p.seed)}
                  className="small"
                  title={`${p.winner === 'player' ? 'Win' : 'Loss'} after ${p.duration.toFixed(1)}s (${p.reason})`}
                  style={{ borderColor: p.winner === 'player' ? 'var(--accent)' : 'var(--error)', fontWeight: shownSeed === p.seed ? 700 : undefined }}
                  onClick={() => showSeed(p.seed)}
                >
                  {String(p.seed)} {p.winner === 'player' ? 'W' : 'L'}
                </button>
              ))}
            </div>
          </details>
          <div className="small muted">Below: the battle with seed {String(shownSeed ?? b.seed)}.</div>
        </div>
      )}

      {single && (
        <div style={{ marginTop: 10 }}>
          <h3>
            {single.winner === 'player' ? 'Win' : 'Loss'} after {single.duration.toFixed(1)}s{' '}
            <span className="small muted">({single.reason === 'timeout' ? (cfg.modes[single.mode]?.timeout_winner === 'hp_pct' ? `time limit: ${single.winner === 'player' ? 'I' : 'the enemy'} had more HP % left` : 'time limit') : single.winner === 'player' ? 'enemy defeated' : 'I was defeated'})</span>
          </h3>
          {single.fights.length > 1 &&
            single.fights.map((f, i) => (
              <div key={i} className="small">
                Fight {i + 1}: {f.winner === 'player' ? 'won' : 'lost'} vs {f.enemy}
                {f.boss ? ' (boss)' : ''} in {f.duration.toFixed(1)}s{f.reason === 'timeout' ? ' (time limit)' : ''}
              </div>
            ))}
          <div className="small">
            Me: HP {fmt(single.player.hp)} / {fmt(single.player.maxHp)}, block {fmt(single.player.block)}, dealt {fmt(single.player.damageDealt)} ({fmt(single.dps)}/s)
          </div>
          <div className="small">
            Enemy: HP {fmt(single.enemy.hp)} / {fmt(single.enemy.maxHp)}, block {fmt(single.enemy.block)}, dealt {fmt(single.enemy.damageDealt)}
          </div>
          <StatusSummary single={single} polarity={(id) => data.statuses.get(id)?.polarity} />
          <div className="tabs" role="tablist" aria-label="Whose breakdown" style={{ marginTop: 6 }}>
            <button role="tab" aria-selected={view === 'player'} className={view === 'player' ? 'active' : ''} onClick={() => setView('player')}>
              My breakdown
            </button>
            <button role="tab" aria-selected={view === 'enemy'} className={view === 'enemy' ? 'active enemy-side' : ''} onClick={() => setView('enemy')}>
              ⚔ Enemy breakdown
            </button>
          </div>
          <table className="stats" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th title="Times the item went off on its cooldown (or was made to activate), plus its gear skill's own activations">Activations</th>
                <th title="Times one of its effects fired">Triggers</th>
                <th>Hits</th>
                <th>Crit</th>
                <th>DMG</th>
                <th title={view === 'player' ? 'Share of all the damage I dealt' : 'Share of all the damage the enemy dealt'}>%</th>
                <th>Other</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(single.items)
                .filter(([, it]) => it.side === view)
                .filter(([, it]) => it.activations || it.triggers || it.attacks || it.damage || it.healing || it.block || Object.keys(it.statuses).length || Object.keys(it.assisted ?? {}).length || Object.keys(it.spent ?? {}).length)
                .map(([id, it]) => (
                  <tr key={id}>
                    <td>{it.name}</td>
                    <td>
                      {it.activations || ''}
                      {it.skillActivations ? <span className="small muted">{it.activations ? ' + ' : ''}{it.skillActivations} skill</span> : null}
                    </td>
                    <td>{it.triggers || ''}</td>
                    <td>{it.attacks ? `${it.hits}/${it.hits + it.misses}` : ''}</td>
                    <td>{it.attacks ? it.crits : ''}</td>
                    <td>{it.damage ? fmt(it.damage) : ''}</td>
                    <td className="small">{it.damage ? pctOf(it.damage) : ''}</td>
                    <td className="small">
                      {[
                        it.healing ? `${fmt(it.healing)} heal` : '',
                        it.block ? `${fmt(it.block)} block` : '',
                        ...Object.entries(it.spent ?? {}).map(([k, n]) => `${fmtStacks(n)} ${k} spent`),
                        // Own stacks, then (stacks other items applied because of this one), e.g. "10 burn (6 burn)".
                        ...[...new Set([...Object.keys(it.statuses), ...Object.keys(it.assisted ?? {})])].map((k) =>
                          [it.statuses[k] ? `${it.statuses[k]} ${k}` : '', it.assisted?.[k] ? `(${it.assisted[k]} ${k})` : ''].filter(Boolean).join(' '),
                        ),
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              {Object.entries((view === 'player' ? single.statusDamage : single.enemyStatusDamage) ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td colSpan={5}>{k} damage</td>
                  <td>{fmt(v)}</td>
                  <td className="small">{pctOf(v)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {single.warnings.map((w, i) => (
            <div key={i} className="issue warning">
              {w}
            </div>
          ))}
          <details style={{ marginTop: 6 }}>
            <summary className="small">Event log ({single.log.length})</summary>
            <input placeholder="Filter log…" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} style={{ width: '100%', margin: '4px 0' }} />
            <div className="list mono small" style={{ maxHeight: 300 }}>
              {log.map((e, i) => (
                <div key={i} style={{ padding: '1px 6px', color: e.side === 'enemy' ? 'var(--error)' : undefined }}>
                  {e.t.toFixed(1).padStart(5, ' ')}s {e.detail ?? e.type}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}

interface BuildTools {
  layouts: string[];
  heroName: (id: string | null) => string;
  gearName: (id: string) => string;
  /** Give the enemy a build, starting from my current one. */
  start: () => void;
  /** Give the enemy a build from a saved layout. */
  load: (name: string) => void;
  /** Edit it in the Bag / Profile tabs. */
  edit: () => void;
}

function EnemyEditor({
  enemy,
  statuses,
  combatStats,
  onChange,
  bossFixed = false,
  buildTools,
  kindInfo,
}: {
  enemy: Inline;
  statuses: string[];
  combatStats: string[];
  onChange: (p: Partial<Inline>) => void;
  bossFixed?: boolean;
  buildTools?: BuildTools;
  /** Whether the build has player items, whether the mode is always PvP (Arena), and the kind it gets when not set. */
  kindInfo?: { playerItems: boolean; modePvp: boolean; mode: string; auto: 'monster' | 'player' };
}) {
  const num = (v: string | number) => (typeof v === 'number' ? String(v) : v);
  const abbrev = (label: string, value: string | number, key: 'hp' | 'atk' | 'block') => (
    <>
      <label>{label}</label>
      <input
        aria-label={`Enemy ${label}`}
        defaultValue={num(value)}
        onChange={(e) => ABBREV_RE.test(e.target.value.trim()) && onChange({ [key]: e.target.value.trim().toUpperCase() } as Partial<Inline>)}
        placeholder="e.g. 50M"
      />
    </>
  );
  const attacks = enemy.attacks;
  const build = enemy.build;
  const g = build?.profile.gear;
  // A player is never a boss, and monster-only settings never apply to one (user, 2026-10-18).
  const isPlayer = !!kindInfo?.modePvp || (kindInfo?.auto ?? enemyKind(enemy)) === 'player';
  const [ask, setAsk] = useState<'copy' | 'simple' | null>(null);
  return (
    <div className="hero-card" style={{ marginTop: 8 }}>
      {ask === 'copy' && buildTools && (
        <Dialog title={`Copy your build to ${enemy.name}?`} onCancel={() => setAsk(null)} actions={[{ label: 'Copy my build', kind: 'primary', onClick: () => (buildTools.start(), setAsk(null)) }]}>
          <p>{enemy.name}'s build (bag, hero, gear, pets, blessings) is replaced by a copy of yours.</p>
        </Dialog>
      )}
      {ask === 'simple' && (
        <Dialog title="Switch to simple stats?" onCancel={() => setAsk(null)} actions={[{ label: 'Remove the build', kind: 'danger', onClick: () => (onChange({ build: undefined }), setAsk(null)) }]}>
          <p>{enemy.name}'s build (bag, hero, gear, pets, blessings) is removed; it fights with the HP, ATK and attacks typed in here.</p>
        </Dialog>
      )}
      {buildTools && (
        <div className="row small" role="radiogroup" aria-label="Enemy type" style={{ marginBottom: 6 }}>
          <label>
            <input type="radio" name="enemy-kind" checked={!build} onChange={() => build && setAsk('simple')} /> Simple stats
          </label>
          <label>
            <input type="radio" name="enemy-kind" checked={!!build} onChange={() => !build && buildTools.start()} /> Full build (bag, hero, gear, pets, blessings, auras)
          </label>
        </div>
      )}
      {build && buildTools && (
        <div className="small" style={{ marginBottom: 8 }}>
          <div>
            Hero: <b>{buildTools.heroName(build.profile.active_hero)}</b> · HP {String(build.profile.basic_stats.hp)} · ATK {String(build.profile.basic_stats.atk)} · Block{' '}
            {String(build.profile.basic_stats.initial_block)} · {build.placements.length} items in the bag · {build.profile.pets.filter((p) => p.active).length} pets
          </div>
          <div className="muted">
            Gear: {[g?.weapon, g?.shield, ...(g?.rings ?? []), ...(g?.gloves ?? [])].filter((x): x is NonNullable<typeof x> => !!x).map((x) => `${buildTools.gearName(x.id)} (${x.rarity})`).join(', ') || 'none'}
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="primary" onClick={buildTools.edit}>
              Edit enemy build
            </button>
            <button onClick={() => setAsk('copy')} title="Replace the enemy's build with a copy of mine">
              Copy my build
            </button>
            <select aria-label="Load a saved layout as the enemy" value="" onChange={(e) => e.target.value && buildTools.load(e.target.value)}>
              <option value="">Load a saved layout…</option>
              {buildTools.layouts.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="muted">HP, ATK, Block and attacks come from the build.{!isPlayer && ' The resistances, immunities and starting statuses below still apply.'}</div>
        </div>
      )}
      <div className="form-grid" style={{ gridTemplateColumns: '110px 1fr' }}>
        <label>Name</label>
        <input aria-label="Enemy name" value={enemy.name} onChange={(e) => onChange({ name: e.target.value })} />
        <label>Enemy is</label>
        <select
          aria-label="Enemy is"
          title="Player = PvP: both sides' base HP and Block ×20, both berserk, Final DMG in PvP applies"
          value={kindInfo?.modePvp ? 'player' : (kindInfo?.auto ?? enemyKind(enemy))}
          onChange={(e) => onChange({ kind: e.target.value as 'monster' | 'player' })}
        >
          <option value="monster">a monster</option>
          <option value="player">a player (PvP: HP and Block ×20 for both)</option>
        </select>
        {kindInfo?.modePvp && enemy.kind === 'monster' && (
          <div className="issue warning small" style={{ gridColumn: '1 / -1' }}>
            {kindInfo.mode} is always PvP: this enemy fights as a player (HP and Block ×20 for both) even though it's set to a monster.{' '}
            <button onClick={() => onChange({ kind: undefined })}>Clear</button>
          </div>
        )}
        {!kindInfo?.modePvp && kindInfo?.playerItems && enemy.kind === 'monster' && (
          <div className="issue warning small" style={{ gridColumn: '1 / -1' }}>
            This enemy has player items but is set to a monster, so there's no PvP ×20 HP and Block.{' '}
            <button onClick={() => onChange({ kind: undefined })}>Make it a player</button>
          </div>
        )}
        {!build && abbrev('HP', enemy.hp, 'hp')}
        {!build && abbrev('ATK', enemy.atk, 'atk')}
        {!build && abbrev('Block', enemy.block, 'block')}
        {!isPlayer && (
          <>
            <label>DMG reduction %</label>
            <input type="number" aria-label="Enemy damage reduction" value={enemy.damage_reduction} onChange={(e) => onChange({ damage_reduction: Number(e.target.value) || 0 })} />
          </>
        )}
        {!bossFixed && !isPlayer && (
          <>
            <label>Boss</label>
            <input type="checkbox" checked={enemy.boss} onChange={(e) => onChange({ boss: e.target.checked })} style={{ justifySelf: 'start' }} />
          </>
        )}
        <label>Berserk</label>
        <input
          type="checkbox"
          aria-label="Enemy berserks"
          title="Goes berserk from 10 s (off = Short Time Limit)"
          checked={enemy.berserk !== false && !enemy.traits.includes('short_time_limit')}
          onChange={(e) => onChange({ berserk: e.target.checked, traits: enemy.traits.filter((t) => t !== 'short_time_limit') })}
          style={{ justifySelf: 'start' }}
        />
      </div>
      {!build && <h3>Attacks</h3>}
      {!build && attacks.map((a, i) => {
        const setA = (patch: Partial<(typeof attacks)[number]>) => onChange({ attacks: attacks.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div key={i} className="row small" style={{ marginBottom: 4 }}>
            <input aria-label="Attack damage" defaultValue={num(a.damage)} style={{ width: 70 }} onChange={(e) => ABBREV_RE.test(e.target.value.trim()) && setA({ damage: e.target.value.trim().toUpperCase() })} />
            dmg every
            <input type="number" step="0.1" aria-label="Attack cooldown" value={a.cooldown} style={{ width: 56 }} onChange={(e) => setA({ cooldown: Math.max(0.1, Number(e.target.value) || 0.1) })} />s acc
            <input type="number" aria-label="Attack accuracy" value={a.accuracy} style={{ width: 56 }} onChange={(e) => setA({ accuracy: Number(e.target.value) || 0 })} />% ×
            <input type="number" min={1} aria-label="Attack hits" value={a.hits} style={{ width: 44 }} onChange={(e) => setA({ hits: Math.max(1, Number(e.target.value) || 1) })} /> crit
            <input type="number" aria-label="Attack crit" value={a.crit_chance} style={{ width: 50 }} onChange={(e) => setA({ crit_chance: Number(e.target.value) || 0 })} />%
            <button aria-label="Remove attack" onClick={() => onChange({ attacks: attacks.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        );
      })}
      {!build && <button onClick={() => onChange({ attacks: [...attacks, { damage: '100K', cooldown: 2, accuracy: 85, hits: 1, crit_chance: 0 }] })}>Add attack</button>}
      {!isPlayer && (
        <>
      <h3>Starting statuses</h3>
      {enemy.starting_statuses.map((s, i) => (
        <div key={i} className="row small" style={{ marginBottom: 4 }}>
          <select value={s.status} aria-label="Status" onChange={(e) => onChange({ starting_statuses: enemy.starting_statuses.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)) })}>
            {statuses.map((st) => (
              <option key={st}>{st}</option>
            ))}
          </select>
          <input type="number" min={1} aria-label="Stacks" value={s.stacks} style={{ width: 60 }} onChange={(e) => onChange({ starting_statuses: enemy.starting_statuses.map((x, j) => (j === i ? { ...x, stacks: Math.max(1, Number(e.target.value) || 1) } : x)) })} />
          <button aria-label="Remove status" onClick={() => onChange({ starting_statuses: enemy.starting_statuses.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange({ starting_statuses: [...enemy.starting_statuses, { status: statuses[0] ?? 'dodge', stacks: 10 }] })}>Add status</button>
      <h3>Resistances, reductions and vulnerabilities (%)</h3>
      {(['resistances', 'vulnerabilities'] as const).flatMap((field) =>
        Object.entries(enemy[field]).map(([k, v]) => (
          <div key={`${field}${k}`} className="row small" style={{ marginBottom: 4 }}>
            <span style={{ minWidth: 180 }}>{k}</span>
            <input
              type="number"
              aria-label={k}
              value={v}
              style={{ width: 70 }}
              onChange={(e) => onChange({ [field]: { ...enemy[field], [k]: Number(e.target.value) || 0 } } as Partial<Inline>)}
            />
            <button
              aria-label={`Remove ${k}`}
              onClick={() => {
                const next = { ...enemy[field] };
                delete next[k];
                onChange({ [field]: next } as Partial<Inline>);
              }}
            >
              ✕
            </button>
          </div>
        )),
      )}
      <select
        aria-label="Add combat stat"
        value=""
        onChange={(e) => {
          const k = e.target.value;
          if (!k) return;
          const field = /vulnerability/.test(k) ? 'vulnerabilities' : 'resistances';
          onChange({ [field]: { ...enemy[field], [k]: 20 } } as Partial<Inline>);
        }}
      >
        <option value="">Add…</option>
        {combatStats
          .filter((s) => s !== 'dmg_reduction' && !(s in enemy.resistances) && !(s in enemy.vulnerabilities))
          .map((s) => (
            <option key={s}>{s}</option>
          ))}
      </select>
      <h3>Immunities</h3>
      <div className="row small">
        {IMMUNITIES.map((im) => (
          <label key={im}>
            <input
              type="checkbox"
              checked={enemy.immunities.includes(im)}
              onChange={(e) => onChange({ immunities: e.target.checked ? [...enemy.immunities, im] : enemy.immunities.filter((x) => x !== im) })}
            />{' '}
            {im}
          </label>
        ))}
      </div>
        </>
      )}
    </div>
  );
}

/** Buffs and debuffs on each fighter at the end, then what each side cleansed, removed, stole, reflected and spent. */
function StatusSummary({ single, polarity }: { single: BattleResult; polarity: (id: string) => string | undefined }) {
  const list = (statuses: Record<string, number>, kind: 'buff' | 'debuff' | 'other') =>
    Object.entries(statuses)
      .filter(([id, n]) => n > 0 && (kind === 'other' ? !['buff', 'debuff'].includes(polarity(id) ?? '') : polarity(id) === kind))
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${fmtStacks(n)} ${id}`)
      .join(', ') || 'none';
  const row = (who: string, side: 'player' | 'enemy') => {
    const st = side === 'player' ? single.player.statuses : single.enemy.statuses;
    const m = single.statusMoves?.[side];
    return (
      <tr key={side}>
        <td>{who}</td>
        <td>{list(st, 'buff')}</td>
        <td>{list(st, 'debuff')}</td>
        <td>{list(st, 'other')}</td>
        <td>{m ? fmtStacks(m.cleansed) : ''}</td>
        <td>{m ? fmtStacks(m.removed) : ''}</td>
        <td>{m ? fmtStacks(m.stolen) : ''}</td>
        <td>{m ? fmtStacks(m.reflected) : ''}</td>
        <td>{m?.spent && Object.keys(m.spent).length ? Object.entries(m.spent).map(([id, n]) => `${fmtStacks(n)} ${id}`).join(', ') : m ? '0' : ''}</td>
      </tr>
    );
  };
  return (
    <div style={{ marginTop: 6 }}>
      <h3>Buffs &amp; debuffs</h3>
      <table className="stats small">
        <thead>
          <tr>
            <th />
            <th title="Buff stacks left at the end">Buffs at the end</th>
            <th title="Debuff stacks left at the end">Debuffs at the end</th>
            <th title="Other modifiers left at the end (counters, Healing Reduction …)">Other</th>
            <th title="Stacks this side cleansed from itself (whole battle)">Cleansed</th>
            <th title="Stacks this side removed from the other side">Removed</th>
            <th title="Stacks this side stole from the other side">Stolen</th>
            <th title="Debuff stacks this side reflected back">Reflected</th>
            <th title="Stacks this side used up as a cost: its own Spike for Spiral Spear's lethal save, the enemy's Freeze for Instant Freeze's Stun">Spent</th>
          </tr>
        </thead>
        <tbody>
          {row('Me', 'player')}
          {row('Enemy', 'enemy')}
        </tbody>
      </table>
    </div>
  );
}
