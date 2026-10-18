import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { LayoutSchema } from '../../src/engine/model';
import { EMPTY_FILTER, allTags, browserEntries, filterEntries } from '../../src/ui/state/browser';
import {
  GRID,
  diffFields,
  footprintFromGrid,
  gridFromFootprint,
  nextShapeCell,
  normalFootprint,
  toDraft,
  validateDraft,
} from '../../src/ui/state/editor';
import { addPlacement, keyAction, layoutToYaml, moveBy, removePlacement, rotateCw, updatePlacement, withIds } from '../../src/ui/state/layoutOps';
import { makeData } from '../helpers';

describe('layout operations', () => {
  it('gives every placement a unique id', () => {
    const l = withIds({ placements: [{ item: 'a', x: 0, y: 0, rotation: 0, supply: false }, { id: 'a#1', item: 'a', x: 1, y: 0, rotation: 0, supply: false }] });
    expect(l.placements.map((p) => p.id)).toEqual(['a#2', 'a#1']);
    const { layout, id } = addPlacement(l, { item: 'a', x: 2, y: 0, rotation: 0, supply: true });
    expect(id).toBe('a#3');
    expect(layout.placements).toHaveLength(3);
  });

  it('updates, rotates and removes placements without mutating', () => {
    const l = withIds({ placements: [{ id: 's', item: 'sword', x: 0, y: 0, rotation: 0, supply: false }] });
    const moved = updatePlacement(l, 's', { x: 3, rotation: rotateCw(270) });
    expect(moved.placements[0]).toMatchObject({ x: 3, y: 0, rotation: 0 });
    expect(l.placements[0]!.x).toBe(0);
    expect(removePlacement(moved, 's').placements).toEqual([]);
    expect([0, 90, 180, 270].map((r) => rotateCw(r as 0))).toEqual([90, 180, 270, 0]);
  });

  it('maps the SPEC keyboard controls', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Delete', 'Backspace', 'Escape', 'a'].map(keyAction)).toEqual([
      'up',
      'down',
      'left',
      'right',
      'rotate',
      'place',
      'remove',
      'remove',
      'cancel',
      null,
    ]);
    expect(moveBy('left')).toEqual({ dx: -1, dy: 0 });
    expect(moveBy('rotate')).toBeNull();
  });

  it('writes layout YAML that reads back the same', () => {
    const l = withIds({
      name: 'test',
      hero: 'rose',
      bag: { mask: new Array(16).fill(1) },
      placements: [
        { id: 'w', item: 'whip', x: 0, y: 0, rotation: 90, supply: true },
        { id: 's', item: 'spear', x: 4, y: 1, rotation: 0, supply: false },
      ],
    });
    const back = LayoutSchema.parse(parse(layoutToYaml(l)));
    expect(back).toEqual(l);
  });
});

describe('item browser', () => {
  const data = makeData();
  const entries = browserEntries(data);
  const names = (f: Partial<typeof EMPTY_FILTER>, supply = new Set<string>()) => filterEntries(entries, { ...EMPTY_FILTER, ...f }, supply).map((e) => e.id);

  it('lists items and gear with their marks', () => {
    const relic = entries.find((e) => e.id === 'relic')!;
    expect(relic).toMatchObject({ kind: 'item', hero: 'alpha', classes: ['warrior'], needsShape: false });
    const band = entries.find((e) => e.id === 'band')!;
    expect(band).toMatchObject({ kind: 'gear', needsShape: true });
    expect(entries.find((e) => e.id === 'egg')!.kind).toBe('pet_spawn');
  });

  it('filters by name, kind, class, hero, rarity, tag and starting equipment', () => {
    expect(names({ text: 'sto' })).toEqual(['stone']);
    expect(names({ kind: 'gear' })).toEqual(['band', 'blade', 'buckler_gear']);
    expect(names({ kind: 'pet_spawn' })).toEqual(['egg']);
    expect(names({ cls: 'ranger', kind: 'item' })).not.toContain('sword');
    expect(names({ cls: 'ranger', kind: 'item' })).toContain('pup'); // universal items stay
    expect(names({ hero: 'alpha' })).toEqual(['relic']);
    expect(names({ rarity: 'legendary' })).toEqual(['legend']);
    expect(names({ tag: 'potion' })).toEqual(['potion']);
    expect(names({ kind: 'supply' }, new Set(['rock', 'sword']))).toEqual(['rock', 'sword']);
    expect(allTags(entries)).toContain('creature');
  });
});

describe('item editor helpers', () => {
  const data = makeData();

  it('turns a loaded entry into a draft with a footprint', () => {
    const d = toDraft(data.items.get('glove') as unknown as Record<string, unknown>);
    expect(d.footprint).toBe('o#o');
    expect(d).not.toHaveProperty('meta');
    expect(d).not.toHaveProperty('shape');
  });

  it('diffs only changed fields, nested, with null for removed ones', () => {
    const orig = toDraft(data.items.get('pup') as unknown as Record<string, unknown>);
    const draft = structuredClone(orig);
    (draft.stats as Record<string, unknown>).cooldown = 2.5;
    delete (draft.stats as Record<string, unknown>).crit_chance;
    draft.footprint = '#'; // same shape, so no change
    draft.tags = ['weapon'];
    expect(diffFields(orig, draft)).toEqual({ stats: { cooldown: 2.5, crit_chance: null }, tags: ['weapon'] });
    expect(diffFields(orig, { ...orig, verified: true, source: 'observed' })).toEqual({});
  });

  it('compares footprints by shape, not by spelling', () => {
    expect(normalFootprint('.o. / .#.')).toBe(normalFootprint('o / #'));
    expect(normalFootprint(undefined)).toBeUndefined();
  });

  it('validates drafts with the data schema and the shape rules', () => {
    const ok = toDraft(data.items.get('glove') as unknown as Record<string, unknown>);
    expect(validateDraft('items', ok)).toEqual([]);
    expect(validateDraft('items', { ...ok, rarity: 'mythic' })[0]).toMatch(/^rarity:/);
    expect(validateDraft('items', { ...ok, footprint: 'x' })[0]).toMatch(/unknown character/);
  });

  it('converts between footprints and the clickable grid', () => {
    const g = gridFromFootprint('o#o / .#.');
    expect(g).toHaveLength(GRID * GRID);
    expect(g.filter((v) => v === 1)).toHaveLength(2);
    expect(g.filter((v) => v === 2)).toHaveLength(2);
    expect(footprintFromGrid(g)).toBe('o#o / .#.');
    expect(footprintFromGrid(new Array(GRID * GRID).fill(0))).toBeUndefined();
    expect(footprintFromGrid(new Array(GRID * GRID).fill(2))).toBeUndefined();
    expect([0, 1, 2].map((v) => nextShapeCell(v as 0))).toEqual([1, 2, 0]);
  });
});
