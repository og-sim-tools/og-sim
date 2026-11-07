/** data/training.yaml — Combat Training tables (Profile tab, calculated stats). */
import { z } from 'zod';
import { Id } from './common';

const Table = z.object({ hp: z.array(z.number()), atk: z.array(z.number()), block: z.array(z.number()) }).strict();

export const TrainingDataSchema = z
  .object({
    source: z.string(),
    verified: z.boolean(),
    /** Upgrades of each stat per rank; all three at this number reaches the next rank. */
    upgrades_per_rank: z.number().int().positive(),
    /** Rank types in order, with how many numbers each has (Apprentice 1–3, Adventurer 1–5 …). */
    ranks: z.array(z.object({ id: Id, name: z.string(), numbers: z.number().int().positive() }).strict()).min(1),
    /** Bonus for the rank reached, by rank level (0 = the first rank's 1). */
    rank_bonus: Table,
    /** Each stat's track, by tier (upgrades_per_rank × rank level + that stat's upgrades). */
    track: Table,
  })
  .strict();
export type TrainingData = z.infer<typeof TrainingDataSchema>;

/** The account's training: rank name and number, then the upgrades of HP, ATK and Block in that rank. */
export const TrainingSchema = z
  .object({
    rank: Id,
    number: z.number().int().min(1),
    hp: z.number().int().min(0),
    atk: z.number().int().min(0),
    block: z.number().int().min(0),
  })
  .strict();
export type Training = z.infer<typeof TrainingSchema>;
