// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextThumbnailStale } from './press.js';

test('a changed scene with no picture leaves the shelf picture stale', () => {
  assert.equal(nextThumbnailStale({ previous: 0, pictureSent: false, sceneChanged: true }), 1);
});

test('a picture arriving clears it, even alongside a scene change', () => {
  assert.equal(nextThumbnailStale({ previous: 1, pictureSent: false, sceneChanged: false }), 1);
  assert.equal(nextThumbnailStale({ previous: 1, pictureSent: true, sceneChanged: false }), 0);
  assert.equal(nextThumbnailStale({ previous: 0, pictureSent: true, sceneChanged: true }), 0);
});

test('a title-only change keeps whatever it was', () => {
  assert.equal(nextThumbnailStale({ previous: 0, pictureSent: false, sceneChanged: false }), 0);
});
