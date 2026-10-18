import { describe, expect, it } from 'vitest';
import {
  type Cell,
  type Footprint,
  type Placement,
  type Rotation,
  type ShapeDef,
  BagError,
  DotResolutionError,
  FootprintError,
  ROTATIONS,
  ShapeDefinitionError,
  assertValidShapeDefinition,
  buildLayout,
  createBag,
  dotGraph,
  fullBag,
  isUsable,
  occupantsAt,
  orient,
  parseFootprint,
  resolveDots,
  validateShapeDefinition,
} from '../../src/engine/bag';

const sorted = (cells: Cell[]) => [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
const fp = (cells: [number, number][], dots: [number, number][] = []): Footprint => ({
  cells: cells.map(([x, y]) => ({ x, y })),
  dots: dots.map(([x, y]) => ({ x, y })),
});
const def = (id: string, footprint: string): ShapeDef => {
  const f = parseFootprint(footprint);
  return { id, shape: f.cells, dots: f.dots };
};
const place = (instanceId: string, itemId: string, x: number, y: number, rotation: Rotation = 0): Placement => ({
  instanceId,
  itemId,
  x,
  y,
  rotation,
});

// The irregular example mask from SPEC §4.1.
const IRREGULAR = [
  0, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 0,
];

describe('bag mask', () => {
  it('builds the full 8 × 6 bag', () => {
    const bag = fullBag();
    expect(bag.width).toBe(8);
    expect(bag.height).toBe(6);
    expect(bag.mask.filter((v) => v === 1)).toHaveLength(48);
  });

  it('derives height from the mask length', () => {
    const bag = createBag(IRREGULAR);
    expect(bag.height).toBe(4);
    expect(isUsable(bag, 0, 0)).toBe(false);
    expect(isUsable(bag, 1, 0)).toBe(true);
    expect(isUsable(bag, 7, 3)).toBe(false);
    expect(isUsable(bag, 0, 1)).toBe(true);
  });

  it('treats out-of-range coordinates as unusable without wrapping', () => {
    const bag = fullBag();
    for (const [x, y] of [[-1, 0], [0, -1], [8, 0], [0, 6], [8, 5], [-1, 5], [7, -1], [0.5, 0]]) {
      expect(isUsable(bag, x!, y!)).toBe(false);
    }
  });

  it('rejects masks whose length is not a multiple of 8', () => {
    expect(() => createBag([1, 1, 1])).toThrow(BagError);
    expect(() => createBag([])).toThrow(/positive multiple of 8/);
  });

  it('rejects mask values other than 0 and 1, naming the cell', () => {
    const mask = new Array(16).fill(1);
    mask[10] = 2;
    expect(() => createBag(mask)).toThrow(/entry 10 \(x=2, y=1\) is 2/);
  });
});

describe('footprint notation', () => {
  it('parses shape cells and dots, anchored at the shape bounding box', () => {
    // Golden Pig: o / # / o
    const pig = parseFootprint('o / # / o');
    expect(pig.cells).toEqual([{ x: 0, y: 0 }]);
    expect(sorted(pig.dots)).toEqual([{ x: 0, y: -1 }, { x: 0, y: 1 }]);
  });

  it('parses a wide item with dots to the right (Whip)', () => {
    const whip = parseFootprint('#oooo / #....');
    expect(sorted(whip.cells)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    expect(sorted(whip.dots)).toEqual([1, 2, 3, 4].map((x) => ({ x, y: 0 })));
  });

  it('accepts backtick-wrapped footprints as copied from the docs', () => {
    expect(parseFootprint('`o#o`')).toEqual(parseFootprint('o#o'));
  });

  it('handles shapes whose bounding box does not start at row/column 0 (Galeclaw)', () => {
    const g = parseFootprint('.o..o. / .o.o.. / .oo... / .#oooo / ##.... / #.....');
    expect(sorted(g.cells)).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }]);
    expect(g.dots).toContainEqual({ x: 1, y: -3 });
    expect(g.dots).toContainEqual({ x: 4, y: -3 });
    expect(g.dots).toHaveLength(10);
  });

  it('rejects unknown characters and footprints with no item cells', () => {
    expect(() => parseFootprint('#x#')).toThrow(FootprintError);
    expect(() => parseFootprint('o / o')).toThrow(/no item cells/);
  });
});

describe('rotation', () => {
  // Asymmetric L shape with asymmetric dots:
  //   o.       dot above the top cell
  //   #.
  //   ##o      dot right of the foot
  const L = parseFootprint('o. / #. / ##o');

  it('parses the reference shape', () => {
    expect(sorted(L.cells)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(sorted(L.dots)).toEqual([{ x: 0, y: -1 }, { x: 2, y: 1 }]);
  });

  const expected: Record<Rotation, Footprint> = {
    0: fp([[0, 0], [0, 1], [1, 1]], [[0, -1], [2, 1]]),
    // ##o   dot that was above is now to the right; dot that was right is now below
    // #.
    // o.
    90: fp([[0, 0], [1, 0], [0, 1]], [[2, 0], [0, 2]]),
    // o##
    // ..#
    // ..o
    180: fp([[0, 0], [1, 0], [1, 1]], [[-1, 0], [1, 2]]),
    // ..o
    // ..#
    // o##
    270: fp([[1, 0], [0, 1], [1, 1]], [[1, -1], [-1, 1]]),
  };

  for (const r of ROTATIONS) {
    it(`rotates shape and dots together by ${r}°`, () => {
      const o = orient(L, r);
      expect(sorted(o.cells)).toEqual(sorted(expected[r].cells));
      expect(sorted(o.dots)).toEqual(sorted(expected[r].dots));
    });
  }

  it('moves a dot to the right of a sword below it after 90° clockwise', () => {
    const sword = fp([[0, 0], [0, 1], [0, 2]], [[1, 0]]); // dot right of the top cell
    const r = orient(sword, 90);
    expect(sorted(r.cells)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(r.dots).toEqual([{ x: 2, y: 1 }]); // below the (former) top cell
  });

  it('keeps the shape anchored at (0, 0) in every rotation', () => {
    for (const r of ROTATIONS) {
      const o = orient(L, r);
      expect(Math.min(...o.cells.map((c) => c.x))).toBe(0);
      expect(Math.min(...o.cells.map((c) => c.y))).toBe(0);
    }
  });

  it('returns to the original after four quarter turns', () => {
    let f = L;
    for (let i = 0; i < 4; i++) f = orient(f, 90);
    expect(sorted(f.cells)).toEqual(sorted(L.cells));
    expect(sorted(f.dots)).toEqual(sorted(L.dots));
  });

  it('rejects invalid rotations', () => {
    expect(() => orient(L, 45 as Rotation)).toThrow(/Invalid rotation 45/);
  });
});

describe('shape definition checks', () => {
  it('accepts every footprint style used in the wiki data', () => {
    for (const f of [
      '#', 'o#o', '.o. / o#o / o#o / .o.', 'o##o / o##o / o##o / o..o', '..o / .#o / o#. / o..',
      '##.. / #... / .o.. / ..o. / ...o', '.o.o. / o.#.. / ..#.o / .o.o.',
    ]) {
      expect(validateShapeDefinition(def('x', f))).toEqual([]);
    }
  });

  it('rejects an item whose dots land on its own cells, naming the item and cells', () => {
    const bad: ShapeDef = { id: 'bad_sword', name: 'Bad Sword', shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }], dots: [{ x: 0, y: 1 }, { x: 1, y: 0 }] };
    const errors = validateShapeDefinition(bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/"bad_sword" \(Bad Sword\)/);
    expect(errors[0]).toMatch(/\(0,1\)/);
    expect(() => assertValidShapeDefinition(bad)).toThrow(ShapeDefinitionError);
  });

  it('never lets a valid item put a dot on its own cells in any rotation', () => {
    const items = ['o. / #. / ##o', '#oooo / #....', '...## / o.o## / .o.o. / ..o.. / ...o.', 'o##. / .##o'];
    for (const f of items) {
      const parsed = parseFootprint(f);
      for (const r of ROTATIONS) {
        const o = orient(parsed, r);
        const own = new Set(o.cells.map((c) => `${c.x},${c.y}`));
        expect(o.dots.filter((d) => own.has(`${d.x},${d.y}`))).toEqual([]);
      }
    }
  });

  it('rejects duplicate cells, empty shapes and non-integer coordinates', () => {
    expect(validateShapeDefinition({ id: 'a', shape: [{ x: 0, y: 0 }, { x: 0, y: 0 }] })[0]).toMatch(/more than once/);
    expect(validateShapeDefinition({ id: 'b', shape: [{ x: 0, y: 0 }], dots: [{ x: 1, y: 0 }, { x: 1, y: 0 }] })[0]).toMatch(/dots list the same cell/);
    expect(validateShapeDefinition({ id: 'c', shape: [] })[0]).toMatch(/empty list/);
    expect(validateShapeDefinition({ id: 'd', shape: [{ x: 0.5, y: 0 }] })[0]).toMatch(/integers/);
  });

  it('accepts items with no shape yet (gear before I enter it)', () => {
    expect(validateShapeDefinition({ id: 'iron_shield' })).toEqual([]);
  });
});

describe('placement validation', () => {
  const defs: Record<string, ShapeDef> = {
    sword: def('sword', '# / # / #'),
    whip: { ...def('whip', '#oooo / #....'), name: 'Whip' },
    block: def('block', '## / ##'),
    gear: { id: 'gear', name: 'Iron Shield' },
  };

  it('accepts a valid layout and records occupancy', () => {
    const layout = buildLayout(fullBag(), [place('s', 'sword', 0, 0), place('b', 'block', 1, 0)], defs);
    expect(layout.valid).toBe(true);
    expect(layout.issues).toEqual([]);
    expect(occupantsAt(layout, 0, 2)).toEqual(['s']);
    expect(occupantsAt(layout, 2, 1)).toEqual(['b']);
    expect(occupantsAt(layout, 3, 3)).toEqual([]);
  });

  it('places rotated items using their rotated footprint', () => {
    const layout = buildLayout(fullBag(), [place('s', 'sword', 2, 4, 90)], defs);
    expect(layout.valid).toBe(true);
    expect(sorted(layout.items.get('s')!.cells)).toEqual([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }]);
  });

  it('reports cells outside the bag', () => {
    const layout = buildLayout(fullBag(), [place('s', 'sword', 7, 4)], defs);
    expect(layout.valid).toBe(false);
    expect(layout.issues).toHaveLength(1);
    expect(layout.issues[0]!.code).toBe('out_of_bounds');
    expect(layout.issues[0]!.cells).toEqual([{ x: 7, y: 6 }]);
  });

  it('reports items covering masked cells', () => {
    const layout = buildLayout(createBag(IRREGULAR), [place('b', 'block', 0, 0)], defs);
    expect(layout.issues.map((i) => i.code)).toEqual(['masked_cell']);
    expect(layout.issues[0]!.cells).toEqual([{ x: 0, y: 0 }]);
    expect(layout.issues[0]!.message).toMatch(/unavailable bag cells at \(0,0\)/);
  });

  it('reports overlaps once per pair with all shared cells', () => {
    const layout = buildLayout(fullBag(), [place('b1', 'block', 0, 0), place('b2', 'block', 1, 1), place('s', 'sword', 5, 0)], defs);
    const overlaps = layout.issues.filter((i) => i.code === 'overlap');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.instanceIds).toEqual(['b1', 'b2']);
    expect(overlaps[0]!.cells).toEqual([{ x: 1, y: 1 }]);
    expect(occupantsAt(layout, 1, 1)).toEqual(['b1', 'b2']);
  });

  it('reports items that still need a shape and skips them', () => {
    const layout = buildLayout(fullBag(), [place('g', 'gear', 0, 0)], defs);
    expect(layout.issues.map((i) => i.code)).toEqual(['needs_shape']);
    expect(layout.issues[0]!.message).toMatch(/Iron Shield/);
    expect(layout.items.has('g')).toBe(false);
    expect(resolveDots(layout, 'g')).toEqual({ dots: [], targets: [] });
  });

  it('reports unknown items, duplicate instance ids and bad rotations', () => {
    const layout = buildLayout(
      fullBag(),
      [place('a', 'nope', 0, 0), place('s', 'sword', 0, 0), place('s', 'sword', 3, 0), place('r', 'sword', 4, 0, 45 as Rotation)],
      defs,
    );
    expect(layout.issues.map((i) => i.code)).toEqual(['unknown_item', 'duplicate_instance', 'invalid_rotation']);
  });

  it('accepts a Map of definitions as well as a record', () => {
    const layout = buildLayout(fullBag(), [place('s', 'sword', 0, 0)], new Map(Object.entries(defs)));
    expect(layout.valid).toBe(true);
  });
});

describe('item-dot resolution', () => {
  const ring = def('ring', 'ooo / o#o / ooo'); // 1×1 with a dot on all 8 neighbours
  const one = def('one', '#');
  const defs: Record<string, ShapeDef> = {
    ring,
    one,
    whip: def('whip', '#oooo / #....'),
    bar4: def('bar4', '####'),
    vbar3: def('vbar3', '# / # / #'),
    greatshield: def('greatshield', 'o##o / o##o / o##o / o..o'),
  };

  /** Fill every usable cell except the source cell with a 1×1 item. */
  function surrounded(mask: number[], sx: number, sy: number) {
    const bag = createBag(mask);
    const placements: Placement[] = [place('src', 'ring', sx, sy)];
    for (let y = 0; y < bag.height; y++) {
      for (let x = 0; x < bag.width; x++) {
        if ((x !== sx || y !== sy) && isUsable(bag, x, y)) placements.push(place(`c${x}_${y}`, 'one', x, y));
      }
    }
    const layout = buildLayout(bag, placements, defs);
    expect(layout.valid).toBe(true);
    return layout;
  }

  const full = new Array(48).fill(1);
  const neighbours = (x: number, y: number) =>
    [-1, 0, 1].flatMap((dy) => [-1, 0, 1].filter((dx) => dx || dy).map((dx) => ({ x: x + dx, y: y + dy })));

  // Every corner and every edge of the full bag: only in-bag neighbours are reached,
  // nothing wraps around to the other side of a row or to the previous/next row.
  const positions: [string, number, number, number][] = [
    ['top-left corner', 0, 0, 5],
    ['top-right corner', 7, 0, 5],
    ['bottom-left corner', 0, 5, 5],
    ['bottom-right corner', 7, 5, 5],
    ['top edge', 3, 0, 3],
    ['bottom edge', 4, 5, 3],
    ['left edge', 0, 2, 3],
    ['right edge', 7, 3, 3],
    ['interior', 4, 2, 0],
  ];
  for (const [name, x, y, outsideCount] of positions) {
    it(`at the ${name}, dots outside the bag touch nothing (no wrap-around)`, () => {
      const layout = surrounded(full, x, y);
      const res = resolveDots(layout, 'src');
      const inside = neighbours(x, y).filter((c) => c.x >= 0 && c.x < 8 && c.y >= 0 && c.y < 6);
      expect(res.dots.filter((d) => d.status === 'outside')).toHaveLength(outsideCount);
      expect(res.dots.filter((d) => d.status === 'outside').every((d) => d.target === undefined)).toBe(true);
      expect(res.targets.sort()).toEqual(inside.map((c) => `c${c.x}_${c.y}`).sort());
    });
  }

  it('dots on masked cells of an irregular bag touch nothing', () => {
    // Source at (1,0): neighbours (0,0) is masked, row -1 is outside.
    const layout = surrounded(IRREGULAR, 1, 0);
    const res = resolveDots(layout, 'src');
    expect(res.dots.filter((d) => d.status === 'masked').map((d) => d.cell)).toEqual([{ x: 0, y: 0 }]);
    expect(res.dots.filter((d) => d.status === 'outside')).toHaveLength(3);
    expect(res.targets.sort()).toEqual(['c0_1', 'c1_1', 'c2_0', 'c2_1'].sort());
  });

  it('dots next to the masked corners of an irregular bag (bottom-right)', () => {
    // Source at (6,3): (7,3) masked, (7,2) usable, row 4 outside.
    const layout = surrounded(IRREGULAR, 6, 3);
    const res = resolveDots(layout, 'src');
    expect(res.dots.filter((d) => d.status === 'masked').map((d) => d.cell)).toEqual([{ x: 7, y: 3 }]);
    expect(res.dots.filter((d) => d.status === 'outside')).toHaveLength(3);
    expect(res.targets.sort()).toEqual(['c5_2', 'c5_3', 'c6_2', 'c7_2'].sort());
  });

  it('reports empty usable cells as empty', () => {
    const layout = buildLayout(fullBag(), [place('src', 'ring', 3, 3)], defs);
    const res = resolveDots(layout, 'src');
    expect(res.targets).toEqual([]);
    expect(res.dots.every((d) => d.status === 'empty')).toBe(true);
    expect(res.dots).toHaveLength(8);
  });

  it('counts a target once when several dots cover it', () => {
    // Whip at (0,0) has dots at (1..4, 0); a 4-wide bar there is covered by all four.
    const layout = buildLayout(fullBag(), [place('w', 'whip', 0, 0), place('bar', 'bar4', 1, 0)], defs);
    const res = resolveDots(layout, 'w');
    expect(res.dots.filter((d) => d.status === 'touches')).toHaveLength(4);
    expect(res.targets).toEqual(['bar']);
  });

  it('counts each distinct target once (Lithinum Greatshield with items on both sides)', () => {
    // Greatshield at (1,0): shape x=1..2, y=0..2; dots at x=0 and x=3 for y=0..3.
    const layout = buildLayout(
      fullBag(),
      [place('gs', 'greatshield', 1, 0), place('left', 'vbar3', 0, 0), place('right', 'vbar3', 3, 1), place('below', 'one', 0, 3)],
      defs,
    );
    expect(layout.valid).toBe(true);
    const res = resolveDots(layout, 'gs');
    expect(res.targets).toEqual(['left', 'right', 'below']);
  });

  it('follows the item when it is rotated (Whip dots point down after 90°)', () => {
    // Whip rotated 90°: shape becomes `##` at y=0, dots at (1, 1..4).
    const layout = buildLayout(fullBag(), [place('w', 'whip', 2, 0, 90), place('target', 'vbar3', 3, 2)], defs);
    expect(layout.valid).toBe(true);
    const res = resolveDots(layout, 'w');
    expect(res.dots.map((d) => d.cell)).toEqual([1, 2, 3, 4].map((y) => ({ x: 3, y })));
    expect(res.targets).toEqual(['target']);
    expect(res.dots.filter((d) => d.status === 'empty').map((d) => d.cell)).toEqual([{ x: 3, y: 1 }]);
  });

  it('a rotated item with dots hanging off the bag edge resolves only in-bag dots', () => {
    // Whip rotated 270° at the top: dots point up, all outside.
    const layout = buildLayout(fullBag(), [place('w', 'whip', 0, 0, 270), place('x', 'one', 0, 1)], defs);
    expect(layout.valid).toBe(true);
    const res = resolveDots(layout, 'w');
    expect(res.dots.every((d) => d.status === 'outside')).toBe(true);
    expect(res.targets).toEqual([]);
  });

  it('supports an effect-specific dot set', () => {
    const layout = buildLayout(fullBag(), [place('src', 'one', 3, 3), place('t', 'one', 3, 2)], defs);
    expect(resolveDots(layout, 'src').targets).toEqual([]);
    expect(resolveDots(layout, 'src', [{ x: 0, y: -1 }]).targets).toEqual(['t']);
  });

  it('throws at runtime if a dot lands on its own item', () => {
    const bad: Record<string, ShapeDef> = { bad: { id: 'bad', shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }], dots: [{ x: 1, y: 0 }] } };
    const layout = buildLayout(fullBag(), [place('b', 'bad', 0, 0)], bad);
    expect(() => resolveDots(layout, 'b')).toThrow(DotResolutionError);
    expect(() => resolveDots(layout, 'b')).toThrow(/\(1,0\)/);
  });

  it('builds a reaches / reached-by graph', () => {
    const layout = buildLayout(fullBag(), [place('w', 'whip', 0, 0), place('bar', 'bar4', 1, 0), place('r', 'ring', 2, 1)], defs);
    const g = dotGraph(layout);
    expect(g.get('w')!.reaches).toEqual(['bar']);
    expect(g.get('bar')!.reachedBy).toEqual(['w', 'r']);
    expect(g.get('r')!.reaches).toEqual(['bar']);
  });
});
