/**
 * "Auto-Distribute" for a split whose lines don't add up to its total: what's unassigned
 * (`remaining`, signed minor units) is spread over the lines in
 * proportion to their amounts. Every line but the first gets its share rounded to the minor unit
 * half up (signed: -2.5 → -2, 2.5 → 3), and the first takes what's left, so nothing is lost.
 * Lines at zero are skipped; when every line is zero the total is spread evenly over all of them.
 *
 * Not `allocate()`: the results differ from the largest-remainder method (-0.03 over lines of
 * 0.01, 0.01 and 0.03 gives 0.00, 0.01, 0.02 more, where largest remainder gives 0.01, 0.00,
 * 0.02).
 *
 * Returns what to add to each line, or null when the lines cancel out (their sum is zero but they
 * aren't all zero) and there's no proportion to follow.
 */
export function distributeSplit(remaining: bigint, lines: readonly bigint[]): bigint[] | null {
  if (lines.length === 0) return null;
  const allZero = lines.every((line) => line === 0n);
  const weights = lines.map((line) => (allZero ? 1n : line));
  const total = weights.reduce((sum, w) => sum + w, 0n);
  if (total === 0n) return null;
  const active = weights.flatMap((w, index) => (w === 0n ? [] : [index]));
  const added = lines.map(() => 0n);
  const [first, ...rest] = active;
  if (first === undefined) return null;
  let given = 0n;
  for (const index of rest) {
    const share = roundHalfUp(remaining * (weights[index] ?? 0n), total);
    added[index] = share;
    given += share;
  }
  added[first] = remaining - given;
  return added;
}

/** `numerator / denominator` rounded to the nearest integer, halves toward +∞ (Math.round). */
function roundHalfUp(numerator: bigint, denominator: bigint) {
  const [n, d] = denominator < 0n ? [-numerator, -denominator] : [numerator, denominator];
  return floorDiv(2n * n + d, 2n * d);
}

function floorDiv(n: bigint, d: bigint) {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
}
