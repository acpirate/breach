// Small seedable RNG (mulberry32) so the logic layer is deterministic under test.

export interface RNG {
  next(): number; // [0, 1)
  int(n: number): number; // integer in [0, n)
  pick<T>(a: T[]): T;
  shuffle<T>(a: T[]): T[]; // in-place Fisher-Yates, returns the same array
  getState(): number; // MK4.1: internal state, so a saved battle resumes deterministically
}

export function makeRNG(seed?: number): RNG {
  let s = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(a: T[]): T => a[Math.floor(next() * a.length)],
    shuffle: <T>(a: T[]): T[] => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    // makeRNG(seed) treats its argument as the raw internal state, so
    // makeRNG(rng.getState()) resumes the exact sequence.
    getState: () => s,
  };
}
