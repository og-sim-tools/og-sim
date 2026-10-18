/**
 * In-game numbers and observation ranges (SPEC §4.3).
 *
 * The game shows rounded numbers with K / M / B suffixes ("1.34M", "812.5K"). Each shown number
 * is really a range: with rounding, "1.34M" is 1.335M–1.345M; with truncation, 1.34M–1.35M.
 * An observation (number shown on an item + my basic stat at the time) gives a range for the
 * item's ratio. Several observations are intersected.
 */

export type Rounding = 'round' | 'truncate';

const SUFFIX: Record<string, number> = { '': 1, K: 1e3, M: 1e6, B: 1e9 };
const NUMBER_RE = /^(\d+)(?:\.(\d+))?\s*([KMB]?)$/i;

export class NumberFormatError extends Error {}

export interface ShownNumber {
  /** The value as written (1.34M → 1,340,000). */
  value: number;
  /** Size of one step in the last shown digit (1.34M → 10,000). */
  step: number;
}

/** Parse "1.34M", "812.5K", "4M", "600k" or a plain number. */
export function parseShown(text: string | number): ShownNumber {
  if (typeof text === 'number') {
    if (!Number.isFinite(text) || text < 0) throw new NumberFormatError(`Not a valid game number: ${text}`);
    return { value: text, step: 0 };
  }
  const m = NUMBER_RE.exec(text.trim());
  if (!m) throw new NumberFormatError(`Not a game number: "${text}" (expected e.g. 812.5K, 1.34M, 4M).`);
  const mult = SUFFIX[m[3]!.toUpperCase()]!;
  const decimals = m[2]?.length ?? 0;
  const value = Number(`${m[1]}${m[2] ? `.${m[2]}` : ''}`) * mult;
  return { value, step: mult / 10 ** decimals };
}

/** Plain value of a basic stat as entered ("4M" → 4,000,000). */
export function parseAbbrev(text: string | number): number {
  return parseShown(text).value;
}

export interface Range {
  lo: number;
  hi: number;
}

/** The range of true values that display as `text`. Plain numbers (no text) are exact. */
export function shownRange(text: string | number, rounding: Rounding = 'round'): Range {
  const { value, step } = parseShown(text);
  if (step === 0) return { lo: value, hi: value };
  return rounding === 'round' ? { lo: value - step / 2, hi: value + step / 2 } : { lo: value, hi: value + step };
}

export interface Observation {
  shown: string;
  stat: string;
}

/** Ratio range implied by one observation: shown / stat. */
export function observationRange(o: Observation, rounding: Rounding = 'round'): Range {
  const s = shownRange(o.shown, rounding);
  const b = shownRange(o.stat, rounding);
  if (b.lo <= 0) throw new NumberFormatError(`Basic stat "${o.stat}" must be positive.`);
  return { lo: s.lo / b.hi, hi: s.hi / b.lo };
}

/** Intersection of ranges, or null if they don't overlap. */
export function intersect(ranges: Range[]): Range | null {
  if (ranges.length === 0) return null;
  const lo = Math.max(...ranges.map((r) => r.lo));
  const hi = Math.min(...ranges.map((r) => r.hi));
  return lo <= hi ? { lo, hi } : null;
}

export const midpoint = (r: Range) => (r.lo + r.hi) / 2;
/** Relative uncertainty (± fraction of the midpoint). */
export const uncertainty = (r: Range) => (midpoint(r) === 0 ? 0 : (r.hi - r.lo) / 2 / midpoint(r));

export interface ScaledValueInput {
  ratio?: number;
  scales_with: 'atk' | 'hp' | 'enemy_hp' | 'unknown';
  observations?: Observation[];
}

export interface ResolvedRatio {
  /** The ratio the simulator uses: the given ratio, or the midpoint of the observation range. */
  ratio: number | null;
  /** Observation range (intersected), if there are observations. */
  range: Range | null;
  /** ± fraction, from the observation range. */
  uncertainty: number | null;
  from: 'ratio' | 'observations' | 'none';
  warnings: string[];
  errors: string[];
}

/**
 * Work out a scaled value's ratio. A typed ratio wins (it may be a confirmed clean value);
 * observations check it. With only observations, the midpoint of their intersection is used.
 */
export function resolveRatio(v: ScaledValueInput, rounding: Rounding = 'round'): ResolvedRatio {
  const warnings: string[] = [];
  const errors: string[] = [];
  const obs = v.observations ?? [];
  let range: Range | null = null;
  if (obs.length > 0) {
    const ranges = obs.map((o) => observationRange(o, rounding));
    range = intersect(ranges);
    if (!range) {
      errors.push(
        `Observations don't agree: ${obs
          .map((o, i) => `${o.shown} at ${o.stat} → ${ranges[i]!.lo.toFixed(4)}–${ranges[i]!.hi.toFixed(4)}`)
          .join('; ')}. A typo, or the value doesn't scale as assumed.`,
      );
    }
  }
  if (v.ratio !== undefined && range && (v.ratio < range.lo || v.ratio > range.hi)) {
    warnings.push(`Ratio ${v.ratio} is outside the observed range ${range.lo.toFixed(4)}–${range.hi.toFixed(4)}.`);
  }
  if (v.scales_with === 'unknown') warnings.push('Unknown scaling stat.');
  const ratio = v.ratio ?? (range ? midpoint(range) : null);
  return {
    ratio,
    range,
    uncertainty: range ? uncertainty(range) : null,
    from: v.ratio !== undefined ? 'ratio' : range ? 'observations' : 'none',
    warnings,
    errors,
  };
}

/** Format a number the way the game does (for display): 1340000 → "1.34M". */
export function formatShown(n: number, digits = 3): string {
  const abs = Math.abs(n);
  const [div, suf] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  const v = n / div;
  return `${Number(v.toPrecision(digits))}${suf}`;
}
