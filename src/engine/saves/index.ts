/**
 * Reading and writing saved files: the account (profile/profile.yaml) and builds (layouts/<name>.yaml).
 *
 * HARD RULE (user, 2026-10-18): a file saved by any version of the simulator must load in every later
 * version. So reading never throws and never refuses a file:
 *   1. the file's `version` (missing = 1) is migrated step by step to SAVE_VERSION (migrate.ts);
 *   2. anything that still doesn't fit is dropped, each with a note saying what and why (salvage.ts);
 *   3. unknown ids (an item removed from the game data) are kept; the Checks panel reports them.
 * Every released version has frozen fixtures in tests/fixtures/saves/<version>/ that must keep loading.
 */
import { parse, stringify } from 'yaml';
import type { LayoutData, Profile } from '../model';
import { AccountFileSchema, BuildFileSchema, SAVE_VERSION, accountToProfile, buildFileToLayout, layoutToBuildFile, profileToAccount } from './files';
import { accountV1toV2, accountV2toV3, buildV1toV2, buildV2toV3, versionOf } from './migrate';
import { type SaveNote, parseSalvaging } from './salvage';

export { SAVE_VERSION, DEFAULT_BASIC_STATS, accountToProfile, profileToAccount, buildFileToLayout, layoutToBuildFile, statsUnset, sameStats } from './files';
export type { AccountFile, BuildFile } from './files';
export { versionOf } from './migrate';
export type { SaveNote } from './salvage';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function readYaml(text: string, what: string, notes: SaveNote[]): unknown {
  try {
    return parse(text);
  } catch (e) {
    notes.push({ level: 'warning', message: `${what} isn't valid YAML (${(e as Error).message.split('\n')[0]}); started empty.` });
    return {};
  }
}

const newer = (v: number, what: string, notes: SaveNote[]) => {
  if (v > SAVE_VERSION) notes.push({ level: 'warning', message: `${what} was saved by a newer version of the simulator (format ${v}, this one reads ${SAVE_VERSION}); settings it doesn't know are left out.` });
};

export interface AccountLoad {
  /** The account as the engine's Profile (no build setup in it). */
  profile: Profile;
  /** The version-1 profile the account came from, if it did: version-1 builds are completed from it. */
  migratedFromV1: Raw | null;
  /** The version the file was saved in (1 = before versioning). */
  version: number;
  notes: SaveNote[];
}

/** Read an account file of any version (null or empty = a new account). */
export function readAccount(text: string | null | undefined): AccountLoad {
  const notes: SaveNote[] = [];
  if (!text || !text.trim()) return { profile: accountToProfile(AccountFileSchema.parse({})), migratedFromV1: null, version: SAVE_VERSION, notes };
  let raw = readYaml(text, 'The account file', notes);
  const version = versionOf(raw);
  newer(version, 'The account file', notes);
  // From version 1 straight to 3: version 2's note ("saved with each build") no longer applies.
  if (version === 1 && isObj(raw)) raw = accountV1toV2(raw, []);
  if (versionOf(raw) === 2 && isObj(raw)) raw = accountV2toV3(raw, notes);
  const file = parseSalvaging(AccountFileSchema, raw, notes, 'Account');
  return { profile: accountToProfile(file), migratedFromV1: file.migrated_from_v1 ?? null, version, notes };
}

export function writeAccount(profile: Profile, migratedFromV1: Raw | null): string {
  return stringify(profileToAccount(profile, migratedFromV1), { lineWidth: 0 });
}

export interface BuildLoad {
  layout: LayoutData;
  version: number;
  notes: SaveNote[];
}

/**
 * Read a build file of any version. `v1Profile`: for version-1 builds, the profile they were used with
 * (the account's migratedFromV1, or a version-1 profile.yaml), so what they didn't save comes from it as before.
 */
export function readBuild(text: string, ctx: { v1Profile?: Raw | null } = {}, what = 'Build'): BuildLoad {
  const notes: SaveNote[] = [];
  let raw = readYaml(text, what, notes);
  const version = versionOf(raw);
  newer(version, what, notes);
  if (version === 1 && isObj(raw)) raw = buildV1toV2(raw, ctx.v1Profile ?? null, notes);
  if (versionOf(raw) === 2 && isObj(raw)) raw = buildV2toV3(raw, notes);
  const file = parseSalvaging(BuildFileSchema, raw, notes, what);
  return { layout: buildFileToLayout(file), version, notes };
}

/** YAML for a build file (defaults left out to keep it short). */
export function writeBuild(layout: LayoutData): string {
  const f = layoutToBuildFile(layout) as Raw & ReturnType<typeof layoutToBuildFile>;
  // Pets and skins: defaults left out.
  const out: Raw = { ...f };
  out.placements = f.placements.map((p) => {
    const e: Raw = { ...(p.id ? { id: p.id } : {}), item: p.item, x: p.x, y: p.y };
    if (p.rotation) e.rotation = p.rotation;
    if (p.supply) e.supply = true;
    return e;
  });
  if (!f.enhanced_cells?.length) delete out.enhanced_cells;
  if (f.storage?.length)
    out.storage = f.storage.map((p) => {
      const e: Raw = { ...(p.id ? { id: p.id } : {}), item: p.item, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
      if (p.rotation) e.rotation = p.rotation;
      if (p.supply) e.supply = true;
      return e;
    });
  return stringify(out, { lineWidth: 0 });
}
export { adoptLegacy, hasLegacy } from './legacy';
export type { Adopted } from './legacy';
