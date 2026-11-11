// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { FIELD_W } from './pulse-glide-logic.js';
import { clearOf, extendSkyline, makeCloud, mixHex, scrollSkyline, type SkylineLayer } from './glide-worlds.js';
import { seededRandom } from './pulse-glide-logic.js';

test('a colour fades into its own clear, not into black', () => {
  assert.strictEqual(clearOf('#ffffff'), 'rgba(255, 255, 255, 0)');
  assert.strictEqual(clearOf('#E8823A'), 'rgba(232, 130, 58, 0)');
});

test('mixHex blends two colours and leaves anything else alone', () => {
  assert.strictEqual(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.strictEqual(mixHex('#ff0000', '#0000ff', 0), '#ff0000');
  assert.strictEqual(mixHex('#ff0000', '#0000ff', 1), '#0000ff');
  assert.strictEqual(mixHex('rgb(1,2,3)', '#ffffff', 0.5), 'rgb(1,2,3)');
});

function coverage(layer: SkylineLayer) {
  const xs = [...layer.buildings].sort((a, b) => a.x - b.x);
  let gap = 0;
  for (let i = 1; i < xs.length; i++) gap = Math.max(gap, xs[i].x - (xs[i - 1].x + xs[i - 1].w));
  return { left: xs[0].x, right: Math.max(...xs.map((b) => b.x + b.w)), gap };
}

test('the skyline covers the field and keeps covering it as it scrolls', () => {
  const rand = seededRandom(7);
  const layer: SkylineLayer = { depth: 0.42, minH: 55, maxH: 150, litChance: 0.3, buildings: [] };
  extendSkyline(layer, rand);
  for (let step = 0; step < 3000; step++) {
    scrollSkyline(layer, 3.5, rand);
    const c = coverage(layer);
    assert.ok(c.left <= 0, 'no hole at the left edge');
    assert.ok(c.right >= FIELD_W, 'no hole at the right edge');
    assert.ok(c.gap <= 7, 'buildings never drift more than a narrow alley apart');
  }
  for (const b of layer.buildings) {
    assert.ok(b.h >= 55 && b.h < 150);
    assert.ok(b.windows.length >= 1 && b.windows[0].length >= 1);
  }
  // Old buildings are let go, so a long run doesn't grow the list forever.
  assert.ok(layer.buildings.length < 40);
});

test('every cloud is its own shape, rounded over the middle', () => {
  const rand = seededRandom(3);
  const a = makeCloud(0, rand);
  const b = makeCloud(0, rand);
  assert.notDeepStrictEqual(a.bumps, b.bumps);
  for (const c of [a, b]) {
    assert.ok(c.bumps.length >= 6 && c.bumps.length <= 9);
    const middle = c.bumps[Math.floor(c.bumps.length / 2)][2];
    assert.ok(middle > c.bumps[0][2] && middle > c.bumps[c.bumps.length - 1][2], 'taller in the middle than at the ends');
  }
});
