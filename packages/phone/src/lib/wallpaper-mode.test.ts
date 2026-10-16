// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyThemeUpdate, type WallpaperSet } from './wallpaper-mode.js';

type T = WallpaperSet & {
  mode: 'light' | 'dark';
  wallpaperFollowsMode?: boolean;
  modeWallpapers?: Partial<Record<'light' | 'dark', WallpaperSet>>;
  shapeRadius?: number;
};

const night: T = { mode: 'dark', wallpaper: 'moon.png', lockScreenWallpaper: 'moon-lock.png', wallpaperFollowsMode: true };

test('with it off, flipping the mode keeps the same wallpaper', () => {
  const out = applyThemeUpdate({ ...night, wallpaperFollowsMode: false }, { mode: 'light' });
  assert.equal(out.wallpaper, 'moon.png');
});

test('the first flip keeps the pictures and files the night set', () => {
  const out = applyThemeUpdate(night, { mode: 'light' });
  assert.equal(out.mode, 'light');
  assert.equal(out.wallpaper, 'moon.png');
  assert.equal(out.modeWallpapers?.dark?.wallpaper, 'moon.png');
});

test('each mode gets its own wallpaper back', () => {
  let t = applyThemeUpdate(night, { mode: 'light' });
  t = applyThemeUpdate(t, { wallpaper: 'sun.png', lockScreenWallpaper: undefined });
  t = applyThemeUpdate(t, { mode: 'dark' });
  assert.equal(t.wallpaper, 'moon.png');
  assert.equal(t.lockScreenWallpaper, 'moon-lock.png');
  t = applyThemeUpdate(t, { mode: 'light' });
  assert.equal(t.wallpaper, 'sun.png');
  assert.equal(t.lockScreenWallpaper, undefined);
});

test('changing something that is not the mode never swaps', () => {
  const out = applyThemeUpdate(night, { shapeRadius: 4 });
  assert.equal(out.wallpaper, 'moon.png');
  assert.equal(out.modeWallpapers, undefined);
});
