// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { clampPillPoint, parsePillPoint, samePillBox, PILL_MARGIN } from './pill-position.js';

// A phone-sized screen with a status bar and a gesture bar, and the pill as
// it measures while a companion is playing.
const box = { width: 180, height: 40, viewportWidth: 412, viewportHeight: 915, insetTop: 32, insetBottom: 24 };

test('a point in the open stays where the owner put it', () => {
  assert.deepEqual(clampPillPoint({ x: 200, y: 500 }, box), { x: 200, y: 500 });
});

test('dragged past the right edge, the whole pill stays on the glass', () => {
  const { x } = clampPillPoint({ x: 460, y: 500 }, box);
  assert.equal(x + box.width / 2, box.viewportWidth - PILL_MARGIN);
});

test('dragged past the left edge, the whole pill stays on the glass', () => {
  const { x } = clampPillPoint({ x: -40, y: 500 }, box);
  assert.equal(x - box.width / 2, PILL_MARGIN);
});

test('dragged up under the status bar, it stops below it', () => {
  assert.equal(clampPillPoint({ x: 200, y: 0 }, box).y, box.insetTop + PILL_MARGIN);
});

test('dragged down into the gesture bar, it stops above it', () => {
  const { y } = clampPillPoint({ x: 200, y: 2000 }, box);
  assert.equal(y + box.height, box.viewportHeight - box.insetBottom - PILL_MARGIN);
});

test('a pill that grows near an edge is pulled back in rather than cut off', () => {
  // Parked against the right edge while it was narrow, then it widens when
  // nothing is playing and it shows Take it back instead.
  const parked = clampPillPoint({ x: 1000, y: 500 }, box);
  const wider = { ...box, width: 280 };
  const { x } = clampPillPoint(parked, wider);
  assert.equal(x + wider.width / 2, wider.viewportWidth - PILL_MARGIN);
});

test('a pill wider than the screen sits in the middle', () => {
  assert.equal(clampPillPoint({ x: 10, y: 500 }, { ...box, width: 500 }).x, box.viewportWidth / 2);
});

test('a saved point comes back, and anything that is not one is ignored', () => {
  assert.deepEqual(parsePillPoint('{"x":120,"y":340}'), { x: 120, y: 340 });
  assert.equal(parsePillPoint(null), null);
  assert.equal(parsePillPoint('not json'), null);
  assert.equal(parsePillPoint('null'), null);
  assert.equal(parsePillPoint('{"x":"120","y":340}'), null);
  assert.equal(parsePillPoint('{"x":120}'), null);
});

test('two measurements of the same pill on the same screen are the same box', () => {
  assert.equal(samePillBox(box, { ...box }), true);
  assert.equal(samePillBox(box, { ...box, width: 181 }), false);
  assert.equal(samePillBox(null, null), true);
  assert.equal(samePillBox(box, null), false);
});
