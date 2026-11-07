/**
 * Combat Training stats (data/training.yaml). Each stat (HP, ATK, Block) has its own track: its tier is
 * upgrades_per_rank × rank level + that stat's upgrades in the current rank, and its value is the rank's bonus
 * plus the track at that tier. That reading of the user's tables (2026-11-06) isn't confirmed by an in-game
 * number yet; the Profile tab says so.
 */
import type { Training, TrainingData } from './model';

export interface TrainingStats {
  hp: number;
  atk: number;
  block: number;
  /** 0 = the first rank's 1. */
  rankLevel: number;
  /** Why the input couldn't be used as is (unknown rank, number or upgrades out of range). */
  problems: string[];
}

/** Rank level of a rank name + number, or null if there's no such rank. */
export function rankLevel(t: TrainingData, rank: string, number: number): number | null {
  let level = 0;
  for (const r of t.ranks) {
    if (r.id === rank) return number >= 1 && number <= r.numbers ? level + number - 1 : null;
    level += r.numbers;
  }
  return null;
}

/** The rank name and number of a rank level. */
export function rankOf(t: TrainingData, level: number): { rank: string; number: number } {
  for (const r of t.ranks) {
    if (level < r.numbers) return { rank: r.id, number: level + 1 };
    level -= r.numbers;
  }
  const last = t.ranks.at(-1)!;
  return { rank: last.id, number: last.numbers };
}

export function trainingStats(t: TrainingData, sel: Training): TrainingStats {
  const problems: string[] = [];
  const level = rankLevel(t, sel.rank, sel.number);
  const name = t.ranks.find((r) => r.id === sel.rank)?.name ?? sel.rank;
  if (level === null) {
    const r = t.ranks.find((x) => x.id === sel.rank);
    problems.push(r ? `${name} only goes up to ${r.numbers}, not ${sel.number}.` : `Unknown training rank "${sel.rank}".`);
    return { hp: 0, atk: 0, block: 0, rankLevel: 0, problems };
  }
  const per = t.upgrades_per_rank;
  const value = (stat: 'hp' | 'atk' | 'block', label: string) => {
    const track = t.track[stat];
    let ups = sel[stat];
    if (ups > per) {
      problems.push(`${label}: ${ups} upgrades, but a rank has only ${per}.`);
      ups = per;
    }
    let tier = per * level + ups;
    if (tier >= track.length) {
      problems.push(`${label}: the table ends at ${name} ${sel.number} with ${track.length - 1 - per * level} upgrades.`);
      tier = track.length - 1;
    }
    return (t.rank_bonus[stat][level] ?? 0) + (track[tier] ?? 0);
  };
  return { hp: value('hp', 'HP'), atk: value('atk', 'ATK'), block: value('block', 'Block'), rankLevel: level, problems };
}
