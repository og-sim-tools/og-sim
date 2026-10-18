/**
 * The hosted static site has no server, so the game data (data/**.yaml) and the reference images
 * (data/images/**) are bundled at build time. The dev server reads them from disk instead (src/server).
 */
import type { SourceFile } from '../engine/loader';

/** True in the built site (`vite build`), where saves live in the browser; false under `npm run dev`. */
export const STATIC_SITE = import.meta.env.PROD;

const yamlFiles = import.meta.glob('../../data/**/*.yaml', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const imageFiles = import.meta.glob('../../data/images/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** The game data files, with paths relative to data/ as the loader expects. */
export async function bundledData(): Promise<SourceFile[]> {
  const out = await Promise.all(Object.entries(yamlFiles).map(async ([p, load]) => ({ path: p.replace(/^(\.\.\/)+data\//, ''), text: await load() })));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** URL of a reference image (path relative to data/images/, as stored on items and gear). */
export function imageUrl(rel: string): string {
  const clean = rel.replace(/^data\/images\//, '');
  return STATIC_SITE ? (imageFiles[`../../data/images/${clean}`] ?? '') : `/api/images/${clean}`;
}
