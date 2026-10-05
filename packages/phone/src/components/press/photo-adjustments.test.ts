// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPhotoAdjustments,
  normalizePhotoAdjustments,
  photoAdjustmentValue,
  setPhotoAdjustmentValue,
} from './photo-adjustments';

test('normalization drops defaults, duplicate types, and unknown controls', () => {
  const stack = normalizePhotoAdjustments({
    version: 1,
    items: [
      { type: 'contrast', value: 0 },
      { type: 'exposure', value: 250 },
      { type: 'exposure', value: -50 },
      { type: 'unknown', value: 80 },
    ],
  });
  assert.deepEqual(stack, {
    version: 1,
    items: [{ id: 'photo-exposure', type: 'exposure', enabled: true, value: 200 }],
  });
});

test('setting controls keeps canonical order and removes reset values', () => {
  let stack = setPhotoAdjustmentValue(undefined, 'vibrance', 20);
  stack = setPhotoAdjustmentValue(stack, 'exposure', 25);
  assert.deepEqual(stack.items.map((item) => item.type), ['exposure', 'vibrance']);
  stack = setPhotoAdjustmentValue(stack, 'exposure', 0);
  assert.equal(photoAdjustmentValue(stack, 'exposure'), 0);
  assert.deepEqual(stack.items.map((item) => item.type), ['vibrance']);
});

test('the empty recipe leaves pixels untouched', () => {
  const pixels = new Uint8ClampedArray([12, 34, 56, 78, 220, 180, 40, 255]);
  const before = [...pixels];
  applyPhotoAdjustments(pixels, { version: 1, items: [] });
  assert.deepEqual([...pixels], before);
});

test('exposure brightens color without changing alpha', () => {
  const pixels = new Uint8ClampedArray([64, 80, 100, 91]);
  applyPhotoAdjustments(pixels, setPhotoAdjustmentValue(undefined, 'exposure', 100));
  assert.deepEqual([...pixels], [128, 160, 200, 91]);
});

test('temperature moves red and blue in opposite directions', () => {
  const pixels = new Uint8ClampedArray([120, 120, 120, 255]);
  applyPhotoAdjustments(pixels, setPhotoAdjustmentValue(undefined, 'temperature', 100));
  assert.ok(pixels[0] > pixels[1]);
  assert.ok(pixels[1] > pixels[2]);
});

test('black and white reaches equal channels and preserves transparency', () => {
  const pixels = new Uint8ClampedArray([200, 80, 20, 37]);
  applyPhotoAdjustments(pixels, setPhotoAdjustmentValue(undefined, 'black-white', 100));
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[1], pixels[2]);
  assert.equal(pixels[3], 37);
});
