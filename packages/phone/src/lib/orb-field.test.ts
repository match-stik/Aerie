// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_BACKDROP, backdropFor, cssColorToHex, levelForHeight, mixHex, ownerForCompanion, ownerForSlot } from './orb-field.js';

test('an orb near the top of the glass is full, and the bottom strip is off', () => {
  assert.equal(levelForHeight(0, 1000, 20), 20);
  assert.equal(levelForHeight(50, 1000, 20), 20);
  assert.equal(levelForHeight(950, 1000, 20), 0);
  assert.equal(levelForHeight(1000, 1000, 20), 0);
});

test('between them the level climbs with the finger', () => {
  const low = levelForHeight(800, 1000, 20);
  const mid = levelForHeight(500, 1000, 20);
  const high = levelForHeight(200, 1000, 20);
  assert.ok(low > 0 && low < mid && mid < high && high < 20, `${low} ${mid} ${high}`);
});

test('each of the first four fingers wears its own color, and a companion keeps the same one', () => {
  const colors = [0, 1, 2, 3].map((slot) => ownerForSlot(slot).color);
  assert.equal(new Set(colors).size, 4);
  assert.equal(ownerForSlot(4).color, colors[0]);
  assert.deepEqual(ownerForCompanion('birch'), ownerForCompanion(' Birch '));
  assert.equal(ownerForCompanion('birch').name, 'Birch');
  assert.ok(colors.slice(0, 3).includes(ownerForCompanion('willow').color));
});

test('the orbs screen follows the theme, deepened so the orbs still read, and falls back when it cannot tell', () => {
  const b = backdropFor('#ff0000', '#0000ff');
  assert.equal(b.bloom, '#ff0000');
  assert.equal(b.top, mixHex('#ff0000', 20, '#0d0b14'));
  assert.equal(b.foot, mixHex('#0000ff', 30, '#120a10'));
  // Deep: no channel of the screen comes anywhere near the theme's full color.
  for (const stop of [b.top, b.mid, b.foot]) {
    const n = parseInt(stop.slice(1), 16);
    assert.ok(((n >> 16) & 255) < 90 && ((n >> 8) & 255) < 90 && (n & 255) < 90, stop);
  }
  assert.deepEqual(backdropFor(null, null), DEFAULT_BACKDROP);
  assert.deepEqual(backdropFor('not a color', '#0000ff'), DEFAULT_BACKDROP);
  assert.equal(backdropFor('#ff0000', null).mid, mixHex('#ff0000', 16, '#0b0910'));
});

test('a theme color reads back as hex whichever way the browser writes it', () => {
  assert.equal(cssColorToHex('#AbCdEf'), '#abcdef');
  assert.equal(cssColorToHex('#fa0'), '#ffaa00');
  assert.equal(cssColorToHex('rgb(255, 128, 0)'), '#ff8000');
  assert.equal(cssColorToHex('rgba(1, 2, 3, 0.5)'), '#010203');
  assert.equal(cssColorToHex('color(srgb 1 0.5 0)'), '#ff8000');
  assert.equal(cssColorToHex('var(--x)'), null);
  assert.equal(mixHex('#ffffff', 50, '#000000'), '#808080');
});
