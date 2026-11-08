/**
 * The game databases (data/<category>.yaml): one complete entry per thing, in-game corrections applied.
 * Where a correction differs from the wiki, `corrections` keeps the wiki's value (see PROVENANCE_KEYS).
 * Pure, so the dev server (item editor) and tools share it.
 */
import { Document, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';

type Entry = Record<string, unknown>;
const isObj = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v);

const TITLES: Record<string, string> = {
  items: 'Items',
  gear: 'Gear',
  heroes: 'Heroes (skills, supplies, star effects)',
  blessings: "Dragon's Blessings",
  pets: 'Pets',
  auras: 'Auras',
  skins: 'Skins',
  statuses: 'Statuses',
  enemy_traits: 'Enemy traits',
  enemies: 'Enemies',
};

export const databaseHeader = (category: string) =>
  `# ${TITLES[category] ?? category}: the simulator's database, one complete entry each (like a wiki page).\n` +
  '# In-game values beat the wiki. Where an entry differs from the wiki, `corrections` keeps the wiki value\n' +
  '# (field, wiki, source, verified). Provenance per entry: source (wiki / observed / manual), url, verified, notes.\n' +
  '# Edit here directly, or with the item editor (it writes here too).\n';

/** Provenance last, so each entry reads like a page: what it is, then where the numbers came from. */
const TAIL = ['source', 'url', 'verified', 'observed_with', 'notes', 'old_ids', 'corrections'];
function ordered(e: Entry): Entry {
  const head = Object.entries(e).filter(([k]) => !TAIL.includes(k));
  const tail = TAIL.filter((k) => k in e).map((k) => [k, e[k]] as const);
  return Object.fromEntries([...head, ...tail]);
}

/** Small nested objects and lists on one line ({ ratio: 1, scales_with: atk }, [weapon, sword]); entries stay blocks. */
function compact(doc: Document): void {
  visit(doc, {
    Map(_k, node, path) {
      if (path.length <= 2) return; // the document's list and each entry
      const json = JSON.stringify(node.toJSON());
      if (json.length <= 180) node.flow = true;
    },
    Seq(_k, node, path) {
      if (path.length <= 1) return;
      if (node.items.every((i) => isScalar(i)) && JSON.stringify(node.toJSON()).length <= 120) node.flow = true;
    },
  });
}

export function formatDatabase(category: string, entries: Entry[]): string {
  const doc = new Document(entries.map(ordered), { aliasDuplicateObjects: false });
  compact(doc);
  // A blank line between entries.
  if (isSeq(doc.contents)) doc.contents.items.forEach((n, i) => i > 0 && ((n as { spaceBefore?: boolean }).spaceBefore = true));
  return databaseHeader(category) + '\n' + doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** Deep merge for edits: nested objects merge, null deletes, everything else replaces. Calls `changed` per changed path. */
export function applyPatch(base: Entry, patch: Entry, changed: (field: string, from: unknown, to: unknown) => void = () => {}, prefix = ''): Entry {
  const out: Entry = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null) {
      if (k in out) changed(path, out[k], undefined);
      delete out[k];
    } else if (isObj(v) && isObj(out[k])) out[k] = applyPatch(out[k] as Entry, v, changed, path);
    else if (JSON.stringify(out[k]) !== JSON.stringify(v)) {
      changed(path, out[k], v);
      out[k] = v;
    }
  }
  return out;
}

const PROVENANCE = new Set(['id', 'source', 'url', 'verified', 'observed_with', 'notes', 'old_ids', 'corrections', 'confirmed']);
const getPath = (o: Entry, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);

/**
 * Apply an item-editor edit to a database file's text: the entry with that id gets the fields (new entry if
 * none). Changing a value a wiki entry had adds a `corrections` record with the wiki value. Other entries and
 * comments stay as they are.
 */
export function upsertDatabaseEntry(text: string | null, category: string, patch: Entry): string {
  const id = patch.id;
  if (typeof id !== 'string') throw new Error('An entry needs an id.');
  const doc = text ? parseDocument(text) : new Document([]);
  if (!isSeq(doc.contents)) throw new Error(`data/${category}.yaml must be a list of entries.`);
  const seq = doc.contents;
  const idx = seq.items.findIndex((n) => isMap(n) && (n.get('id') as unknown) === id);
  const { confirmed, source, verified, notes, ...fields } = patch;
  let next: Entry;
  if (idx < 0) {
    next = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
    Object.assign(next, { source: source ?? 'manual', verified: confirmed === true || verified === true }, notes ? { notes } : {});
  } else {
    const base = (seq.items[idx] as { toJSON(): Entry }).toJSON();
    const fromWiki = base.source === 'wiki';
    const corrections = [...((base.corrections as Entry[] | undefined) ?? [])];
    next = applyPatch(base, fields, (field, from) => {
      if (PROVENANCE.has(field.split('.')[0]!) || !fromWiki || from === undefined) return;
      const rec = { field, wiki: from, source: String(source ?? 'manual'), verified: verified === true };
      const at = corrections.findIndex((c) => c.field === field);
      if (at >= 0) corrections[at] = { ...rec, wiki: corrections[at]!.wiki };
      else corrections.push(rec);
    });
    // A wiki entry stays a wiki entry (url and all); what changed is in `corrections`. My own entries take the edit's provenance.
    if (!fromWiki) {
      if (source !== undefined) next.source = source;
      if (verified !== undefined) next.verified = verified;
    }
    if (confirmed === true) next.verified = true;
    if (typeof notes === 'string' && notes && !String(base.notes ?? '').includes(notes)) next.notes = base.notes ? `${String(base.notes)}
${notes}` : notes;
    const kept = corrections.filter((c) => JSON.stringify(getPath(next, String(c.field))) !== JSON.stringify(c.wiki));
    if (kept.length) next.corrections = kept;
    else delete next.corrections;
  }
  const node = doc.createNode(ordered(next));
  const one = new Document([node]);
  compact(one);
  if (idx < 0) {
    const fresh = (one.contents as typeof seq).items[0] as { spaceBefore?: boolean };
    fresh.spaceBefore = seq.items.length > 0;
    seq.items.push(fresh as never);
  }
  else {
    const old = seq.items[idx] as { commentBefore?: string | null };
    const fresh = (one.contents as typeof seq).items[0] as { commentBefore?: string | null };
    fresh.commentBefore = old.commentBefore ?? null;
    (fresh as { spaceBefore?: boolean }).spaceBefore = (old as { spaceBefore?: boolean }).spaceBefore;
    seq.items[idx] = fresh as never;
  }
  const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return text ? out : databaseHeader(category) + '\n' + out;
}

/** Remove one of my own entries (not a wiki one) from a database file's text; null when there's none. */
export function removeDatabaseEntry(text: string, id: string): string | null {
  const doc = parseDocument(text);
  if (!isSeq(doc.contents)) return null;
  const idx = doc.contents.items.findIndex((n) => isMap(n) && (n.get('id') as unknown) === id);
  if (idx < 0) return null;
  if ((doc.contents.items[idx] as { get(k: string): unknown }).get('source') === 'wiki') throw new Error(`"${id}" is a wiki entry: change it instead of deleting it.`);
  doc.contents.items.splice(idx, 1);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
