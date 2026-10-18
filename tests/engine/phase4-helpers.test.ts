/** Engine helpers added for the UI: footprint formatting, first-fit placement, available supplies, confirmed flag. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLayout, createBag, findFirstFit, formatFootprint, fullBag, parseFootprint } from '../../src/engine/bag';
import { loadGameData } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { availableSupplies } from '../../src/engine/validate';
import { makeData, makeLoadout, makeProfile } from '../helpers';

describe('formatFootprint', () => {
  it('round-trips every footprint in the real data', () => {
    const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
    let n = 0;
    for (const item of d.items.values()) {
      const text = formatFootprint(item.shape!, item.dots);
      const back = parseFootprint(text);
      expect(back.cells, item.id).toEqual(item.shape);
      expect(back.dots.sort((a, b) => a.y - b.y || a.x - b.x), item.id).toEqual([...item.dots].sort((a, b) => a.y - b.y || a.x - b.x));
      n++;
    }
    expect(n).toBe(232);
  }, 30_000); // loads all the game data: slow when the whole suite runs in parallel

  it('keeps the bounding box of cells and dots', () => {
    expect(formatFootprint([{ x: 0, y: 0 }], [{ x: 0, y: -1 }, { x: 0, y: 1 }])).toBe('o / # / o');
    expect(formatFootprint([{ x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe('o.. / .#. / ..o');
  });
});

describe('findFirstFit', () => {
  const defs = { one: { id: 'one', shape: [{ x: 0, y: 0 }] }, bar: { id: 'bar', shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } };
  const fp = (s: string) => parseFootprint(s);

  it('scans left to right, top to bottom', () => {
    const layout = buildLayout(fullBag(), [{ instanceId: 'a', itemId: 'one', x: 0, y: 0, rotation: 0 }], defs);
    expect(findFirstFit(layout, fp('#'))).toEqual({ x: 1, y: 0 });
    expect(findFirstFit(layout, fp('# / #'))).toEqual({ x: 1, y: 0 });
  });

  it('skips closed cells and moves to the next row when a row is full', () => {
    const mask = [0, 0, 0, 0, 0, 0, 1, 1, ...new Array(8).fill(1)];
    const layout = buildLayout(createBag(mask), [{ instanceId: 'a', itemId: 'bar', x: 6, y: 0, rotation: 0 }], defs);
    expect(findFirstFit(layout, fp('##'))).toEqual({ x: 0, y: 1 });
  });

  it('can ignore the item being moved, and returns null when nothing fits', () => {
    const layout = buildLayout(createBag([1, 1, 0, 0, 0, 0, 0, 0]), [{ instanceId: 'a', itemId: 'bar', x: 0, y: 0, rotation: 0 }], defs);
    expect(findFirstFit(layout, fp('##'))).toBeNull();
    expect(findFirstFit(layout, fp('##'), 0, 'a')).toEqual({ x: 0, y: 0 });
    expect(findFirstFit(layout, fp('##'), 90, 'a')).toBeNull();
  });
});

describe('availableSupplies', () => {
  const data = makeData();
  it('lists starting equipment unlocked by owned same-class heroes, with cost and source', () => {
    const profile = makeProfile(
      data,
      'basic_stats: { hp: 1, atk: 1, initial_block: 0 }\nheroes: [{ id: alpha, stars: 3 }, { id: beta, stars: 1 }, { id: gamma, stars: 9 }]\nactive_hero: alpha\n',
    );
    const list = availableSupplies(makeLoadout(data, profile, 'placements: []'));
    expect(list.map((s) => `${s.item.id}:${s.cost}:${s.unlockedBy.join('+')}`)).toEqual([
      'glove:4:Beta 1★',
      'legend:8:Alpha 3★',
      'relic:6:Alpha 1★',
      'rock:2:Alpha 0★',
      'sword:2:Alpha 0★',
    ]);
  });
});

describe('confirmed flag', () => {
  const base = ['config.yaml', 'stats.yaml'].map((f) => ({ path: f, text: readFileSync(join(__dirname, '..', '..', 'data', f), 'utf8') }));
  it('marks a wiki entry verified without changing any field', () => {
    const res = loadGameData([
      ...base,
      { path: 'auras/wiki/a.yaml', text: '- { id: a, name: A, rarity: rare, skill_name: S, skill_text: T, source: wiki, verified: false }\n' },
      { path: 'auras/manual/user_edits.yaml', text: '- { id: a, confirmed: true, source: observed, verified: true }\n' },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.data.auras.get('a')!.verified).toBe(true);
    expect(res.overrides.map((o) => `${o.field}:${String(o.from)}→${String(o.to)}`)).toEqual(['verified:false→true']);
    expect(res.issues.filter((i) => i.level === 'warning')).toEqual([]);
  });

  it('works on manual-only entries too', () => {
    const res = loadGameData([
      ...base,
      { path: 'auras/manual/x.yaml', text: '- { id: b, name: B, rarity: rare, skill_name: S, skill_text: T, source: manual, verified: false, confirmed: true }\n' },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.data.auras.get('b')!.verified).toBe(true);
  });
});
