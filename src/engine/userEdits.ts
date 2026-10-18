/**
 * Item editor edits (SPEC §8.2): a list of entries in a manual/ file that override the wiki field by field.
 * Pure, so the dev server (data/<category>/manual/user_edits.yaml) and the browser (hosted site) share it.
 */
import { parse, stringify } from 'yaml';

export const USER_EDITS_FILE = 'user_edits.yaml';
/** The hosted site's edits, kept in the browser: a separate file name, loaded after user_edits.yaml so they win. */
export const BROWSER_EDITS_FILE = 'your_edits.yaml';
export const EDIT_ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const EDITS_HEADER =
  '# Written by the item editor (SPEC §8.2). Same id as a wiki entry = override field by field.\n' +
  '# Safe to hand-edit. Loaded after the other manual/ files, so these edits win.\n';

export type Entry = Record<string, unknown>;
const isObj = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge: nested objects merge, everything else (lists, values, null) replaces. */
export function deepMerge(base: Entry, over: Entry): Entry {
  const out: Entry = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Entry, v) : v;
  return out;
}

/**
 * Insert or update one entry. Fields deep-merge into the stored entry, so earlier edits to other fields
 * survive. A null value is stored as null, which the loader reads as "delete this field".
 */
export function upsertEdit(list: Entry[], entry: Entry): Entry[] {
  const id = entry.id;
  if (typeof id !== 'string' || !EDIT_ID_RE.test(id)) throw new Error(`Bad id "${String(id)}".`);
  const idx = list.findIndex((e) => e.id === id);
  return idx >= 0 ? list.map((e, i) => (i === idx ? deepMerge(e, entry) : e)) : [...list, entry];
}

/** Drop all edits to one entry (the wiki / other manual files show again). */
export const removeEdit = (list: Entry[], id: string): Entry[] => list.filter((e) => e.id !== id);

export function readEdits(text: string | null | undefined): Entry[] {
  if (!text) return [];
  const v = parse(text) as unknown;
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('An edits file must contain a list.');
  return v.filter(isObj);
}

export const writeEdits = (list: Entry[]): string => EDITS_HEADER + stringify(list, { lineWidth: 0, aliasDuplicateObjects: false });
