// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A sound's loudness becomes a toy line: quiet is off, loud is the top, and
// the line has one level per tenth of a second.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envelopeFromPcm } from './sound-envelope.js';

function tone(seconds: number, amplitude: number, rate = 8000): number[] {
  return Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.round(amplitude * Math.sin(i / 3)));
}

test('silence is off, a loud stretch reaches the top, and a softer one sits between', () => {
  const pcm = Int16Array.from([...tone(1, 30), ...tone(1, 12000), ...tone(1, 4000), ...tone(1, 30)]);
  const line = envelopeFromPcm(pcm);
  assert.equal(line.length, 40, 'one level per tenth of a second');
  assert.ok(line.slice(0, 10).every((l) => l === 0), 'the quiet start is off');
  assert.ok(Math.max(...line.slice(10, 20)) === 20, 'the loud stretch reaches the top');
  const soft = line.slice(21, 29);
  assert.ok(soft.every((l) => l > 0 && l < 20), `the softer stretch sits between: ${soft}`);
  assert.ok(line.slice(31).every((l) => l === 0), 'the quiet end is off');
});

test('a sound with no loud part at all is a flat line of nothing', () => {
  assert.ok(envelopeFromPcm(Int16Array.from(tone(2, 20))).every((l) => l === 0));
  assert.deepEqual(envelopeFromPcm(new Int16Array(0)), []);
});
