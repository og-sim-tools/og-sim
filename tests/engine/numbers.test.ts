import { describe, expect, it } from 'vitest';
import {
  NumberFormatError,
  formatShown,
  intersect,
  observationRange,
  parseAbbrev,
  parseShown,
  resolveRatio,
  shownRange,
  uncertainty,
} from '../../src/engine/numbers';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('shown numbers', () => {
  it('parses K / M / B with any number of decimals, case-insensitive', () => {
    expect(parseShown('1.34M')).toEqual({ value: 1_340_000, step: 10_000 });
    expect(parseShown('812.5K')).toEqual({ value: 812_500, step: 100 });
    expect(parseShown('4M')).toEqual({ value: 4_000_000, step: 1_000_000 });
    expect(parseShown('600k')).toEqual({ value: 600_000, step: 1_000 });
    expect(parseShown('2.5B')).toEqual({ value: 2_500_000_000, step: 100_000_000 });
    expect(parseShown('123')).toEqual({ value: 123, step: 1 });
    expect(parseAbbrev(42)).toBe(42);
    expect(() => parseShown('1.3.4M')).toThrow(NumberFormatError);
    expect(() => parseShown('12X')).toThrow(NumberFormatError);
  });

  it('turns a rounded display into a range', () => {
    const r = shownRange('1.34M');
    close(r.lo, 1_335_000);
    close(r.hi, 1_345_000);
    const k = shownRange('812.5K');
    close(k.lo, 812_450);
    close(k.hi, 812_550);
  });

  it('supports truncation as well', () => {
    const r = shownRange('1.34M', 'truncate');
    close(r.lo, 1_340_000);
    close(r.hi, 1_350_000);
  });

  it('treats plain numbers as exact', () => {
    expect(shownRange(5000)).toEqual({ lo: 5000, hi: 5000 });
  });

  it('formats numbers like the game', () => {
    expect(formatShown(1_340_000)).toBe('1.34M');
    expect(formatShown(812_500)).toBe('813K');
    expect(formatShown(3_302_400)).toBe('3.3M');
    expect(formatShown(950)).toBe('950');
  });
});

describe('observation ranges', () => {
  it('gives the ratio range of one observation', () => {
    // Spear-like: 2.01M shown at 1.34M ATK.
    const r = observationRange({ shown: '2.01M', stat: '1.34M' });
    close(r.lo, 2_005_000 / 1_345_000);
    close(r.hi, 2_015_000 / 1_335_000);
    expect(r.lo).toBeLessThan(1.5);
    expect(r.hi).toBeGreaterThan(1.5);
  });

  it('intersects several observations', () => {
    expect(intersect([{ lo: 1, hi: 3 }, { lo: 2, hi: 4 }])).toEqual({ lo: 2, hi: 3 });
    expect(intersect([{ lo: 1, hi: 2 }, { lo: 3, hi: 4 }])).toBeNull();
    expect(intersect([])).toBeNull();
  });

  it('uses the typed ratio and checks it against observations (Clone Potion)', () => {
    const r = resolveRatio({
      ratio: 0.15,
      scales_with: 'hp',
      observations: [{ shown: '1.03M', stat: '6.9M' }, { shown: '600K', stat: '4M' }],
    });
    expect(r.ratio).toBe(0.15);
    expect(r.from).toBe('ratio');
    expect(r.warnings).toEqual([]);
    expect(r.range!.lo).toBeLessThanOrEqual(0.15);
    expect(r.range!.hi).toBeGreaterThanOrEqual(0.15);
  });

  it('uses the midpoint when there is no typed ratio', () => {
    const r = resolveRatio({ scales_with: 'atk', observations: [{ shown: '2.08M', stat: '696.3K' }] });
    expect(r.from).toBe('observations');
    close(r.ratio!, (2_075_000 / 696_350 + 2_085_000 / 696_250) / 2);
    expect(r.uncertainty!).toBeGreaterThan(0);
    expect(r.uncertainty!).toBeLessThan(0.005);
  });

  it('warns when the wiki ratio is outside the observed range (Greatdog: 3.0x)', () => {
    const r = resolveRatio({ ratio: 3.0, scales_with: 'atk', observations: [{ shown: '2.08M', stat: '696.3K' }] });
    expect(r.warnings[0]).toBe('Ratio 3 is outside the observed range 2.9798–2.9946.');
    expect(resolveRatio({ ratio: 2.99, scales_with: 'atk', observations: [{ shown: '2.08M', stat: '696.3K' }] }).warnings).toEqual([]);
  });

  it('reports observations that do not overlap', () => {
    const r = resolveRatio({ scales_with: 'hp', observations: [{ shown: '1.03M', stat: '6.9M' }, { shown: '900K', stat: '4M' }] });
    expect(r.ratio).toBeNull();
    expect(r.errors[0]).toMatch(/Observations don't agree/);
  });

  it('computes the relative uncertainty', () => {
    expect(uncertainty({ lo: 0.9, hi: 1.1 })).toBeCloseTo(0.1);
  });

  it('accounts for the extra precision below 1M', () => {
    const coarse = observationRange({ shown: '1.03M', stat: '6.9M' });
    const fine = observationRange({ shown: '812.5K', stat: '6.9M' });
    expect(uncertainty(fine)).toBeLessThan(uncertainty(coarse));
  });
});
