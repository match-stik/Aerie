// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SLIDESHOW_PACES, nextSlide, paceLabel, slideshowSecondsOf } from './slideshow';

test('an unset pace is the ten seconds it always was, and so is anything unknown', () => {
  assert.equal(slideshowSecondsOf(undefined), 10);
  assert.equal(slideshowSecondsOf(45), 10);
  assert.equal(slideshowSecondsOf('60'), 10);
  for (const pace of SLIDESHOW_PACES) assert.equal(slideshowSecondsOf(pace), pace);
});

test('each pace reads the way it is said', () => {
  assert.deepEqual(SLIDESHOW_PACES.map(paceLabel), ['10 sec', '1 min', '10 min', '1 hour']);
});

test('in order it walks the slots and wraps, as it always did', () => {
  assert.equal(nextSlide(0, 3, false), 1);
  assert.equal(nextSlide(2, 3, false), 0);
  // A picture taken out from under the index still lands inside the set.
  assert.equal(nextSlide(7, 3, false), 2);
});

test('one picture, or none, never moves', () => {
  assert.equal(nextSlide(0, 1, true), 0);
  assert.equal(nextSlide(4, 0, false), 0);
});

test('shuffled it is never the picture already showing, wherever the dice land', () => {
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999999, 1]) {
    for (let from = 0; from < 5; from++) {
      const to = nextSlide(from, 5, true, () => roll);
      assert.notEqual(to, from);
      assert.ok(to >= 0 && to < 5);
    }
  }
  // Two pictures shuffled can only trade places.
  assert.equal(nextSlide(0, 2, true, () => 0.9), 1);
});
