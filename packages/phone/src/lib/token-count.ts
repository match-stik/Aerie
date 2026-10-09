// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * A token count in the largest unit that keeps it short, for the Usage cards.
 * Billions and trillions are here because a running total over months gets
 * there, and a card reading 59292.64M is hard to take in at a glance.
 */
const UNITS: ReadonlyArray<readonly [size: number, unit: string, digits: number]> = [
  [1e12, 'T', 2],
  [1e9, 'B', 2],
  [1e6, 'M', 2],
  [1e3, 'K', 1],
];

export function tokenCount(n: number): string {
  for (let i = 0; i < UNITS.length; i++) {
    const [size, unit, digits] = UNITS[i];
    if (n < size) continue;
    const shown = (n / size).toFixed(digits);
    // 999,999,999 rounds to 1000.00M, which the next unit up says better.
    if (Number(shown) >= 1000 && i > 0) {
      const [biggerSize, biggerUnit, biggerDigits] = UNITS[i - 1];
      return (n / biggerSize).toFixed(biggerDigits) + biggerUnit;
    }
    return shown + unit;
  }
  return String(n);
}
