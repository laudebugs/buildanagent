/** Seeded randomness for tests. Nothing here reads `Math.random`, so a seed gives the same numbers on every target. */

/** A seeded generator in [0, 1) (mulberry32), for tests that need randomness without `Math.random()`. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
