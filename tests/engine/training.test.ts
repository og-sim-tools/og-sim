import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { basicStats, computeAccountStats } from '../../src/engine/accountStats';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { loadGameData } from '../../src/engine/loader';
import { ProfileSchema } from '../../src/engine/model';
import { readAccount, writeAccount } from '../../src/engine/saves';
import { rankLevel, rankOf, trainingStats } from '../../src/engine/training';
import { buildPlayer } from '../../src/engine/combat/setup';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';

const ROOT = join(__dirname, '..', '..');
const data = loadGameDataFromDir(join(ROOT, 'data')).data;
const t = data.training!;

describe('Combat Training data', () => {
  it('loads every rank and tier from the CSVs', () => {
    expect(t.ranks.map((r) => [r.id, r.numbers])).toEqual([
      ['apprentice', 3],
      ['adventurer', 5],
      ['elite', 10],
      ['master', 15],
      ['warrior', 20],
      ['gmaster', 27],
      ['hero', 41],
    ]);
    expect(t.rank_bonus.hp).toHaveLength(121);
    expect(t.track.hp).toHaveLength(1201);
  });

  it('rejects tables that are the wrong length', () => {
    const text = readFileSync(join(ROOT, 'data', 'training.yaml'), 'utf8').replace('upgrades_per_rank: 10', 'upgrades_per_rank: 9');
    const r = loadGameData([{ path: 'training.yaml', text }]);
    expect(r.issues.some((i) => i.file === 'training.yaml' && i.field === 'track.hp')).toBe(true);
  });
});

describe('training stats', () => {
  it('rank names and numbers map to rank levels', () => {
    expect(rankLevel(t, 'apprentice', 1)).toBe(0);
    expect(rankLevel(t, 'adventurer', 1)).toBe(3);
    expect(rankLevel(t, 'gmaster', 12)).toBe(64);
    expect(rankLevel(t, 'hero', 41)).toBe(120);
    expect(rankLevel(t, 'apprentice', 4)).toBeNull();
    expect(rankOf(t, 64)).toEqual({ rank: 'gmaster', number: 12 });
  });

  it('each stat is the rank bonus plus its own track (10 × rank level + its upgrades)', () => {
    // GMaster 12 = rank level 64: rank bonus 148808 / 29762 / 29762; tracks at 647 / 650 / 643.
    const s = trainingStats(t, { rank: 'gmaster', number: 12, hp: 7, atk: 10, block: 3 });
    expect(s).toEqual({ hp: 148808 + 146963, atk: 29762 + 30060, block: 29762 + 87748, rankLevel: 64, problems: [] });
    expect(trainingStats(t, { rank: 'apprentice', number: 1, hp: 0, atk: 0, block: 0 })).toMatchObject({ hp: 0, atk: 0, block: 0 });
  });

  it('says why an input is out of range', () => {
    expect(trainingStats(t, { rank: 'apprentice', number: 9, hp: 0, atk: 0, block: 0 }).problems[0]).toMatch(/only goes up to 3/);
    expect(trainingStats(t, { rank: 'nope', number: 1, hp: 0, atk: 0, block: 0 }).problems[0]).toMatch(/Unknown training rank/);
    const top = trainingStats(t, { rank: 'hero', number: 41, hp: 2, atk: 0, block: 0 });
    expect(top.hp).toBe(1914550 + 1421175);
    expect(top.problems[0]).toMatch(/HP: the table ends/);
  });
});

describe('calculated vs typed-in HP / ATK / Block', () => {
  const base = { basic_stats: { hp: '5M', atk: '1M', initial_block: '2M' }, training: { rank: 'gmaster', number: 12, hp: 7, atk: 10, block: 3 } };

  it('typed in (the default) overrides every calculation', () => {
    const p = ProfileSchema.parse(base);
    const a = computeAccountStats(data, p, null);
    expect([a.hp, a.atk, a.initialBlock]).toEqual([5e6, 1e6, 2e6]);
    expect(a.basic).toEqual({ mode: 'direct', parts: [], warnings: [] });
  });

  it('calculated adds up training and always warns that gear is a stub', () => {
    const p = ProfileSchema.parse({ ...base, stat_mode: 'calculated' });
    const a = computeAccountStats(data, p, null);
    expect([a.hp, a.atk, a.initialBlock]).toEqual([295771, 59822, 117510]);
    expect(a.basic.parts.map((x) => x.label)).toEqual(['Training (GMaster 12, HP +7)', 'Training (GMaster 12, ATK +10)', 'Training (GMaster 12, Block +3)']);
    expect(a.basic.warnings.join(' ')).toMatch(/Gear HP \/ ATK \/ Block isn't counted/);
  });

  it('every battle with calculated stats carries the warning', () => {
    const lo = (mode?: 'calculated') => buildLoadout(data, ProfileSchema.parse({ ...base, ...(mode ? { stat_mode: mode } : {}) }), LayoutSchema.parse({ placements: [] }));
    const w = buildPlayer(lo('calculated'));
    expect(w.player.maxHp).toBe(295771);
    expect(w.warnings.some((x) => /calculated .* too low/.test(x))).toBe(true);
    expect(buildPlayer(lo()).warnings.some((x) => /calculated/.test(x))).toBe(false);
  });

  it('calculated without training counts nothing and asks for it', () => {
    const b = basicStats(data, ProfileSchema.parse({ basic_stats: base.basic_stats, stat_mode: 'calculated' }));
    expect([b.hp, b.atk, b.initialBlock]).toEqual([0, 0, 0]);
    expect(b.source.warnings[0]).toMatch(/Enter your Combat Training/);
  });

  it('the account keeps the mode and training (version 7), and older accounts stay typed in', () => {
    const p = ProfileSchema.parse({ ...base, stat_mode: 'calculated' });
    const back = readAccount(writeAccount(p, null)).profile;
    expect(back.stat_mode).toBe('calculated');
    expect(back.training).toEqual(base.training);
    const v6 = readAccount(readFileSync(join(ROOT, 'tests/fixtures/saves/v6/profile.yaml'), 'utf8')).profile;
    expect(v6.stat_mode).toBeUndefined();
    expect(writeAccount(ProfileSchema.parse(base), null)).not.toMatch(/stat_mode/);
  });
});
