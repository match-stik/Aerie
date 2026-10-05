// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Antigravity reports percent REMAINING; the Claude and Codex cards above it
 * report percent USED. Two bars side by side meaning opposite things is worse
 * than no bar at all, so the conversion happens at the glass — the endpoint
 * stays faithful to what `agy --print /usage` actually printed.
 *
 * ONE COPY ON PURPOSE. This started as arithmetic inline in the component with
 * a second copy in its test, and they disagreed: 100 - 99.97 is
 * 0.030000000000001137, so the component rounded and the test did not.
 */
export function usedFromRemaining(remainingPercent: number): number {
  const used = Math.max(0, Math.min(100, 100 - remainingPercent));
  return Math.round(used * 100) / 100;
}
