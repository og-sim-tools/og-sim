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
  mkdirSync(join(root, 'data', 'items', 'wiki'), { recursive: true });
  writeFileSync(join(root, 'data', 'items', 'wiki', 'a.yaml'), '[]\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const edits = () => parse(readFileSync(join(root, 'data', 'items', 'manual', 'user_edits.yaml'), 'utf8')) as Record<string, unknown>[];

describe('file API', () => {
  it('snapshots data files, the profile and layout names', () => {
    writeProfile(root, 'basic_stats: { hp: 1, atk: 1, initial_block: 0 }\n');
    writeLayout(root, 'my build', 'placements: []\n');
    const s = snapshot(root);
    expect(s.data.map((f) => f.path)).toEqual(['items/wiki/a.yaml']);
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

  it('upserts editor edits with a deep merge and keeps null as "delete"', () => {
    upsertManualEntry(root, 'items', { id: 'spear', stats: { damage: { ratio: 1.6, scales_with: 'atk' } }, source: 'observed', verified: true });
    upsertManualEntry(root, 'items', { id: 'spear', stats: { cooldown: 2.5, accuracy: null } });
    upsertManualEntry(root, 'items', { id: 'whip', value: 9 });
    expect(edits()).toEqual([
      { id: 'spear', stats: { damage: { ratio: 1.6, scales_with: 'atk' }, cooldown: 2.5, accuracy: null }, source: 'observed', verified: true },
      { id: 'whip', value: 9 },
    ]);
    expect(readFileSync(join(root, 'data', 'items', 'manual', 'user_edits.yaml'), 'utf8')).toMatch(/^# Written by the item editor/);
  });

  it('reverts one entry and removes the file when it empties', () => {
    upsertManualEntry(root, 'items', { id: 'a', value: 1 });
    upsertManualEntry(root, 'items', { id: 'b', value: 2 });
    expect(deleteManualEntry(root, 'items', 'a')).toBe(true);
    expect(edits()).toEqual([{ id: 'b', value: 2 }]);
    expect(deleteManualEntry(root, 'items', 'nope')).toBe(false);
    deleteManualEntry(root, 'items', 'b');
    expect(existsSync(join(root, 'data', 'items', 'manual', 'user_edits.yaml'))).toBe(false);
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
    expect(() => imagePath(root, '../items/wiki/a.yaml')).toThrow(/Bad image path/);
    expect(() => imagePath(root, 'gear/none.png')).toThrow(/No such image/);
  });
});
