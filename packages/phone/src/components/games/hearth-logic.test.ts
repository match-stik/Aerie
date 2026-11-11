// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  CX,
  CY,
  FIELD_H,
  FIELD_W,
  FIRE_R,
  chainMultiplier,
  chargeFlare,
  emberHits,
  hourName,
  lightRadius,
  offField,
  pickKind,
  reachesFire,
  spawnPoint,
  waveFor,
} from './hearth-logic.js';

test('the night runs Dusk to 4 AM, then toward dawn', () => {
  assert.strictEqual(hourName(1), 'Dusk');
  assert.strictEqual(hourName(8), '3 AM');
  assert.strictEqual(hourName(9), '4 AM');
  assert.strictEqual(hourName(10), 'Toward dawn');
  assert.strictEqual(hourName(40), 'Toward dawn');
});

test('each hour is busier and faster than the last, within limits', () => {
  for (let n = 2; n <= 12; n++) {
    const a = waveFor(n - 1);
    const b = waveFor(n);
    assert.ok(b.count >= a.count && b.every <= a.every && b.speed >= a.speed, `wave ${n}`);
  }
  assert.ok(waveFor(99).count <= 40 && waveFor(99).every >= 18 && waveFor(99).speed <= 1.6);
});

test('new things come out as the night goes on', () => {
  assert.deepStrictEqual([...new Set(waveFor(1).kinds)].sort(), ['moth', 'shade']);
  assert.ok(waveFor(2).kinds.includes('creep'));
  assert.ok(!waveFor(2).kinds.includes('wisp'));
  assert.ok(waveFor(3).kinds.includes('wisp'));
  const w = waveFor(3);
  assert.strictEqual(pickKind(w, 0), w.kinds[0]);
  assert.strictEqual(pickKind(w, 0.9999999), w.kinds[w.kinds.length - 1]);
});

test('arrivals start off the field, all the way round', () => {
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    const p = spawnPoint(a);
    assert.ok(p.x < 0 || p.x > FIELD_W || p.y < 0 || p.y > FIELD_H, `angle ${a}`);
    assert.ok(!offField(p.x, p.y, 60), 'but not so far they take forever');
  }
});

test('chains multiply, capped at four', () => {
  assert.deepStrictEqual([0, 4, 5, 9, 10, 15, 99].map(chainMultiplier), [1, 1, 2, 2, 3, 4, 4]);
});

test('the flare fills in ten hits and stops at full', () => {
  let c = 0;
  for (let i = 0; i < 10; i++) c = chargeFlare(c);
  assert.ok(Math.abs(c - 1) < 1e-9);
  assert.strictEqual(chargeFlare(1), 1);
});

test('the firelight closes in as things get near', () => {
  assert.ok(lightRadius(400) > lightRadius(120));
  assert.ok(lightRadius(120) > lightRadius(30));
  assert.strictEqual(lightRadius(0), 70);
});

test('touching the fire, and being hit by an ember', () => {
  assert.ok(reachesFire(CX + FIRE_R + 5, CY, 8));
  assert.ok(!reachesFire(CX + FIRE_R + 9, CY, 8));
  assert.ok(emberHits(100, 100, 108, 100, 6));
  assert.ok(!emberHits(100, 100, 120, 100, 6));
});
