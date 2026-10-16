// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Where the owner's toy stop sits once they have dragged it somewhere.
 *
 * The pill changes width with what it is showing (a name and a bar per motor
 * while a companion plays, a sentence and Take it back while nothing does), so
 * the point kept is the pill's top centre rather than its corner: a pill that
 * grows or shrinks does it around where the owner put it instead of creeping
 * sideways. Every point is clamped so the whole pill stays on the glass and
 * clear of the status bar and the gesture bar, because the stop must never be
 * parked anywhere the owner cannot reach it.
 */
export interface PillPoint {
  /** The pill's horizontal centre, in CSS pixels from the left of the screen. */
  x: number;
  /** The pill's top edge, in CSS pixels from the top of the screen. */
  y: number;
}

export interface PillBox {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  /** The status bar's height, read off the safe area. */
  insetTop: number;
  /** The gesture bar's height, read off the safe area. */
  insetBottom: number;
}

/** Breathing room kept between the pill and every edge. */
export const PILL_MARGIN = 8;

export function clampPillPoint(point: PillPoint, box: PillBox): PillPoint {
  const half = box.width / 2;
  const minX = half + PILL_MARGIN;
  const maxX = box.viewportWidth - half - PILL_MARGIN;
  const minY = box.insetTop + PILL_MARGIN;
  const maxY = box.viewportHeight - box.insetBottom - box.height - PILL_MARGIN;
  return {
    // A pill wider than the screen sits in the middle rather than hanging off
    // one side of it.
    x: maxX < minX ? box.viewportWidth / 2 : Math.min(Math.max(point.x, minX), maxX),
    y: maxY < minY ? minY : Math.min(Math.max(point.y, minY), maxY),
  };
}

export function samePillBox(a: PillBox | null, b: PillBox | null): boolean {
  if (!a || !b) return a === b;
  return a.width === b.width
    && a.height === b.height
    && a.viewportWidth === b.viewportWidth
    && a.viewportHeight === b.viewportHeight
    && a.insetTop === b.insetTop
    && a.insetBottom === b.insetBottom;
}

/** A saved point, or null for anything that is not one. */
export function parsePillPoint(raw: string | null): PillPoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PillPoint> | null;
    if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}
