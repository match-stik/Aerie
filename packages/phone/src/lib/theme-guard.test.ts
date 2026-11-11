// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardTheme } from './theme-guard.js';

const known = new Set(['custom', 'pal-obsidian', 'pal-inkwell', 'pal-fire']);

test('a good theme passes through untouched', () => {
  const t = { mode: 'light', id: 'pal-inkwell', wallpaper: 'w' };
  assert.deepEqual(guardTheme(t, known), t);
});

test('a palette id is a known id', () => {
  assert.equal(guardTheme({ mode: 'dark', id: 'pal-fire' }, known).id, 'pal-fire');
});

test('a mode that is not light or dark becomes dark', () => {
  assert.equal(guardTheme({ mode: 'x', id: 'pal-fire' }, known).mode, 'dark');
  assert.equal(guardTheme({ id: 'pal-fire' }, known).mode, 'dark');
});

test('an unknown id becomes Obsidian and keeps everything else', () => {
  const out = guardTheme({ mode: 'light', id: 'nope', shapeRadius: 9 }, known);
  assert.equal(out.id, 'pal-obsidian');
  assert.equal(out.shapeRadius, 9);
});

test('a retired accent moves to its matched palette, and custom stays', () => {
  assert.equal(guardTheme({ mode: 'light', id: 'sapphire' }, known).id, 'pal-inkwell');
  assert.equal(guardTheme({ mode: 'dark', id: 'monochrome' }, known).id, 'pal-obsidian');
  assert.equal(guardTheme({ mode: 'dark', id: 'custom' }, known).id, 'custom');
});
