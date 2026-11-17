// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How the wallpaper slideshow moves, apart from drawing it. It was a
// fixed ten seconds in the order the pictures were added; unset it still is.
// Kept free of imports so it can be tested.

/** The paces they can pick, in seconds. */
export const SLIDESHOW_PACES = [10, 60, 600, 3600] as const;
export type SlideshowPace = (typeof SLIDESHOW_PACES)[number];

/** How long each picture stays. Anything unset or unknown is the ten seconds it always was. */
export function slideshowSecondsOf(value: unknown): SlideshowPace {
  return (SLIDESHOW_PACES as readonly unknown[]).includes(value) ? (value as SlideshowPace) : 10;
}

/** What a pace is called on its chip. */
export function paceLabel(seconds: SlideshowPace): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} hour`;
}

/**
 * The picture after this one. In order it walks the slots and wraps; shuffled
 * it lands on any picture but the one showing, so a change is always a change.
 */
export function nextSlide(index: number, count: number, shuffle: boolean, rand: () => number = Math.random): number {
  if (!(count > 1)) return 0;
  const from = ((index % count) + count) % count;
  if (!shuffle) return (from + 1) % count;
  const step = 1 + Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return (from + step) % count;
}
