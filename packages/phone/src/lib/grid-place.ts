// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The grid the home screen's widgets and the lock screen's pieces both sit on
// (theirs, Nov 8 2026: the lock screen goes on the grid too, so the two never
// disagree). Four columns; rows count up from the bottom edge, in whatever
// unit the caller draws them (the home screen and the lock screen both use
// thirds of a widget row). Kept free of imports so it can be tested alone.

export const GRID_COLS = 4;

/** A piece's place: its left column and its bottom row, row 0 at the bottom. */
export interface GridSpot {
  col: number;
  row: number;
}

export interface GridSize {
  cols: number;
  rows: number;
}

export class Cells {
  private taken = new Set<string>();
  constructor(private readonly width = GRID_COLS) {}
  fits(col: number, row: number, cols: number, rows: number): boolean {
    if (col < 0 || row < 0 || col + cols > this.width) return false;
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) if (this.taken.has(`${c},${r}`)) return false;
    return true;
  }
  take(col: number, row: number, cols: number, rows: number) {
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) this.taken.add(`${c},${r}`);
  }
}

/** The open place nearest to a spot, counted in cells; ties go to the lower
 *  row, then the left. Searches up to rowLimit rows and past it if it must. */
export function nearestOpen(cells: Cells, cols: number, rows: number, near: GridSpot, rowLimit: number, width = GRID_COLS): GridSpot {
  let best: GridSpot | null = null;
  let bestD = Infinity;
  for (let limit = Math.max(rowLimit, rows); ; limit += 4) {
    for (let r = 0; r + rows <= limit; r++) {
      for (let c = 0; c + cols <= width; c++) {
        if (!cells.fits(c, r, cols, rows)) continue;
        const d = Math.abs(c - near.col) + Math.abs(r - near.row);
        if (d < bestD || (d === bestD && best && (r < best.row || (r === best.row && c < best.col)))) { best = { col: c, row: r }; bestD = d; }
      }
    }
    if (best) return best;
  }
}

/** Every piece in `order` with a place, none overlapping: a saved place is
 *  kept when it fits; anything without one, or whose place is taken, goes to
 *  the open place nearest where it wanted to be (its saved place, else the
 *  `fallback` for it, else the bottom left). Earlier in `order` wins a cell. */
export function keepPlaces<K extends string>(
  order: readonly K[],
  saved: Partial<Record<K, GridSpot>>,
  sizeOf: (id: K) => GridSize,
  rowLimit: number,
  fallback: (id: K) => GridSpot = () => ({ col: 0, row: 0 }),
  width = GRID_COLS,
): Record<K, GridSpot> {
  const cells = new Cells(width);
  const out: Partial<Record<K, GridSpot>> = {};
  for (const id of order) {
    const s = saved[id];
    const { cols, rows } = sizeOf(id);
    if (s && cells.fits(s.col, s.row, cols, rows)) { cells.take(s.col, s.row, cols, rows); out[id] = s; }
  }
  for (const id of order) {
    if (out[id]) continue;
    const { cols, rows } = sizeOf(id);
    const want = saved[id] ?? fallback(id);
    const s = nearestOpen(cells, cols, rows, want, rowLimit, width);
    cells.take(s.col, s.row, cols, rows);
    out[id] = s;
  }
  return out as Record<K, GridSpot>;
}

/** How many rows tall the pieces stand. */
export function gridHeight<K extends string>(layout: Partial<Record<K, GridSpot>>, sizeOf: (id: K) => GridSize): number {
  let h = 0;
  for (const [id, s] of Object.entries(layout) as [K, GridSpot][]) h = Math.max(h, s.row + sizeOf(id).rows);
  return h;
}

/** The places after they drops a piece at a spot: it stays exactly there
 *  (kept inside the columns and under rowLimit), everything it doesn't cover
 *  stays put, and anything it does cover moves to the open place nearest
 *  where it was. A drop that only clips a neighbor by less than `snapRows`
 *  was meant to sit against it (theirs, Nov 8 2026: dropping things down to the
 *  Record kept kicking it up to the top), so it snaps flush instead. */
export function placeOnGrid<K extends string>(
  layout: Record<K, GridSpot>,
  order: readonly K[],
  id: K,
  to: GridSpot,
  rowLimit: number,
  sizeOf: (id: K) => GridSize,
  snapRows = 3,
  width = GRID_COLS,
): Record<K, GridSpot> {
  const { cols, rows } = sizeOf(id);
  const target = {
    col: Math.min(width - cols, Math.max(0, Math.round(to.col))),
    row: Math.max(0, Math.min(Math.max(0, rowLimit - rows), Math.round(to.row))),
  };
  const clear = (row: number) => {
    const c = new Cells(width);
    for (const other of order) {
      if (other === id || !layout[other]) continue;
      const o = layout[other];
      const size = sizeOf(other);
      c.take(o.col, o.row, size.cols, size.rows);
    }
    return row >= 0 && row + rows <= Math.max(rowLimit, rows) && c.fits(target.col, row, cols, rows);
  };
  if (!clear(target.row)) {
    for (let d = 1; d < snapRows; d++) {
      if (clear(target.row + d)) { target.row += d; break; }
      if (clear(target.row - d)) { target.row -= d; break; }
    }
  }
  const cells = new Cells(width);
  cells.take(target.col, target.row, cols, rows);
  const out: Partial<Record<K, GridSpot>> = { [id]: target } as Partial<Record<K, GridSpot>>;
  const moved: K[] = [];
  for (const other of order) {
    if (other === id || !layout[other]) continue;
    const s = layout[other];
    const size = sizeOf(other);
    if (cells.fits(s.col, s.row, size.cols, size.rows)) { cells.take(s.col, s.row, size.cols, size.rows); out[other] = s; } else moved.push(other);
  }
  for (const other of moved) {
    const size = sizeOf(other);
    const s = nearestOpen(cells, size.cols, size.rows, layout[other], rowLimit, width);
    cells.take(s.col, s.row, size.cols, size.rows);
    out[other] = s;
  }
  return out as Record<K, GridSpot>;
}
