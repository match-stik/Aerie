// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their strength per motor scales every level, keeps a pattern's shape and
// never turns a moving motor off; their own patterns count and their forgetting
// a toy are kept.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToySettings, scaleLevel } from './toy-settings';

function mem(initial: string | null = null) {
  let text = initial;
  return { read: () => text, write: (t: string) => { text = t; }, peek: () => text };
}

test('full strength changes nothing, and half strength halves every level without turning one off', () => {
  assert.equal(scaleLevel(14, undefined), 14);
  assert.equal(scaleLevel(14, 20), 14);
  assert.equal(scaleLevel(20, 10), 10);
  assert.equal(scaleLevel(10, 10), 5);
  assert.equal(scaleLevel(1, 4), 1, 'a motor that was moving keeps moving');
  assert.equal(scaleLevel(0, 4), 0, 'off stays off');
});

test('strength is per toy and per motor, and only motion is scaled', () => {
  const s = createToySettings(mem());
  s.setStrength('flexer', 'FLEXER_FINGER', 10);
  assert.equal(s.scale('flexer', 'FLEXER_FINGER', 20), 10);
  assert.equal(s.scale('flexer', 'FLEXER_VIBRATE', 20), 20, 'the other motor is untouched');
  assert.equal(s.scale('fizz', 'FLEXER_FINGER', 20), 20, 'another toy is untouched');
  assert.equal(s.scale('flexer', 'PRESET', 3), 3, 'a pattern number is never scaled');
});

test('settings survive the app starting again, and full strength is not kept as a setting', () => {
  const store = mem();
  const a = createToySettings(store);
  a.setStrength('flexer', 'FLEXER_FINGER', 12);
  a.setPresets('flexer', 6);
  a.forget('gemini');
  const b = createToySettings(store);
  assert.equal(b.scale('flexer', 'FLEXER_FINGER', 20), 12);
  assert.equal(b.get('flexer').presets, 6);
  assert.equal(b.forgotten('gemini'), true);
  b.setStrength('flexer', 'FLEXER_FINGER', 20);
  assert.deepEqual(b.get('flexer').strength, {});
});

test('a forgotten toy comes back when remembered, and a broken record starts clean', () => {
  const s = createToySettings(mem('{not json'));
  assert.equal(s.forgotten('x'), false);
  s.forget('x');
  assert.equal(s.forgotten('x'), true);
  s.remember('x');
  assert.equal(s.forgotten('x'), false);
});

test('their own patterns count is held between none and ten', () => {
  const s = createToySettings(mem());
  s.setPresets('t', 14);
  assert.equal(s.get('t').presets, 10);
  s.setPresets('t', null);
  assert.equal(s.get('t').presets, undefined);
});
