/**
 * Chapters (user, 2026-10-20; config `chapters`): every chapter has 12 enemies, every 5th has 5; from chapter
 * 10 on, the enemies repeat every 25 chapters (chapter 35 has chapter 10's enemies, with other base stats).
 * Which enemies a chapter has isn't entered yet, so every chapter is "unknown" for now.
 */
import type { GameData } from './loader';

export interface ChapterInfo {
  number: number;
  /** How many enemies it has (12, or 5 for every 5th chapter). */
  enemies: number;
  /** Every 5th chapter. */
  bossChapter: boolean;
  /** The earlier chapter with the same enemies (other base stats), if any. */
  sameAs: number | null;
  /** Its enemies are entered (none are yet). */
  known: boolean;
}

export function chapterInfo(data: GameData, n: number): ChapterInfo {
  const c = data.config!.chapters;
  const number = Math.max(1, Math.min(c.count, Math.round(n)));
  const bossChapter = c.boss_every > 0 && number % c.boss_every === 0;
  // The first chapter in the repeating range with the same enemies.
  const first = number >= c.repeat_from + c.repeat_every && c.repeat_every > 0 ? c.repeat_from + ((number - c.repeat_from) % c.repeat_every) : number;
  return { number, enemies: bossChapter ? c.boss_enemies : c.enemies, bossChapter, sameAs: first !== number ? first : null, known: false };
}
