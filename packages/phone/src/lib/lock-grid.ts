// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Where each piece of the lock screen sits (theirs, Nov 8 2026: 'I think the
// grid'). Before this the clock and the weather moved freely, the cards at the
// bottom never moved, and the Spotify card slid up out of the way of anything
// it touched, which read as being shoved. Now every piece sits on the same
// four-column grid as the home screen (lib/grid-place.ts), rows in thirds
// counted up from just above the swipe line, and takes as many cells as it
// actually draws. A drop that clips a neighbor snaps flush against it; a real
// overlap moves the other piece to the nearest open place; nothing slides.
// Places are cells, not pixels, so the same layout fits any screen.
// Across, a piece moves in QUARTER columns (theirs, Nov 8 2026: the weather line
// would not sit exactly in the middle): a one-column piece on a four-column
// grid has no middle column to sit in. A piece is sized in half columns and
// moved in quarters, so whatever its width there is a step that puts it dead
// center. Up and down works the same way (theirs, Nov 8 2026: pieces that
// looked like they'd stack were pushing each other apart, because a one-line
// weather piece held a whole row it never drew in, gap and all): rows step in
// quarters, and the gap between two pieces is part of the space each one
// takes, so a piece holds at most a quarter row more than it draws. Places
// save in columns and rows that may end in .25, .5 or .75; places saved
// before this (whole ones) read back the same.

import { GRID_COLS, type GridSize, type GridSpot } from './grid-place.js';

export type LockGridPiece = 'clock' | 'weather' | 'messages' | 'note' | 'spotify';
/** In the order they claim cells when two want the same ones. */
export const LOCK_GRID_PIECES: readonly LockGridPiece[] = ['messages', 'note', 'spotify', 'clock', 'weather'];

/** The same spacing as the home screen's grid (components/HomeWidgets.tsx). */
export const LOCK_GAP_PX = 12;
export const LOCK_ROW_PX = (76 - LOCK_GAP_PX * 2) / 3;
/** How far one quarter-row step moves a piece up or down. */
export const LOCK_ROW_STEP_PX = (LOCK_ROW_PX + LOCK_GAP_PX) / 4;
/** Quarter columns across: everything inside the lock grid counts in these. */
export const LOCK_STEPS = GRID_COLS * 4;

/** How far one quarter step moves a piece across, for a column this wide. */
export function lockStepPx(colW: number): number {
  return (colW + LOCK_GAP_PX) / 4;
}

/** How wide `steps` quarter steps are, gaps between them included. */
export function lockSpanPx(steps: number, colW: number): number {
  return steps * lockStepPx(colW) - LOCK_GAP_PX;
}

/** A saved place (columns and rows, maybe in quarters) as the grid counts it (quarter steps), and back. */
export const toSteps = (s: GridSpot): GridSpot => ({ col: Math.round(s.col * 4), row: Math.round(s.row * 4) });
export const fromSteps = (s: GridSpot): GridSpot => ({ col: s.col / 4, row: s.row / 4 });

/** The places they saved, read back carefully: anything malformed is no place. */
export function lockSpotsOf(value: unknown): Partial<Record<LockGridPiece, GridSpot>> {
  const out: Partial<Record<LockGridPiece, GridSpot>> = {};
  if (!value || typeof value !== 'object') return out;
  for (const id of LOCK_GRID_PIECES) {
    const s = (value as Record<string, unknown>)[id] as { col?: unknown; row?: unknown } | undefined;
    if (!s || typeof s !== 'object') continue;
    if (typeof s.col !== 'number' || !Number.isInteger(s.col * 4) || typeof s.row !== 'number' || !Number.isInteger(s.row * 4)) continue;
    const col = s.col as number;
    const row = s.row as number;
    if (col < 0 || col >= GRID_COLS || row < 0 || row > 200) continue;
    out[id] = { col, row };
  }
  return out;
}

/** How many cells a piece takes for the box it draws: enough half columns
 *  across (counted as quarter steps, always an even number of them, which is
 *  what lets any piece center) and rows up to hold it, at least one of each,
 *  never wider than the grid. */
export function cellsFor(width: number, height: number, colW: number): GridSize {
  const halves = Math.min(GRID_COLS * 2, Math.max(1, Math.ceil((width + LOCK_GAP_PX - 0.5) / (2 * lockStepPx(colW)))));
  const cols = halves * 2;
  const rows = Math.max(1, Math.ceil((height + LOCK_GAP_PX - 0.5) / LOCK_ROW_STEP_PX));
  return { cols, rows };
}

/** Where a placed piece draws inside its cells: centered across them (a card
 *  as wide as the grid just fills them) and standing on their bottom edge. */
export function drawnLeft(spot: GridSpot, size: GridSize, width: number, colW: number): number {
  return spot.col * lockStepPx(colW) + Math.max(0, (lockSpanPx(size.cols, colW) - width) / 2);
}

/** The cell (in quarter steps) a piece lands in when the box it draws, `width`
 *  by `height`, has its top-left corner at (left, top) measured from the
 *  grid's top-left, on a grid `height` tall: the inverse of where it draws,
 *  so a piece let go of lands where it was seen. */
export function spotForBox(left: number, top: number, box: GridSize, width: number, height: number, colW: number, gridH: number): GridSpot {
  const inset = Math.max(0, (lockSpanPx(box.cols, colW) - width) / 2);
  return {
    col: Math.round((left - inset) / lockStepPx(colW)),
    row: Math.round((gridH - (top + height)) / LOCK_ROW_STEP_PX),
  };
}

/** How many quarter-row steps fit in a grid this tall. */
export function rowsIn(height: number): number {
  return Math.max(1, Math.floor((height + LOCK_GAP_PX) / LOCK_ROW_STEP_PX));
}

/** Where a piece goes before they have put it anywhere, close to where the lock
 *  screen always drew it: the cards stacked up from the bottom, the clock at
 *  the top (or just above the cards for the dateline face), the weather in
 *  the top right. */
/* Counted in quarter steps, like everything else inside the grid. */
export function defaultLockSpot(id: LockGridPiece, size: GridSize, maxRows: number, face: string): GridSpot {
  const top = Math.max(0, maxRows - size.rows);
  if (id === 'clock') return { col: Math.floor((LOCK_STEPS - size.cols) / 2), row: face === 'dateline' ? 48 : top };
  if (id === 'weather') return { col: LOCK_STEPS - size.cols, row: top };
  return { col: 0, row: 0 };
}
