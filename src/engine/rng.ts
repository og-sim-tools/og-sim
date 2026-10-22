/**
 * The one source of randomness (CLAUDE.md, SPEC §2): a small seeded PRNG (sfc32), so the same
 * inputs and seed always give the same battle.
 */

/** 32-bit hash of a string seed (cyrb53-style mix, truncated). */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0, (h1 ^ h2) >>> 0, (h1 + h2) >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  /** Number of values drawn so far (handy when debugging determinism). */
  draws = 0;

  constructor(readonly seed: number | string) {
    [this.a, this.b, this.c, this.d] = hashSeed(String(seed));
    for (let i = 0; i < 12; i++) this.next(); // warm up
    this.draws = 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.draws++;
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** True with the given percent chance (0–100). 0 and 100 never draw, so they don't shift the sequence. */
  chance(pct: number): boolean {
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    return this.next() * 100 < pct;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Random element (undefined for an empty list). */
  pick<T>(list: readonly T[]): T | undefined {
    return list.length === 0 ? undefined : list[this.int(list.length)];
  }

  /** Random sample of up to n distinct elements, in random order. */
  sample<T>(list: readonly T[], n: number): T[] {
    const copy = [...list];
    const out: T[] = [];
    while (out.length < n && copy.length > 0) out.push(copy.splice(this.int(copy.length), 1)[0]!);
    return out;
  }
}

let freshCount = 0;
/** A new battle seed for the UI's dice button (from the clock and a counter, through Rng: no Math.random). */
export function freshSeed(): number {
  freshCount++;
  return 1 + Math.floor(new Rng(`fresh:${Date.now()}:${freshCount}`).next() * 999_999);
}
