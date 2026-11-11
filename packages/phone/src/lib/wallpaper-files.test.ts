// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineToBlob, inlineWallpapers, swapWallpapers } from './wallpaper-files.js';
import type { AppTheme } from '../types';

const home = 'data:image/png;base64,iVBORw0KGgo=';
const lock = 'data:image/webp;base64,UklGRg==';
const day = 'data:image/png;base64,AAAA';

// A real-world settings shape: the live set repeated as the Midnight set,
// plus a Daylight set of its own.
const theme = {
  mode: 'dark',
  id: 'pal-ember',
  wallpaper: home,
  lockScreenWallpaper: lock,
  wallpapers: [home, '/api/files/00000000-0000-4000-8000-000000000000'],
  slideshowEnabled: true,
  wallpaperFollowsMode: true,
  modeWallpapers: {
    dark: { wallpaper: home, lockScreenWallpaper: lock, slideshowEnabled: true },
    light: { wallpaper: day, lockScreenWallpaper: lock },
  },
} as unknown as AppTheme;

test('each inline picture is found once, however many places hold it', () => {
  assert.deepEqual(inlineWallpapers(theme).sort(), [day, home, lock].sort());
});

test('a picture with a link is swapped everywhere it appears and nothing else moves', () => {
  const links = new Map([[home, '/api/files/home'], [lock, '/api/files/lock']]);
  const next = swapWallpapers(theme, links);
  assert.equal(next.wallpaper, '/api/files/home');
  assert.equal(next.lockScreenWallpaper, '/api/files/lock');
  assert.deepEqual(next.wallpapers, ['/api/files/home', '/api/files/00000000-0000-4000-8000-000000000000']);
  assert.equal(next.modeWallpapers?.dark?.wallpaper, '/api/files/home');
  assert.equal(next.modeWallpapers?.dark?.slideshowEnabled, true);
  // No link came back for the Daylight picture, so it stays inline.
  assert.equal(next.modeWallpapers?.light?.wallpaper, day);
  assert.equal(next.modeWallpapers?.light?.lockScreenWallpaper, '/api/files/lock');
  assert.equal(next.slideshowEnabled, true);
  assert.equal(next.id, 'pal-ember');
  // The theme it was handed is untouched.
  assert.equal(theme.wallpaper, home);
});

test('with nothing confirmed the theme comes back as it was', () => {
  assert.equal(swapWallpapers(theme, new Map()), theme);
});

test('the bytes of an inline picture come back as they were written', async () => {
  const blob = inlineToBlob('data:image/png;base64,AAEC/w==');
  assert.ok(blob);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 1, 2, 255]);
  assert.equal(inlineToBlob('/api/files/abc'), null);
});
