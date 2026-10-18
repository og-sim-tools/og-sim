/**
 * Downloads item sprites and gear icons from the wiki into data/images/ and writes
 * data/items/manual/images.yaml + data/gear/manual/images.yaml (image path + native pixel size).
 * Run once: npx tsx tools/fetch-icons.ts <item list file> <gear list file>
 *   item list: "Item Name|a/ab/File.png" per line (from the wiki's Items page)
 *   gear list: Gear-Icon file names after "Gear-Icon-", space separated (from the Gear page)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { loadGameDataFromDir } from '../src/engine/loader-node';

const ROOT = process.cwd();
const BASE = 'https://static.wikia.nocookie.net/backpack-arena/images/';
const [itemArg, gearArg] = process.argv.slice(2);
if (!itemArg || !gearArg) throw new Error('usage: tsx tools/fetch-icons.ts <item list> <gear list> | --list <file>');
const itemList: string = itemArg;
const gearList: string = gearArg;

const data = loadGameDataFromDir(join(ROOT, 'data')).data;
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer): { w: number; h: number } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** MediaWiki stores File:X.png at images/<md5[0]>/<md5[0..1]>/X.png (md5 of the underscored name). */
function wikiPath(file: string): string {
  const name = decodeURIComponent(file);
  const md5 = createHash('md5').update(name).digest('hex');
  return `${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(name).replace(/%2F/g, '/')}`;
}

/** The original PNG (without ?format=original the CDN sends WebP). */
async function download(path: string): Promise<Buffer> {
  const res = await fetch(`${BASE}${path}/revision/latest?format=original`);
  if (!res.ok) throw new Error(`${res.status} for ${BASE + path}`);
  return Buffer.from(await res.arrayBuffer());
}

async function run() {
  const report: string[] = [];
  let bytes = 0;

  // Items
  const byName = new Map([...data.items.values()].map((i) => [norm(i.name), i.id]));
  const itemEntries: unknown[] = [];
  mkdirSync(join(ROOT, 'data/images/items'), { recursive: true });
  for (const line of readFileSync(itemList, 'utf8').split('\n').filter(Boolean)) {
    const [name, path] = line.split('|') as [string, string];
    const id = byName.get(norm(name));
    if (!id) {
      report.push(`no item named "${name}" in our data`);
      continue;
    }
    const buf = await download(path);
    bytes += buf.length;
    const size = pngSize(buf);
    writeFileSync(join(ROOT, `data/images/items/${id}.png`), buf);
    itemEntries.push({ id, image: `items/${id}.png`, image_size: size, source: 'wiki', url: BASE + path, verified: false });
  }
  const missingItems = [...data.items.values()].filter((i) => !itemEntries.some((e) => (e as { id: string }).id === i.id)).map((i) => i.name);

  // Gear
  const gearByName = new Map([...data.gear.values()].map((g) => [norm(g.name), g.id]));
  const gearEntries: unknown[] = [];
  mkdirSync(join(ROOT, 'data/images/gear'), { recursive: true });
  for (const file of readFileSync(gearList, 'utf8').split(/\s+/).filter(Boolean)) {
    const title = decodeURIComponent(file).replace(/\.png$/, '').replace(/_/g, ' ');
    const id = gearByName.get(norm(title)) ?? [...data.gear.values()].find((g) => norm(g.name).replace(/ of /g, ' ') === norm(title))?.id;
    if (!id) {
      report.push(`no gear named "${title}" in our data`);
      continue;
    }
    const path = wikiPath(`Gear-Icon-${decodeURIComponent(file)}`);
    const buf = await download(path);
    bytes += buf.length;
    writeFileSync(join(ROOT, `data/images/gear/${id}.png`), buf);
    gearEntries.push({ id, image: `gear/${id}.png`, image_size: pngSize(buf), source: 'wiki', url: BASE + path, verified: false });
  }
  const missingGear = [...data.gear.values()].filter((g) => !gearEntries.some((e) => (e as { id: string }).id === g.id)).map((g) => g.name);

  const head = (what: string) =>
    `# ${what} images from the wiki (tools/fetch-icons.ts, 2026-10-16). image_size is the sprite's native pixel size.\n\n`;
  writeFileSync(join(ROOT, 'data/items/manual/images.yaml'), head('Item sprite') + stringify(itemEntries, { lineWidth: 0 }));
  writeFileSync(join(ROOT, 'data/gear/manual/images.yaml'), head('Gear icon') + stringify(gearEntries, { lineWidth: 0 }));
  console.log(`items: ${itemEntries.length}, gear: ${gearEntries.length}, ${bytes} bytes`);
  console.log(`no icon: ${[...missingItems, ...missingGear].join(', ') || 'none'}`);
  for (const r of report) console.log(r);
}

/**
 * Explicit list mode: npx tsx tools/fetch-icons.ts --list <file>, lines "item|<id>|a/ab/File.png" or
 * "gear|<id>|…". Downloads each and adds or replaces its entry in the images.yaml files.
 */
async function runList(file: string) {
  let bytes = 0;
  const files = { item: 'data/items/manual/images.yaml', gear: 'data/gear/manual/images.yaml', gearicon: 'data/gear/manual/icons.yaml' } as const;
  const current = Object.fromEntries(
    Object.entries(files).map(([k, f]) => [k, (parse(readFileSync(join(ROOT, f), 'utf8')) ?? []) as { id: string }[]]),
  ) as Record<keyof typeof files, { id: string }[]>;
  const NL = String.fromCharCode(10);
  for (const line of readFileSync(file, 'utf8').split(NL).filter(Boolean)) {
    const [kind, id, rawPath] = line.trim().split('|') as [keyof typeof files, string, string];
    // gearicon lines give the Gear-Icon file name; its path comes from the name's md5.
    const path = kind === 'gearicon' ? wikiPath(`Gear-Icon-${rawPath}`) : rawPath;
    const dir = kind === 'item' ? 'items' : kind === 'gear' ? 'gear' : 'gear_icons';
    const buf = await download(path);
    bytes += buf.length;
    mkdirSync(join(ROOT, `data/images/${dir}`), { recursive: true });
    writeFileSync(join(ROOT, `data/images/${dir}/${id}.png`), buf);
    const entry =
      kind === 'gearicon'
        ? { id, icon: `${dir}/${id}.png`, source: 'wiki', url: BASE + path, verified: false }
        : { id, image: `${dir}/${id}.png`, image_size: pngSize(buf), source: 'wiki', url: BASE + path, verified: false };
    current[kind] = [...current[kind].filter((e) => e.id !== id), entry];
  }
  for (const [k, f] of Object.entries(files)) {
    const head = readFileSync(join(ROOT, f), 'utf8').split(NL).filter((l) => l.startsWith('#')).join(NL);
    writeFileSync(join(ROOT, f), head + NL + NL + stringify(current[k as keyof typeof files], { lineWidth: 0 }));
  }
  console.log(`downloaded ${bytes} bytes`);
}

if (process.argv[2] === '--list') void runList(process.argv[3]!);
else void run();
