// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSketchDataUrl, isSketchId, sketchPaths } from './studio-sketch.js';

// The whole point of an id is that a client can never name a file for the
// generator to read. These pin the two doors that could let it: what counts as
// a sketch id, and what a data URL is allowed to be.

const PNG_1x1 =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('only a uuid is a sketch id', () => {
  assert.equal(isSketchId('9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'), true);
  for (const bad of [
    '',
    '../../etc/passwd',
    'not-a-uuid',
    '9f1b2c3d4e5f4a6b8c7d0e1f2a3b4c5d',
    '/data/sketches/9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d.png',
    42,
    null,
    undefined,
    { id: '9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d' },
  ]) {
    assert.equal(isSketchId(bad as never), false, JSON.stringify(bad));
  }
});

test('a path handed in where an id belongs resolves to nothing', () => {
  assert.deepEqual(sketchPaths(['../../../etc/passwd', '/etc/passwd', 'x.png']), []);
  assert.deepEqual(sketchPaths('9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'), []);
  assert.deepEqual(sketchPaths(null), []);
  assert.deepEqual(sketchPaths(undefined), []);
});

test('an id with no file behind it yields no path rather than a broken one', () => {
  assert.deepEqual(sketchPaths(['9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d']), []);
});

test('a canvas export decodes and a remote URL does not', () => {
  assert.ok((decodeSketchDataUrl(PNG_1x1) as Buffer).length > 64);
  for (const bad of [
    'https://example.com/cat.png',
    'file:///etc/passwd',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA',
    '',
    null,
    undefined,
    12,
  ]) {
    assert.equal(decodeSketchDataUrl(bad as never), null, JSON.stringify(bad));
  }
});

test('an absurd payload is refused rather than written to disk', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024);
  assert.equal(decodeSketchDataUrl(huge), null);
});
