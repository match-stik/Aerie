// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockFromWindow, hourLabel, windowFromClock, windowSentence } from './visit-window.js';

test('hours read as clock times', () => {
  assert.equal(hourLabel(0), '12 AM');
  assert.equal(hourLabel(10), '10 AM');
  assert.equal(hourLabel(12), '12 PM');
  assert.equal(hourLabel(22), '10 PM');
  assert.equal(hourLabel(26), '2 AM');
});

test('an Until earlier than From runs into the next morning', () => {
  assert.deepEqual(windowFromClock(10, 2), { start: 10, end: 26 });
  assert.deepEqual(windowFromClock(10, 22), { start: 10, end: 22 });
  assert.deepEqual(windowFromClock(10, 10), { start: 10, end: 34 }, 'the same hour is a whole day round');
  assert.deepEqual(clockFromWindow(10, 26), { from: 10, until: 2 });
});

test('the window is said the way a person would say it', () => {
  assert.equal(windowSentence(10, 26), 'From 10 AM until 2 AM the next morning');
  assert.equal(windowSentence(10, 22), 'From 10 AM until 10 PM');
  assert.equal(windowSentence(8, 24), 'From 8 AM until 12 AM the next morning');
});
