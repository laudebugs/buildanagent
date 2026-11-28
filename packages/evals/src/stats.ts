/** The two estimators a report uses: the Wilson score interval and the unbiased pass^k of one task. */

/** The 97.5th percentile of the standard normal distribution, for a two-sided 95% interval. */
const Z_95 = 1.959963984540054;

/** A confidence interval on a proportion, both ends between 0 and 1. */
export interface Interval {
  /** The lower end. */
  readonly lower: number;
  /** The upper end. */
  readonly upper: number;
}

/**
 * The 95% Wilson score interval for `successes` out of `trials`, which needs `trials > 0`. With p̂ = s/n and
 * z = 1.96: centre = (p̂ + z²/2n) / (1 + z²/n) and half-width = z·√(p̂(1−p̂)/n + z²/4n²) / (1 + z²/n). Unlike the
 * normal approximation, it stays inside [0, 1] and keeps a width at 0 or n successes.
 */
export function wilson(successes: number, trials: number): Interval {
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * The unbiased estimate of pass^k, the chance that k trials drawn without replacement from a task's n graded
 * trials all pass, given c of them passed: C(c, k) / C(n, k), which needs n ≥ k. It is the product of
 * (c − i) / (n − i) for i from 0 to k − 1, which avoids the large binomials, and it is 0 as soon as c < k.
 */
export function passHatK(n: number, c: number, k: number): number {
  let estimate = 1;
  for (let i = 0; i < k; i++) estimate *= (c - i) / (n - i);
  return Math.max(0, estimate);
}
