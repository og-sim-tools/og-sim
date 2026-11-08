import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  FileApiError,
  deleteManualEntry,
  imagePath,
  listLayouts,
  readLayout,
  snapshot,
  upsertManualEntry,
  writeLayout,
  writeProfile,
} from '../../src/server/files';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'og-files-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'items.yaml'),
    '# Items database\n\n- id: spear\n  name: Spear\n  stats: { cooldown: 2.6, accuracy: 80 }\n  source: wiki\n  url: https://example.com\n  verified: false\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const db = () => parse(readFileSync(join(root, 'data', 'items.yaml'), 'utf8')) as Record<string, unknown>[];

describe('file API', () => {
  it('snapshots data files, the profile and layout names', () => {
    writeProfile(root, 'basic_stats: { hp: 1, atk: 1, initial_block: 0 }\n');
    writeLayout(root, 'my build', 'placements: []\n');
    const s = snapshot(root);
    expect(s.data.map((f) => f.path)).toEqual(['items.yaml']);
    expect(s.profile).toMatch(/basic_stats/);
    expect(s.layouts).toEqual(['my build']);
    expect(readLayout(root, 'my build')).toBe('placements: []\n');
  });

  it('refuses unsafe layout names, unknown layouts and invalid YAML', () => {
    expect(() => writeLayout(root, '../escape', 'x: 1')).toThrow(FileApiError);
    expect(() => writeLayout(root, 'a/b', 'x: 1')).toThrow(/Bad layout name/);
    expect(() => readLayout(root, 'nope')).toThrow(/No layout/);
    expect(() => writeProfile(root, 'a: [unclosed')).toThrow(/not valid YAML/);
    expect(listLayouts(root)).toEqual([]);
  });

  it('writes editor edits into the database; changed wiki values are kept under corrections', () => {
    upsertManualEntry(root, 'items', { id: 'spear', stats: { cooldown: 2.5, accuracy: null }, source: 'observed', verified: true, notes: 'Seen in game.' });
    upsertManualEntry(root, 'items', { id: 'spear', stats: { cooldown: 2.4 }, source: 'observed', verified: true });
    upsertManualEntry(root, 'items', { id: 'whip', name: 'Whip', value: 9, source: 'manual', verified: false });
    expect(db()).toEqual([
      {
        id: 'spear',
        name: 'Spear',
        stats: { cooldown: 2.4 },
        source: 'wiki',
        url: 'https://example.com',
        verified: false,
        notes: 'Seen in game.',
        corrections: [
          { field: 'stats.cooldown', wiki: 2.6, source: 'observed', verified: true },
          { field: 'stats.accuracy', wiki: 80, source: 'observed', verified: true },
        ],
      },
      { id: 'whip', name: 'Whip', value: 9, source: 'manual', verified: false },
    ]);
    const text = readFileSync(join(root, 'data', 'items.yaml'), 'utf8');
    expect(text).toMatch(/^# Items database/);
    // Back to the wiki's value: no correction left.
    upsertManualEntry(root, 'items', { id: 'spear', stats: { cooldown: 2.6, accuracy: 80 } });
    expect(db()[0]!.corrections).toBeUndefined();
  });

  it('deletes my own entries, never wiki ones', () => {
    upsertManualEntry(root, 'items', { id: 'claw', name: 'Claw', source: 'manual', verified: true });
    expect(deleteManualEntry(root, 'items', 'claw')).toBe(true);
    expect(db().map((e) => e.id)).toEqual(['spear']);
    expect(deleteManualEntry(root, 'items', 'nope')).toBe(false);
    expect(() => deleteManualEntry(root, 'items', 'spear')).toThrow(/wiki entry/);
    expect(existsSync(join(root, 'data', 'items.yaml'))).toBe(true);
  });

  it('only writes known categories and valid ids', () => {
    expect(() => upsertManualEntry(root, 'weapons', { id: 'a' })).toThrow(/Unknown category/);
    expect(() => upsertManualEntry(root, '../items', { id: 'a' })).toThrow(/Unknown category/);
    expect(() => upsertManualEntry(root, 'items', { id: '../x' })).toThrow(/Bad id/);
  });

  it('serves images only from data/images', () => {
    mkdirSync(join(root, 'data', 'images', 'gear'), { recursive: true });
    writeFileSync(join(root, 'data', 'images', 'gear', 'x.png'), 'png');
    expect(imagePath(root, 'gear/x.png')).toBe(join(root, 'data', 'images', 'gear', 'x.png'));
    expect(() => imagePath(root, '../items.yaml')).toThrow(/Bad image path/);
    expect(() => imagePath(root, 'gear/none.png')).toThrow(/No such image/);
  });
});
