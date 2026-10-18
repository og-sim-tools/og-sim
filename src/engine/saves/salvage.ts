/**
 * Lenient parsing for saved files: whatever doesn't fit the schema is removed piece by piece, each with a
 * note saying what and why, until the rest parses. A save is never refused (see ./index.ts).
 */
import type { ZodIssue, ZodTypeAny, z } from 'zod';

export interface SaveNote {
  level: 'info' | 'warning';
  message: string;
}

type Container = Record<string, unknown> | unknown[];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;

const at = (root: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((v, k) => (isContainer(v) ? (v as Record<string, unknown>)[k as string] : undefined), root);
const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'nothing' : s.length > 80 ? `${s.slice(0, 77)}…` : s;
};
export const pathText = (path: (string | number)[]) => path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '') || '(the whole file)';
/** "placements[2] (black_bow)": list positions shift as entries are dropped, so name the entry too. */
const where = (root: unknown, path: (string | number)[]) => {
  const v = at(root, path);
  const label = isObj(v) ? (v.item ?? v.id ?? v.name) : undefined;
  return `${pathText(path)}${typeof label === 'string' ? ` (${label})` : ''}`;
};
const sameRequired = (issue: ZodIssue, last: (string | number)[] | null) =>
  !!last && issue.code === 'invalid_type' && issue.received === 'undefined' && pathText(issue.path) === pathText(last);

/** Remove the smallest piece of `root` that `issue` is about. Returns the path removed, or null when there's nothing left to remove. */
function dropFor(root: Container, issue: ZodIssue, notes: SaveNote[], what: string, reason = `${pathText(issue.path)}: ${issue.message}`): (string | number)[] | null {
  const path = issue.path;
  if (issue.code === 'unrecognized_keys') {
    const obj = at(root, path);
    if (!isObj(obj)) return null;
    for (const k of issue.keys) delete obj[k];
    notes.push({ level: 'warning', message: `${what}: ignored unknown setting${issue.keys.length > 1 ? 's' : ''} ${issue.keys.join(', ')}${path.length ? ` in ${where(root, path)}` : ''}.` });
    return path;
  }
  if (issue.code === 'too_big' && issue.type === 'array') {
    const arr = at(root, path);
    if (Array.isArray(arr) && arr.length > Number(issue.maximum)) {
      const cut = arr.splice(Number(issue.maximum));
      notes.push({ level: 'warning', message: `${what}: ${pathText(path)} can hold at most ${String(issue.maximum)}; dropped ${show(cut)}.` });
      return path;
    }
  }
  // The deepest list entry the problem is in goes as a whole (a placement, a pet, a blessing) …
  for (let k = path.length - 1; k >= 0; k--) {
    if (typeof path[k] !== 'number') continue;
    const arr = at(root, path.slice(0, k));
    if (Array.isArray(arr) && (path[k] as number) < arr.length) {
      const [gone] = arr.splice(path[k] as number, 1);
      notes.push({ level: 'warning', message: `${what}: dropped ${pathText(path.slice(0, k + 1))} ${show(gone)} (${reason}).` });
      return path.slice(0, k + 1);
    }
  }
  // … otherwise the deepest setting that exists (its default applies).
  for (let k = path.length; k >= 1; k--) {
    const parent = at(root, path.slice(0, k - 1));
    const key = path[k - 1]!;
    if (isObj(parent) && key in parent) {
      const gone = parent[key as string];
      delete parent[key as string];
      notes.push({ level: 'warning', message: `${what}: dropped ${pathText(path.slice(0, k))} ${show(gone)} (${reason}).` });
      return path.slice(0, k);
    }
  }
  return null;
}

/** Parse `raw` with `schema`, dropping what doesn't fit (with notes). `fallback` is used if nothing parses. */
export function parseSalvaging<S extends ZodTypeAny>(schema: S, raw: unknown, notes: SaveNote[], what: string, fallback: unknown = {}): z.infer<S> {
  let value: unknown = raw === undefined || raw === null ? {} : structuredClone(raw);
  if (!isObj(value)) {
    notes.push({ level: 'warning', message: `${what}: not a list of settings (${show(raw)}); started empty.` });
    value = {};
  }
  let last: { path: (string | number)[]; reason: string } | null = null;
  for (let i = 0; i < 500; i++) {
    const res = schema.safeParse(value);
    if (res.success) return res.data as z.infer<S>;
    const issue = res.error.issues[0]!;
    // A required setting that was just dropped as invalid: drop what holds it instead, as one note with the first reason.
    const again = sameRequired(issue, last?.path ?? null);
    if (again) notes.pop();
    const reason: string = again ? last!.reason : `${pathText(issue.path)}: ${issue.message}`;
    const dropped = dropFor(value as Container, again ? { ...issue, path: issue.path.slice(0, -1), message: reason } : issue, notes, what, reason);
    if (!dropped) break;
    last = { path: dropped, reason };
  }
  notes.push({ level: 'warning', message: `${what}: couldn't be read; started empty.` });
  return schema.parse(fallback) as z.infer<S>;
}
