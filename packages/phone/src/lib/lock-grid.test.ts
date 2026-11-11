// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepPlaces, placeOnGrid } from './grid-place.js';
import { cellsFor, defaultLockSpot, drawnLeft, fromSteps, lockSpotsOf, LOCK_GRID_PIECES, LOCK_STEPS, rowsIn, spotForBox, toSteps, type LockGridPiece } from './lock-grid.js';

const colW = 80; // a 380-wide grid: four columns of 80 and three gaps of 12... close enough to their phone

test('a piece takes the cells its box needs, and saved places are read carefully', () => {
  // Across counts in quarter columns, sixteen on four columns; a piece is a
  // whole number of half columns, so always an even count.
  // Rows step in quarters too, the gap to the next piece included, so a
  // one-line piece holds barely more than it draws.
  assert.deepEqual(cellsFor(347, 60, colW), { cols: 16, rows: 10 });
  assert.deepEqual(cellsFor(70, 30, colW), { cols: 4, rows: 6 });
  assert.deepEqual(cellsFor(30, 30, colW), { cols: 2, rows: 6 });
  assert.deepEqual(cellsFor(120, 16, colW), { cols: 6, rows: 4 });
  assert.deepEqual(cellsFor(170, 160, colW), { cols: 8, rows: 24 });
  // A saved place may sit on a quarter column; anything else malformed is no place.
  assert.deepEqual(
    lockSpotsOf({ clock: { col: 1, row: 20 }, weather: { col: 1.25, row: 1.75 }, note: { col: 1.1, row: 0 }, spotify: { col: 'x', row: 1 }, messages: { col: 0, row: 0.3 }, nonsense: { col: 0, row: 0 } }),
    { clock: { col: 1, row: 20 }, weather: { col: 1.25, row: 1.75 } },
  );
  assert.deepEqual(toSteps({ col: 1.25, row: 4.5 }), { col: 5, row: 18 });
  assert.deepEqual(fromSteps({ col: 5, row: 18 }), { col: 1.25, row: 4.5 });
  assert.equal(rowsIn(600), 83);
});

test('nothing on the lock screen shoves anything: a clipping drop sits flush, and only a real overlap moves the other piece', () => {
  const sizes: Record<LockGridPiece, { cols: number; rows: number }> = {
    messages: { cols: 16, rows: 12 }, note: { cols: 16, rows: 12 }, spotify: { cols: 16, rows: 12 }, clock: { cols: 8, rows: 24 }, weather: { cols: 6, rows: 4 },
  };
  const sizeOf = (id: LockGridPiece) => sizes[id];
  const maxRows = 120;
  const start = keepPlaces(LOCK_GRID_PIECES, {}, sizeOf, maxRows, (id) => defaultLockSpot(id, sizes[id], maxRows, 'classic'), LOCK_STEPS);
  // The cards stack up from the bottom, the clock sits at the top, the weather top right.
  assert.deepEqual([start.messages, start.note, start.spotify], [{ col: 0, row: 0 }, { col: 0, row: 12 }, { col: 0, row: 24 }]);
  assert.deepEqual(start.clock, { col: 4, row: 96 });
  assert.equal(start.weather.col, 10);
  // The clock dropped a row into the Spotify card snaps flush on top of it; Spotify stays.
  const flush = placeOnGrid(start, LOCK_GRID_PIECES, 'clock', { col: 4, row: 33 }, maxRows, sizeOf, 12, LOCK_STEPS);
  assert.deepEqual(flush.clock, { col: 4, row: 36 });
  assert.deepEqual(flush.spotify, { col: 0, row: 24 });
  // The clock set down right on top of the one-line weather stacks on it; neither moves.
  const w = placeOnGrid(start, LOCK_GRID_PIECES, 'weather', { col: 5, row: 60 }, maxRows, sizeOf, 12, LOCK_STEPS);
  const stack = placeOnGrid(w, LOCK_GRID_PIECES, 'clock', { col: 4, row: 64 }, maxRows, sizeOf, 12, LOCK_STEPS);
  assert.deepEqual([stack.weather, stack.clock], [{ col: 5, row: 60 }, { col: 4, row: 64 }]);
  // The weather line, three half columns wide (about the width theirs measured), sits dead center five quarter steps in.
  const mid = placeOnGrid(start, LOCK_GRID_PIECES, 'weather', { col: 5, row: 80 }, maxRows, sizeOf, 12, LOCK_STEPS);
  assert.deepEqual(mid.weather, { col: 5, row: 80 });
  const gridW = 4 * colW + 3 * 12;
  assert.equal(drawnLeft(mid.weather, sizes.weather, 120, colW) + 120 / 2, gridW / 2);
  // Every width there is has a centered step.
  for (let halves = 1; halves <= 8; halves++) {
    const size = { cols: halves * 2, rows: 1 };
    const w = halves * (colW + 12) / 2 - 12 - 3;
    assert.equal(drawnLeft({ col: (LOCK_STEPS - size.cols) / 2, row: 0 }, size, w, colW) + w / 2, gridW / 2);
  }
});

test('a piece let go of lands where it was seen: the outline and the drop are the same box', () => {
  // A full-width card 76 tall whose bottom sits on the grid's bottom lands on row 0.
  const card = { cols: 16, rows: 3 };
  assert.deepEqual(spotForBox(0, 600 - 76, card, 4 * colW + 36, 76, colW, 600), { col: 0, row: 0 });
  // A narrow piece drawn at a spot reads back as that same spot, at every half step.
  const weather = { cols: 4, rows: 6 };
  for (let col = 0; col <= LOCK_STEPS - weather.cols; col++) {
    const left = drawnLeft({ col, row: 5 }, weather, 60, colW);
    const top = 600 - 5 * (((76 - 24) / 3 + 12) / 4) - 30;
    assert.deepEqual(spotForBox(left, top, weather, 60, 30, colW, 600), { col, row: 5 });
  }
});
