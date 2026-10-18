/**
 * Headless CLI (SPEC §3).
 *
 *   npm run sim -- validate layouts/example.yaml
 *   npm run sim -- stats layouts/example.yaml [--profile profile/profile.yaml]
 *   npm run sim -- battle layouts/example.yaml [--runs 1000] [--seed 7] [--enemy id]
 *                         [--duration 30] [--mode stage] [--log]
 */
import { applySetup } from './engine/layoutSetup';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { BattleSetupError, runBattle } from './engine/combat/battle';
import { resolveEnemies, runMonteCarlo } from './engine/combat/montecarlo';
import type { BattleResult } from './engine/combat/types';
import { buildSynergyReport } from './engine/effects/synergy';
import { formatIssue, loadProfile } from './engine/loader';
import { loadGameDataFromDir } from './engine/loader-node';
import { type Loadout, type LoadoutIssue, buildLoadout } from './engine/loadout';
import type { LayoutData } from './engine/model';
import { readAccount, readBuild } from './engine/saves';
import { formatShown } from './engine/numbers';
import { type PctStat, aggregateStats } from './engine/stats';
import { supplySummary, validateLoadout } from './engine/validate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function usage(): never {
  console.error('Usage: npm run sim -- <validate|stats|battle> <layout.yaml> [--profile <profile.yaml>] [--runs N] [--seed S] [--enemy id] [--duration s] [--mode stage] [--log]');
  process.exit(2);
}

function fail(lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(1);
}

function load(layoutPath: string, profilePath: string): { loadout: Loadout; battle: LayoutData['battle'] } {
  const res = loadGameDataFromDir(join(ROOT, 'data'));
  if (!res.ok) fail(['Game data has errors (run `npm run check-data`):', ...res.errors.map(formatIssue)]);
  const read = (path: string) => {
    try {
      return readFileSync(path, 'utf8');
    } catch (e) {
      return fail([`${path}: ${(e as Error).message}`]);
    }
  };
  // Saved files of any version load (src/engine/saves); what had to change is printed, not fatal.
  const account = readAccount(read(profilePath));
  const build = readBuild(read(layoutPath), { v1Profile: account.migratedFromV1 }, layoutPath);
  for (const n of [...account.notes, ...build.notes]) console.error(`${n.level === 'warning' ? 'WARNING' : 'NOTE   '} ${n.message}`);
  const profile = applySetup(account.profile, build.layout.setup);
  const checked = loadProfile({ path: profilePath, text: stringify(profile) }, res.data);
  if (!checked.ok) fail(checked.issues.map(formatIssue));
  return { loadout: buildLoadout(res.data, profile, build.layout), battle: build.layout.battle };
}

const fmtIssue = (i: LoadoutIssue) => `${i.level === 'error' ? 'ERROR  ' : 'WARNING'} [${i.code}] ${i.message}`;
const sign = (n: number) => `${n >= 0 ? '+' : ''}${Number(n.toFixed(2))}`;
const parts = (p: PctStat) => p.parts.map((c) => `${sign(c.amount)} ${c.label}`).join(', ');

function printValidation(loadout: Loadout): boolean {
  const issues = validateLoadout(loadout);
  const supply = supplySummary(loadout);
  console.log(`Hero: ${loadout.hero?.name ?? '—'}   Supply Ability: ${supply ? `${supply.used} / ${supply.capacity}` : '—'}`);
  if (issues.length === 0) console.log('Valid: no problems found.');
  for (const i of issues) console.log(fmtIssue(i));
  return !issues.some((i) => i.level === 'error');
}

function printStats(loadout: Loadout) {
  const { player, items, issues } = aggregateStats(loadout);
  const synergy = buildSynergyReport(loadout);
  console.log(`\nPlayer: HP ${formatShown(player.hp)}  ATK ${formatShown(player.atk)}  Initial Block ${formatShown(player.initialBlock)}`);
  for (const i of issues) console.log(fmtIssue(i));

  for (const [id, s] of items) {
    const syn = synergy.get(id)!;
    console.log(`\n■ ${s.name}${s.kind === 'gear' ? ' (gear)' : ''}  [${id}]`);
    if (s.damage) {
      const d = s.damage;
      const unc = d.ratio.uncertainty !== null ? ` ±${(d.ratio.uncertainty * 100).toFixed(2)}%` : '';
      console.log(`  DMG ${formatShown(d.perHit)} per hit${d.hits > 1 ? ` × ${d.hits}` : ''}  = ${d.ratio.ratio}x ATK${unc} (${formatShown(d.base)}) × ${d.modifier.toFixed(3)}`);
      if (d.typePct.parts.length) console.log(`    type ${sign(d.typePct.total)}%: ${parts(d.typePct)}`);
      if (d.allPct.parts.length) console.log(`    all  ${sign(d.allPct.total)}%: ${parts(d.allPct)}`);
    }
    if (s.cooldown) {
      const c = s.cooldown;
      console.log(`  Cooldown ${c.final.toFixed(3)}s (base ${c.base}s, haste ${sign(c.haste.total)}%${c.clamped ? ', clamped' : ''})${c.haste.parts.length ? `: ${parts(c.haste)}` : ''}`);
    }
    if (s.accuracy) console.log(`  Accuracy ${s.accuracy.total}%: ${parts(s.accuracy)}`);
    if (s.critChance) console.log(`  Crit ${s.critChance.capped}%${s.critChance.parts.length ? `: ${parts(s.critChance)}` : ''}`);
    if (s.critDamage) console.log(`  Crit DMG +${s.critDamage.total}%${s.critDamage.parts.length ? `: ${parts(s.critDamage)}` : ''}`);
    for (const [name, v] of Object.entries(s.effectValues)) {
      console.log(`  ${name}: ${v.value !== null ? formatShown(v.value) : '?'} (${v.ratio.ratio}x ${v.scalesWith.toUpperCase()})`);
    }
    for (const g of syn.gives) {
      const to = g.targets.map((t) => synergy.get(t)?.name ?? t).join(', ') || 'nothing';
      console.log(`  gives: ${g.text} → ${to}`);
    }
    for (const r of syn.receives) console.log(`  receives: ${r.text} ← ${r.fromName}`);
    if (syn.textOnly) {
      const touches = syn.dotTargets.map((t) => synergy.get(t)?.name ?? t).join(', ');
      console.log(`  ${syn.partial ? 'rest of effect (text only)' : 'effect (text only, not simulated yet)'}: ${syn.textOnly.replace(/\n/g, ' ')}`);
      if (touches) console.log(`    dots touch: ${touches}`);
    }
  }
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function printBattle(r: BattleResult, withLog: boolean) {
  if (withLog) {
    for (const e of r.log) console.log(`${e.t.toFixed(1).padStart(5)}s  ${e.side === 'player' ? 'ME ' : 'FOE'}  ${e.detail ?? e.type}`);
    console.log('');
  }
  if (r.fights.length > 1) {
    r.fights.forEach((f, i) =>
      console.log(`Fight ${i + 1}: ${f.winner === 'player' ? 'won' : 'lost'} vs ${f.enemy}${f.boss ? ' (boss)' : ''} in ${f.duration.toFixed(1)}s${f.reason === 'timeout' ? ' (time limit)' : ''}`),
    );
  }
  const who = r.winner === 'player' ? 'WIN' : 'LOSS';
  console.log(`${who} (${r.reason === 'timeout' ? (r.winner === 'player' ? 'time limit: more HP % left' : 'time limit') : r.winner === 'player' ? 'enemy defeated' : 'I was defeated'}) after ${r.duration.toFixed(1)}s, seed ${r.seed}`);
  console.log(`Me:    HP ${formatShown(r.player.hp)} / ${formatShown(r.player.maxHp)}  block ${formatShown(r.player.block)}  dealt ${formatShown(r.player.damageDealt)}  (${formatShown(r.dps)}/s)`);
  console.log(`Enemy: HP ${formatShown(r.enemy.hp)} / ${formatShown(r.enemy.maxHp)}  block ${formatShown(r.enemy.block)}  dealt ${formatShown(r.enemy.damageDealt)}`);
  const st = Object.entries(r.player.statuses).map(([k, v]) => `${k} ${v}`).join(', ');
  const et = Object.entries(r.enemy.statuses).map(([k, v]) => `${k} ${v}`).join(', ');
  if (st) console.log(`My statuses: ${st}`);
  if (et) console.log(`Enemy statuses: ${et}`);
  console.log('\nPer item:');
  for (const [id, it] of Object.entries(r.items)) {
    const parts = [
      it.activations ? `${it.activations} activations` : '',
      it.skillActivations ? `${it.skillActivations} skill activations` : '',
      it.triggers ? `${it.triggers} triggers` : '',
      it.attacks ? `${it.attacks} attacks, ${it.hits} hits, ${it.misses} misses, ${it.crits} crits` : '',
      it.damage ? `${formatShown(it.damage)} dmg` : '',
      it.healing ? `${formatShown(it.healing)} healed` : '',
      it.block ? `${formatShown(it.block)} block` : '',
      Object.entries(it.statuses).map(([k, v]) => `${v} ${k}`).join(', '),
    ].filter(Boolean);
    if (parts.length) console.log(`  ${it.side === 'enemy' ? '[enemy] ' : ''}${it.name} [${id}]: ${parts.join(' · ')}`);
  }
  for (const [k, v] of Object.entries(r.statusDamage)) console.log(`  ${k} damage: ${formatShown(v)}`);
  for (const w of r.warnings) console.log(`NOTE: ${w}`);
}

const [cmd, layoutArg, ...rest] = process.argv.slice(2);
if (!cmd || !layoutArg) usage();
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const profilePath = resolve(opt('profile') ?? join(ROOT, 'profile', 'profile.yaml'));
const { loadout, battle } = load(resolve(layoutArg), profilePath);

if (cmd === 'validate') {
  process.exit(printValidation(loadout) ? 0 : 1);
} else if (cmd === 'stats') {
  const ok = printValidation(loadout);
  printStats(loadout);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'battle') {
  const ok = printValidation(loadout);
  if (!ok) console.log('(battling anyway — fix the errors above for a meaningful result)');
  try {
    const mode = opt('mode') ?? battle?.mode ?? 'stage';
    const enemy = resolveEnemies(loadout.data, { ...battle, mode }, opt('enemy'));
    const seedText = opt('seed');
    const seed = seedText === undefined ? (battle?.seed ?? 1) : /^-?\d+$/.test(seedText) ? Number(seedText) : seedText;
    const runs = Number(opt('runs') ?? battle?.runs ?? 1);
    const opts = { mode, durationS: opt('duration') ? Number(opt('duration')) : battle?.duration_s, seed };
    console.log(`\nBattle vs ${enemy.map((e) => e.name).join(' → ')} (${mode}, ${runs} run${runs === 1 ? '' : 's'})\n`);
    if (runs === 1) printBattle(runBattle(loadout, enemy, { ...opts, log: rest.includes('--log') }), rest.includes('--log'));
    else {
      const mc = runMonteCarlo(loadout, enemy, runs, opts);
      const d = mc.dps;
      console.log(`Win rate ${pct(mc.winRate)} (${mc.wins}/${mc.runs}), ${mc.timeouts} time-outs`);
      console.log(`Duration  mean ${mc.duration.mean.toFixed(1)}s  p10 ${mc.duration.p10.toFixed(1)}s  p50 ${mc.duration.p50.toFixed(1)}s  p90 ${mc.duration.p90.toFixed(1)}s`);
      console.log(`DPS       mean ${formatShown(d.mean)}  min ${formatShown(d.min)}  p10 ${formatShown(d.p10)}  p50 ${formatShown(d.p50)}  p90 ${formatShown(d.p90)}  max ${formatShown(d.max)}`);
      console.log(`HP left   me ${mc.playerHpLeftPct.toFixed(1)}%  enemy ${mc.enemyHpLeftPct.toFixed(1)}%`);
      for (const w of mc.warnings) console.log(`NOTE: ${w}`);
    }
  } catch (e) {
    if (e instanceof BattleSetupError) fail([`ERROR: ${e.message}`]);
    throw e;
  }
} else {
  usage();
}
