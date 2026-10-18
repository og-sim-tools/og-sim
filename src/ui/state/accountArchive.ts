/**
 * The account export: one .zip holding a folder with the account (profile.yaml) and every saved build
 * (builds/<name>.yaml), each in its saved-file format so any later version can load it. Import reads that
 * folder back, and also a zip of the project's own profile/ and layouts/ folders.
 */
import { parse } from 'yaml';
import { CATEGORIES } from '../../engine/loader';
import { SAVE_VERSION } from '../../engine/saves';
import { BUILD_NAME_RE, safeBuildName } from '../../engine/saves/names';
import { type ZipEntry, zipFiles } from './zip';

export interface SavedBuild {
  name: string;
  text: string;
}

const README = `Overgeared Hero backpack simulator: account export.

profile.yaml   your account (heroes, stars, skill links, auras)
builds/        one file per saved build (hero, blessings, gear, pets, skins, bag, battle)
edits/         your item editor changes, by kind (only when you made some on the hosted site)

To restore it, open the simulator and use "Import account" with this .zip (or a zip of this folder).
Every file says which format version it is, and newer versions of the simulator always load older files.
`;

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function accountArchive(accountText: string, builds: SavedBuild[], when = new Date(), edits: SavedEdits[] = []): { filename: string; bytes: Uint8Array } {
  const folder = `og-sim-account-${day(when)}`;
  const manifest = `format: og-sim-account\nversion: ${SAVE_VERSION}\nexported: ${when.toISOString()}\nbuilds: ${builds.length}\n`;
  const entries: ZipEntry[] = [
    { path: `${folder}/README.txt`, text: README },
    { path: `${folder}/manifest.yaml`, text: manifest },
    { path: `${folder}/profile.yaml`, text: accountText },
    ...builds.map((b) => ({ path: `${folder}/builds/${b.name}.yaml`, text: b.text })),
    ...edits.map((e) => ({ path: `${folder}/edits/${e.category}.yaml`, text: e.text })),
  ];
  return { filename: `${folder}.zip`, bytes: zipFiles(entries, when) };
}

/** Item editor edits for one kind of data (items, gear, pets …). */
export interface SavedEdits {
  category: string;
  text: string;
}

export interface AccountImport {
  accountText: string | null;
  builds: SavedBuild[];
  edits: SavedEdits[];
  notes: string[];
}

/** What a zip holds: profile.yaml (the shallowest one) and the .yaml files in a builds/ or layouts/ folder. */
export function readAccountArchive(entries: ZipEntry[]): AccountImport {
  const notes: string[] = [];
  const builds: SavedBuild[] = [];
  const edits: SavedEdits[] = [];
  let account: { depth: number; text: string } | null = null;
  let ignored = 0;
  for (const e of entries) {
    const parts = e.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const base = parts[parts.length - 1] ?? '';
    const dir = parts[parts.length - 2]?.toLowerCase();
    if (base.toLowerCase() === 'profile.yaml') {
      if (!account || parts.length < account.depth) account = { depth: parts.length, text: e.text };
      continue;
    }
    if (/\.ya?ml$/i.test(base) && (dir === 'builds' || dir === 'layouts')) {
      const raw = base.replace(/\.ya?ml$/i, '');
      let name = BUILD_NAME_RE.test(raw) ? raw : safeBuildName(raw);
      if (!name) {
        notes.push(`Skipped "${base}": its name has no usable letters or digits.`);
        continue;
      }
      if (name !== raw) notes.push(`"${raw}" is saved as "${name}" (build names can only have letters, digits, spaces, _ and -).`);
      for (let n = 2; builds.some((b) => b.name.toLowerCase() === name.toLowerCase()); n++) name = `${raw.slice(0, 60)} ${n}`;
      builds.push({ name, text: e.text });
      continue;
    }
    if (dir === 'edits' && /^[a-z_]+\.ya?ml$/.test(base) && (CATEGORIES as readonly string[]).includes(base.replace(/\.ya?ml$/, ''))) {
      edits.push({ category: base.replace(/\.ya?ml$/, ''), text: e.text });
      continue;
    }
    if (!/^(readme\.txt|manifest\.yaml)$/i.test(base)) ignored++;
  }
  if (ignored) notes.push(`Ignored ${ignored} other file${ignored === 1 ? '' : 's'} in the zip.`);
  return { accountText: account?.text ?? null, builds: builds.sort((a, b) => a.name.localeCompare(b.name)), edits, notes };
}

/** A single .yaml picked for "Import account": an account (profile) file, or a build file by mistake. */
export function looksLikeBuild(text: string): boolean {
  try {
    const v = parse(text) as Record<string, unknown> | null;
    return !!v && typeof v === 'object' && ('placements' in v || 'bag' in v || 'battle' in v);
  } catch {
    return false;
  }
}

/** Offer bytes as a file download. */
export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/zip'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
