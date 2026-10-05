// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMetres, isOpenable, type Threshold } from './thresholds.js';

// The proximity maths is the whole feature. If this drifts, a place either
// never opens or opens from the wrong side of town, and both of those are
// the bug.
//
// Every coordinate below is a synthetic round number on purpose. Fixtures
// must never be anybody's actual doorstep — a repo remembers what it was
// handed, and a test file is a strange place to learn where somebody lives.

const LAT = 42.0, LNG = 0.0;

test('distanceMetres is zero for the same point', () => {
  assert.equal(Math.round(distanceMetres(LAT, LNG, LAT, LNG)), 0);
});

test('distanceMetres matches a known degree of latitude', () => {
  // One degree of latitude is ~111.19 km anywhere on the globe.
  assert.ok(Math.abs(distanceMetres(0, 0, 1, 0) - 111195) < 50);
});

test('distanceMetres narrows with longitude at higher latitude', () => {
  // Well away from the equator a degree of longitude is noticeably shorter
  // than one of latitude. LAT is the only thing that decides that — the
  // number does not get repeated in prose, or changing it makes this a lie.
  const north = distanceMetres(LAT, LNG, LAT + 0.001, LNG);
  const east = distanceMetres(LAT, LNG, LAT, LNG + 0.001);
  assert.ok(east < north, 'longitude should be the shorter degree this far north');
});

test('distanceMetres over a long haul stays sane', () => {
  // One degree down and one across at this latitude, ~139 km.
  const km = distanceMetres(LAT, LNG, LAT - 1, LNG + 1) / 1000;
  assert.ok(km > 130 && km < 150, `expected ~139km, got ${km.toFixed(1)}`);
});

test('a 120m radius includes 100m and excludes 220m', () => {
  assert.ok(distanceMetres(LAT, LNG, LAT + 0.0009, LNG) <= 120);
  assert.ok(distanceMetres(LAT, LNG, LAT + 0.002, LNG) > 120);
});

function threshold(over: Partial<Threshold>): Threshold {
  return {
    id: 't', place_id: 'p', author: 'birch', kind: 'note', content: 'x',
    file_id: null, seal: 'immediate', open_at: null,
    created_at: new Date(0).toISOString(), first_found_at: null,
    ...over,
  };
}

test('a first_visit seal cannot be read from somewhere else', () => {
  const t = threshold({ seal: 'first_visit' });
  assert.equal(isOpenable(t, false), false);
  assert.equal(isOpenable(t, true), true);
});

test('an immediate seal opens from anywhere', () => {
  const t = threshold({ seal: 'immediate' });
  assert.equal(isOpenable(t, false), true);
});

test('a date seal holds until its date, wherever the owner is standing', () => {
  const future = threshold({ seal: 'date', open_at: '2999-01-01T00:00:00.000Z' });
  const past = threshold({ seal: 'date', open_at: '2000-01-01T00:00:00.000Z' });
  assert.equal(isOpenable(future, true), false);
  assert.equal(isOpenable(past, false), true);
});
