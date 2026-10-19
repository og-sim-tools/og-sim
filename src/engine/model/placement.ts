/** One item placed in a bag (layouts, enemy builds). */
import { z } from 'zod';
import { Id } from './common';

export const LayoutPlacementSchema = z
  .object({
    /** Instance id; generated from the item id when left out. */
    id: z.string().min(1).optional(),
    /** Item or gear id. */
    item: Id,
    x: z.number().int(),
    y: z.number().int(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    /** Brought as starting equipment (costs Supply Ability) instead of bought in the shop. */
    supply: z.boolean().default(false),
  })
  .strict();

export const BagMaskSchema = z.object({ mask: z.array(z.number().int()) }).strict();
export const EnhancedCellsSchema = z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict());

/**
 * An item put aside in the storage box beside the bag while rearranging: it isn't in the bag, so it doesn't
 * fight or count towards the build's value. x, y: where its top-left corner sits, as a share (0–1) of the
 * box's width and height (not on a grid).
 */
export const StoredItemSchema = z
  .object({
    id: z.string().min(1).optional(),
    item: Id,
    x: z.number(),
    y: z.number(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    supply: z.boolean().default(false),
  })
  .strict();
