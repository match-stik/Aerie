// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RADIUS_M, MAX_REGIONS, regionsFor } from './geofence-regions';

const place = (over: Record<string, unknown> = {}) => ({
  id: 'a', name: 'Home', lat: 42.2, lng: -89.0, radius_m: 60, waiting: 1, ...over,
});

test('keeps a well-formed place intact', () => {
  const [only] = regionsFor([place()]);
  assert.deepEqual(only, { id: 'a', name: 'Home', lat: 42.2, lng: -89.0, radius_m: 60, waiting: 1 });
});

test('drops anything it could not put on a map', () => {
  const rows = [
    place({ id: '' }),
    place({ id: '  ' }),
    place({ lat: null }),
    place({ lng: 'not a number' }),
    place({ lat: Number.NaN }),
    null,
    'nonsense',
  ];
  assert.equal(regionsFor(rows).length, 0);
});

test('a missing or useless radius becomes the default rather than a zero circle', () => {
  assert.equal(regionsFor([place({ radius_m: undefined })])[0].radius_m, DEFAULT_RADIUS_M);
  assert.equal(regionsFor([place({ radius_m: 0 })])[0].radius_m, DEFAULT_RADIUS_M);
  assert.equal(regionsFor([place({ radius_m: -5 })])[0].radius_m, DEFAULT_RADIUS_M);
});

test('numeric strings from JSON still count as coordinates', () => {
  const [only] = regionsFor([place({ lat: '42.5', lng: '-89.25' })]);
  assert.equal(only.lat, 42.5);
  assert.equal(only.lng, -89.25);
});

test('over the ceiling it keeps the places holding the most, not the first hundred', () => {
  const rows = Array.from({ length: MAX_REGIONS + 5 }, (_, i) => place({
    id: `p${i}`, name: `Place ${String(i).padStart(3, '0')}`, waiting: i === MAX_REGIONS + 4 ? 99 : 1,
  }));
  const picked = regionsFor(rows);
  assert.equal(picked.length, MAX_REGIONS);
  assert.equal(picked[0].waiting, 99, 'the fullest place must survive the cut');
});

test('the same input registers the same hundred every launch', () => {
  const rows = Array.from({ length: MAX_REGIONS + 3 }, (_, i) => place({
    id: `p${i}`, name: `Place ${String(i).padStart(3, '0')}`, waiting: 1,
  }));
  assert.deepEqual(regionsFor(rows).map(p => p.id), regionsFor([...rows].reverse()).map(p => p.id));
});

test('a non-array answer is no regions rather than a crash', () => {
  assert.deepEqual(regionsFor(undefined), []);
  assert.deepEqual(regionsFor({ places: [] }), []);
});
