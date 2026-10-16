// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { motorsFor, presetsFor } from './toy-motors.js';

// Command lists as Lovense's SDK README gives them for a few toys.
const FLEXER = ['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'FLASH', 'PRESET', 'FLEXER_VIBRATE', 'FLEXER_FINGER', 'MULTIPLY', 'SET_AUTO_SWITCH'];
const DOMI2 = ['VIBRATE', 'VIBRATE_FLASH', 'FLASH', 'ALIGHT_ON', 'ALIGHT_OFF', 'PRESET', 'SET_AUTO_SWITCH'];
const FERRI = ['VIBRATE', 'FLASH', 'PRESET', 'SET_AUTO_SWITCH'];
const GEMINI = ['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'FLASH', 'PRESET', 'SET_AUTO_SWITCH'];

const commands = (list: string[]) => motorsFor({ commands: list }).map((m) => m.command);

test('the Flexer gets its vibration and its fingering, and nothing doubled', () => {
  assert.deepEqual(commands(FLEXER), ['FLEXER_VIBRATE', 'FLEXER_FINGER']);
});

test('a toy with two numbered motors gets one slider for each', () => {
  assert.deepEqual(commands(GEMINI), ['VIBRATE1', 'VIBRATE2']);
});

test('a one-motor toy gets the plain vibration', () => {
  assert.deepEqual(commands(DOMI2), ['VIBRATE']);
  assert.deepEqual(commands(FERRI), ['VIBRATE']);
});

test('a toy that has not said what it can do still gets the plain vibration', () => {
  assert.deepEqual(commands([]), ['VIBRATE']);
});

test('every toy offers the four patterns Lovense toys keep', () => {
  assert.equal(presetsFor({ commands: FLEXER }), 4);
  assert.equal(presetsFor({ commands: FERRI }), 4);
  assert.equal(presetsFor({ commands: DOMI2 }), 4);
});

test('a toy with no patterns of its own gets no pattern row', () => {
  assert.equal(presetsFor({ commands: ['VIBRATE', 'FLASH'] }), 0);
});

test('a toy with an air pump gets a pump slider that tops out at 3 (untested on a real toy)', () => {
  const MAX2 = ['VIBRATE', 'AIR_IN', 'AIR_OUT', 'AIR_AUTO', 'PRESET'];
  assert.deepEqual(commands(MAX2), ['VIBRATE', 'AIR_AUTO']);
  assert.equal(motorsFor({ commands: MAX2 }).find((m) => m.command === 'AIR_AUTO')?.max, 3);
});
