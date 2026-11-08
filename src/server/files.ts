/**
 * File access for the local dev server (SPEC §8): the browser reads game data, the profile and
 * layouts, and saves only to these places:
 *   profile/profile.yaml
 *   layouts/<name>.yaml
 *   data/<category>.yaml   (item editor: the entry is changed in the database itself)
 * Names and categories are checked, so nothing outside the project can be written.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { parse } from 'yaml';
import { CATEGORIES, type SourceFile } from '../engine/loader';
import { readDataDir } from '../engine/loader-node';
import { BUILD_NAME_RE, BUILD_NAME_RULE } from '../engine/saves/names';
import { removeDatabaseEntry, upsertDatabaseEntry } from '../engine/database';
const ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export class FileApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface Snapshot {
  data: SourceFile[];
  profile: string | null;
  layouts: string[];
}

export function snapshot(root: string): Snapshot {
  const profilePath = join(root, 'profile', 'profile.yaml');
  return {
    data: readDataDir(join(root, 'data')),
    profile: existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : null,
    layouts: listLayouts(root),
  };
}

export function listLayouts(root: string): string[] {
  const dir = join(root, 'layouts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function layoutPath(root: string, name: string): string {
  if (!BUILD_NAME_RE.test(name)) throw new FileApiError(`Bad layout name "${name}" (${BUILD_NAME_RULE}).`);
  return join(root, 'layouts', `${name}.yaml`);
}

export function readLayout(root: string, name: string): string {
  const p = layoutPath(root, name);
  if (!existsSync(p)) throw new FileApiError(`No layout "${name}".`, 404);
  return readFileSync(p, 'utf8');
}

function checkYaml(text: string, what: string): unknown {
  try {
    return parse(text);
  } catch (e) {
    throw new FileApiError(`${what} is not valid YAML: ${(e as Error).message}`);
  }
}

export function writeLayout(root: string, name: string, text: string): void {
  checkYaml(text, 'Layout');
  mkdirSync(join(root, 'layouts'), { recursive: true });
  writeFileSync(layoutPath(root, name), text);
}

/** Delete a saved layout file (layouts/<name>.yaml). */
export function deleteLayout(root: string, name: string): void {
  const p = layoutPath(root, name);
  if (!existsSync(p)) throw new FileApiError(`No layout "${name}".`, 404);
  rmSync(p);
}

export function readProfile(root: string): string | null {
  const p = join(root, 'profile', 'profile.yaml');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

export function writeProfile(root: string, text: string): void {
  checkYaml(text, 'Profile');
  mkdirSync(join(root, 'profile'), { recursive: true });
  writeFileSync(join(root, 'profile', 'profile.yaml'), text);
}

function databaseFile(root: string, category: string): string {
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new FileApiError(`Unknown category "${category}".`);
  return join(root, 'data', `${category}.yaml`);
}

/** Change (or add) one entry in data/<category>.yaml with the item editor's fields (see upsertDatabaseEntry). */
export function upsertManualEntry(root: string, category: string, entry: Record<string, unknown>): void {
  const file = databaseFile(root, category);
  const id = entry.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new FileApiError(`Bad id "${String(id)}".`);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (text !== null) checkYaml(text, `data/${category}.yaml`);
  try {
    writeFileSync(file, upsertDatabaseEntry(text, category, entry));
  } catch (e) {
    throw new FileApiError((e as Error).message);
  }
}

/** Delete one of my own entries (an enemy item I made) from data/<category>.yaml. Wiki entries can't be deleted. */
export function deleteManualEntry(root: string, category: string, id: string): boolean {
  const file = databaseFile(root, category);
  if (!existsSync(file)) return false;
  let next: string | null;
  try {
    next = removeDatabaseEntry(readFileSync(file, 'utf8'), id);
  } catch (e) {
    throw new FileApiError((e as Error).message);
  }
  if (next === null) return false;
  writeFileSync(file, next);
  return true;
}

/** Path of a reference image under data/images/, refusing anything that escapes it. */
export function imagePath(root: string, rel: string): string {
  const base = join(root, 'data', 'images');
  const p = normalize(join(base, rel));
  if (!p.startsWith(base + sep)) throw new FileApiError('Bad image path.', 403);
  if (!existsSync(p)) throw new FileApiError('No such image.', 404);
  return p;
}
