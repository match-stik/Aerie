// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock, patternLength, previewPoints, stepsFromChanges, stitchTracks } from './toy-patterns';

test('a held level becomes one step, and the length is kept whole', () => {
  assert.deepEqual(stepsFromChanges([{ at: 0, level: 8 }], 0, 1000), [[8, 1000]]);
  assert.deepEqual(stepsFromChanges([], 5, 1100), [[5, 1100]]);
});

test('a fast drag through many numbers lands on the grid instead of a step per number', () => {
  // 0 to 20 in 400 ms, a number every 20 ms, then held at 20.
  const changes = Array.from({ length: 21 }, (_, i) => ({ at: i * 20, level: i }));
  const steps = stepsFromChanges(changes, 0, 2000);
  assert.ok(steps.every(([, ms]) => ms >= 200), JSON.stringify(steps));
  assert.equal(steps.reduce((s, [, ms]) => s + ms, 0), 2000);
  assert.equal(steps[steps.length - 1][0], 20);
  assert.ok(steps.length <= 3, JSON.stringify(steps));
});

test('a pulse tapped out by hand comes back as the same pulse', () => {
  const changes = [
    { at: 0, level: 12 }, { at: 1000, level: 0 },
    { at: 2000, level: 12 }, { at: 3000, level: 0 },
  ];
  assert.deepEqual(stepsFromChanges(changes, 0, 4000), [[12, 1000], [0, 1000], [12, 1000], [0, 1000]]);
});

test('two minutes of fiddling never passes the most steps one track takes', () => {
  const changes = Array.from({ length: 6000 }, (_, i) => ({ at: i * 20, level: i % 21 }));
  const steps = stepsFromChanges(changes, 0, 120_000);
  assert.ok(steps.length <= 600, String(steps.length));
});

test('too short to keep is nothing', () => {
  assert.deepEqual(stepsFromChanges([{ at: 0, level: 9 }], 0, 150), []);
});

test('length, preview and clock', () => {
  assert.equal(patternLength({ motor1: [[5, 1000], [0, 500]], motor2: [[3, 2000]] }), 2000);
  assert.equal(previewPoints([[20, 1000], [0, 1000]], 2000, 100, 22), '0.0,1.0 50.0,1.0 50.0,21.0 100.0,21.0');
  assert.equal(clock(65_000), '1:05');
  assert.equal(clock(8_000), '0:08');
});

test('stitched patterns play one after another, each keeping its own length on every motor', () => {
  const a = { tracks: { motor1: [[8, 1000], [12, 1000]] as [number, number][], motor2: [[4, 500]] as [number, number][] } };
  const b = { tracks: { motor1: [[12, 600], [3, 400]] as [number, number][] } };
  const joined = stitchTracks([a, b]);
  // motor1: a's two steps, b's first step joins a's last (both 12), then b's last.
  assert.deepEqual(joined.motor1, [[8, 1000], [12, 1600], [3, 400]]);
  // motor2: a's half second, then rest for the rest of a and all of b.
  assert.deepEqual(joined.motor2, [[4, 500], [0, 2500]]);
  assert.equal(patternLength(joined), 3000);
  assert.deepEqual(stitchTracks([]), {});
});
