/**
 * Optimize tab: improve my build against a list of opponent builds (one per meta archetype). Runs the
 * engine's local search in time slices, then shows every build tried, the best one, its stats against
 * each opponent and the spread of match scores (HP margin + unused Celestial Shield).
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadoutIssue } from '../../engine/loadout';
import { type KeyAction, moveBy, rotateCw } from '../state/layoutOps';
import { resolveEnemies } from '../../engine/combat/montecarlo';
import { buildSynergyReport } from '../../engine/effects/synergy';
import type { GameData } from '../../engine/loader';
import { type Loadout, buildLoadout, buildValue } from '../../engine/loadout';
import type { EnemyBuild, LayoutData, Profile } from '../../engine/model';
import { formatShown } from '../../engine/numbers';
import { type Candidate, type OptimizeOptions, type OptimizeProgress, type OptimizeResult, type Opponent, optimize, optimizeMany, skinQuestGuard, withMyBaseStats } from '../../engine/optimize';
import { checkSkinQuest } from '../../engine/skinQuests';
import { aggregateStats } from '../../engine/stats';
import { BagGrid } from './BagGrid';
import { Panel } from './Panel';
import { StatsPanel } from './StatsPanel';

type Battle = NonNullable<LayoutData['battle']>;
type Placement = LayoutData['placements'][number];
type Inline = Exclude<NonNullable<Battle['enemy']>, string>;

/** The enemy fields a build-based opponent needs; everything real comes from its build. */
const OPPONENT: Inline = {
  id: 'custom_enemy',
  name: 'Opponent',
  hp: '1M',
  atk: 0,
  block: 0,
  damage_reduction: 0,
  attacks: [],
  boss: false,
  starting_statuses: [],
  resistances: {},
  vulnerabilities: {},
  immunities: [],
  traits: [],
  kind: 'player',
};

const CURRENT_ENEMY = '__current_enemy__';
const STORE = 'og-optimize-opponents';
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const num = (x: number, d = 1) => x.toFixed(d);
const fmt = (n: number) => formatShown(n);

interface Props {
  data: GameData;
  /** My profile with this layout's setup applied (as the Battle tab uses it). */
  profile: Profile;
  layout: LayoutData;
  layoutName: string;
  loadout: Loadout;
  layouts: string[];
  layoutAsBuild: (name: string) => Promise<EnemyBuild>;
  onApply: (placements: LayoutData['placements']) => void;
  /** The Battle tab's layout panel (load / save / new), shared so builds are set up the same way. */
  setup?: ReactNode;
}

export function OptimizePanel({ data, profile, layout, layoutName, loadout, layouts, layoutAsBuild, onApply, setup }: Props) {
  const startValue = useMemo(() => buildValue(loadout).total, [loadout]);
  const inline = layout.battle && typeof layout.battle.enemy === 'object' ? layout.battle.enemy : null;
  const [picked, setPicked] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(picked));
    } catch {
      /* per-viewer convenience only */
    }
  }, [picked]);
  // valueBudget null = the current build's value (follows the build until set by hand).
  const [opts, setOpts] = useState({
    seeds: 20,
    iterations: 60,
    shieldWeight: 50,
    temperature: 5,
    allowItemChanges: true,
    valueBudget: null as number | null,
    searchSeed: 1,
    keepSkinQuests: true,
    matchStats: false,
    balance: true,
    /** Several search seeds: how many runs, and whether each starts from the previous run's best. */
    multiSeed: false,
    /** Shake up when stuck: after this many builds without a better best, this many changes at once (kept even if worse). */
    shake: false,
    shakePatience: 15,
    shakeSize: 3,
    searchRuns: 3,
    chainRuns: true,
    /** With matchStats: opponents get my base stats × this. */
    statMultiple: 1,
  });
  const budget = opts.valueBudget ?? startValue;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [statSel, setStatSel] = useState<string | null>(null);
  const stop = useRef(false);
  const lastRun = useRef<{ opponents: Opponent[]; o: OptimizeOptions; base: LayoutData } | null>(null);
  const [edit, setEdit] = useState<Placement[] | null>(null);
  const [picked1, setPicked1] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // A different build shown: drop unsaved edits to the previous one.
  useEffect(() => {
    setEdit(null);
    setPicked1(null);
  }, [sel]);
  const started = useRef(0);

  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }));

  // The Battle tab's enemy build, with any edits made there (stats, bag, hero …). A saved layout of the
  // same name uses this edited build instead of the file, so changes made in the Battle tab count here.
  const edited = inline?.build ? (inline.build.source_layout ?? inline.name) : null;
  const editedIsSaved = !!edited && layouts.includes(edited);
  const getBuild = async (name: string): Promise<EnemyBuild | undefined> =>
    name === CURRENT_ENEMY || (editedIsSaved && name === edited) ? inline?.build : await layoutAsBuild(name);
  const labelOf = (name: string) => (name === CURRENT_ENEMY ? `${inline?.name ?? 'Enemy'} (Battle tab)` : name);

  // Stats of me and of every opponent (as calculated, before the PvP HP / Block multiplier).
  const statLine = (lo: Loadout) => {
    const p = aggregateStats(lo).player;
    return `${lo.hero?.name ?? 'no hero'} · HP ${fmt(p.hp)} · ATK ${fmt(p.atk)} · Block ${fmt(p.initialBlock)}`;
  };
  const myStats = useMemo(() => statLine(loadout), [loadout]);
  const questNotes = useMemo(() => skinQuestGuard(data, profile, loadout, opts.keepSkinQuests).warnings, [data, profile, loadout, opts.keepSkinQuests]);
  const [oppStats, setOppStats] = useState<Record<string, string>>({});
  const optionNames = [...(inline?.build && !editedIsSaved ? [CURRENT_ENEMY] : []), ...layouts.filter((n) => n !== layoutName)];
  const optionKey = optionNames.join('|');
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const n of optionNames) {
        try {
          const b = await getBuild(n);
          const prof = b && opts.matchStats ? withMyBaseStats(b, profile, opts.statMultiple).profile : b?.profile;
          if (b && prof) out[n] = statLine(buildLoadout(data, prof, { placements: b.placements, bag: b.bag, enhanced_cells: b.enhanced_cells }));
        } catch {
          out[n] = "couldn't load";
        }
      }
      if (live) setOppStats(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionKey, inline, data, opts.matchStats, opts.statMultiple, profile.basic_stats, profile.detailed_stats]);
  // What a run was made with: when it changes, the results are out of date.
  const signature = JSON.stringify([myStats, layout.placements, picked.map((n) => oppStats[n]), opts]);
  const [ranWith, setRanWith] = useState<string | null>(null);

  const run = async (startPlacements?: Placement[]) => {
    setError(null);
    setResult(null);
    setSel(null);
    setEdit(null);
    try {
      const opponents: Opponent[] = [];
      const mode = layout.battle?.mode ?? 'stage';
      for (const name of picked.filter((n) => optionNames.includes(n))) {
        const build = await getBuild(name);
        if (!build) continue;
        const label = labelOf(name);
        const fromBattle = name === CURRENT_ENEMY || (editedIsSaved && name === edited);
        // "Same base stats as me": the opponent's HP / ATK / Block (and Stat Details) become mine; its gear, hero and bag stay.
        const b = opts.matchStats ? withMyBaseStats(build, profile, opts.statMultiple) : build;
        const enemy = { ...OPPONENT, ...(fromBattle && inline ? inline : {}), name: label, kind: 'player' as const, build: b };
        opponents.push({ name: label, enemy: resolveEnemies(data, { mode, enemy } as never) });
      }
      if (opponents.length === 0) throw new Error('Pick at least one opponent build.');
      const o: OptimizeOptions = {
        ...opts,
        valueBudget: opts.allowItemChanges ? budget : undefined,
        shakeUp: opts.shake ? { patience: opts.shakePatience, size: opts.shakeSize } : undefined,
        seedBase: typeof layout.battle?.seed === 'number' ? layout.battle.seed : 1,
        mode,
        durationS: layout.battle?.duration_s,
      };
      const base = startPlacements ? { ...layout, placements: startPlacements } : layout;
      lastRun.current = { opponents, o, base };
      const gen = opts.multiSeed && opts.searchRuns > 1 ? optimizeMany(data, profile, base, opponents, o, opts.searchRuns, opts.chainRuns) : optimize(data, profile, base, opponents, o);
      setRanWith(signature);
      stop.current = false;
      started.current = Date.now();
      setRunning(true);
      const step = () => {
        try {
          const until = performance.now() + 40;
          let r = gen.next();
          while (!r.done && performance.now() < until) r = gen.next();
          if (r.done) {
            setResult(r.value);
            setSel(r.value.best.id);
            setRunning(false);
            return;
          }
          setProgress(r.value);
          if (stop.current) {
            // Stopped: finish with the builds scored so far.
            const cands = [...r.value.candidates];
            if (cands.length && r.value.best) {
              setResult({ candidates: cands, start: cands[0]!, best: r.value.best, warnings: r.value.warnings });
              setSel(r.value.best.id);
            }
            setRunning(false);
            return;
          }
          setTimeout(step, 0);
        } catch (e) {
          setError((e as Error).message);
          setRunning(false);
        }
      };
      setTimeout(step, 0);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };

  const shown = result && sel !== null ? result.candidates.find((c) => c.id === sel) ?? result.best : null;
  // My edits to the shown build (move, rotate, delete; never add): null = not edited.
  const working = edit ?? shown?.placements ?? null;
  const baseLayout = lastRun.current?.base ?? layout;
  const shownLoadout = useMemo(() => (working ? buildLoadout(data, profile, { ...baseLayout, placements: working }) : null), [working, data, profile, baseLayout]);
  const editIssues: LoadoutIssue[] = useMemo(
    () => (shownLoadout ? shownLoadout.layout.issues.map((i) => ({ level: 'error' as const, code: i.code, message: i.message, instanceIds: i.instanceIds, cells: i.cells })) : []),
    [shownLoadout],
  );
  const editValid = editIssues.length === 0;
  const change = (fn: (ps: Placement[]) => Placement[]) => working && setEdit(fn(working.map((p) => ({ ...p }))));
  const onBagKey = (action: KeyAction) => {
    if (!picked1) return;
    const d = moveBy(action);
    if (d) change((ps) => ps.map((p) => (p.id === picked1 ? { ...p, x: p.x + d.dx, y: p.y + d.dy } : p)));
    else if (action === 'rotate') change((ps) => ps.map((p) => (p.id === picked1 ? { ...p, rotation: rotateCw(p.rotation) } : p)));
    else if (action === 'remove') {
      change((ps) => ps.filter((p) => p.id !== picked1));
      setPicked1(null);
    } else if (action === 'cancel') setPicked1(null);
  };
  const onBagDrop = (drop: { itemId?: string; instanceId?: string }, x: number, y: number) => {
    if (!drop.instanceId) return; // no adding items here: that's the Battle tab
    change((ps) => ps.map((p) => (p.id === drop.instanceId ? { ...p, x, y } : p)));
    setPicked1(drop.instanceId);
  };
  /** Score my edited build on the same opponents, seeds and options as the run, and add it to the list. */
  const testScore = () => {
    const cfg = lastRun.current;
    if (!cfg || !working || !result || !shown) return;
    setTesting(true);
    const gen = optimize(data, profile, { ...cfg.base, placements: working }, cfg.opponents, { ...cfg.o, iterations: 0, cleanup: false });
    const step = () => {
      try {
        const until = performance.now() + 40;
        let r = gen.next();
        while (!r.done && performance.now() < until) r = gen.next();
        if (!r.done) return void setTimeout(step, 0);
        const c = { ...r.value.start, id: result.candidates.length, parent: shown.id, change: 'my edit', reason: `edited from build #${shown.id} and tested`, accepted: false };
        const better = c.objective > result.best.objective;
        setResult({ ...result, candidates: [...result.candidates, c], best: better ? c : result.best });
        setSel(c.id);
        setEdit(null);
        setTesting(false);
      } catch (e) {
        setError((e as Error).message);
        setTesting(false);
      }
    };
    setTimeout(step, 0);
  };
  const shownStats = useMemo(() => (shownLoadout ? aggregateStats(shownLoadout) : null), [shownLoadout]);
  const shownSynergy = useMemo(() => (shownLoadout ? buildSynergyReport(shownLoadout) : new Map()), [shownLoadout]);
  const eta = progress && running && progress.battles > 0 ? ((Date.now() - started.current) / progress.battles) * (progress.totalBattles - progress.battles) : 0;


  return (
    <div className="main optimize">
      <div className="stack">
        {setup}
        <Panel id="optimize.settings" title="Optimize">
          <ol className="small muted how-to">
            <li>
              Set up <b>{layoutName || 'your build'}</b> in the Battle tab (hero, gear, pets, skins, starting equipment).
            </li>
            <li>Tick the saved builds to test it against below, one per meta archetype.</li>
            <li>Run: it tries moves, rotations and item swaps within your coin budget, plays each try against every opponent on the same seeds, and keeps the best.</li>
          </ol>
          <h3>Opponents (PvP)</h3>
          <div className="small">
            Me: <span className="muted">{myStats}</span>
          </div>
          {optionNames.length === 0 && <div className="small muted">Save some builds first (Battle tab → Save).</div>}
          {optionNames.map((n) => (
            <label key={n} className="small" style={{ display: 'block', marginTop: 3 }}>
              <input type="checkbox" checked={picked.includes(n)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, n] : p.filter((x) => x !== n)))} />{' '}
              <b>{labelOf(n)}</b>
              {editedIsSaved && n === edited && <span className="badge">with the Battle tab's edits</span>}
              <div className="muted" style={{ marginLeft: 22 }}>
                {oppStats[n] ?? '…'}
              </div>
            </label>
          ))}
          <label className="row small" style={{ marginTop: 4 }} title="Every opponent gets my base HP, ATK, Block and Stat Details; its hero, gear, pets, skins and bag stay its own">
            <input type="checkbox" checked={opts.matchStats} onChange={(e) => set('matchStats', e.target.checked)} /> Opponents use my base stats ×
            <input
              type="number"
              min={0.1}
              step={0.1}
              aria-label="Multiple of my base stats"
              disabled={!opts.matchStats}
              value={opts.statMultiple}
              onChange={(e) => set('statMultiple', Math.max(0.1, Number(e.target.value) || 1))}
              style={{ width: 56 }}
            />
            <span className="muted">(1 = a fair test of the builds; 2 = twice my HP, ATK and Block)</span>
          </label>
          <div className="small muted">Stats as calculated; PvP multiplies HP and Block for both sides in battle.</div>
          <h3>Search</h3>
          <div className="form-grid" style={{ gridTemplateColumns: '140px 1fr' }}>
            <label title="Battles per opponent for each build tried">Seeds per opponent</label>
            <input type="number" min={1} value={opts.seeds} onChange={(e) => set('seeds', Math.max(1, Number(e.target.value) || 1))} />
            <label title="Builds to try after the starting one">Builds to try</label>
            <input type="number" min={1} value={opts.iterations} onChange={(e) => set('iterations', Math.max(1, Number(e.target.value) || 1))} />
            <label>Change items too</label>
            <span className="row small" style={{ flexWrap: 'wrap', gap: 4 }}>
              <label className="check-line">
                <input type="checkbox" checked={opts.allowItemChanges} onChange={(e) => set('allowItemChanges', e.target.checked)} />
                <span>replace / add shop items, value ≤</span>
              </label>
              <input
                type="number"
                min={0}
                disabled={!opts.allowItemChanges}
                value={budget}
                onChange={(e) => set('valueBudget', e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 64 }}
              />
              {opts.valueBudget !== null && (
                <button className="small" onClick={() => set('valueBudget', null)} title="Follow the build's value again">
                  reset
                </button>
              )}
              <span className="muted">(now {startValue})</span>
            </span>
          </div>
          <details className="small" style={{ marginTop: 6 }}>
            <summary>Advanced search settings</summary>
          <div className="form-grid" style={{ gridTemplateColumns: '140px 1fr', marginTop: 6 }}>
            <label title="Score points for an unused once-per-battle save (Celestial Shield) at the end: + for mine, − for the opponent's">Shield left weight</label>
            <input type="number" min={0} value={opts.shieldWeight} onChange={(e) => set('shieldWeight', Math.max(0, Number(e.target.value) || 0))} />
            <label title="Early on, a change may be kept even if the score drops by up to this much (it shrinks to 0); helps escape dead ends">Temperature</label>
            <input type="number" min={0} value={opts.temperature} onChange={(e) => set('temperature', Math.max(0, Number(e.target.value) || 0))} />
            <label title="Search seed: a different one tries different changes">Search seed</label>
            <input type="number" value={opts.searchSeed} onChange={(e) => set('searchSeed', Number(e.target.value) || 0)} />
            <label title="Run the search with several seeds (the seed above, +1, +2 …) and keep every build in one list">Several seeds</label>
            <span className="row small" style={{ flexWrap: 'wrap', gap: 4 }}>
              <input type="checkbox" checked={opts.multiSeed} onChange={(e) => set('multiSeed', e.target.checked)} />
              <input
                type="number"
                min={2}
                aria-label="Number of search seeds"
                disabled={!opts.multiSeed}
                value={opts.searchRuns}
                onChange={(e) => set('searchRuns', Math.max(2, Math.round(Number(e.target.value) || 2)))}
                style={{ width: 56 }}
              />
              runs
              {opts.multiSeed && (
                <span style={{ display: 'block', width: '100%' }}>
                  <label className="check-line">
                    <input type="radio" name="opt-chain" checked={opts.chainRuns} onChange={() => set('chainRuns', true)} />
                    <span>chained: seed 1's best build starts seed 2, and so on</span>
                  </label>
                  <br />
                  <label className="check-line">
                    <input type="radio" name="opt-chain" checked={!opts.chainRuns} onChange={() => set('chainRuns', false)} />
                    <span>separate: every seed starts from my build</span>
                  </label>
                </span>
              )}
            </span>
            <label title="For long runs: when the best build stops improving, try a bigger jump that may score worse for a while, to escape a dead end and reach a higher best">Shake up when stuck</label>
            <span className="small">
              <label className="check-line">
                <input type="checkbox" checked={opts.shake} onChange={(e) => set('shake', e.target.checked)} />
                <span>
                  after{' '}
                  <input
                    type="number"
                    min={2}
                    aria-label="Builds without a better best before a shake-up"
                    disabled={!opts.shake}
                    value={opts.shakePatience}
                    onChange={(e) => set('shakePatience', Math.max(2, Math.round(Number(e.target.value) || 2)))}
                    style={{ width: 52 }}
                  />{' '}
                  builds without a better best, make{' '}
                  <input
                    type="number"
                    min={2}
                    aria-label="Changes per shake-up"
                    disabled={!opts.shake}
                    value={opts.shakeSize}
                    onChange={(e) => set('shakeSize', Math.max(2, Math.round(Number(e.target.value) || 2)))}
                    style={{ width: 44 }}
                  />{' '}
                  changes at once (kept even if worse; one more each time it's stuck again)
                </span>
              </label>
            </span>
            <label title="Equipped skins whose quest the build meets now (e.g. Dream Eater's 30 Creature value) keep it: builds that would break it aren't tried">Keep skin quests</label>
            <label className="check-line small">
              <input type="checkbox" checked={opts.keepSkinQuests} onChange={(e) => set('keepSkinQuests', e.target.checked)} />
              <span>skip builds that break an equipped skin's quest</span>
            </label>
          </div>
          <label className="check-line small" style={{ marginTop: 4 }} title="Winning a matchup you already win by more counts less (diminishing returns above 0), so value moves toward the matchups you lose">
            <input type="checkbox" checked={opts.balance} onChange={(e) => set('balance', e.target.checked)} />
            <span>Balance matchups (help the fights I lose before padding the ones I win)</span>
          </label>
          <div className="small muted" style={{ marginTop: 4 }}>
            Moves, swaps and rotations always. Item changes swap the weakest item for a counter or a booster, or try an alternative that still fits what
            the neighbouring dots look for (a Spell under Witch's Mirror stays a Spell). Gear and starting equipment are moved but never replaced. Match score = my HP % left − opponent HP % left ±{' '}
            {opts.shieldWeight} per unused Celestial Shield.
          </div>
          </details>
          <div className="small muted" style={{ marginTop: 6 }}>
            About {opts.seeds * Math.max(1, picked.length) * (opts.iterations + 1) * (opts.multiSeed ? opts.searchRuns : 1)} battles per run.
          </div>
          {questNotes.map((w) => (
            <div key={w} className="issue warning small" style={{ marginTop: 4 }}>
              {w}
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={running || picked.length === 0} onClick={() => void run()}>
              Run optimization
            </button>
            {running && <button onClick={() => (stop.current = true)}>Stop</button>}
          </div>
          {error && <div className="issue error">{error}</div>}
          {result && !running && ranWith && ranWith !== signature && (
            <div className="issue warning" style={{ marginTop: 8 }}>
              Stats, builds or settings changed since this run, so these results are out of date. Run it again.
            </div>
          )}
          {progress && running && (
            <div style={{ marginTop: 8 }}>
              <div className="progress">
                <div style={{ width: `${(100 * progress.battles) / Math.max(1, progress.totalBattles)}%` }} />
              </div>
              <div className="small muted">
                Build {progress.candidate + 1} / {(opts.iterations + 1) * (opts.multiSeed ? opts.searchRuns : 1)} · {progress.battles} / {progress.totalBattles} battles · about {Math.ceil(eta / 1000)} s left
                {progress.best && ` · best so far ${num(progress.best.meanScore)} (${pct(progress.best.winRate)} wins)`}
              </div>
            </div>
          )}
        </Panel>
        {result && <CandidatesTable result={result} sel={sel} onSel={setSel} />}
      </div>

      <div className="stack">
        {result && shown && (
          <>
            <div className="panel">
              <h2>
                {shown.id === result.best.id ? 'Best build' : shown.id === 0 ? 'Starting build' : `Build #${shown.id}`}{' '}
                <span className="small muted">
                  score {num(shown.meanScore)} (balanced {num(shown.objective)}) · {pct(shown.winRate)} wins · value {shown.value}
                  {edit && ' · edited, not tested yet'}
                </span>
              </h2>
              <div className="small muted">{shown.change}</div>
              {shownLoadout &&
                (profile.equipped_skins ?? []).map((id) => {
                  const skin = data.skins.get(id);
                  if (!skin?.skill || !skin.quest_check || skin.quest_check.type === 'run') return null;
                  const q = checkSkinQuest(shownLoadout, skin);
                  return (
                    <div key={id} className={`small ${q.status === 'met' ? 'muted' : 'warn'}`}>
                      {skin.skill.name} quest: {q.status === 'met' ? 'met' : 'NOT met (skill off)'} · {q.detail}
                    </div>
                  );
                })}
              {shownLoadout && (
                <BagGrid
                  loadout={shownLoadout}
                  issues={editIssues}
                  selected={picked1}
                  hovered={null}
                  ghost={null}
                  maskEdit={false}
                  onSelect={(id) => {
                    setPicked1(id);
                    if (id) setStatSel(id);
                  }}
                  onInspect={setStatSel}
                  onHover={() => {}}
                  onToggleMask={() => {}}
                  onDrop={onBagDrop}
                  onKey={onBagKey}
                />
              )}
              <div className="row small" style={{ marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
                <span className="muted">Click an item for its stats; drag or use the arrow keys to move it, space to rotate, Delete to remove it.</span>
                {picked1 && (
                  <>
                    <button onClick={() => onBagKey('rotate')}>Rotate</button>
                    <button onClick={() => onBagKey('remove')}>Remove</button>
                  </>
                )}
                {edit && <button onClick={() => setEdit(null)}>Undo my edits</button>}
              </div>
              {edit && !editValid && <div className="issue error small">Items overlap or sit outside the bag: fix that before testing.</div>}
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <button disabled={shown.id === 0 && !edit} onClick={() => onApply(working ?? shown.placements)}>
                  Use this build
                </button>
                <button disabled={running || testing || !editValid} onClick={() => void run(working ?? shown.placements)} title="Run the optimization again, starting from this build (with my edits)">
                  Rerun from this build
                </button>
                <span style={{ flex: 1 }} />
                <button className="primary" disabled={!edit || !editValid || testing || running} onClick={testScore} title="Score my edited build on the same opponents and seeds; it's added to the list">
                  {testing ? 'Testing…' : 'Test score'}
                </button>
              </div>
            </div>
            <DiagnosisPanel c={shown} start={result.start} />
            <Comparison start={result.start} shown={shown} />
            <div className="panel">
              <h3>Match score distribution</h3>
              <div className="small muted">How often each match score came up (all opponents, all seeds). Grey: starting build; colour: this build.</div>
              <Histogram a={result.start} b={shown} />
            </div>
            <div className="panel">
              <h3>Score of every build tried</h3>
              <ScoreTrace result={result} sel={shown.id} onSel={setSel} />
            </div>
          </>
        )}
      </div>
      {shownStats && <StatsPanel stats={shownStats} synergy={shownSynergy} selected={statSel} onSelect={setStatSel} />}
    </div>
  );
}

function CandidatesTable({ result, sel, onSel }: { result: OptimizeResult; sel: number | null; onSel: (id: number) => void }) {
  return (
    <div className="panel">
      <h3>Builds tried ({result.candidates.length})</h3>
      <div className="small muted">✓ = kept as the new current build. Click a row to see it.</div>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="stats small">
          <thead>
            <tr>
              <th>#</th>
              {result.candidates.some((c) => c.run) && <th title="Which search seed (run) it came from">Run</th>}
              <th>Change</th>
              <th title="Mean match score">Score</th>
              <th title="What the search maximises: winning a won matchup by more counts less (diminishing returns above 0), so lost matchups weigh more">Balanced</th>
              <th>Wins</th>
              <th title="Matches where my Celestial Shield was still unused">Shield kept</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.candidates.map((c) => (
              <tr key={c.id} className={`clickable${c.id === sel ? ' sel' : ''}`} onClick={() => onSel(c.id)}>
                <td>{c.id}</td>
                {result.candidates.some((x) => x.run) && <td>{c.run ?? ''}</td>}
                <td>
                  {c.change}
                  {c.reason && <div className="muted">{c.reason}</div>}
                </td>
                <td>
                  <b style={c.id === result.best.id ? { color: 'var(--good, #16a34a)' } : undefined}>{num(c.meanScore)}</b>
                </td>
                <td>{num(c.objective)}</td>
                <td>{pct(c.winRate)}</td>
                <td>{pct(c.opponents.reduce((a, o) => a + o.myShieldLeftRate, 0) / Math.max(1, c.opponents.length))}</td>
                <td>{c.value}</td>
                <td>{c.accepted ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What the shown build is good and bad at (the search uses this to pick item swaps). */
function DiagnosisPanel({ c, start }: { c: Candidate; start: Candidate }) {
  const d = c.diagnosis;
  const list = (xs: { source: string; share: number }[]) => xs.map((x) => `${x.source} ${(x.share * 100).toFixed(0)}%`).join(' · ') || '—';
  return (
    <div className="panel">
      <h3>What this build is good and bad at</h3>
      <table className="stats small">
        <tbody>
          <tr>
            <td>My damage comes from</td>
            <td>{list(d.strengths)}</td>
          </tr>
          <tr>
            <td>Worst matchup</td>
            <td>{d.worst ? `${d.worst.opponent} (score ${num(d.worst.score)})` : '—'}</td>
          </tr>
          <tr>
            <td>What hurts me there</td>
            <td>{d.worst ? list(d.worst.threats) : '—'}</td>
          </tr>
          <tr>
            <td>Items doing the least</td>
            <td>{d.weakItems.map((w) => `${w.name} (${fmt(w.contribution)})`).join(' · ') || '—'}</td>
          </tr>
          {c.id !== start.id && (
            <tr>
              <td>Starting build</td>
              <td className="muted">
                damage from {list(start.diagnosis.strengths.slice(0, 3))}; hurt by {start.diagnosis.worst ? list(start.diagnosis.worst.threats.slice(0, 3)) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="small muted">
        Item swaps aim here: when losing, at a counter to what hurts most in the worst matchup (e.g. buff removal against Spike, Block / damage reduction
        against weapon hits, Cleanse against Burn / Poison); otherwise at more of the main damage source. The item doing the least is swapped out, and the new
        one goes where its dots link with the most items. "Doing the least" counts damage, healing, Block and status / removed stacks (a stack ≈ 0.1x ATK).
      </div>
    </div>
  );
}

function Comparison({ start, shown }: { start: Candidate; shown: Candidate }) {
  const rows: [string, (o: Candidate['opponents'][number]) => string][] = [
    ['Match score', (o) => num(o.meanScore)],
    ['Win rate', (o) => pct(o.winRate)],
    ['My HP left', (o) => `${num(o.myHpPct)}%`],
    ['Opponent HP left', (o) => `${num(o.foeHpPct)}%`],
    ['My Celestial Shield unused', (o) => pct(o.myShieldLeftRate)],
    ['Opponent shield unused', (o) => pct(o.foeShieldLeftRate)],
    ['Fight length', (o) => `${num(o.duration)} s`],
    ['My DPS', (o) => fmt(o.dps)],
    ['Damage dealt', (o) => fmt(o.dealt)],
    ['Damage taken', (o) => fmt(o.taken)],
  ];
  return (
    <div className="panel">
      <h3>Against each opponent</h3>
      <div className="small muted">Means over the seeds: starting build → this build.</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="stats small">
          <thead>
            <tr>
              <th />
              {shown.opponents.map((o) => (
                <th key={o.name}>{o.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}>
                <td>{label}</td>
                {shown.opponents.map((o, i) => (
                  <td key={o.name}>
                    <span className="muted">{f(start.opponents[i]!)}</span> → <b>{f(o)}</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Histogram of match scores, 10-point bins from −150 to 150 (shield weight can push past ±100). */
function Histogram({ a, b }: { a: Candidate; b: Candidate }) {
  const scores = (c: Candidate) => c.opponents.flatMap((o) => o.matches.map((m) => m.score));
  const sa = scores(a);
  const sb = scores(b);
  const all = [...sa, ...sb];
  const lo = Math.floor(Math.min(-100, ...all) / 10) * 10;
  const hi = Math.ceil(Math.max(100, ...all) / 10) * 10;
  const bins = Math.max(1, (hi - lo) / 10);
  const count = (xs: number[]) => {
    const out = new Array(bins).fill(0) as number[];
    for (const x of xs) {
      const k = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / 10)));
      out[k] = (out[k] ?? 0) + 1;
    }
    return out.map((n) => n / Math.max(1, xs.length));
  };
  const ca = count(sa);
  const cb = count(sb);
  const max = Math.max(0.01, ...ca, ...cb);
  const W = 520;
  const H = 150;
  const bw = W / bins;
  const y = (f: number) => H - 18 - (f / max) * (H - 30);
  const x0 = ((0 - lo) / (hi - lo)) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Match score distribution">
      {ca.map((f, i) => (
        <rect key={`a${i}`} x={i * bw + 1} y={y(f)} width={bw - 2} height={H - 18 - y(f)} fill="var(--muted, #888)" opacity={0.35} />
      ))}
      {cb.map((f, i) => (
        <rect key={`b${i}`} x={i * bw + bw * 0.25} y={y(f)} width={bw * 0.5} height={H - 18 - y(f)} fill="var(--accent)" />
      ))}
      <line x1={x0} x2={x0} y1={6} y2={H - 18} stroke="currentColor" strokeDasharray="3 3" opacity={0.5} />
      <text x={2} y={H - 4} fontSize={10} fill="currentColor">
        {lo}
      </text>
      <text x={x0 - 4} y={H - 4} fontSize={10} fill="currentColor">
        0
      </text>
      <text x={W - 24} y={H - 4} fontSize={10} fill="currentColor">
        {hi}
      </text>
      <text x={W - 150} y={14} fontSize={10} fill="currentColor">
        {`mean ${num(a.meanScore)} → ${num(b.meanScore)}`}
      </text>
    </svg>
  );
}

/** Mean score of every build in the order tried; kept builds joined by a line, best ringed. */
function ScoreTrace({ result, sel, onSel }: { result: OptimizeResult; sel: number; onSel: (id: number) => void }) {
  const cs = result.candidates;
  const ys = cs.map((c) => c.meanScore);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const W = 520;
  const H = 150;
  const px = (i: number) => 10 + (i / Math.max(1, cs.length - 1)) * (W - 20);
  const py = (v: number) => (hi === lo ? H / 2 : H - 14 - ((v - lo) / (hi - lo)) * (H - 28));
  const kept = cs.filter((c) => c.accepted);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Score of every build tried">
      <polyline points={kept.map((c) => `${px(c.id)},${py(c.meanScore)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      {cs.map((c) => (
        <circle key={c.id} cx={px(c.id)} cy={py(c.meanScore)} r={c.id === sel ? 5 : 3} fill={c.accepted ? 'var(--accent)' : 'var(--muted, #888)'} style={{ cursor: 'pointer' }} onClick={() => onSel(c.id)}>
          <title>{`#${c.id} ${c.change}: ${num(c.meanScore)}`}</title>
        </circle>
      ))}
      <circle cx={px(result.best.id)} cy={py(result.best.meanScore)} r={8} fill="none" stroke="var(--good, #16a34a)" strokeWidth={2} />
      <text x={4} y={12} fontSize={10} fill="currentColor">
        {num(hi)}
      </text>
      <text x={4} y={H - 2} fontSize={10} fill="currentColor">
        {num(lo)}
      </text>
    </svg>
  );
}
