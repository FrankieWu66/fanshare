/**
 * Seeded deterministic RNG — mulberry32.
 *
 * Why: the game-night rehearsal has to be reproducible between runs so we can
 * answer "did my patch regress a flow that worked last time?" Seed controls
 * every random decision (which player a hype trader picks, jitter on action
 * timing, whether a skeptic abandons on this tick). LLM narration is allowed
 * to vary; decisions are not.
 *
 * mulberry32 is a tiny PRNG with good distribution for our use case. Don't use
 * for crypto — this is strictly for test-harness determinism.
 */

export interface SeededRng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  intBetween(min: number, max: number): number;
  /** Float in [min, max). */
  floatBetween(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Pick one element from an array. */
  pick<T>(arr: readonly T[]): T;
  /** Shuffle a copy of arr (Fisher-Yates). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Derive a child RNG from this one + a label (so each bot has its own stream). */
  child(label: string): SeededRng;
}

/**
 * Hash a string to a 32-bit unsigned int (FNV-1a). Used to derive child-stream
 * seeds from labels so each bot gets its own independent sequence seeded from
 * the same root seed.
 */
function hashLabel(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** mulberry32 — tiny seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: string | number): SeededRng {
  const rootSeed = typeof seed === "number" ? seed >>> 0 : hashLabel(seed);
  const nextFloat = mulberry32(rootSeed);

  const rng: SeededRng = {
    next: () => nextFloat(),
    intBetween: (min, max) => Math.floor(nextFloat() * (max - min + 1)) + min,
    floatBetween: (min, max) => nextFloat() * (max - min) + min,
    chance: (p) => nextFloat() < p,
    pick: <T>(arr: readonly T[]) => arr[Math.floor(nextFloat() * arr.length)]!,
    shuffle: <T>(arr: readonly T[]) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    child: (label) => makeRng(rootSeed ^ hashLabel(label)),
  };

  return rng;
}
