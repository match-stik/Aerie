// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barColorsFor } from './system-bar-colors.js';

const page = '#FAF6F3';
const at = (mode: 'light' | 'dark', osState: string, extra: { hasWallpaper?: boolean; showSettings?: boolean } = {}) =>
  barColorsFor({ mode, osState, hasWallpaper: extra.hasWallpaper ?? true, showSettings: extra.showSettings ?? false, pageBg: page });

test('inside an app the bars wear the frame and the page keeps its color', () => {
  assert.deepEqual(at('light', 'messages'), { bars: '#FFFFFF', body: page });
  assert.deepEqual(at('dark', 'messages'), { bars: '#000000', body: page });
});

test('the home screen keeps the frame, so coming home from a white app does not flip', () => {
  assert.deepEqual(at('light', 'home'), { bars: '#FFFFFF', body: '#000000' });
  assert.deepEqual(at('dark', 'home'), { bars: '#000000', body: '#000000' });
});

test('the lock screen keeps its black bar in both modes', () => {
  assert.equal(at('light', 'locked').bars, '#000000');
  assert.equal(at('dark', 'locked').bars, '#000000');
});

test('a home screen with no wallpaper is just a page, and Settings over it wears the frame', () => {
  assert.deepEqual(at('light', 'home', { hasWallpaper: false }), { bars: '#FFFFFF', body: page });
  assert.deepEqual(at('light', 'locked', { showSettings: true }), { bars: '#FFFFFF', body: page });
});
