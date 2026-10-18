/** Node file-system wrapper around the pure loader. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type LoadResult, type SourceFile, loadGameData } from './loader';

export function readDataDir(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(name)) {
        out.push({ path: relative(dir, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

export function loadGameDataFromDir(dir: string): LoadResult {
  return loadGameData(readDataDir(dir));
}
