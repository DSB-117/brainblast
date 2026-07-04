export function wrapIndex(i: number, n: number): number {
  // VULNERABLE: JS `%` is a REMAINDER, not a modulo — it returns a NEGATIVE result
  // for negative i (e.g. -1 % 5 === -1). Used as an array/ring-buffer index this
  // reads out of bounds (undefined) or off the wrong end.
  return i % n;
}
