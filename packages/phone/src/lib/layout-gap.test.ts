// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameTiming, layoutGap, summarizeKeyboardChange } from './layout-gap.js';

test('a full window with the app filling it is fine, typing or not', () => {
  assert.equal(layoutGap({ inner: 800, visual: 800, rootBottom: 800, typing: false }, 800), null);
  assert.equal(layoutGap({ inner: 480, visual: 480, rootBottom: 480, typing: true }, 800), null);
});

test('the app stopping above the bottom of a full window is the page staying short', () => {
  assert.equal(layoutGap({ inner: 800, visual: 800, rootBottom: 540, typing: false }, 800), 'root-short');
});

test('a window still keyboard-sized with nothing being typed is the app window staying short', () => {
  assert.equal(layoutGap({ inner: 520, visual: 520, rootBottom: 520, typing: false }, 800), 'window-short');
  assert.equal(layoutGap({ inner: 760, visual: 760, rootBottom: 760, typing: false }, 800), null);
});

test('a keyboard closing is recorded frame by frame, and a short flash of the app falling short is caught', () => {
  const trace = summarizeKeyboardChange([
    { t: 0, inner: 480, visual: 480, rootBottom: 480, docH: 480 },
    { t: 16, inner: 480, visual: 480, rootBottom: 480, docH: 480 },
    { t: 33, inner: 800, visual: 800, rootBottom: 480, docH: 800 },
    { t: 50, inner: 800, visual: 800, rootBottom: 800, docH: 800 },
    { t: 66, inner: 800, visual: 800, rootBottom: 800, docH: 800 },
  ]);
  assert.equal(trace.closed, true);
  assert.equal(trace.worstRootShort, 320, 'the one frame where the app lagged its window');
  assert.equal(trace.frames.length, 3, 'unchanged frames are dropped');
});

test('a close where the page stays whole in every frame says so', () => {
  const trace = summarizeKeyboardChange([
    { t: 0, inner: 480, visual: 480, rootBottom: 480, docH: 480 },
    { t: 40, inner: 800, visual: 800, rootBottom: 800, docH: 800 },
  ]);
  assert.equal(trace.closed, true);
  assert.equal(trace.worstRootShort, 0);
  assert.equal(trace.worstWindowShort, 0);
});

test('a keyboard opening is not a close', () => {
  assert.equal(summarizeKeyboardChange([
    { t: 0, inner: 800, visual: 800, rootBottom: 800, docH: 800 },
    { t: 40, inner: 480, visual: 480, rootBottom: 480, docH: 480 },
  ]).closed, false);
});

test('the message box is watched too, and a box that balloons while the keyboard moves is caught', () => {
  const trace = summarizeKeyboardChange([
    { t: -1, inner: 819, visual: 819, rootBottom: 819, docH: 819, boxTop: 760, boxH: 48 },
    { t: 0, inner: 503, visual: 503, rootBottom: 503, docH: 503, boxTop: 444, boxH: 48 },
    { t: 16, inner: 503, visual: 503, rootBottom: 503, docH: 503, boxTop: 300, boxH: 192 },
    { t: 33, inner: 503, visual: 503, rootBottom: 503, docH: 503, boxTop: 444, boxH: 48 },
  ]);
  assert.equal(trace.opened, true);
  assert.equal(trace.closed, false);
  assert.equal(trace.boxGrew, 144);
  assert.equal(trace.frames.length, 4, 'a frame where only the box changed is kept');
});

test('the stopwatch: how long the page took to draw its first frame after the keyboard moved, and its longest wait', () => {
  // Frames 16 ms apart, except one 640 ms stall after the second.
  const t = frameTiming(1000, [1016, 1032, 1672, 1688], []);
  assert.equal(t.firstFrameMs, 16);
  assert.equal(t.longestFrameMs, 640);
  assert.equal(t.busyMs, 0);
  assert.equal(t.longestTaskMs, 0);
  assert.deepEqual(t.tasks, []);
});

test('the stopwatch counts the page\'s long tasks around the move, the one already holding it up included', () => {
  const tasks = [
    { start: -5000, duration: 300 },  // long before the move: not this one
    { start: 380, duration: 600 },    // still running when the keyboard closed
    { start: 1005, duration: 610 },
    { start: 1900, duration: 70 },
    { start: 6000, duration: 90 },    // after the recording ended
  ];
  const t = frameTiming(1000, [1620, 1636], tasks);
  assert.equal(t.firstFrameMs, 620);
  assert.deepEqual(t.tasks, [[-620, 600], [5, 610], [900, 70]]);
  assert.equal(t.busyMs, 1280);
  assert.equal(t.longestTaskMs, 610);
});

test('no frames at all is reported as no reading, never as zero', () => {
  const t = frameTiming(1000, [], []);
  assert.equal(t.firstFrameMs, null);
  assert.equal(t.longestFrameMs, null);
});
