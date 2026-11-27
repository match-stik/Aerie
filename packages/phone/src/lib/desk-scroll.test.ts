// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyScrollDelta } from './desk-scroll.js';

test('the arrows move a list a step, and Page moves it most of a screen', () => {
  assert.equal(keyScrollDelta('ArrowDown', 500, 2000, 0), 48);
  assert.equal(keyScrollDelta('ArrowUp', 500, 2000, 300), -48);
  assert.equal(keyScrollDelta('PageDown', 500, 2000, 0), 450);
  assert.equal(keyScrollDelta('PageUp', 500, 2000, 900), -450);
});

test('Home and End go all the way, from wherever the list is', () => {
  assert.equal(keyScrollDelta('Home', 500, 2000, 700), -700);
  assert.equal(keyScrollDelta('End', 500, 2000, 700), 800);
});

test('a key that is not a scrolling key is left alone', () => {
  assert.equal(keyScrollDelta('a', 500, 2000, 0), null);
  assert.equal(keyScrollDelta(' ', 500, 2000, 0), null);
  assert.equal(keyScrollDelta('Enter', 500, 2000, 0), null);
});

test('a baby arrow shows only at an end that has more', async () => {
  const { arrowEnds } = await import('./desk-scroll.js');
  assert.deepEqual(arrowEnds(0, 500, 2000), { up: false, down: true });
  assert.deepEqual(arrowEnds(700, 500, 2000), { up: true, down: true });
  assert.deepEqual(arrowEnds(1500, 500, 2000), { up: true, down: false });
  assert.deepEqual(arrowEnds(0, 500, 500), { up: false, down: false });
});

test('an arrow sits in the padding when there is room, else just outside the edge', async () => {
  const { arrowLeft } = await import('./desk-scroll.js');
  assert.equal(arrowLeft(500, 16, 1366), 486);
  assert.equal(arrowLeft(500, 0, 520), 502);
  assert.equal(arrowLeft(500, 0, 500), 486);
  assert.equal(arrowLeft(500, 0, 510), 486);
});

test('a click on an arrow moves a list a few lines, not a screen', async () => {
  const { arrowStep } = await import('./desk-scroll.js');
  assert.equal(arrowStep(800), 160);
  assert.equal(arrowStep(300), 90);
  assert.equal(arrowStep(100), 48);
});
