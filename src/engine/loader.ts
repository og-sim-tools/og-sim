/**
 * Data loader (SPEC §3): YAML → zod-validated game data.
 *
 * - Files live in `<category>/wiki/*.yaml` (generated, never hand-edited) and
 *   `<category>/manual/*.yaml` (my corrections and additions), plus `stats.yaml` and `config.yaml`.
 * - A manual entry with the same id as a wiki entry overrides it field by field: nested objects
 *   merge, lists and plain values replace, `null` deletes. Geometry (`footprint` / `shape` / `dots`)
 *   is replaced as a whole. Every override is reported.
 * - A manual entry with `replaces: <wiki id>` overrides that wiki entry under a new id (a rename);
 *   references to the old id are redirected and reported.
 * - Errors name the file, line, entry and field.
 *
 * Pure: takes file contents, so it runs in Node (see loader-node.ts), tests, and the browser.
 */
import { LineCounter, parseDocument, isMap, isSeq } from 'yaml';
import type { ZodIssue, ZodTypeAny } from 'zod';
import { type Cell, parseFootprint, validateShapeDefinition, FootprintError } from './bag';
import {
  AuraSchema,
  SkinSchema,
  BlessingSchema,
  ConfigSchema,
  EnemySchema,
  EnemyTraitSchema,
  GEOMETRY_KEYS,
  GearSchema,
  HeroSchema,
  ItemSchema,
  PROVENANCE_KEYS,
  PetSchema,
  ProfileSchema,
  StatRegistrySchema,
  type Profile,
  StatusSchema,
  type AuraData,
  type SkinData,
  type BlessingData,
  type Config,
  type EnemyData,
  type EnemyTraitData,
  type GearData,
  type HeroData,
  type ItemData,
  type PetData,
  type StatDef,
  type StatusData,
} from './model';

// ------------------------------------------------------------------ public types

export const CATEGORIES = [
  'items',
  'gear',
  'heroes',
  'blessings',
  'pets',
  'auras',
  'skins',
  'statuses',
  'enemy_traits',
  'enemies',
] as const;
export type Category = (typeof CATEGORIES)[number];

const SCHEMAS: Record<Category, ZodTypeAny> = {
  items: ItemSchema,
  gear: GearSchema,
  heroes: HeroSchema,
  blessings: BlessingSchema,
  pets: PetSchema,
  auras: AuraSchema,
  skins: SkinSchema,
  statuses: StatusSchema,
  enemy_traits: EnemyTraitSchema,
  enemies: EnemySchema,
};

export interface SourceFile {
  /** Path relative to the data directory, with forward slashes, e.g. "items/wiki/warrior.yaml". */
  path: string;
  text: string;
}

export interface Issue {
  level: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  entry?: string;
  field?: string;
}

export interface OverrideRecord {
  category: Category;
  id: string;
  /** Field path, e.g. "stats.damage.ratio". */
  field: string;
  /** Wiki value (undefined = field was added). */
  from: unknown;
  /** Manual value (undefined = field was deleted). */
  to: unknown;
  file: string;
  line: number;
  source: string;
  verified: boolean;
}

export interface EntryMeta {
  category: Category;
  /** "file:line" of every layer this entry came from, wiki first. */
  origins: string[];
  overrides: OverrideRecord[];
  /** Old wiki id when a manual entry renamed it. */
  replaces?: string;
}

/** Geometry normalised to cell objects (see bag.ts). */
interface Placeable {
  shape: Cell[] | null;
  dots: Cell[];
}

export type Item = Omit<ItemData, 'shape' | 'dots'> & Placeable & { meta: EntryMeta };
export type Gear = Omit<GearData, 'shape' | 'dots'> & Placeable & { meta: EntryMeta };
export type Hero = HeroData & { meta: EntryMeta };
export type Blessing = BlessingData & { meta: EntryMeta };
export type Pet = PetData & { meta: EntryMeta };
export type Aura = AuraData & { meta: EntryMeta };
export type Skin = SkinData & { meta: EntryMeta };
export type Status = StatusData & { meta: EntryMeta };
export type EnemyTrait = EnemyTraitData & { meta: EntryMeta };
export type Enemy = EnemyData & { meta: EntryMeta };

export interface Skill {
  id: string;
  name: string;
  text: string;
  hero: string;
}

export interface GameData {
  items: Map<string, Item>;
  gear: Map<string, Gear>;
  heroes: Map<string, Hero>;
  blessings: Map<string, Blessing>;
  pets: Map<string, Pet>;
  auras: Map<string, Aura>;
  skins: Map<string, Skin>;
  statuses: Map<string, Status>;
  enemy_traits: Map<string, EnemyTrait>;
  enemies: Map<string, Enemy>;
  /** All hero skills by global id. */
  skills: Map<string, Skill>;
  stats: Map<string, StatDef>;
  config: Config | null;
  /** Renamed ids per category: old → new. */
  aliases: Record<Category, Map<string, string>>;
}

export interface LoadResult {
  data: GameData;
  issues: Issue[];
  overrides: OverrideRecord[];
  errors: Issue[];
  ok: boolean;
}

export class DataLoadError extends Error {
  constructor(readonly issues: Issue[]) {
    super(`Game data failed to load:\n${issues.filter((i) => i.level === 'error').map(formatIssue).join('\n')}`);
  }
}

export function formatIssue(i: Issue): string {
  const where = [i.file && (i.line ? `${i.file}:${i.line}` : i.file), i.entry, i.field].filter(Boolean).join(' › ');
  return `${i.level.toUpperCase()}${where ? ` ${where}` : ''}: ${i.message}`;
}

// ------------------------------------------------------------------ YAML reading

interface RawEntry {
  value: Record<string, unknown>;
  file: string;
  line: number;
}

/** Parse a YAML file, returning the JS value and a function giving the line of each top-level list entry. */
function readYaml(file: SourceFile, issues: Issue[]): { value: unknown; entryLines: number[] } | null {
  const lineCounter = new LineCounter();
  const doc = parseDocument(file.text, { lineCounter, prettyErrors: false });
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const line = e.linePos?.[0]?.line ?? (e.pos ? lineCounter.linePos(e.pos[0]).line : undefined);
      issues.push({ level: 'error', file: file.path, line, message: `YAML syntax error: ${e.message.split('\n')[0]}` });
    }
    return null;
  }
  const entryLines: number[] = [];
  if (isSeq(doc.contents)) {
    for (const node of doc.contents.items) {
      const offset = (node as { range?: [number, number, number] } | null)?.range?.[0] ?? 0;
      entryLines.push(lineCounter.linePos(offset).line);
    }
  } else if (isMap(doc.contents)) {
    entryLines.push(1);
  }
  return { value: doc.toJS(), entryLines };
}

function readEntries(file: SourceFile, issues: Issue[]): RawEntry[] {
  const parsed = readYaml(file, issues);
  if (!parsed) return [];
  const { value, entryLines } = parsed;
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ level: 'error', file: file.path, line: 1, message: 'File must contain a list of entries (each starting with "- id: …").' });
    return [];
  }
  const out: RawEntry[] = [];
  value.forEach((v, i) => {
    const line = entryLines[i] ?? 1;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      issues.push({ level: 'error', file: file.path, line, message: `Entry ${i + 1} is not a mapping.` });
      return;
    }
    const entry = v as Record<string, unknown>;
    if (typeof entry.id !== 'string' || entry.id === '') {
      issues.push({ level: 'error', file: file.path, line, message: `Entry ${i + 1} has no \`id\`.` });
      return;
    }
    out.push({ value: entry, file: file.path, line });
  });
  return out;
}

// ------------------------------------------------------------------ merging

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Merge a manual entry onto a wiki entry, field by field.
 * Nested objects merge; lists and values replace; null deletes.
 */
export function mergeEntry(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
  record: (field: string, from: unknown, to: unknown) => void,
): Record<string, unknown> {
  const out = clone(base);
  const skip = new Set<string>([...PROVENANCE_KEYS, 'replaces', 'confirmed', 'id']);

  if (GEOMETRY_KEYS.some((k) => k in over)) {
    for (const k of GEOMETRY_KEYS) {
      if (k in out && !(k in over)) {
        record(k, out[k], undefined);
        delete out[k];
      }
    }
  }

  const walk = (target: Record<string, unknown>, src: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(src)) {
      if (prefix === '' && skip.has(k)) continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (v === null) {
        if (k in target) record(path, target[k], undefined);
        delete target[k];
      } else if (isPlainObject(v) && isPlainObject(target[k])) {
        walk(target[k] as Record<string, unknown>, v, path);
      } else if (!deepEqual(target[k], v)) {
        record(path, target[k], v);
        target[k] = clone(v);
      }
    }
  };
  walk(out, over, '');

  const notes = [base.notes, over.notes].filter((n): n is string => typeof n === 'string' && n !== '');
  if (notes.length > 0) out.notes = notes.join('\n');
  return out;
}

// ------------------------------------------------------------------ references

type RefSlot = { field: string; target: Category; get: () => string; set: (v: string) => void };

function refsOf(category: Category, e: Record<string, unknown>): RefSlot[] {
  const out: RefSlot[] = [];
  const list = (key: string, target: Category) => {
    const arr = e[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((_, i) => {
      if (typeof arr[i] === 'string') out.push({ field: `${key}.${i}`, target, get: () => arr[i], set: (v) => (arr[i] = v) });
    });
  };
  const listOf = (key: string, sub: string, target: Category) => {
    const arr = e[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((o, i) => {
      if (isPlainObject(o) && typeof o[sub] === 'string') {
        out.push({ field: `${key}.${i}.${sub}`, target, get: () => o[sub] as string, set: (v) => (o[sub] = v) });
      }
    });
  };
  const one = (key: string, target: Category) => {
    if (typeof e[key] === 'string') out.push({ field: key, target, get: () => e[key] as string, set: (v) => (e[key] = v) });
  };
  switch (category) {
    case 'items':
      list('merges_into', 'items');
      list('components', 'items');
      one('hero_exclusive', 'heroes');
      break;
    case 'heroes':
      listOf('supplies', 'item', 'items');
      listOf('exclusive_items', 'item', 'items');
      break;
    case 'blessings':
      one('hero', 'heroes');
      break;
    case 'skins':
      one('hero', 'heroes');
      listOf('spawns', 'item', 'items');
      break;
    case 'enemies':
      list('traits', 'enemy_traits');
      listOf('starting_statuses', 'status', 'statuses');
      break;
    default:
      break;
  }
  return out;
}

// ------------------------------------------------------------------ main

function zodIssues(issues: ZodIssue[], base: Omit<Issue, 'message' | 'level'>): Issue[] {
  return issues.map((z) => ({
    ...base,
    level: 'error' as const,
    field: z.path.join('.') || undefined,
    message: z.message,
  }));
}

function emptyData(): GameData {
  const aliases = Object.fromEntries(CATEGORIES.map((c) => [c, new Map<string, string>()])) as Record<
    Category,
    Map<string, string>
  >;
  return {
    items: new Map(),
    gear: new Map(),
    heroes: new Map(),
    blessings: new Map(),
    pets: new Map(),
    auras: new Map(),
    skins: new Map(),
    statuses: new Map(),
    enemy_traits: new Map(),
    enemies: new Map(),
    skills: new Map(),
    stats: new Map(),
    config: null,
    aliases,
  };
}

/** Load game data from file contents. Never throws on bad data: check `ok` / `errors`. */
export function loadGameData(files: readonly SourceFile[]): LoadResult {
  const issues: Issue[] = [];
  const overrides: OverrideRecord[] = [];
  const data = emptyData();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const layered: Record<Category, { wiki: RawEntry[]; manual: RawEntry[] }> = Object.fromEntries(
    CATEGORIES.map((c) => [c, { wiki: [], manual: [] }]),
  ) as unknown as Record<Category, { wiki: RawEntry[]; manual: RawEntry[] }>;

  for (const file of sorted) {
    if (!/\.ya?ml$/i.test(file.path)) continue;
    if (file.path === 'stats.yaml') {
      loadStats(file, data, issues);
      continue;
    }
    if (file.path === 'config.yaml') {
      loadConfig(file, data, issues);
      continue;
    }
    const m = /^([a-z_]+)\/(wiki|manual)\/[^/]+$/.exec(file.path);
    if (!m || !(CATEGORIES as readonly string[]).includes(m[1]!)) {
      issues.push({
        level: 'warning',
        file: file.path,
        message: `Ignored: not in <category>/wiki/ or <category>/manual/ (categories: ${CATEGORIES.join(', ')}).`,
      });
      continue;
    }
    layered[m[1] as Category][m[2] as 'wiki' | 'manual'].push(...readEntries(file, issues));
  }
  if (!data.config) issues.push({ level: 'error', file: 'config.yaml', message: 'Missing config.yaml.' });
  if (!sorted.some((f) => f.path === 'stats.yaml')) issues.push({ level: 'error', file: 'stats.yaml', message: 'Missing stats.yaml.' });

  // Merge layers and validate each entry.
  const merged: Record<Category, Map<string, { value: Record<string, unknown>; meta: EntryMeta; where: string }>> =
    Object.fromEntries(CATEGORIES.map((c) => [c, new Map()])) as never;

  for (const category of CATEGORIES) {
    const { wiki, manual } = layered[category];
    const out = merged[category];
    const at = (r: RawEntry) => `${r.file}:${r.line}`;

    const wikiById = new Map<string, RawEntry>();
    for (const r of wiki) {
      const id = r.value.id as string;
      const prev = wikiById.get(id);
      if (prev) {
        issues.push({ level: 'error', file: r.file, line: r.line, entry: id, message: `Duplicate id (also at ${at(prev)}).` });
        continue;
      }
      if ('replaces' in r.value) {
        issues.push({ level: 'error', file: r.file, line: r.line, entry: id, field: 'replaces', message: '`replaces` is only allowed in manual/ files.' });
      }
      wikiById.set(id, r);
    }
    for (const [id, r] of wikiById) {
      out.set(id, { value: clone(r.value), meta: { category, origins: [at(r)], overrides: [] }, where: at(r) });
    }

    // Manual entries apply in file order; one id may appear in several files (e.g. corrections
    // and an effects batch), but only once per file.
    const manualSeen = new Map<string, RawEntry>();
    const manualFields = new Map<string, Map<string, string>>(); // id → field → file:line that set it
    for (const r of manual) {
      const id = r.value.id as string;
      const key = `${r.file}\u0000${id}`;
      const prev = manualSeen.get(key);
      if (prev) {
        issues.push({ level: 'error', file: r.file, line: r.line, entry: id, message: `Duplicate manual entry (also at ${at(prev)}).` });
        continue;
      }
      manualSeen.set(key, r);

      const replaces = r.value.replaces;
      let baseId: string | undefined = id;
      if (replaces !== undefined) {
        if (typeof replaces !== 'string' || !wikiById.has(replaces)) {
          issues.push({ level: 'error', file: r.file, line: r.line, entry: id, field: 'replaces', message: `No wiki entry "${String(replaces)}" to replace.` });
          continue;
        }
        if (wikiById.has(id)) {
          issues.push({ level: 'error', file: r.file, line: r.line, entry: id, message: `Can't rename "${replaces}" to "${id}": a wiki entry already has that id.` });
          continue;
        }
        baseId = replaces;
      }

      const base = baseId !== undefined ? out.get(baseId) : undefined;
      if (base) {
        const setBy = manualFields.get(id) ?? manualFields.get(baseId!) ?? new Map<string, string>();
        for (const field of Object.keys(r.value)) {
          if ((PROVENANCE_KEYS as readonly string[]).includes(field) || ['id', 'replaces', 'confirmed'].includes(field)) continue;
          const earlier = setBy.get(field);
          if (earlier) {
            issues.push({ level: 'warning', file: r.file, line: r.line, entry: id, field, message: `Also set at ${earlier}; this later file wins.` });
          }
          setBy.set(field, at(r));
        }
        manualFields.set(id, setBy);
        const recs: OverrideRecord[] = [];
        const value = mergeEntry(base.value, r.value, (field, from, to) =>
          recs.push({
            category,
            id,
            field,
            from,
            to,
            file: r.file,
            line: r.line,
            source: String(r.value.source ?? 'manual'),
            verified: r.value.verified === true,
          }),
        );
        value.id = id;
        // `confirmed: true` marks the whole entry as checked in-game (SPEC §10).
        if (r.value.confirmed === true && value.verified !== true) {
          recs.push({ category, id, field: 'verified', from: value.verified, to: true, file: r.file, line: r.line, source: String(r.value.source ?? 'manual'), verified: true });
          value.verified = true;
        }
        out.delete(baseId!);
        const meta: EntryMeta = { ...base.meta, origins: [...base.meta.origins, at(r)], overrides: [...base.meta.overrides, ...recs] };
        if (replaces !== undefined) {
          meta.replaces = replaces as string;
          data.aliases[category].set(replaces as string, id);
          issues.push({ level: 'info', file: r.file, line: r.line, entry: id, message: `Renamed wiki entry "${replaces}" to "${id}".` });
        }
        if (recs.length === 0 && replaces === undefined && typeof r.value.notes !== 'string' && r.value.confirmed !== true) {
          issues.push({ level: 'warning', file: r.file, line: r.line, entry: id, message: 'Manual entry matches the wiki entry exactly and adds no notes; it overrides nothing.' });
        }
        out.set(id, { value, meta, where: `${base.where} + ${at(r)}` });
        overrides.push(...recs);
      } else {
        manualFields.set(id, new Map(Object.keys(r.value).map((k) => [k, at(r)])));
        out.set(id, { value: clone(r.value), meta: { category, origins: [at(r)], overrides: [] }, where: at(r) });
      }
    }
  }

  // Redirect references to renamed entries.
  for (const category of CATEGORIES) {
    for (const [id, { value, where }] of merged[category]) {
      for (const ref of refsOf(category, value)) {
        const to = data.aliases[ref.target].get(ref.get());
        if (to) {
          issues.push({
            level: 'info',
            file: where,
            entry: id,
            field: ref.field,
            message: `Reference "${ref.get()}" redirected to renamed entry "${to}".`,
          });
          ref.set(to);
        }
      }
    }
  }

  // Validate.
  for (const category of CATEGORIES) {
    for (const [id, { value, meta, where }] of merged[category]) {
      const { replaces: _r, confirmed: _c, ...clean } = value;
      if (_c === true) clean.verified = true;
      const res = SCHEMAS[category].safeParse(clean);
      if (!res.success) {
        issues.push(...zodIssues(res.error.issues, { file: where, entry: id }));
        continue;
      }
      const entity = { ...(res.data as Record<string, unknown>), meta };
      if (category === 'items' || category === 'gear') {
        if (!placeable(entity, id, where, issues)) continue;
      }
      (data[category] as Map<string, unknown>).set(id, entity);
    }
  }

  crossCheck(data, merged, issues);

  const errors = issues.filter((i) => i.level === 'error');
  return { data, issues, overrides, errors, ok: errors.length === 0 };
}

/** Throwing variant: returns the data or throws DataLoadError listing every error. */
export function loadGameDataOrThrow(files: readonly SourceFile[]): LoadResult {
  const res = loadGameData(files);
  if (!res.ok) throw new DataLoadError(res.issues);
  return res;
}

// ------------------------------------------------------------------ geometry

/** Normalise geometry to cell lists and run the hard shape checks. */
function placeable(entity: Record<string, unknown>, id: string, where: string, issues: Issue[]): boolean {
  let shape: Cell[] | null = null;
  let dots: Cell[] = [];
  const toCells = (v: unknown): Cell[] => ((v as [number, number][] | undefined) ?? []).map(([x, y]) => ({ x, y }));
  if (typeof entity.footprint === 'string') {
    try {
      const fp = parseFootprint(entity.footprint);
      shape = fp.cells;
      dots = fp.dots;
    } catch (e) {
      if (!(e instanceof FootprintError)) throw e;
      issues.push({ level: 'error', file: where, entry: id, field: 'footprint', message: e.message });
      return false;
    }
  } else if (Array.isArray(entity.shape)) {
    shape = toCells(entity.shape);
    dots = toCells(entity.dots);
  }
  const errors = validateShapeDefinition({ id, name: entity.name as string, shape, dots });
  if (errors.length > 0) {
    for (const message of errors) issues.push({ level: 'error', file: where, entry: id, field: 'footprint', message });
    return false;
  }
  entity.shape = shape;
  entity.dots = dots;
  return true;
}

// ------------------------------------------------------------------ stats.yaml / config.yaml

function loadStats(file: SourceFile, data: GameData, issues: Issue[]): void {
  const parsed = readYaml(file, issues);
  if (!parsed) return;
  const res = StatRegistrySchema.safeParse(parsed.value);
  if (!res.success) {
    for (const z of res.error.issues) {
      const idx = typeof z.path[1] === 'number' ? z.path[1] : undefined;
      const raw = idx !== undefined ? (parsed.value as { stats: { id?: string }[] }).stats[idx] : undefined;
      issues.push({ level: 'error', file: file.path, entry: raw?.id, field: z.path.slice(2).join('.') || undefined, message: z.message });
    }
    return;
  }
  for (const s of res.data.stats) {
    if (data.stats.has(s.id)) issues.push({ level: 'error', file: file.path, entry: s.id, message: 'Duplicate stat id.' });
    data.stats.set(s.id, s);
  }
}

function loadConfig(file: SourceFile, data: GameData, issues: Issue[]): void {
  const parsed = readYaml(file, issues);
  if (!parsed) return;
  const res = ConfigSchema.safeParse(parsed.value);
  if (!res.success) {
    issues.push(...zodIssues(res.error.issues, { file: file.path }));
    return;
  }
  data.config = res.data;
}

// ------------------------------------------------------------------ profile

export interface ProfileLoadResult {
  profile: Profile | null;
  issues: Issue[];
  ok: boolean;
}

/**
 * Load profile/profile.yaml and check that everything it names exists. Rule checks
 * (capacity, class, gear slots, pet cost, blessing ranges) are phase 3.
 */
export function loadProfile(file: SourceFile, data: GameData): ProfileLoadResult {
  const issues: Issue[] = [];
  const done = (profile: Profile | null) => ({ profile, issues, ok: !issues.some((i) => i.level === 'error') });
  const parsed = readYaml(file, issues);
  if (!parsed) return done(null);
  const res = ProfileSchema.safeParse(parsed.value);
  if (!res.success) {
    issues.push(...zodIssues(res.error.issues, { file: file.path }));
    return done(null);
  }
  const p = res.data;
  const err = (field: string, message: string) => issues.push({ level: 'error', file: file.path, field, message });
  const known = (map: Map<string, unknown>, id: string, field: string, what: string) => {
    if (!map.has(id)) err(field, `Unknown ${what} "${id}".`);
  };

  for (const key of Object.keys(p.detailed_stats)) {
    const def = data.stats.get(key);
    if (!def) err(`detailed_stats.${key}`, `Unknown stat "${key}" (not in data/stats.yaml).`);
    else if (def.group === 'basic') err(`detailed_stats.${key}`, `"${key}" is a basic stat; put it under basic_stats.`);
    else if (!def.in_stat_details) err(`detailed_stats.${key}`, `"${key}" isn't on the Stat Details screen.`);
  }
  const maxStars = data.config?.heroes.max_stars;
  const owned = new Set<string>();
  p.heroes.forEach((h, i) => {
    known(data.heroes, h.id, `heroes.${i}.id`, 'hero');
    if (owned.has(h.id)) err(`heroes.${i}.id`, `Hero "${h.id}" is listed twice.`);
    owned.add(h.id);
    if (maxStars !== undefined && h.stars > maxStars) err(`heroes.${i}.stars`, `Stars must be 0–${maxStars}.`);
    h.links.forEach((l, j) => known(data.skills, l, `heroes.${i}.links.${j}`, 'skill'));
    h.blessings?.equipped.forEach((b, j) => known(data.blessings, b.id, `heroes.${i}.blessings.equipped.${j}.id`, 'blessing'));
  });
  if (p.active_hero && !owned.has(p.active_hero)) err('active_hero', `"${p.active_hero}" is not among the heroes listed in the profile.`);
  const gear: [string, { id: string } | null][] = [
    ['gear.weapon', p.gear.weapon],
    ['gear.shield', p.gear.shield],
    ...p.gear.rings.map((g, i): [string, { id: string }] => [`gear.rings.${i}`, g]),
    ...p.gear.gloves.map((g, i): [string, { id: string }] => [`gear.gloves.${i}`, g]),
  ];
  for (const [field, g] of gear) if (g) known(data.gear, g.id, `${field}.id`, 'gear');
  p.pets.forEach((pet, i) => known(data.pets, pet.id, `pets.${i}.id`, 'pet'));
  if (p.aura) known(data.auras, p.aura, 'aura', 'aura');
  p.skins.forEach((s, i) => known(data.skins, s.id, `skins.${i}.id`, 'skin'));
  p.equipped_skins.forEach((id, i) => known(data.skins, id, `equipped_skins.${i}`, 'skin'));
  return done(p);
}

// ------------------------------------------------------------------ cross-checks

function crossCheck(
  data: GameData,
  merged: Record<Category, Map<string, { where: string }>>,
  issues: Issue[],
): void {
  const where = (c: Category, id: string) => merged[c].get(id)?.where;
  const err = (c: Category, id: string, field: string, message: string) =>
    issues.push({ level: 'error', file: where(c, id), entry: id, field, message });
  const warn = (c: Category, id: string, field: string | undefined, message: string) =>
    issues.push({ level: 'warning', file: where(c, id), entry: id, field, message });

  // Reference targets exist.
  for (const category of CATEGORIES) {
    for (const [id, e] of data[category] as Map<string, Record<string, unknown>>) {
      for (const ref of refsOf(category, e)) {
        const target = data[ref.target] as Map<string, unknown>;
        if (!target.has(ref.get())) {
          err(category, id, ref.field, `Unknown ${ref.target} id "${ref.get()}".`);
        }
      }
    }
  }

  // Items and gear share one namespace (both are placed by id in layouts).
  for (const id of data.gear.keys()) {
    if (data.items.has(id)) err('gear', id, 'id', `Same id as item "${id}". Give the gear a different id (e.g. "${id}_gear").`);
  }

  // Skills: global ids, links and blessings point to the right hero's skills.
  for (const [heroId, hero] of data.heroes) {
    for (const s of hero.skills) {
      const prev = data.skills.get(s.id);
      if (prev) err('heroes', heroId, 'skills', `Skill id "${s.id}" is also used by hero "${prev.hero}".`);
      else data.skills.set(s.id, { ...s, hero: heroId });
    }
  }
  for (const [heroId, hero] of data.heroes) {
    hero.skill_links.forEach((l, i) => {
      if (!hero.skills.some((s) => s.id === l.skill)) {
        err('heroes', heroId, `skill_links.${i}.skill`, `"${l.skill}" is not one of ${hero.name}'s skills (${hero.skills.map((s) => s.id).join(', ')}).`);
      }
    });
    hero.exclusive_items.forEach((x, i) => {
      const item = data.items.get(x.item);
      if (item && item.hero_exclusive !== heroId) {
        warn('heroes', heroId, `exclusive_items.${i}`, `Item "${x.item}" is listed as ${hero.name}'s exclusive item but its hero_exclusive is ${item.hero_exclusive ?? 'not set'}.`);
      }
    });
    const cfg = data.config;
    if (cfg) {
      const expected = cfg.heroes.supply_ability_base[hero.rarity];
      if (hero.base_supply_ability !== expected) {
        warn('heroes', heroId, 'base_supply_ability', `${hero.base_supply_ability} doesn't match the ${hero.rarity} base in config (${expected}).`);
      }
      const stars = hero.supplies.map((s) => s.stars).sort((a, b) => a - b);
      const want = [...cfg.heroes.supply_unlock_stars[hero.rarity]].sort((a, b) => a - b);
      if (!deepEqual(stars, want)) {
        warn('heroes', heroId, 'supplies', `Supply unlock stars [${stars.join(', ')}] don't match the ${hero.rarity} pattern [${want.join(', ')}].`);
      }
    }
  }
  for (const [id, item] of data.items) {
    if (item.hero_exclusive) {
      const hero = data.heroes.get(item.hero_exclusive);
      if (hero && !hero.exclusive_items.some((x) => x.item === id)) {
        warn('items', id, 'hero_exclusive', `Not listed among ${hero.name}'s exclusive items.`);
      }
      if (hero && item.class_restriction.length > 0 && !item.class_restriction.includes(hero.class)) {
        err('items', id, 'hero_exclusive', `Exclusive to ${hero.name} (${hero.class}) but restricted to ${item.class_restriction.join(', ')}.`);
      }
    }
  }
  for (const [id, b] of data.blessings) {
    if (b.stat && data.stats.size > 0 && !data.stats.has(b.stat)) err('blessings', id, 'stat', `Unknown stat "${b.stat}" (not in data/stats.yaml).`);
  }
  for (const [id, p] of data.pets) {
    p.spawns.forEach((s, i) => {
      const item = data.items.get(s.item);
      if (!item) err('pets', id, `spawns.${i}.item`, `Unknown item "${s.item}".`);
      else if (item.kind !== 'pet_spawn') warn('pets', id, `spawns.${i}.item`, `"${s.item}" isn't marked as a pet-spawned item.`);
    });
    p.spawn_inflict_multiplier.forEach((m, i) => {
      if (!data.statuses.has(m.status)) err('pets', id, `spawn_inflict_multiplier.${i}.status`, `Unknown status "${m.status}".`);
    });
  }
  for (const [id, s] of data.skins) {
    s.spawns.forEach((sp, i) => {
      const item = data.items.get(sp.item);
      if (item && item.kind !== 'skin_spawn') warn('skins', id, `spawns.${i}.item`, `"${sp.item}" isn't marked as a skin-spawned item.`);
    });
  }
  for (const [id, e] of data.enemies) {
    for (const field of ['resistances', 'vulnerabilities'] as const) {
      for (const k of Object.keys(e[field])) {
        if (data.stats.size > 0 && !data.stats.has(k)) err('enemies', id, `${field}.${k}`, `Unknown stat "${k}" (not in data/stats.yaml).`);
      }
    }
  }

  const usedTags = new Set([...data.items.values(), ...data.gear.values()].flatMap((i) => i.tags));
  for (const [id, b] of data.blessings) {
    if (b.buffs_skill) {
      const skill = data.skills.get(b.buffs_skill);
      if (!skill) err('blessings', id, 'buffs_skill', `Unknown skill "${b.buffs_skill}".`);
      else if (skill.hero !== b.hero) err('blessings', id, 'buffs_skill', `Skill "${b.buffs_skill}" belongs to ${skill.hero}, not ${b.hero}.`);
    }
    for (const t of b.target_tags) {
      if (!usedTags.has(t)) warn('blessings', id, 'target_tags', `No item has the tag "${t}".`);
    }
  }
}
